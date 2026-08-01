import { createHmac } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import {
  AuthOtpPurpose,
  SessionTokenPurpose,
  UserStatus,
} from "@prisma/client";
import { AuthLocale } from "../src/auth/auth.dto";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";

describe("AuthService", () => {
  const pendingUser = {
    id: "user-1",
    workspaceId: "workspace-1",
    phoneNumber: "+998901234567",
    fullName: "Ada Lovelace",
    username: null,
    passwordHash: null,
    roleAssignments: [],
    status: UserStatus.PENDING,
    telegramUserId: 100n,
    telegramChatId: 200n,
    verifiedAt: new Date("2026-07-27T00:00:00.000Z"),
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
  };

  let prisma: ReturnType<typeof prismaMock>;
  let jwt: { sign: jest.Mock };
  let telegram: { sendOtp: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-only-auth-secret";
    prisma = prismaMock();
    jwt = { sign: jest.fn().mockReturnValue("access.jwt") };
    telegram = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      telegram as unknown as TelegramService,
    );
  });

  it("sends a localized registration OTP with a five-minute technical expiry", async () => {
    prisma.user.findUnique.mockResolvedValue(pendingUser);
    prisma.authOtp.count.mockResolvedValue(0);
    let createdOtp: any;
    prisma.authOtp.create.mockImplementation(({ data }: any) => {
      createdOtp = { id: "otp-1", attempts: 0, consumedAt: null, ...data };
      return Promise.resolve(createdOtp);
    });

    const before = Date.now();
    await expect(
      service.requestRegistrationOtp(pendingUser.phoneNumber, AuthLocale.RU),
    ).resolves.toEqual({ message: "OTP sent successfully." });

    expect(telegram.sendOtp).toHaveBeenCalledWith(
      200n,
      expect.stringMatching(/^\d{6}$/),
      AuthLocale.RU,
      AuthOtpPurpose.REGISTRATION,
    );
    expect(createdOtp.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 5 * 60_000,
    );
    expect(createdOtp.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 5 * 60_000,
    );
  });

  it("verifies a purpose-bound OTP and returns a 384-bit temporary token", async () => {
    const code = "123456";
    prisma.user.findUnique.mockResolvedValue(pendingUser);
    prisma.authOtp.findFirst.mockResolvedValue({
      id: "otp-1",
      userId: pendingUser.id,
      purpose: AuthOtpPurpose.REGISTRATION,
      codeHash: createHmac("sha256", process.env.JWT_SECRET!)
        .update(`${pendingUser.id}:${AuthOtpPurpose.REGISTRATION}:${code}`)
        .digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date(),
    });
    let createdToken: any;
    prisma.sessionToken.create.mockImplementation(({ data }: any) => {
      createdToken = data;
      return Promise.resolve({ id: "token-1", ...data });
    });

    const result = await service.verifyRegistrationOtp(
      pendingUser.phoneNumber,
      code,
    );

    expect(result.temporaryToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(result.expiresInSeconds).toBe(600);
    expect(createdToken.purpose).toBe(SessionTokenPurpose.REGISTRATION);
    expect(createdToken.tokenHash).not.toContain(result.temporaryToken);
    expect(createdToken.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 9 * 60_000,
    );
  });

  it("normalizes usernames before checking global availability", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.usernameAvailability("  Ada.Lovelace "),
    ).resolves.toEqual({ username: "ada.lovelace", available: true });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: "ada.lovelace" },
      select: { id: true },
    });
  });

  it("registers, logs in, and refreshes without rotating the refresh token", async () => {
    prisma.sessionToken.findUnique.mockResolvedValue({
      id: "registration-token",
      userId: pendingUser.id,
      purpose: SessionTokenPurpose.REGISTRATION,
      tokenHash: "stored-hash",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      createdAt: new Date(),
      user: pendingUser,
    });
    let openedUser: any;
    prisma.user.update.mockImplementation(({ data }: any) => {
      openedUser = { ...pendingUser, ...data };
      return Promise.resolve(openedUser);
    });

    await expect(
      service.register("Bearer temporary-token", {
        username: "Ada.Lovelace",
        password: "Secure-Platform-42!",
        passwordConfirmation: "Secure-Platform-42!",
      }),
    ).resolves.toEqual({ message: "Registration completed successfully." });

    expect(openedUser.username).toBe("ada.lovelace");
    expect(openedUser.status).toBe(UserStatus.OPEN);
    expect(openedUser.passwordHash).toMatch(/^scrypt\$/);
    expect(openedUser.passwordHash).not.toContain("Secure-Platform-42!");

    prisma.user.findUnique.mockResolvedValue(openedUser);
    const login = await service.login({
      username: "ADA.LOVELACE",
      password: "Secure-Platform-42!",
    });
    expect(login).toEqual({
      accessToken: "access.jwt",
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{64}$/),
    });
    expect(jwt.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: pendingUser.id, type: "access" }),
      { expiresIn: 1800 },
    );

    prisma.sessionToken.findUnique.mockResolvedValue({
      id: "refresh-token",
      userId: pendingUser.id,
      purpose: SessionTokenPurpose.REFRESH,
      tokenHash: "refresh-hash",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      createdAt: new Date(),
      user: openedUser,
    });
    await expect(service.refresh(login.refreshToken)).resolves.toEqual({
      accessToken: "access.jwt",
    });
  });

  it("resets a password and revokes all refresh sessions", async () => {
    const openedUser = {
      ...pendingUser,
      status: UserStatus.OPEN,
      username: "ada.lovelace",
      passwordHash: "existing-hash",
    };
    prisma.sessionToken.findUnique.mockResolvedValue({
      id: "reset-token",
      userId: openedUser.id,
      purpose: SessionTokenPurpose.PASSWORD_RESET,
      tokenHash: "stored-hash",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      createdAt: new Date(),
      user: openedUser,
    });

    await expect(
      service.resetPassword("Bearer temporary-token", {
        password: "Replacement-Password-42!",
        passwordConfirmation: "Replacement-Password-42!",
      }),
    ).resolves.toEqual({ message: "Password reset completed successfully." });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: openedUser.id },
      data: { passwordHash: expect.stringMatching(/^scrypt\$/) },
    });
    expect(prisma.sessionToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: openedUser.id,
        purpose: SessionTokenPurpose.REFRESH,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

function prismaMock() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    authOtp: {
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sessionToken: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn(async (input: any) =>
    typeof input === "function" ? input(prisma) : Promise.all(input),
  );
  return prisma;
}
