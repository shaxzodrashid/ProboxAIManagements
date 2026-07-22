import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomInt } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TelegramService } from "../telegram/telegram.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly telegram: TelegramService,
  ) {}
  async requestOtp(phoneNumber: string) {
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, status: "ACTIVE", telegramChatId: { not: null } },
    });
    if (!user) return;
    const recent = await this.prisma.authOtp.count({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
    });
    if (recent >= 3) return;
    const code = randomInt(100000, 1_000_000).toString();
    await this.prisma.authOtp.create({
      data: {
        userId: user.id,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    await this.telegram.sendText(
      user.telegramChatId!,
      `Your ProboxAI login code is: ${code}. It expires in 5 minutes.`,
    );
  }
  async verifyOtp(phoneNumber: string, code: string) {
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, status: "ACTIVE" },
    });
    if (!user) throw new UnauthorizedException("Invalid code");
    const otp = await this.prisma.authOtp.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otp || otp.attempts >= 5 || otp.codeHash !== this.hash(code)) {
      if (otp)
        await this.prisma.authOtp.update({
          where: { id: otp.id },
          data: { attempts: { increment: 1 } },
        });
      throw new UnauthorizedException("Invalid code");
    }
    await this.prisma.authOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return {
      accessToken: this.jwt.sign(
        { id: user.id, workspaceId: user.workspaceId, role: user.role },
        { expiresIn: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900) },
      ),
    };
  }
  private hash(code: string) {
    return createHash("sha256")
      .update(`${process.env.JWT_SECRET}:${code}`)
      .digest("hex");
  }
}
