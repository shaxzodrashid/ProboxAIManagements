import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { parsePhoneNumber } from "libphonenumber-js";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./accounts.dto";

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(workspaceId: string, dto: CreateUserDto) {
    return this.prisma.user.create({
      data: {
        workspaceId,
        displayName: dto.displayName,
        phoneNumber: normalize(dto.phoneNumber),
        role: dto.role,
      },
    });
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
          status: "ACTIVE",
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
      select: {
        id: true,
        displayName: true,
        phoneNumber: true,
        role: true,
        status: true,
        verifiedAt: true,
        createdAt: true,
      },
    });
  }
  async suspend(workspaceId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, workspaceId },
    });
    if (!user) throw new NotFoundException("User not found");
    return this.prisma.user.update({
      where: { id },
      data: { status: "SUSPENDED" },
    });
  }
}
function normalize(value: string) {
  return parsePhoneNumber(value).number;
}
