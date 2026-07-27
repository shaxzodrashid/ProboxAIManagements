import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  AuthOtpPurpose,
  Prisma,
  SessionTokenPurpose,
  UserStatus,
} from "@prisma/client";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { parsePhoneNumber } from "libphonenumber-js";
import { PrismaService } from "../prisma/prisma.service";
import { TelegramService } from "../telegram/telegram.service";
import {
  AuthLocale,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from "./auth.dto";

const OTP_TTL_MS = 5 * 60_000;
const TEMPORARY_TOKEN_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly telegram: TelegramService,
  ) {}

  requestRegistrationOtp(phoneNumber: string, locale: AuthLocale) {
    return this.requestOtp(phoneNumber, locale, AuthOtpPurpose.REGISTRATION);
  }

  requestPasswordResetOtp(phoneNumber: string, locale: AuthLocale) {
    return this.requestOtp(phoneNumber, locale, AuthOtpPurpose.PASSWORD_RESET);
  }

  verifyRegistrationOtp(phoneNumber: string, code: string) {
    return this.verifyOtp(phoneNumber, code, AuthOtpPurpose.REGISTRATION);
  }

  verifyPasswordResetOtp(phoneNumber: string, code: string) {
    return this.verifyOtp(phoneNumber, code, AuthOtpPurpose.PASSWORD_RESET);
  }

  async usernameAvailability(username: string) {
    const normalized = normalizeUsername(username);
    const existing = await this.prisma.user.findUnique({
      where: { username: normalized },
      select: { id: true },
    });
    return { username: normalized, available: !existing };
  }

  async register(authorization: string | undefined, dto: RegisterDto) {
    const rawToken = bearerToken(authorization);
    const token = await this.findTemporaryToken(
      rawToken,
      SessionTokenPurpose.REGISTRATION,
    );
    if (
      token.user.status !== UserStatus.PENDING ||
      !token.user.verifiedAt ||
      !token.user.telegramChatId ||
      token.user.username ||
      token.user.passwordHash
    )
      throw new ConflictException("This identity cannot be registered");

    const username = normalizeUsername(dto.username);
    this.assertPasswords(dto.password, dto.passwordConfirmation, username);
    const passwordHash = await this.hashPassword(dto.password);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.consumeTemporaryToken(tx, token.id);
        await tx.user.update({
          where: { id: token.userId },
          data: {
            username,
            passwordHash,
            status: UserStatus.OPEN,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Username is already taken");
      throw error;
    }
    return { message: "Registration completed successfully." };
  }

  async login(dto: LoginDto) {
    const username = normalizeUsername(dto.username);
    const user = await this.prisma.user.findUnique({ where: { username } });
    const passwordMatches = user?.passwordHash
      ? await this.verifyPassword(dto.password, user.passwordHash)
      : await this.performDummyPasswordCheck(dto.password);
    if (
      !user ||
      user.status !== UserStatus.OPEN ||
      !user.passwordHash ||
      !passwordMatches
    )
      throw new UnauthorizedException("Invalid username or password");

    const refreshToken = randomToken();
    await this.prisma.sessionToken.create({
      data: {
        userId: user.id,
        purpose: SessionTokenPurpose.REFRESH,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const token = await this.prisma.sessionToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (
      !token ||
      token.purpose !== SessionTokenPurpose.REFRESH ||
      token.revokedAt ||
      token.consumedAt ||
      token.expiresAt <= new Date() ||
      token.user.status !== UserStatus.OPEN
    )
      throw new UnauthorizedException("Invalid or expired refresh token");
    return { accessToken: this.signAccessToken(token.user) };
  }

  async resetPassword(
    authorization: string | undefined,
    dto: ResetPasswordDto,
  ) {
    const rawToken = bearerToken(authorization);
    const token = await this.findTemporaryToken(
      rawToken,
      SessionTokenPurpose.PASSWORD_RESET,
    );
    if (
      token.user.status !== UserStatus.OPEN ||
      !token.user.username ||
      !token.user.passwordHash
    )
      throw new ConflictException("This account cannot reset its password");
    this.assertPasswords(
      dto.password,
      dto.passwordConfirmation,
      token.user.username,
    );
    const passwordHash = await this.hashPassword(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await this.consumeTemporaryToken(tx, token.id);
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await tx.sessionToken.updateMany({
        where: {
          userId: token.userId,
          purpose: SessionTokenPurpose.REFRESH,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
    return { message: "Password reset completed successfully." };
  }

  private async requestOtp(
    phoneNumber: string,
    locale: AuthLocale,
    purpose: AuthOtpPurpose,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: normalizePhoneNumber(phoneNumber) },
    });
    if (!user) throw new NotFoundException("Pre-registered user not found");
    if (!user.verifiedAt || !user.telegramChatId)
      throw new ForbiddenException(
        "This phone number has not been verified through the Telegram bot",
      );
    if (
      purpose === AuthOtpPurpose.REGISTRATION &&
      (user.status !== UserStatus.PENDING ||
        user.username !== null ||
        user.passwordHash !== null)
    )
      throw new ConflictException("This user is already registered");
    if (
      purpose === AuthOtpPurpose.PASSWORD_RESET &&
      (user.status !== UserStatus.OPEN || !user.username || !user.passwordHash)
    )
      throw new ConflictException("This account cannot reset its password");

    const recent = await this.prisma.authOtp.count({
      where: {
        userId: user.id,
        purpose,
        createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
    });
    if (recent >= 3)
      throw new HttpException(
        "Too many OTP requests. Please try again later",
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const code = randomInt(100000, 1_000_000).toString();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authOtp.updateMany({
        where: { userId: user.id, purpose, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.authOtp.create({
        data: {
          userId: user.id,
          purpose,
          codeHash: this.hashOtp(user.id, purpose, code),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      }),
    ]);
    await this.telegram.sendOtp(user.telegramChatId, code, locale, purpose);
    return { message: "OTP sent successfully." };
  }

  private async verifyOtp(
    phoneNumber: string,
    code: string,
    purpose: AuthOtpPurpose,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: normalizePhoneNumber(phoneNumber) },
    });
    if (!user) throw new UnauthorizedException("Invalid or expired OTP code");
    const otp = await this.prisma.authOtp.findFirst({
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    const valid =
      otp &&
      otp.attempts < 5 &&
      safeEqual(otp.codeHash, this.hashOtp(user.id, purpose, code));
    if (!valid) {
      if (otp)
        await this.prisma.authOtp.update({
          where: { id: otp.id },
          data: { attempts: { increment: 1 } },
        });
      throw new UnauthorizedException("Invalid or expired OTP code");
    }

    const temporaryToken = randomToken();
    const tokenPurpose =
      purpose === AuthOtpPurpose.REGISTRATION
        ? SessionTokenPurpose.REGISTRATION
        : SessionTokenPurpose.PASSWORD_RESET;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authOtp.update({
        where: { id: otp.id },
        data: { consumedAt: now },
      }),
      this.prisma.sessionToken.updateMany({
        where: {
          userId: user.id,
          purpose: tokenPurpose,
          revokedAt: null,
          consumedAt: null,
        },
        data: { revokedAt: now },
      }),
      this.prisma.sessionToken.create({
        data: {
          userId: user.id,
          purpose: tokenPurpose,
          tokenHash: hashToken(temporaryToken),
          expiresAt: new Date(now.getTime() + TEMPORARY_TOKEN_TTL_MS),
        },
      }),
    ]);
    return { temporaryToken, expiresInSeconds: 600 };
  }

  private async findTemporaryToken(
    rawToken: string,
    purpose: SessionTokenPurpose,
  ) {
    const token = await this.prisma.sessionToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (
      !token ||
      token.purpose !== purpose ||
      token.revokedAt ||
      token.consumedAt ||
      token.expiresAt <= new Date()
    )
      throw new UnauthorizedException("Invalid or expired temporary token");
    return token;
  }

  private async consumeTemporaryToken(
    tx: Prisma.TransactionClient,
    tokenId: string,
  ) {
    const consumed = await tx.sessionToken.updateMany({
      where: {
        id: tokenId,
        revokedAt: null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new UnauthorizedException("Invalid or expired temporary token");
  }

  private signAccessToken(user: {
    id: string;
    workspaceId: string;
    role: string;
  }) {
    return this.jwt.sign(
      {
        id: user.id,
        workspaceId: user.workspaceId,
        role: user.role,
        type: "access",
      },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  private hashOtp(userId: string, purpose: AuthOtpPurpose, code: string) {
    return createHmac("sha256", process.env.JWT_SECRET ?? "")
      .update(`${userId}:${purpose}:${code}`)
      .digest("hex");
  }

  private assertPasswords(
    password: string,
    passwordConfirmation: string,
    username: string,
  ) {
    if (password !== passwordConfirmation)
      throw new BadRequestException("Password confirmation does not match");
    if (password.toLowerCase().includes(username.toLowerCase()))
      throw new BadRequestException("Password must not contain the username");
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16);
    const derived = await derivePassword(password, salt);
    return [
      "scrypt",
      SCRYPT_COST,
      SCRYPT_BLOCK_SIZE,
      SCRYPT_PARALLELIZATION,
      salt.toString("base64url"),
      derived.toString("base64url"),
    ].join("$");
  }

  private async verifyPassword(password: string, encoded: string) {
    const [algorithm, cost, blockSize, parallelization, saltText, hashText] =
      encoded.split("$");
    if (
      algorithm !== "scrypt" ||
      !cost ||
      !blockSize ||
      !parallelization ||
      !saltText ||
      !hashText ||
      Number(cost) !== SCRYPT_COST ||
      Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
      Number(parallelization) !== SCRYPT_PARALLELIZATION
    )
      return false;
    const expected = Buffer.from(hashText, "base64url");
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await derivePassword(
      password,
      Buffer.from(saltText, "base64url"),
      Number(cost),
      Number(blockSize),
      Number(parallelization),
    );
    return timingSafeEqual(expected, actual);
  }

  private async performDummyPasswordCheck(password: string) {
    await derivePassword(password, Buffer.alloc(16));
    return false;
  }
}

function normalizePhoneNumber(value: string) {
  try {
    const phone = parsePhoneNumber(value);
    if (!phone.isValid()) throw new Error("invalid");
    return phone.number;
  } catch {
    throw new BadRequestException("phoneNumber must be a valid phone number");
  }
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function bearerToken(authorization: string | undefined) {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1];
  if (!token)
    throw new UnauthorizedException("Temporary bearer token required");
  return token;
}

function randomToken() {
  return randomBytes(48).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function derivePassword(
  password: string,
  salt: Buffer,
  cost = SCRYPT_COST,
  blockSize = SCRYPT_BLOCK_SIZE,
  parallelization = SCRYPT_PARALLELIZATION,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}
