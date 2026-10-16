import { USERNAME_PATTERN } from "../auth/auth.dto";
import { publicIdentity, publicIdentitySelect } from "./public-identity";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  Prisma,
  ProfileAudienceField,
  ProfileAudienceMode,
  UserStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccountsService } from "./accounts.service";
import { SaveSelfProfileDto } from "./profile-privacy.dto";
import { ReplaceProfileAudienceDto } from "./profile-privacy.dto";
import { audienceAllows } from "./profile-audience";

const recipients = {
  accountRecipients: true,
  workspaceRecipients: true,
} as const;
const fields = Object.values(ProfileAudienceField);
@Injectable()
export class ProfilePrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}
  private async owner(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    id: string,
  ) {
    if (
      !(await tx.user.findFirst({
        where: { id, workspaceId, status: UserStatus.OPEN },
        select: { id: true },
      }))
    )
      throw new NotFoundException("User not found");
  }
  private transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    write = false,
  ) {
    return this.prisma
      .$transaction(action, {
        isolationLevel: write
          ? Prisma.TransactionIsolationLevel.Serializable
          : Prisma.TransactionIsolationLevel.RepeatableRead,
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        )
          throw new ConflictException(
            "Profile privacy changed concurrently; reread before retrying",
          );
        throw new ServiceUnavailableException(
          "Profile privacy is temporarily unavailable",
        );
      });
  }
  policies(workspaceId: string, ownerId: string) {
    return this.transaction(async (tx) => {
      await this.owner(tx, workspaceId, ownerId);
      const rows = await tx.profileAudiencePolicy.findMany({
        where: { ownerId },
        include: recipients,
      });
      return fields.map((field) =>
        this.response(
          field,
          rows.find((row) => row.field === field),
        ),
      );
    });
  }
  private response(
    field: ProfileAudienceField,
    row?: {
      mode: ProfileAudienceMode;
      accountRecipients: { accountId: string }[];
      workspaceRecipients: { workspaceId: string }[];
    },
  ) {
    const custom = row?.mode === ProfileAudienceMode.CUSTOM;
    const accountIds = custom
      ? row.accountRecipients.map((r) => r.accountId).sort()
      : [];
    const workspaceIds = custom
      ? row.workspaceRecipients.map((r) => r.workspaceId).sort()
      : [];
    return {
      field,
      mode: row?.mode ?? ProfileAudienceMode.NO_ONE,
      accountIds,
      workspaceIds,
      accountCount: accountIds.length,
      workspaceCount: workspaceIds.length,
    };
  }
  replace(
    workspaceId: string,
    ownerId: string,
    field: ProfileAudienceField,
    dto: ReplaceProfileAudienceDto,
  ) {
    this.validateAudience(field, dto);
    return this.transaction(
      (tx) => this.replaceInTransaction(tx, workspaceId, ownerId, field, dto),
      true,
    );
  }
  private validateAudience(
    field: ProfileAudienceField,
    dto: ReplaceProfileAudienceDto,
  ) {
    if (
      !fields.includes(field) ||
      !Object.values(ProfileAudienceMode).includes(dto.mode) ||
      !Array.isArray(dto.accountIds) ||
      !Array.isArray(dto.workspaceIds) ||
      dto.accountIds.length > 500 ||
      dto.workspaceIds.length > 500 ||
      new Set(dto.accountIds).size !== dto.accountIds.length ||
      new Set(dto.workspaceIds).size !== dto.workspaceIds.length
    )
      throw new BadRequestException("Invalid profile audience");
    if (
      dto.mode !== ProfileAudienceMode.CUSTOM &&
      (dto.accountIds.length || dto.workspaceIds.length)
    )
      throw new BadRequestException("Recipient sets require CUSTOM");
  }
  private async replaceInTransaction(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    ownerId: string,
    field: ProfileAudienceField,
    dto: ReplaceProfileAudienceDto,
  ) {
    await this.owner(tx, workspaceId, ownerId);
    const accounts = await tx.user.count({
      where: { id: { in: dto.accountIds }, status: UserStatus.OPEN },
    });
    const workspaces = await tx.workspace.count({
      where: { id: workspaceId, AND: { id: { in: dto.workspaceIds } } },
    });
    if (
      accounts !== dto.accountIds.length ||
      workspaces !== dto.workspaceIds.length
    )
      throw new BadRequestException("One or more recipients are unavailable");
    await tx.profileAudiencePolicy.upsert({
      where: { ownerId_field: { ownerId, field } },
      create: { ownerId, field, mode: dto.mode },
      update: { mode: dto.mode },
    });
    await tx.profileAudienceAccountRecipient.deleteMany({
      where: { ownerId, field },
    });
    await tx.profileAudienceWorkspaceRecipient.deleteMany({
      where: { ownerId, field },
    });
    if (dto.accountIds.length)
      await tx.profileAudienceAccountRecipient.createMany({
        data: dto.accountIds.map((accountId) => ({
          ownerId,
          field,
          accountId,
        })),
      });
    if (dto.workspaceIds.length)
      await tx.profileAudienceWorkspaceRecipient.createMany({
        data: dto.workspaceIds.map((workspaceId) => ({
          ownerId,
          field,
          workspaceId,
        })),
      });
    return this.response(
      field,
      await tx.profileAudiencePolicy.findUniqueOrThrow({
        where: { ownerId_field: { ownerId, field } },
        include: recipients,
      }),
    );
  }

  save(workspaceId: string, ownerId: string, dto: SaveSelfProfileDto) {
    if (
      !Array.isArray(dto.audiences) ||
      dto.audiences.length > 5 ||
      dto.audiences.some((p) => !p || typeof p !== "object" || Array.isArray(p))
    )
      throw new BadRequestException("Invalid profile audiences");
    for (const policy of dto.audiences)
      this.validateAudience(policy.field, policy);
    if (
      new Set(dto.audiences.map((p) => p.field)).size !== dto.audiences.length
    )
      throw new BadRequestException("Each audience field may appear only once");
    for (const policy of dto.audiences) {
      if (
        policy.mode !== ProfileAudienceMode.CUSTOM &&
        (policy.accountIds.length || policy.workspaceIds.length)
      )
        throw new BadRequestException("Recipient sets require CUSTOM");
    }
    return this.transaction(async (tx) => {
      const profile = await this.accounts.updateSelfInTransaction(
        tx,
        workspaceId,
        ownerId,
        dto,
      );
      for (const policy of dto.audiences)
        await this.replaceInTransaction(
          tx,
          workspaceId,
          ownerId,
          policy.field,
          policy,
        );
      const rows = await tx.profileAudiencePolicy.findMany({
        where: { ownerId },
        include: recipients,
      });
      return {
        profile,
        audiences: fields.map((field) =>
          this.response(
            field,
            rows.find((r) => r.field === field),
          ),
        ),
      };
    }, true);
  }
  contacts(workspaceId: string, ownerId: string) {
    return this.transaction(async (tx) => {
      await this.owner(tx, workspaceId, ownerId);
      const rows = await tx.profileContact.findMany({
        where: { ownerId },
        orderBy: { contactAccountId: "asc" },
      });
      return rows.map((r) => ({
        accountId: r.contactAccountId,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }
  addContact(workspaceId: string, ownerId: string, contactAccountId: string) {
    return this.transaction(async (tx) => {
      await this.owner(tx, workspaceId, ownerId);
      if (
        !(await tx.user.findFirst({
          where: { id: contactAccountId, status: UserStatus.OPEN },
          select: { id: true },
        }))
      )
        throw new BadRequestException("Contact account is unavailable");
      const row = await tx.profileContact.upsert({
        where: { ownerId_contactAccountId: { ownerId, contactAccountId } },
        create: { ownerId, contactAccountId },
        update: {},
      });
      return {
        accountId: row.contactAccountId,
        createdAt: row.createdAt.toISOString(),
      };
    }, true);
  }
  removeContact(
    workspaceId: string,
    ownerId: string,
    contactAccountId: string,
  ) {
    return this.transaction(async (tx) => {
      await this.owner(tx, workspaceId, ownerId);
      await tx.profileContact.deleteMany({
        where: { ownerId, contactAccountId },
      });
      return { removed: true };
    }, true);
  }
  publicProfile(where: { id?: string; username?: string }, viewerId?: string) {
    if (where.username !== undefined) {
      const username = where.username.replace(/^@/, "").trim().toLowerCase();
      if (!USERNAME_PATTERN.test(username))
        throw new NotFoundException("Profile not found");
      where = { username };
    }
    return this.transaction(async (tx) => {
      const owner = await tx.user.findFirst({
        where: { ...where, status: UserStatus.OPEN },
        select: { ...publicIdentitySelect, bio: true, birthDate: true },
      });
      if (!owner) throw new NotFoundException("Profile not found");
      const viewer = viewerId
        ? await tx.user.findFirst({
            where: { id: viewerId, status: UserStatus.OPEN },
            select: { id: true, workspaceId: true },
          })
        : null;
      const policies = await tx.profileAudiencePolicy.findMany({
        where: { ownerId: owner.id },
        include: recipients,
      });
      const contact = viewer
        ? !!(await tx.profileContact.findUnique({
            where: {
              ownerId_contactAccountId: {
                ownerId: owner.id,
                contactAccountId: viewer.id,
              },
            },
            select: { ownerId: true },
          }))
        : false;
      const allows = (field: ProfileAudienceField) =>
        audienceAllows(
          policies.find((p) => p.field === field),
          viewer,
          contact,
        );
      return {
        ...publicIdentity(owner),
        bio: allows(ProfileAudienceField.BIO) ? owner.bio : null,
        birthdayDayMonth:
          owner.birthDate && allows(ProfileAudienceField.BIRTHDAY_DAY_MONTH)
            ? {
                day: owner.birthDate.getUTCDate(),
                month: owner.birthDate.getUTCMonth() + 1,
              }
            : null,
        birthdayYear:
          owner.birthDate && allows(ProfileAudienceField.BIRTHDAY_YEAR)
            ? owner.birthDate.getUTCFullYear()
            : null,
      };
    });
  }
  // Internal field-only projection; public identity is explicitly allowlisted above.
  project(ownerId: string, viewerId?: string) {
    return this.transaction(async (tx) => {
      const hidden = { bio: null, birthdayDayMonth: null, birthdayYear: null };
      const owner = await tx.user.findFirst({
        where: { id: ownerId, status: UserStatus.OPEN },
        select: { bio: true, birthDate: true },
      });
      if (!owner) return hidden;
      const viewer = viewerId
        ? await tx.user.findFirst({
            where: { id: viewerId, status: UserStatus.OPEN },
            select: { id: true, workspaceId: true },
          })
        : null;
      const policies = await tx.profileAudiencePolicy.findMany({
        where: { ownerId },
        include: recipients,
      });
      const contact = viewer
        ? !!(await tx.profileContact.findUnique({
            where: {
              ownerId_contactAccountId: {
                ownerId,
                contactAccountId: viewer.id,
              },
            },
            select: { ownerId: true },
          }))
        : false;
      const allows = (field: ProfileAudienceField) =>
        audienceAllows(
          policies.find((p) => p.field === field),
          viewer,
          contact,
        );
      return {
        bio: allows(ProfileAudienceField.BIO) ? owner.bio : null,
        birthdayDayMonth:
          owner.birthDate && allows(ProfileAudienceField.BIRTHDAY_DAY_MONTH)
            ? {
                day: owner.birthDate.getUTCDate(),
                month: owner.birthDate.getUTCMonth() + 1,
              }
            : null,
        birthdayYear:
          owner.birthDate && allows(ProfileAudienceField.BIRTHDAY_YEAR)
            ? owner.birthDate.getUTCFullYear()
            : null,
      };
    });
  }
}
