import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import {
  ArchiveProjectDto,
  ProjectArchiveResponseDto,
} from "./project-archive.dto";
import { ProjectArchiveService } from "./project-archive.service";

@Controller("projects/:projectId/archive")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Projects")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class ProjectArchiveController {
  constructor(private readonly archives: ProjectArchiveService) {}
  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_ARCHIVE)
  @ApiRevision("project archive")
  @ApiOperation({
    summary: "Archive an owned project without removing its context",
    description:
      "Fresh dedicated permission and creator ownership required. Stable requestId and original If-Match permit readback by identical retry. Archived projects are read-only, hidden from ordinary lists. No files, task history, execution status or membership are removed. No restore action is defined.",
  })
  @ApiOkResponse({ type: ProjectArchiveResponseDto })
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Body() dto: ArchiveProjectDto,
    @ExpectedRevision() revision: number,
  ) {
    return this.archives.archive(actor, projectId, dto.requestId, revision);
  }
}
