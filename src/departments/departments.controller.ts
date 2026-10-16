import {
  ExpectedRevision,
  ApiRevision,
  RevisionResponseDto,
} from "../openapi/revision";
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  ApiOperationErrors,
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  CreateDepartmentDto,
  DepartmentHomeProvisioningResponseDto,
  DepartmentResponseDto,
  UpdateDepartmentDto,
} from "./departments.dto";
import { DepartmentsService } from "./departments.service";
import {
  hasPermission,
  Permissions,
} from "../authorization/permission.catalog";

@Controller("departments")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permissions.DEPARTMENTS_READ)
@ApiTags("Departments")
@ApiAccessToken()
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get(":id/revision")
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({
    summary: "Read a workspace-scoped mutation revision without a read grant",
  })
  @ApiOkResponse({ type: RevisionResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  revision(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.departments.revision(user.workspaceId, id);
  }

  @Get()
  @ApiOperation({
    summary: "List active workspace departments",
    description:
      "Active departments only by default. includeArchived=true is honored only with departments.manage. Known archived IDs remain readable within the caller workspace.",
  })
  @ApiOkResponse({ type: DepartmentResponseDto, isArray: true })
  @ApiAuthenticationErrors()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.departments.list(
      user.workspaceId,
      hasPermission(user, Permissions.DEPARTMENTS_MANAGE) &&
        includeArchived === "true",
    );
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get an active or archived department in the caller workspace",
  })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.departments.get(user.workspaceId, id);
  }

  @Post()
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({
    summary: "Create a department and provision its home directory",
  })
  @ApiCreatedResponse({ type: DepartmentHomeProvisioningResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  @ApiOperationErrors(true)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departments.create(user.workspaceId, dto);
  }

  @Patch(":id")
  @ApiRevision()
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({
    summary: "Update an unused department home or its name",
    description:
      "Omitted fields retain their values. Null clearing is unsupported and returns 400 before provisioning or writes. Empty PATCH is supported.",
  })
  @ApiOkResponse({ type: DepartmentHomeProvisioningResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  @ApiOperationErrors(true)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateDepartmentDto,
    @ExpectedRevision() revision: number,
  ) {
    return this.departments.update(user.workspaceId, id, dto, revision);
  }

  @Post(":id/default")
  @ApiRevision()
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({ summary: "Make a department the workspace default" })
  @ApiCreatedResponse({ type: DepartmentResponseDto })
  @ApiAuthenticationErrors()
  @ApiOperationErrors()
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @ExpectedRevision() revision: number,
  ) {
    return this.departments.setDefault(user.workspaceId, id, revision);
  }

  @Post(":id/archive")
  @ApiRevision()
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({ summary: "Archive a non-default department" })
  @ApiCreatedResponse({ type: DepartmentResponseDto })
  @ApiAuthenticationErrors()
  @ApiOperationErrors()
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @ExpectedRevision() revision: number,
  ) {
    return this.departments.archive(user.workspaceId, id, revision);
  }
}
