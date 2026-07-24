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
import { UserRole } from "@prisma/client";
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
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
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
} from "./projects.dto";
import { ProjectsService } from "./projects.service";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";

@Controller("projects")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags("Projects")
@ApiAccessToken()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary: "List accessible projects",
    description:
      "Administrators receive all workspace projects. Other users receive projects they belong to and projects with workspace read access enabled.",
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
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Create a project",
    description:
      "Administrator or manager only. Creates both the workspace-scoped project record and an empty project directory. The creator is added as the first member.",
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
      "Members and administrators receive the member list. Users with public read access receive project metadata only.",
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
  @ApiOperation({
    summary: "Update project settings",
    description: "Available to project members and administrators.",
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
  @ApiOperation({
    summary: "Add a project member",
    description:
      "Available to project members and administrators. Existing members are returned unchanged.",
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
  @ApiOperation({
    summary: "Remove a project member",
    description: "Available to project members and administrators.",
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

  @Get(":id/files/download")
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiTags("Settings")
@ApiAccessToken()
export class SettingsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get("projects-home")
  @ApiOperation({
    summary: "Get the workspace projects home",
    description:
      "Administrator-only. Returns the effective path and whether it was explicitly configured for the workspace.",
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
    summary: "Set the workspace projects home",
    description:
      "Administrator-only. The path must be absolute and inside the server's allowed root. It cannot change after a project has been created.",
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
