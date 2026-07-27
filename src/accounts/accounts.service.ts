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

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(workspaceId: string, dto: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          workspaceId,
          fullName: dto.fullName,
          phoneNumber: normalize(dto.phoneNumber),
          role: dto.role,
          status: UserStatus.PENDING,
        },
        select: userResponseSelect,
      });
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
    return this.prisma.user.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: userResponseSelect,
    });
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
      throw new BadRequestException(
        "Administrators cannot ban or delete themselves",
      );
    const user = await this.prisma.user.findFirst({
      where: { id, workspaceId },
    });
    if (!user) throw new NotFoundException("User not found");
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
      return updated;
    });
  }
}

const userResponseSelect = {
  id: true,
  fullName: true,
  username: true,
  phoneNumber: true,
  role: true,
  status: true,
  verifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

function normalize(value: string) {
  try {
    const phone = parsePhoneNumber(value);
    if (!phone.isValid()) throw new Error("invalid");
    return phone.number;
  } catch {
    throw new BadRequestException("phoneNumber must be a valid phone number");
  }
}
