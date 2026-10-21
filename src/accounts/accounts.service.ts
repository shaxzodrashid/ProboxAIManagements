import { lockWorkspace } from "../prisma/workspace-lock";
import { readDependency } from "../prisma/read-dependency";
import { assertCurrentManagement } from "../prisma/current-management";
import { Permissions } from "../authorization/permission.catalog";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { parseBirthDate } from "./profile-birthday";
import { parsePhoneNumber } from "libphonenumber-js";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto, UpdateSelfProfileDto } from "./accounts.dto";
import { SelfTelegramLinkResponseDto } from "./telegram-link.dto";
import { AuthorizationService } from "../authorization/authorization.service";
import { SystemRoleKeys } from "../authorization/permission.catalog";
import {
  databaseOperationError,
  operationError,
  uniqueTarget,
} from "../openapi/operation-errors";

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}
  async create(workspaceId: string, actorId: string, dto: CreateUserDto) {
    const structured =
      dto.firstName !== undefined || dto.lastName !== undefined;
    if (structured === (dto.fullName !== undefined))
      throw new BadRequestException(
        "Supply either fullName or structured names, never both",
      );
    const nameData = structured
      ? { firstName: dto.firstName ?? null, lastName: dto.lastName ?? null }
      : {};
    const fullName = structured
      ? composeName(dto.firstName, dto.lastName)
      : dto.fullName!;
    if (!fullName)
      throw new BadRequestException("At least one name component is required");
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        await assertCurrentManagement(
          tx,
          workspaceId,
          actorId,
          Permissions.USERS_MANAGE,
        );
        const roleIds = await this.authorization.resolveRoleIds(
          workspaceId,
          dto.roleIds,
          dto.role,
          tx,
        );
        const user = await tx.user.create({
          data: {
            workspaceId,
            fullName,
            ...nameData,
            phoneNumber: normalize(dto.phoneNumber),
            status: UserStatus.PENDING,
            roleAssignments: {
              create: roleIds.map((roleId) => ({
                roleId,
                assignedById: actorId,
              })),
            },
          },
          select: userResponseSelect,
        });
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { authorizationRevision: { increment: 1 } },
        });
        return toUserResponse(user);
      });
    } catch (error) {
      if (uniqueTarget(error, ["phoneNumber"], "User_phoneNumber_key"))
        throw operationError(
          409,
          "USER_PHONE_CONFLICT",
          "A user with this phone number already exists",
          "createUser",
          "phoneNumber",
        );
      databaseOperationError(error, "createUser");
    }
  }
  async verifyTelegramContact(input: {
    fromId: number;
    chatId: number;
    chatType?: string;
    contactUserId?: number;
    phoneNumber: string;
  }) {
    if (input.chatType !== "private" || input.contactUserId !== input.fromId)
      return false;
    const phoneNumber = normalize(input.phoneNumber);
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, status: "PENDING" },
    });
    if (!user) return false;
    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          telegramUserId: BigInt(input.fromId),
          telegramChatId: BigInt(input.chatId),
          verifiedAt: new Date(),
        },
      });
      return true;
    } catch {
      throw new ConflictException("Telegram identity is already linked");
    }
  }
  async list(workspaceId: string) {
    const users = await readDependency("listUsers", () =>
      this.prisma.user.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        select: userResponseSelect,
      }),
    );
    return users.map(toUserResponse);
  }

  async self(workspaceId: string, id: string) {
    const user = await readDependency("readSelfProfile", () =>
      this.prisma.user.findFirst({
        where: { id, workspaceId, status: UserStatus.OPEN },
        select: selfProfileSelect,
      }),
    );
    if (!user) throw new NotFoundException("User not found");
    return toSelfProfile(user);
  }

  async telegramLink(
    workspaceId: string,
    id: string,
  ): Promise<SelfTelegramLinkResponseDto> {
    const user = await readDependency("readSelfTelegramLink", () =>
      this.prisma.user.findFirst({
        where: { id, workspaceId, status: UserStatus.OPEN },
        select: {
          telegramUserId: true,
          telegramChatId: true,
          verifiedAt: true,
        },
      }),
    );
    if (!user) throw new NotFoundException("User not found");
    const presence = [
      user.telegramUserId,
      user.telegramChatId,
      user.verifiedAt,
    ].map((value) => value != null);
    return {
      linkState: presence.every(Boolean)
        ? "LINKED"
        : presence.some(Boolean)
          ? "INCOMPLETE"
          : "NOT_LINKED",
    };
  }

  async updateSelf(workspaceId: string, id: string, dto: UpdateSelfProfileDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      return this.updateSelfInTransaction(tx, workspaceId, id, dto);
    });
  }
  async updateSelfInTransaction(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    id: string,
    dto: UpdateSelfProfileDto,
  ) {
    // Explicit service allowlist complements HTTP whitelist validation.
    const data: Prisma.UserUpdateManyMutationInput = {};
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.birthDate !== undefined)
      data.birthDate =
        dto.birthDate === null ? null : parseBirthDate(dto.birthDate);
    const changesNames =
      dto.firstName !== undefined || dto.lastName !== undefined;

    const where = { id, workspaceId, status: UserStatus.OPEN };
    const current = await tx.user.findFirst({
      where,
      select: selfProfileSelect,
    });
    if (!current) throw new NotFoundException("User not found");
    if (changesNames) {
      const firstName =
        dto.firstName === undefined ? current.firstName : dto.firstName;
      const lastName =
        dto.lastName === undefined ? current.lastName : dto.lastName;
      const fullName = composeName(firstName, lastName);
      if (!fullName)
        throw new BadRequestException(
          "A name update must leave at least one nonempty component",
        );
      Object.assign(data, { firstName, lastName, fullName });
    }
    if (!Object.keys(data).length) return toSelfProfile(current);
    const result = await tx.user.updateMany({
      where: {
        ...where,
        ...(changesNames
          ? {
              firstName: current.firstName,
              lastName: current.lastName,
              fullName: current.fullName,
            }
          : {}),
      },
      data,
    });
    if (!result.count)
      throw new ConflictException(
        "Profile changed concurrently; reread before retrying",
      );
    const updated = await tx.user.findFirst({
      where,
      select: selfProfileSelect,
    });
    if (!updated) throw new NotFoundException("User not found");
    return toSelfProfile(updated);
  }
  async ban(workspaceId: string, actorId: string, id: string) {
    return this.setTerminalStatus(workspaceId, actorId, id, UserStatus.BANNED);
  }
  async delete(workspaceId: string, actorId: string, id: string) {
    return this.setTerminalStatus(workspaceId, actorId, id, UserStatus.DELETED);
  }
  private async setTerminalStatus(
    workspaceId: string,
    actorId: string,
    id: string,
    status: UserStatus,
  ) {
    if (actorId === id)
      throw operationError(
        400,
        "SELF_USER_PROTECTED",
        "Users cannot ban or delete themselves",
        "changeUserStatus",
      );
    return this.prisma
      .$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        await assertCurrentManagement(
          tx,
          workspaceId,
          actorId,
          Permissions.USERS_MANAGE,
        );
        const user = await tx.user.findFirst({
          where: { id, workspaceId },
        });
        if (!user)
          throw operationError(
            404,
            "RESOURCE_NOT_FOUND",
            "User not found",
            "changeUserStatus",
          );
        const ownedProjects = await tx.project.count({
          where: { creatorId: id },
        });
        if (ownedProjects)
          throw operationError(
            409,
            "USER_OWNS_PROJECTS",
            "This user owns project records and cannot be banned or deleted until they are removed",
            "changeUserStatus",
          );

        const updated = await tx.user.update({
          where: { id },
          data: { status },
          select: userResponseSelect,
        });
        await tx.sessionToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { authorizationRevision: { increment: 1 } },
        });
        return toUserResponse(updated);
      })
      .catch((error) => databaseOperationError(error, "changeUserStatus"));
  }
}

const userResponseSelect = {
  id: true,
  fullName: true,
  firstName: true,
  lastName: true,
  username: true,
  phoneNumber: true,
  roleAssignments: {
    select: { role: { select: { id: true, key: true, name: true } } },
    orderBy: { role: { name: "asc" } },
  },
  status: true,
  verifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export const selfProfileSelect = {
  birthDate: true,
  id: true,
  workspaceId: true,
  fullName: true,
  firstName: true,
  lastName: true,
  username: true,
  phoneNumber: true,
  bio: true,
} satisfies Prisma.UserSelect;

function composeName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function toSelfProfile(
  user: Prisma.UserGetPayload<{ select: typeof selfProfileSelect }>,
) {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    displayName: composeName(user.firstName, user.lastName) || user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    phoneNumber: user.phoneNumber,
    bio: user.bio,
    birthDate: user.birthDate?.toISOString().slice(0, 10) ?? null,
  };
}

function toUserResponse(user: any) {
  const roles = (user.roleAssignments ?? []).map(({ role }: any) => role);
  const priority = [
    SystemRoleKeys.ADMIN,
    SystemRoleKeys.MANAGER,
    SystemRoleKeys.MEMBER,
  ];
  const role = priority.find((key) =>
    roles.some((assigned: { key: string }) => assigned.key === key),
  );
  const { roleAssignments: _assignments, ...rest } = user;
  return { ...rest, roles, role: role ?? null };
}

function normalize(value: string) {
  try {
    const phone = parsePhoneNumber(value);
    if (!phone.isValid()) throw new Error("invalid");
    return phone.number;
  } catch {
    throw new BadRequestException("phoneNumber must be a valid phone number");
  }
}
