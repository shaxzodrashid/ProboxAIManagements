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
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectFolderDto,
  MoveProjectFileDto,
  SetProjectsHomeDto,
  UpdateProjectDto,
  UploadProjectFileDto,
} from "./projects.dto";
import { ProjectsService } from "./projects.service";

@Controller("projects")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.list(user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user, dto);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.projects.get(user, id);
  }

  @Put(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user, id, dto);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projects.addMember(user, id, dto.userId);
  }

  @Delete(":id/members/:userId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.projects.removeMember(user, id, userId);
  }

  @Post(":id/folders")
  createFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateProjectFolderDto,
  ) {
    return this.projects.createFolder(user, id, dto.path);
  }

  @Get(":id/files")
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
export class SettingsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get("projects-home")
  getProjectsHome(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.getProjectsHome(user.workspaceId);
  }

  @Put("projects-home")
  setProjectsHome(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetProjectsHomeDto,
  ) {
    return this.projects.setProjectsHome(user.workspaceId, dto.path);
  }
}
