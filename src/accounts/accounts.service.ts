import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { parsePhoneNumber } from "libphonenumber-js";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./accounts.dto";
import { AuthorizationService } from "../authorization/authorization.service";
import { SystemRoleKeys } from "../authorization/permission.catalog";

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}
  async create(workspaceId: string, actorId: string, dto: CreateUserDto) {
    const roleIds = await this.authorization.resolveRoleIds(
      workspaceId,
      dto.roleIds,
      dto.role,
    );
    try {
      const user = await this.prisma.user.create({
        data: {
          workspaceId,
          fullName: dto.fullName,
          phoneNumber: normalize(dto.phoneNumber),
          status: UserStatus.PENDING,
          roleAssignments: {
            create: roleIds.map((roleId) => ({
              roleId,
              workspaceId,
              assignedById: actorId,
            })),
          },
        },
        select: userResponseSelect,
      });
      return toUserResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "A user with this phone number already exists",
        );
      throw error;
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
    const users = await this.prisma.user.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: userResponseSelect,
    });
    return users.map(toUserResponse);
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
      throw new BadRequestException("Users cannot ban or delete themselves");
    const user = await this.prisma.user.findFirst({
      where: { id, workspaceId },
    });
    if (!user) throw new NotFoundException("User not found");
    const ownedProjects = await this.prisma.project.count({
      where: { creatorId: id },
    });
    if (ownedProjects)
      throw new ConflictException(
        "This user owns project records and cannot be banned or deleted until they are removed",
      );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { status },
        select: userResponseSelect,
      });
      await tx.sessionToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return toUserResponse(updated);
    });
  }
}

const userResponseSelect = {
  id: true,
  fullName: true,
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
