import {
  ProjectDeletionHistoryResponseDto,
  ProjectDeletionStateResponseDto,
  ProjectDeletionRequestResponseDto,
  DeletionSessionDecisionResponseDto,
  ConfirmProjectDeletionResponseDto,
} from "./project-deletion-contracts";
import { ExpectedRevision, ApiRevision } from "../openapi/revision";
import { ProjectListQueryDto } from "./project-archive.dto";
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  ParseUUIDPipe,
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
import { EffectiveFileInterceptor } from "../storage/upload-limits";
import {
  ApiExtraModels,
  getSchemaPath,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiServiceUnavailableResponse,
  ApiResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ProjectUploadConfigurationResponseDto,
  ProjectFileDeletionConfirmationResponseDto,
  ProjectFileTrashedResponseDto,
  ProjectFileOperationResponseDto,
  ProjectTrashItemResponseDto,
  ProjectTrashRestoredResponseDto,
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectFolderDto,
  MoveProjectFileResponseDto,
  MoveProjectFileDto,
  ProjectFileListResponseDto,
  ProjectFolderResponseDto,
  ProjectMemberResponseDto,
  ProjectResponseDto,
  ProjectScalarResponseDto,
  ProjectCreatedResponseDto,
  ProjectListItemResponseDto,
  ProjectMembershipScalarResponseDto,
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
  ProtectedFileTypeResponseDto,
  ProtectedFileTypeRemovedResponseDto,
} from "./protected-file-types.dto";
import {
  SubmitProjectCreationDto,
  ProjectCreationOutcomeDto,
} from "./project-creation-submission.dto";
import {
  ApiErrorResponseDto,
  ApiUploadSizeError,
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

  @Post("creation-submissions")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_CREATE)
  @ApiOperation({
    summary:
      "Submit identifiable project creation without replaying filesystem work",
    description:
      "Keep requestId through response loss. Repeated identical submissions only read outcome. UNRESOLVED requires inspection, never automatic CLEAR or a new request identity. Legacy POST /projects remains available without submission readback.",
  })
  @ApiAcceptedResponse({ type: ProjectCreationOutcomeDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: "Identity reuse or overlapping unresolved creation.",
  })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description: "PROJECT_CREATION_OUTCOME_UNKNOWN; read the same identity.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  submitCreation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitProjectCreationDto,
  ) {
    return this.projects.submitCreation(user, dto);
  }

  @Get("creation-submissions/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_CREATE)
  @ApiOperation({
    summary:
      "Read the caller's own creation outcome without project-list access",
    description:
      "Current projects.create required. Foreign workspace/owner and unknown identities are 404; absence does not prove an earlier submission cannot commit.",
  })
  @ApiOkResponse({ type: ProjectCreationOutcomeDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  creationOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
  ) {
    return this.projects.creationOutcome(user, requestId);
  }

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "List accessible projects",
    description:
      "Current projects.read is required. Ordinary lists exclude archived projects; lifecycle=archived returns only archives with the same access checks. Callers with projects.read-all receive all matching workspace projects; others receive membership/public-read projects. isMember reports only persisted membership. Authorization, scope and viewer relationship share one snapshot.",
  })
  @ApiOkResponse({
    description: "Projects ordered by latest update.",
    type: ProjectListItemResponseDto,
    isArray: true,
  })
  @ApiAuthenticationErrors()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProjectListQueryDto,
  ) {
    return this.projects.list(user, query.lifecycle);
  }

  @Post()
  @RequirePermissions(Permissions.PROJECTS_CREATE)
  @ApiOperation({
    summary: "Create a project",
    description:
      "Requires projects.create. Selects the workspace default department when departmentId is omitted. Existing directories require an explicit KEEP choice here; CLEAR must use POST /projects/creation-submissions with a client-generated requestId (legacy CLEAR returns 428). Empty projects become ready immediately; a published template registers asynchronous setup. The creator becomes the first member. Use keyed creation-submissions for original-response readback; this legacy route does not supply a client submission identity.",
  })
  @ApiCreatedResponse({
    description: "Project and its backing directory created.",
    type: ProjectCreatedResponseDto,
  })
  @ApiResponse({
    type: ApiErrorResponseDto,
    status: 428,
    description:
      "PROJECT_CREATION_ID_REQUIRED: CLEAR must use keyed creation-submissions.",
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
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Get project details",
    description:
      "Current projects.read plus project read scope. Members/read-all callers receive the existing member list; public-read nonmembers receive metadata with members omitted. isMember independently reports the current caller's actual membership in the same snapshot; it is not an access grant or personalization ranking.",
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
  @ApiOkResponse({
    description:
      "Updated project scalars only. Relational data is omitted; refresh detail or retain existing relations when merging.",
    type: ProjectScalarResponseDto,
  })
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
      "Requires projects.members.manage and project membership unless projects.manage-all is also granted. New members must be OPEN accounts in this workspace. Existing inactive memberships are returned unchanged until explicitly removed; they grant no active account authority.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Project ID." })
  @ApiCreatedResponse({
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
    type: ProjectMembershipScalarResponseDto,
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

  @Get(":id/files/upload-configuration")
  @RequirePermissions(Permissions.PROJECT_FILES_WRITE)
  @ApiOperation({
    summary: "Read effective project upload configuration",
    description:
      "Same membership/admin and READY gates as uploads; does not read storage or imply storage health. Unavailable requests return errors, never client defaults.",
  })
  @ApiOkResponse({ type: ProjectUploadConfigurationResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  uploadConfiguration(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.projects.uploadConfiguration(user, id);
  }

  @Post(":id/files/upload")
  @RequirePermissions(Permissions.PROJECT_FILES_WRITE)
  @UseInterceptors(
    EffectiveFileInterceptor(() => ({
      limits: { fileSize: ProjectsService.maxUploadBytes() + 1 },
    })),
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
  @ApiUploadSizeError()
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
  @ApiOkResponse({
    type: ProtectedFileTypeResponseDto,
    isArray: true,
    description:
      "Existing project-scoped rules ordered by extension; sensitive access and projects.files.delete remain required.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  listProtectedFileTypes(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.projects.listProtectedFileTypes(user, id);
  }

  @Post(":id/protected-file-types")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "Append a protected file extension" })
  @ApiCreatedResponse({
    type: ProtectedFileTypeResponseDto,
    description:
      "Created or existing normalized rule; repeated normalized extensions preserve the original record and creation attribution.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
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
  @ApiOkResponse({ type: ProtectedFileTypeResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
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
  @ApiOkResponse({ type: ProtectedFileTypeRemovedResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
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
  @ApiExtraModels(
    ProjectFileDeletionConfirmationResponseDto,
    ProjectFileTrashedResponseDto,
  )
  @ApiCreatedResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ProjectFileDeletionConfirmationResponseDto) },
        { $ref: getSchemaPath(ProjectFileTrashedResponseDto) },
      ],
    },
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  deleteFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: DeleteProjectFileDto,
  ) {
    return this.projects.deleteFile(user, id, dto.path, dto.operationId);
  }

  @Post(":id/files/delete-confirmations/:confirmationId/confirm")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({
    summary: "Confirm deletion of a protected project file or folder",
  })
  @ApiCreatedResponse({ type: ProjectFileTrashedResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  confirmFileDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("confirmationId") confirmationId: string,
  ) {
    return this.projects.confirmFileDeletion(user, id, confirmationId);
  }

  @Get(":id/file-operations")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOkResponse({ type: ProjectFileOperationResponseDto, isArray: true })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  fileOperations(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.projects.listFileOperations(user, id);
  }

  @Get(":id/file-operations/:operationId")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOkResponse({ type: ProjectFileOperationResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  fileOperation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("operationId") operationId: string,
  ) {
    return this.projects.fileOperation(user, id, operationId);
  }

  @Post(":id/file-operations/:operationId/reconcile")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({
    summary:
      "Inspect a deletion outcome and repair its database state without moving bytes",
  })
  @ApiCreatedResponse({ type: ProjectFileOperationResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  reconcileFileOperation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("operationId") operationId: string,
  ) {
    return this.projects.reconcileFileOperation(user, id, operationId);
  }

  @Get(":id/trash")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "List recoverable project trash items" })
  @ApiOkResponse({
    type: ProjectTrashItemResponseDto,
    isArray: true,
    description:
      "ACTIVE rows newest first, including expired rows awaiting cleanup. Sensitive access required; READY is not required for this metadata list.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  listTrash(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.projects.listTrash(user, id);
  }

  @Post(":id/trash/:trashId/restore")
  @RequirePermissions(Permissions.PROJECT_FILES_DELETE)
  @ApiOperation({ summary: "Restore a recoverable project trash item" })
  @ApiCreatedResponse({ type: ProjectTrashRestoredResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  restoreTrash(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("trashId") trashId: string,
  ) {
    return this.projects.restoreTrash(user, id, trashId);
  }

  @Get(":id/deletion-requests")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({
    summary: "Read recent deletion state",
    description:
      "Owner/member within current workspace; after project removal only the persisted owner or requester within the resource's saved workspace. Latest 100 requests and audits, newest first. Unknown legacy audit scope fails closed.",
  })
  @ApiOkResponse({ type: ProjectDeletionHistoryResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  deletionHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.projects.deletionHistory(user, id);
  }

  @Get(":id/deletion-requests/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({
    summary: "Reconcile a known deletion request",
    description:
      "Same scope as deletion history; works after request/project removal through the durable audit. Does not perform filesystem work, reissue tokens or confirm deletion.",
  })
  @ApiOkResponse({ type: ProjectDeletionStateResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  deletionState(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
  ) {
    return this.projects.deletionHistory(user, id, requestId);
  }

  @Post(":id/deletion-requests")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({ summary: "Request permanent project deletion" })
  @ApiCreatedResponse({ type: ProjectDeletionRequestResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.projects.requestProjectDeletion(user, id);
  }

  @Post(":id/deletion-requests/:requestId/approve")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({ summary: "Owner approval and deletion-token preflight" })
  @ApiCreatedResponse({ type: ProjectDeletionRequestResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  approveDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
  ) {
    return this.projects.approveProjectDeletion(user, id, requestId);
  }

  @Post(":id/deletion-requests/:requestId/active-sessions")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({
    summary:
      "Owner chooses whether live project sessions should wait or be interrupted",
  })
  @ApiCreatedResponse({ type: DeletionSessionDecisionResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
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
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({ summary: "Cancel an outstanding project deletion request" })
  @ApiCreatedResponse({ type: ProjectDeletionRequestResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  cancelDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
  ) {
    return this.projects.cancelProjectDeletion(user, id, requestId);
  }

  @Post(":id/deletion-requests/:requestId/confirm")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECTS_DELETE)
  @ApiOperation({
    summary:
      "Submit the owner Telegram token and permanently delete the project",
  })
  @ApiCreatedResponse({ type: ConfirmProjectDeletionResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
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
  @ApiOkResponse({
    description:
      "Binary file stream. The response includes an attachment Content-Disposition header.",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" },
      },
    },
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
      "Legacy administrator endpoint. Returns the active default department home, departmentId and revision. New integrations should use the Departments API.",
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
  @ApiRevision()
  @ApiOperation({
    summary: "Set the legacy default projects home",
    description:
      "Requires the current quoted If-Match revision and departmentId from GET. Updates the active default home under the department/project lock; a changed default returns 409. The home cannot change after the department owns a project. Preserve entered data and reconcile unknown outcomes before retrying.",
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
    @ExpectedRevision() revision: number,
  ) {
    return this.projects.setProjectsHome(
      user.workspaceId,
      dto.path,
      revision,
      dto.departmentId,
    );
  }
}
