import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ROLES_KEY } from "./auth.decorator";
import { AuthenticatedUser } from "./auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { UserStatus } from "@prisma/client";

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
    try {
      const payload = this.jwt.verify<AuthenticatedUser>(token);
      if (payload.type !== "access") throw new Error("wrong token type");
      const user = await this.prisma.user.findFirst({
        where: { id: payload.id, status: UserStatus.OPEN },
        select: { id: true, workspaceId: true, role: true },
      });
      if (!user) throw new Error("user is not open");
      request.user = { ...user, type: "access" };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return (
      !roles ||
      roles.includes(
        context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user
          .role,
      )
    );
  }
}
