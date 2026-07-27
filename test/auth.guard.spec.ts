import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole, UserStatus } from "@prisma/client";
import { JwtAuthGuard } from "../src/auth/auth.guards";
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
        role: UserRole.MEMBER,
        type: "access",
      }),
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "user-1",
          workspaceId: "workspace-current",
          role: UserRole.ADMIN,
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
      select: { id: true, workspaceId: true, role: true },
    });
    expect(request.user).toEqual({
      id: "user-1",
      workspaceId: "workspace-current",
      role: UserRole.ADMIN,
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
