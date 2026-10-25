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
          authRevokedAt: true,
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
    const issuedAt =
      payload.issued_at ??
      (typeof payload.iat === "number" ? payload.iat * 1000 : undefined);
    if (
      user.authRevokedAt &&
      (typeof issuedAt !== "number" ||
        !Number.isFinite(issuedAt) ||
        issuedAt <= user.authRevokedAt.getTime())
    )
      throw new UnauthorizedException("Invalid or expired access token");
    if (payload.sid !== undefined) {
      if (typeof payload.sid !== "string" || !payload.sid)
        throw new UnauthorizedException("Invalid or expired access token");
      const session = await authenticationDependency(() =>
        this.prisma.sessionToken.findUnique({ where: { id: payload.sid } }),
      );
      if (
        !session ||
        session.userId !== user.id ||
        payload.workspaceId !== user.workspaceId ||
        session.purpose !== "REFRESH" ||
        session.revokedAt ||
        session.consumedAt ||
        session.expiresAt.getTime() <= Date.now()
      )
        throw new UnauthorizedException("Invalid or expired access token");
    }
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
      ...(typeof issuedAt === "number" ? { accessIssuedAt: issuedAt } : {}),
      accessExpiresAt:
        typeof payload.exp === "number" ? payload.exp * 1000 : Date.now(),
      ...(payload.sid
        ? {
            sessionId: payload.sid,
            authenticatedAt:
              typeof payload.auth_time === "number"
                ? payload.auth_time * 1000
                : undefined,
          }
        : {}),
      ...(!payload.sid && typeof payload.iat === "number"
        ? { authenticatedAt: (payload.auth_time ?? payload.iat) * 1000 }
        : {}),
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
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser; method?: string }>();
    const user = request.user;
    if (!user || !required.every((key) => user.permissions.includes(key)))
      throw new ForbiddenException("Insufficient permissions");
    if (
      request.method &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      required.some((key) =>
        ["authorization.manage", "users.manage"].includes(key),
      )
    ) {
      if (
        !user.authenticatedAt ||
        user.authenticatedAt > Date.now() ||
        Date.now() - user.authenticatedAt > 10 * 60_000
      )
        throw new ForbiddenException({
          statusCode: 403,
          code: "RECENT_AUTH_REQUIRED",
          message: "Recent authentication required",
        });
    }
    return true;
  }
}
