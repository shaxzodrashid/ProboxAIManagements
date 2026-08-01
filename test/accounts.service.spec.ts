import { UserStatus } from "@prisma/client";
import { AccountsService } from "../src/accounts/accounts.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthorizationService } from "../src/authorization/authorization.service";

const authorization = {
  resolveRoleIds: jest.fn().mockResolvedValue(["role-manager"]),
};

function accounts(prisma: any) {
  return new AccountsService(
    prisma as PrismaService,
    authorization as unknown as AuthorizationService,
  );
}

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
    const service = accounts(prisma);

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
    const service = accounts(prisma);
    await service.create("workspace-1", "admin-1", {
      fullName: "Ada Lovelace",
      phoneNumber: "+998901234567",
      roleIds: ["role-manager"],
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          workspaceId: "workspace-1",
          fullName: "Ada Lovelace",
          phoneNumber: "+998901234567",
          status: UserStatus.PENDING,
          roleAssignments: {
            create: [
              {
                roleId: "role-manager",
                workspaceId: "workspace-1",
                assignedById: "admin-1",
              },
            ],
          },
        },
      }),
    );
  });

  it("returns every assigned role and a deterministic legacy role", async () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "user-1",
            fullName: "Ada Lovelace",
            roleAssignments: [
              {
                role: {
                  id: "custom-role",
                  key: "reviewer",
                  name: "Reviewer",
                },
              },
              {
                role: {
                  id: "manager-role",
                  key: "MANAGER",
                  name: "Manager",
                },
              },
              {
                role: {
                  id: "member-role",
                  key: "MEMBER",
                  name: "Member",
                },
              },
            ],
          },
        ]),
      },
    };
    const service = accounts(prisma);

    await expect(service.list("workspace-1")).resolves.toEqual([
      {
        id: "user-1",
        fullName: "Ada Lovelace",
        roles: [
          { id: "custom-role", key: "reviewer", name: "Reviewer" },
          { id: "manager-role", key: "MANAGER", name: "Manager" },
          { id: "member-role", key: "MEMBER", name: "Member" },
        ],
        role: "MANAGER",
      },
    ]);
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
      project: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma.$transaction = jest.fn((callback: any) => callback(prisma));
    const service = accounts(prisma);

    await expect(
      service.ban("workspace-1", "admin-1", "user-2"),
    ).resolves.toEqual({
      id: "user-2",
      status: UserStatus.BANNED,
      roles: [],
      role: null,
    });
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

  it("does not deactivate an account that remains a project owner", async () => {
    const prisma: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "owner-1" }) },
      project: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = accounts(prisma);
    await expect(
      service.delete("workspace-1", "admin-1", "owner-1"),
    ).rejects.toThrow("owns project records");
  });
});
