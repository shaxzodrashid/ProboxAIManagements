import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectFolderDto,
  MoveProjectFileResponseDto,
  MoveProjectFileDto,
  ProjectFileListResponseDto,
  ProjectFolderResponseDto,
  ProjectMemberResponseDto,
  ProjectResponseDto,
  ProjectsHomeResponseDto,
  SetProjectsHomeDto,
  UploadedProjectFileResponseDto,
  UpdateProjectDto,
  UploadProjectFileDto,
  ProtectedFileTypeDto,
  DeleteProjectFileDto,
  ActiveSessionDecisionDto,
  ConfirmProjectDeletionDto,
} from "./projects.dto";
import { ProjectsService } from "./projects.service";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { Permissions } from "../authorization/permission.catalog";

@Controller("projects")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permissions.PROJECTS_READ)
@ApiTags("Projects")
@ApiAccessToken()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary: "List accessible projects",
    description:
      "Callers with projects.read-all receive all workspace projects. Other users receive projects they belong to and projects with workspace read access enabled.",
  })
  @ApiOkResponse({
    description: "Projects ordered by latest update.",
    type: ProjectResponseDto,
    isArray: true,
  })
  @ApiAuthenticationErrors()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.list(user);
  }

  @Post()
  @RequirePermissions(Permissions.PROJECTS_CREATE)
  @ApiOperation({
    summary: "Create a project",
    description:
      "Requires projects.create. Selects the workspace default department when departmentId is omitted. If the target directory already exists, the first request returns a conflict asking the caller to explicitly resubmit with existingDirectoryAction KEEP or CLEAR. Empty projects become ready immediately; selecting a published department template creates a persisted asynchronous initialization job. The creator is added as the first member.",
  })
  @ApiCreatedResponse({
    description: "Project and its backing directory created.",
    type: ProjectResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user, dto);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get project details",
    description:
      "Project members and callers with projects.read-all receive the member list. Users with public read access receive project metadata only.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiOkResponse({
    description: "Project details, scoped to the caller's access level.",
    type: ProjectResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.projects.get(user, id);
  }

  @Put(":id")
  @RequirePermissions(Permissions.PROJECTS_UPDATE)
  @ApiOperation({
    summary: "Update project settings",
    description:
      "Requires projects.update and project membership unless projects.manage-all is also granted.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiOkResponse({ description: "Updated project.", type: ProjectResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user, id, dto);
  }

  @Post(":id/members")
  @RequirePermissions(Permissions.PROJECT_MEMBERS_MANAGE)
  @ApiOperation({
    summary: "Add a project member",
    description:
      "Requires projects.members.manage and project membership unless projects.manage-all is also granted. Existing members are returned unchanged.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiOkResponse({
    description: "Project membership.",
    type: ProjectMemberResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projects.addMember(user, id, dto.userId);
  }

  @Delete(":id/members/:userId")
  @RequirePermissions(Permissions.PROJECT_MEMBERS_MANAGE)
  @ApiOperation({
    summary: "Remove a project member",
    description:
      "Requires projects.members.manage and project membership unless projects.manage-all is also granted.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiParam({
    name: "userId",
    format: "uuid",
    description: "Workspace user ID to remove.",
  })
  @ApiOkResponse({
    description: "Removed membership record.",
    type: ProjectMemberResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.projects.removeMember(user, id, userId);
  }

  @Post(":id/folders")
  @RequirePermissions(Permissions.PROJECT_FILES_WRITE)
  @ApiOperation({
    summary: "Create a project folder",
    description:
      "Available to project members and administrators. Creates parent directories as needed.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiCreatedResponse({
    description: "Folder created.",
    type: ProjectFolderResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  createFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateProjectFolderDto,
  ) {
    return this.projects.createFolder(user, id, dto.path);
  }

  @Get(":id/files")
  @RequirePermissions(Permissions.PROJECT_FILES_READ)
  @ApiOperation({
    summary: "List a project directory",
    description:
      "Available to members, administrators, and users granted workspace read access. Omit `path` to list the project root.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiQuery({
    name: "path",
    required: false,
    example: "src",
    description: "Project-relative directory path.",
  })
  @ApiOkResponse({
    description: "Directory entries.",
    type: ProjectFileListResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  files(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("path") relativePath?: string,
  ) {
    return this.projects.listFiles(user, id, relativePath);
  }

  @Post(":id/files/upload")
  @RequirePermissions(Permissions.PROJECT_FILES_WRITE)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: ProjectsService.maxUploadBytes() },
    }),
  )
  @ApiOperation({
    summary: "Upload a project file",
    description:
      "Available to project members and administrators. Uses multipart form data; the destination folder must already exist. Uploads never overwrite an existing file.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description:
            "File to upload. The basename is used; directory components are ignored.",
        },
        path: {
          type: "string",
          example: "assets/images",
          description: "Optional existing project-relative destination folder.",
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: "File saved.",
    type: UploadedProjectFileResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UploadProjectFileDto,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true }))
    file: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.projects.uploadFile(user, id, dto.path, file);
  }

  @Post(":id/files/move")
  @RequirePermissions(Permissions.PROJECT_FILES_WRITE)
  @ApiOperation({
    summary: "Move or rename a project file or folder",
    description:
      "Available to project members and administrators. The destination parent must exist; moves into self, overwrites, traversal, and symbolic links are rejected.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiOkResponse({
    description: "Move completed.",
    type: MoveProjectFileResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: MoveProjectFileDto,
  ) {
    return this.projects.moveFile(
      user,
      id,
      dto.sourcePath,
      dto.destinationPath,
    );
  }

  @Get(":id/protected-file-types")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "List protected file extensions" })
  listProtectedFileTypes(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.projects.listProtectedFileTypes(user, id);
  }

  @Post(":id/protected-file-types")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "Append a protected file extension" })
  addProtectedFileType(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ProtectedFileTypeDto,
  ) {
    return this.projects.addProtectedFileType(user, id, dto.extension);
  }

  @Put(":id/protected-file-types/:typeId")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "Update a protected file extension (owner only)" })
  updateProtectedFileType(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("typeId") typeId: string,
    @Body() dto: ProtectedFileTypeDto,
  ) {
    return this.projects.updateProtectedFileType(
      user,
      id,
      typeId,
      dto.extension,
    );
  }

  @Delete(":id/protected-file-types/:typeId")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "Remove a protected file extension (owner only)" })
  removeProtectedFileType(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("typeId") typeId: string,
  ) {
    return this.projects.removeProtectedFileType(user, id, typeId);
  }

  @Post(":id/files/delete")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({
    summary: "Move a file or folder to the recoverable project trash",
  })
  deleteFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: DeleteProjectFileDto,
  ) {
    return this.projects.deleteFile(user, id, dto.path);
  }

  @Post(":id/files/delete-confirmations/:confirmationId/confirm")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({
    summary: "Confirm deletion of a protected project file or folder",
  })
  confirmFileDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("confirmationId") confirmationId: string,
  ) {
    return this.projects.confirmFileDeletion(user, id, confirmationId);
  }

  @Get(":id/trash")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "List recoverable project trash items" })
  listTrash(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.projects.listTrash(user, id);
  }

  @Post(":id/trash/:trashId/restore")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "Restore a recoverable project trash item" })
  restoreTrash(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("trashId") trashId: string,
  ) {
    return this.projects.restoreTrash(user, id, trashId);
  }

  @Post(":id/deletion-requests")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({ summary: "Request permanent project deletion" })
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.projects.requestProjectDeletion(user, id);
  }

  @Post(":id/deletion-requests/:requestId/approve")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({ summary: "Owner approval and deletion-token preflight" })
  approveDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
  ) {
    return this.projects.approveProjectDeletion(user, id, requestId);
  }

  @Post(":id/deletion-requests/:requestId/active-sessions")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({
    summary:
      "Owner chooses whether live project sessions should wait or be interrupted",
  })
  resolveDeletionSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
    @Body() dto: ActiveSessionDecisionDto,
  ) {
    return this.projects.resolveProjectDeletionSessions(
      user,
      id,
      requestId,
      dto.action,
    );
  }

  @Post(":id/deletion-requests/:requestId/cancel")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({ summary: "Cancel an outstanding project deletion request" })
  cancelDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
  ) {
    return this.projects.cancelProjectDeletion(user, id, requestId);
  }

  @Post(":id/deletion-requests/:requestId/confirm")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({
    summary:
      "Submit the owner Telegram token and permanently delete the project",
  })
  confirmDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
    @Body() dto: ConfirmProjectDeletionDto,
  ) {
    return this.projects.confirmProjectDeletion(user, id, requestId, dto.token);
  }

  @Get(":id/files/download")
  @RequirePermissions(Permissions.PROJECT_FILES_READ)
  @ApiOperation({
    summary: "Download a project file",
    description:
      "Available to members, administrators, and users granted workspace read access. Directories and symbolic links cannot be downloaded.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiQuery({
    name: "path",
    required: true,
    example: "docs/README.md",
    description: "Project-relative file path.",
  })
  @ApiProduces("application/octet-stream")
  @ApiOkResponse({
    description:
      "Binary file stream. The response includes an attachment Content-Disposition header.",
    schema: { type: "string", format: "binary" },
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("path") relativePath: string,
    @Res()
    response: {
      setHeader(name: string, value: string | number): void;
      status(code: number): unknown;
      sendFile(path: string): void;
    },
  ) {
    const file = await this.projects.downloadFile(user, id, relativePath);
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    response.sendFile(file.path);
  }
}

@Controller("settings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permissions.SETTINGS_MANAGE)
@ApiTags("Settings")
@ApiAccessToken()
export class SettingsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get("projects-home")
  @ApiOperation({
    summary: "Get the legacy default projects home",
    description:
      "Backward-compatible administrator endpoint. Returns the default department home. New integrations should use the Departments API.",
  })
  @ApiOkResponse({
    description: "Effective projects home.",
    type: ProjectsHomeResponseDto,
  })
  @ApiAuthenticationErrors()
  getProjectsHome(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.getProjectsHome(user.workspaceId);
  }

  @Put("projects-home")
  @ApiOperation({
    summary: "Set the legacy default projects home",
    description:
      "Backward-compatible administrator endpoint. Creates or updates the default department home when it is allowlisted. It cannot change after the department owns a project. New integrations should use the Departments API.",
  })
  @ApiOkResponse({
    description: "Projects home updated.",
    type: ProjectsHomeResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  setProjectsHome(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetProjectsHomeDto,
  ) {
    return this.projects.setProjectsHome(user.workspaceId, dto.path);
  }
}
