import { UserRole, UserStatus } from "@prisma/client";
import { AccountsService } from "../src/accounts/accounts.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("AccountsService", () => {
  it("links a Telegram self-contact without opening the pending identity", async () => {
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "user-1",
          status: UserStatus.PENDING,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new AccountsService(prisma as PrismaService);

    await expect(
      service.verifyTelegramContact({
        fromId: 100,
        chatId: 200,
        chatType: "private",
        contactUserId: 100,
        phoneNumber: "+998901234567",
      }),
    ).resolves.toBe(true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        telegramUserId: 100n,
        telegramChatId: 200n,
        verifiedAt: expect.any(Date),
      },
    });
  });

  it("creates settings users as pending without credentials", async () => {
    const prisma: any = {
      user: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new AccountsService(prisma as PrismaService);
    await service.create("workspace-1", {
      fullName: "Ada Lovelace",
      phoneNumber: "+998901234567",
      role: UserRole.MANAGER,
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          workspaceId: "workspace-1",
          fullName: "Ada Lovelace",
          phoneNumber: "+998901234567",
          role: UserRole.MANAGER,
          status: UserStatus.PENDING,
        },
      }),
    );
  });

  it("bans a user and revokes every active session token atomically", async () => {
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: "user-2" }),
        update: jest.fn().mockResolvedValue({
          id: "user-2",
          status: UserStatus.BANNED,
        }),
      },
      sessionToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    prisma.$transaction = jest.fn((callback: any) => callback(prisma));
    const service = new AccountsService(prisma as PrismaService);

    await expect(
      service.ban("workspace-1", "admin-1", "user-2"),
    ).resolves.toEqual({ id: "user-2", status: UserStatus.BANNED });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-2" },
        data: { status: UserStatus.BANNED },
      }),
    );
    expect(prisma.sessionToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-2", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
