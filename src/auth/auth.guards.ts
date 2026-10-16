import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PERMISSIONS_KEY } from "./auth.decorator";
import { AccessTokenPayload, AuthenticatedUser } from "./auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { UserStatus } from "@prisma/client";
import {
  authenticationUnavailable,
  authenticationDependency,
  hasMalformedJwtSerialization,
  isCredentialRejection,
} from "./authentication-failures";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();
    const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException("Bearer token required");
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token);
    } catch (error) {
      if (
        isCredentialRejection(error) ||
        (error instanceof SyntaxError && hasMalformedJwtSerialization(token))
      )
        throw new UnauthorizedException("Invalid or expired access token");
      throw authenticationUnavailable();
    }
    if (
      !payload ||
      payload.type !== "access" ||
      typeof payload.id !== "string" ||
      !payload.id
    )
      throw new UnauthorizedException("Invalid or expired access token");
    const user = await authenticationDependency(() =>
      this.prisma.user.findFirst({
        where: { id: payload.id, status: UserStatus.OPEN },
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
      }),
    );
    if (!user)
      throw new UnauthorizedException("Invalid or expired access token");
    const roles = user.roleAssignments.map(({ role }) => ({
      id: role.id,
      key: role.key,
      name: role.name,
    }));
    const permissions = [
      ...new Set(
        user.roleAssignments.flatMap(({ role }) =>
          role.permissions.map(({ permissionKey }) => permissionKey),
        ),
      ),
    ].sort();
    request.user = {
      id: user.id,
      workspaceId: user.workspaceId,
      roles,
      permissions,
      type: "access",
      accessExpiresAt:
        typeof payload.exp === "number" ? payload.exp * 1000 : Date.now(),
    };
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user || !required.every((key) => user.permissions.includes(key)))
      throw new ForbiddenException("Insufficient permissions");
    return true;
  }
}
