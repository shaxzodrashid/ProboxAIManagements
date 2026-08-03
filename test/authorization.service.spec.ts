import { BadRequestException } from "@nestjs/common";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("AuthorizationService", () => {
  it("creates a custom role from catalog-backed permissions", async () => {
    const prisma: any = {
      permission: { count: jest.fn().mockResolvedValue(2) },
      role: {
        create: jest.fn().mockResolvedValue({
          id: "role-1",
          workspaceId: "workspace-1",
          key: "reviewer",
          name: "Reviewer",
          description: null,
          isSystem: false,
          permissions: [
            {
              permissionKey: "projects.read",
              permission: { key: "projects.read" },
            },
            {
              permissionKey: "projects.files.read",
              permission: { key: "projects.files.read" },
            },
          ],
          _count: { userAssignments: 0 },
        }),
      },
    };
    const service = new AuthorizationService(prisma as PrismaService);

    await expect(
      service.createRole("workspace-1", {
        key: "reviewer",
        name: "Reviewer",
        permissionKeys: ["projects.read", "projects.files.read"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "role-1",
        key: "reviewer",
        permissions: [{ key: "projects.read" }, { key: "projects.files.read" }],
        userCount: 0,
      }),
    );
    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "workspace-1",
          permissions: {
            create: [
              { permissionKey: "projects.read" },
              { permissionKey: "projects.files.read" },
            ],
          },
        }),
      }),
    );
  });

  it("rejects permission keys outside the application catalog", async () => {
    const prisma: any = {
      permission: { count: jest.fn().mockResolvedValue(0) },
      role: { create: jest.fn() },
    };
    const service = new AuthorizationService(prisma as PrismaService);

    await expect(
      service.createRole("workspace-1", {
        key: "unsafe",
        name: "Unsafe role",
        permissionKeys: ["made-up.permission"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it("atomically replaces a different user's multiple roles", async () => {
    const prisma: any = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "user-2" })
          .mockResolvedValueOnce({
            id: "user-2",
            roleAssignments: [
              { role: { id: "role-1", key: "REVIEWER", name: "Reviewer" } },
              { role: { id: "role-2", key: "REPORTER", name: "Reporter" } },
            ],
          }),
      },
      role: { count: jest.fn().mockResolvedValue(2) },
      userRoleAssignment: {
        deleteMany: jest.fn().mockReturnValue("delete-roles"),
        createMany: jest.fn().mockReturnValue("create-roles"),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const service = new AuthorizationService(prisma as PrismaService);

    await expect(
      service.setUserRoles("workspace-1", "admin-1", "user-2", [
        "role-1",
        "role-2",
      ]),
    ).resolves.toEqual({
      id: "user-2",
      roles: [
        { id: "role-1", key: "REVIEWER", name: "Reviewer" },
        { id: "role-2", key: "REPORTER", name: "Reporter" },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      "delete-roles",
      "create-roles",
    ]);
    expect(prisma.userRoleAssignment.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-2",
          roleId: "role-1",
          workspaceId: "workspace-1",
          assignedById: "admin-1",
        },
        {
          userId: "user-2",
          roleId: "role-2",
          workspaceId: "workspace-1",
          assignedById: "admin-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("allows an administrator to add a role without gaining permissions", async () => {
    const prisma: any = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "admin-1" })
          .mockResolvedValueOnce({
            id: "admin-1",
            roleAssignments: [
              {
                role: {
                  id: "role-admin",
                  key: "ADMIN",
                  name: "Administrator",
                },
              },
              {
                role: {
                  id: "role-manager",
                  key: "MANAGER",
                  name: "Manager",
                },
              },
            ],
          }),
      },
      role: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            permissions: [
              { permissionKey: "authorization.manage" },
              { permissionKey: "projects.read" },
            ],
          },
          { permissions: [{ permissionKey: "projects.read" }] },
        ]),
      },
      userRoleAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: {
              permissions: [
                { permissionKey: "authorization.manage" },
                { permissionKey: "projects.read" },
              ],
            },
          },
        ]),
        deleteMany: jest.fn().mockReturnValue("delete-roles"),
        createMany: jest.fn().mockReturnValue("create-roles"),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const service = new AuthorizationService(prisma as PrismaService);

    await expect(
      service.setUserRoles("workspace-1", "admin-1", "admin-1", [
        "role-admin",
        "role-manager",
      ]),
    ).resolves.toEqual({
      id: "admin-1",
      roles: [
        { id: "role-admin", key: "ADMIN", name: "Administrator" },
        { id: "role-manager", key: "MANAGER", name: "Manager" },
      ],
    });
  });

  it("prevents administrators from granting themselves new permissions", async () => {
    const prisma: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "admin-1" }) },
      role: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            permissions: [
              { permissionKey: "authorization.manage" },
              { permissionKey: "projects.read" },
            ],
          },
        ]),
      },
      userRoleAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: {
              permissions: [{ permissionKey: "authorization.manage" }],
            },
          },
        ]),
      },
    };
    const service = new AuthorizationService(prisma as PrismaService);

    await expect(
      service.setUserRoles("workspace-1", "admin-1", "admin-1", [
        "role-elevated",
      ]),
    ).rejects.toThrow("cannot grant yourself permissions");
  });

  it("prevents administrators from removing their own management access", async () => {
    const prisma: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "admin-1" }) },
      role: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { permissions: [{ permissionKey: "projects.read" }] },
          ]),
      },
      userRoleAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: {
              permissions: [
                { permissionKey: "authorization.manage" },
                { permissionKey: "projects.read" },
              ],
            },
          },
        ]),
      },
    };
    const service = new AuthorizationService(prisma as PrismaService);

    await expect(
      service.setUserRoles("workspace-1", "admin-1", "admin-1", [
        "role-manager",
      ]),
    ).rejects.toThrow("cannot remove your own authorization management");
  });

  it("prevents gaining permissions through a role assigned to the caller", async () => {
    const prisma: any = {
      permission: { count: jest.fn().mockResolvedValue(1) },
      role: {
        findFirst: jest.fn().mockResolvedValue({
          id: "role-admin",
          workspaceId: "workspace-1",
          userAssignments: [{ userId: "admin-1" }],
        }),
      },
      userRoleAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: {
              id: "role-admin",
              permissions: [{ permissionKey: "authorization.manage" }],
            },
          },
        ]),
      },
    };
    const service = new AuthorizationService(prisma as PrismaService);
    await expect(
      service.setRolePermissions("workspace-1", "admin-1", "role-admin", [
        "projects.read",
      ]),
    ).rejects.toThrow("cannot grant yourself permissions");
  });
});
