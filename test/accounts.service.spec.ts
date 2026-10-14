import { UserStatus } from "@prisma/client";
import { AccountsService } from "../src/accounts/accounts.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthorizationService } from "../src/authorization/authorization.service";

const authorization = {
  resolveRoleIds: jest.fn().mockResolvedValue(["role-manager"]),
};

function accounts(prisma: any) {
  prisma.$queryRaw = jest.fn().mockResolvedValue([]);
  prisma.workspace = { update: jest.fn().mockResolvedValue({}) };
  const read = prisma.user?.findFirst;
  prisma.user ??= {};
  prisma.user.findFirst = jest.fn((args: any) =>
    args.where.roleAssignments
      ? Promise.resolve({ id: args.where.id })
      : read?.(args),
  );
  prisma.$transaction ??= jest.fn((fn: any) => fn(prisma));
  return new AccountsService(
    prisma as PrismaService,
    authorization as unknown as AuthorizationService,
  );
}

describe("AccountsService", () => {
  it("creates independent multiword names and composes compatibility fullName", async () => {
    const prisma: any = {
      user: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          roleAssignments: [],
        })),
      },
    };
    const result = await accounts(prisma).create("workspace-1", "admin-1", {
      firstName: "Mary Jane",
      lastName: "de la Cruz",
      phoneNumber: "+998901234567",
    });
    expect(result).toMatchObject({
      firstName: "Mary Jane",
      lastName: "de la Cruz",
      fullName: "Mary Jane de la Cruz",
      status: "PENDING",
    });
  });
  it("accepts a single name without requiring a last name", async () => {
    const prisma: any = {
      user: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          roleAssignments: [],
        })),
      },
    };
    const result = await accounts(prisma).create("workspace-1", "admin-1", {
      firstName: "A",
      phoneNumber: "+998901234567",
    });
    expect(result).toMatchObject({
      firstName: "A",
      lastName: null,
      fullName: "A",
    });
  });
  it.each([{}, { fullName: "Legacy", firstName: "Ada" }])(
    "rejects missing or ambiguous creation names %j",
    async (names) => {
      const prisma: any = { user: { create: jest.fn() } };
      await expect(
        accounts(prisma).create("workspace-1", "admin-1", {
          ...names,
          phoneNumber: "+998901234567",
        }),
      ).rejects.toThrow("Supply either");
      expect(prisma.user.create).not.toHaveBeenCalled();
    },
  );
  it("cannot read or update a self identity in another workspace", async () => {
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    prisma.$transaction = (callback: any) => callback(prisma);
    await expect(
      accounts(prisma).self("wrong-workspace", "self"),
    ).rejects.toThrow("User not found");
    await expect(
      accounts(prisma).updateSelf("wrong-workspace", "self", { bio: "x" }),
    ).rejects.toThrow("User not found");
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "self", workspaceId: "wrong-workspace", status: "OPEN" },
      }),
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it("detects a racing name update instead of overwriting the other component", async () => {
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          firstName: "Ada",
          lastName: null,
          fullName: "Ada",
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction = (callback: any) => callback(prisma);
    await expect(
      accounts(prisma).updateSelf("workspace-1", "self", {
        lastName: "Lovelace",
      }),
    ).rejects.toThrow("Profile changed concurrently");
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "self",
          workspaceId: "workspace-1",
          status: "OPEN",
          firstName: "Ada",
          lastName: null,
          fullName: "Ada",
        },
      }),
    );
  });
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
