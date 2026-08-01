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

  @Get()
  @ApiOperation({ summary: "List workspace departments" })
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
  @ApiOperation({ summary: "Get a department" })
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
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departments.create(user.workspaceId, dto);
  }

  @Patch(":id")
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({ summary: "Update an unused department home or its name" })
  @ApiOkResponse({ type: DepartmentHomeProvisioningResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(user.workspaceId, id, dto);
  }

  @Post(":id/default")
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({ summary: "Make a department the workspace default" })
  @ApiOkResponse({ type: DepartmentResponseDto })
  setDefault(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.departments.setDefault(user.workspaceId, id);
  }

  @Post(":id/archive")
  @RequirePermissions(Permissions.DEPARTMENTS_MANAGE)
  @ApiOperation({ summary: "Archive a non-default department" })
  @ApiOkResponse({ type: DepartmentResponseDto })
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.departments.archive(user.workspaceId, id);
  }
}
