import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { Permissions } from "../authorization/permission.catalog";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  ProjectMemberPickerQueryDto,
  ProjectMemberPickerResponseDto,
} from "./project-member-picker.dto";
import { ProjectMemberPickerService } from "./project-member-picker.service";

@Controller("projects/:projectId/member-candidates")
@ApiTags("Projects")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class ProjectMemberPickerController {
  constructor(private readonly picker: ProjectMemberPickerService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECT_MEMBERS_MANAGE)
  @ApiOperation({
    summary: "Discover eligible project member candidates",
    description:
      "Current projects.members.manage plus project membership or projects.manage-all required; users.read is not needed. Rechecked persisted authorization every page. Only current OPEN accounts belonging to the project's workspace; minimal public identity and existing-project membership flag. Default50/max100; literal case-insensitive search; UUID ascending. Mutable roster continuation, not a complete roster/count or grant. Archived/deleting projects return409. Add-member rechecks eligibility independently; picker selection grants nothing.",
  })
  @ApiOkResponse({ type: ProjectMemberPickerResponseDto })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: ProjectMemberPickerQueryDto,
  ) {
    return this.picker.read(actor, projectId, query);
  }
}
