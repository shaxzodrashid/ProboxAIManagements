import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import { AuthenticatedUser } from "./auth.types";

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest().user as AuthenticatedUser,
);
export const ROLES_KEY = "proboxai.roles";
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
