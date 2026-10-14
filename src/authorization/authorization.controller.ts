import {
  ExpectedRevision,
  ApiRevision,
  RevisionResponseDto,
} from "../openapi/revision";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiOperationErrors,
} from "../openapi/api-docs";
import {
  CreateRoleDto,
  DeletedRoleResponseDto,
  UserRolesResponseDto,
  PermissionResponseDto,
  RoleResponseDto,
  SetRolePermissionsDto,
  SetUserRolesDto,
  UpdateRoleDto,
} from "./authorization.dto";
import { Permissions } from "./permission.catalog";
import { AuthorizationService } from "./authorization.service";

@Controller("authorization")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Authorization")
@ApiAccessToken()
@ApiAuthenticationErrors()
export class AuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get("me")
  @ApiOperation({ summary: "Get the caller's current effective authorization" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        workspaceId: { type: "string", format: "uuid" },
        roles: { type: "array", items: { type: "object" } },
        permissions: { type: "array", items: { type: "string" } },
      },
    },
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      workspaceId: user.workspaceId,
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  @Get("revision")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOkResponse({ type: RevisionResponseDto })
  revision(@CurrentUser() user: AuthenticatedUser) {
    return this.authorization.revision(user.workspaceId);
  }

  @Get("roles/:id/edit")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({
    summary:
      "Read a role permission edit snapshot with workspace authorization revision",
  })
  @ApiOkResponse({ type: RoleResponseDto })
  roleEdit(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.authorization.getRole(user.workspaceId, id);
  }

  @Get("users/:userId/roles")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({
    summary: "Read user role assignments with workspace authorization revision",
  })
  @ApiOkResponse({ type: UserRolesResponseDto })
  userRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId") id: string,
  ) {
    return this.authorization.getUserRoles(user.workspaceId, id);
  }

  @Get("permissions")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "List the assignable permission catalog" })
  @ApiOkResponse({ type: PermissionResponseDto, isArray: true })
  permissions() {
    return this.authorization.listPermissions();
  }

  @Get("roles")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "List workspace roles with permissions" })
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  roles(@CurrentUser() user: AuthenticatedUser) {
    return this.authorization.listRoles(user.workspaceId);
  }

  @Post("roles")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Create a custom workspace role" })
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiOperationErrors()
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoleDto,
  ) {
    return this.authorization.createRole(user.workspaceId, dto, user.id);
  }

  @Patch("roles/:id")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Update role display metadata" })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiOperationErrors()
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.authorization.updateRole(user.workspaceId, id, dto, user.id);
  }

  @Put("roles/:id/permissions")
  @ApiRevision("workspace authorization")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Replace a role's permission set" })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiOperationErrors()
  setRolePermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SetRolePermissionsDto,
    @ExpectedRevision() revision: number,
  ) {
    return this.authorization.setRolePermissions(
      user.workspaceId,
      user.id,
      id,
      dto.permissionKeys,
      revision,
    );
  }

  @Delete("roles/:id")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Delete an unassigned custom role" })
  @ApiOkResponse({ type: DeletedRoleResponseDto })
  @ApiOperationErrors()
  deleteRole(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.authorization.deleteRole(user.workspaceId, user.id, id);
  }

  @Put("users/:userId/roles")
  @ApiRevision("workspace authorization")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Replace a user's role assignments" })
  @ApiOkResponse({ type: UserRolesResponseDto })
  @ApiOperationErrors()
  setUserRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId") userId: string,
    @Body() dto: SetUserRolesDto,
    @ExpectedRevision() revision: number,
  ) {
    return this.authorization.setUserRoles(
      user.workspaceId,
      user.id,
      userId,
      dto.roleIds,
      revision,
    );
  }
}
