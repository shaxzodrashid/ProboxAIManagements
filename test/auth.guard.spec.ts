import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { UserStatus } from "@prisma/client";
import { JwtAuthGuard, PermissionsGuard } from "../src/auth/auth.guards";
import { PrismaService } from "../src/prisma/prisma.service";

describe("JwtAuthGuard", () => {
  const request = {
    headers: { authorization: "Bearer access.jwt" },
    user: undefined as unknown,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;

  beforeEach(() => {
    request.user = undefined;
  });

  it("loads the current OPEN user before accepting an access JWT", async () => {
    const jwt = {
      verify: jest.fn().mockReturnValue({
        id: "user-1",
        workspaceId: "workspace-old",
        type: "access",
      }),
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "user-1",
          workspaceId: "workspace-current",
          roleAssignments: [
            {
              role: {
                id: "role-1",
                key: "REVIEWER",
                name: "Reviewer",
                permissions: [
                  { permissionKey: "projects.read" },
                  { permissionKey: "projects.files.read" },
                ],
              },
            },
            {
              role: {
                id: "role-2",
                key: "REPORTER",
                name: "Reporter",
                permissions: [{ permissionKey: "projects.read" }],
              },
            },
          ],
        }),
      },
    };
    const guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "user-1", status: UserStatus.OPEN },
      select: {
        id: true,
        workspaceId: true,
        roleAssignments: {
          select: {
            role: {
              select: {
                id: true,
                key: true,
                name: true,
                permissions: { select: { permissionKey: true } },
              },
            },
          },
        },
      },
    });
    expect(request.user).toEqual({
      id: "user-1",
      workspaceId: "workspace-current",
      roles: [
        { id: "role-1", key: "REVIEWER", name: "Reviewer" },
        { id: "role-2", key: "REPORTER", name: "Reporter" },
      ],
      permissions: ["projects.files.read", "projects.read"],
      type: "access",
    });
  });

  it("rejects a valid JWT after the persisted user is banned or deleted", async () => {
    const guard = new JwtAuthGuard(
      {
        verify: jest.fn().mockReturnValue({ id: "user-1", type: "access" }),
      } as unknown as JwtService,
      {
        user: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("does not accept a temporary token as an access JWT", async () => {
    const prisma = { user: { findFirst: jest.fn() } };
    const guard = new JwtAuthGuard(
      {
        verify: jest.fn().mockReturnValue({ id: "user-1" }),
      } as unknown as JwtService,
      prisma as unknown as PrismaService,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe("PermissionsGuard", () => {
  it("requires every declared permission from the live request user", () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue(["projects.read", "projects.files.read"]),
    };
    const guard = new PermissionsGuard(reflector as unknown as Reflector);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            permissions: ["projects.read", "projects.files.read"],
          },
        }),
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects a user missing a declared permission", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(["authorization.manage"]),
    };
    const guard = new PermissionsGuard(reflector as unknown as Reflector);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: ["authorization.read"] } }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
