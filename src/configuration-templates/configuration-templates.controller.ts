import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UserRole } from "@prisma/client";
import { diskStorage } from "multer";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  ConfigurationTemplateResponseDto,
  CreateConfigurationTemplateDto,
  MoveTemplateFileDto,
  ReplaceTemplateManifestDto,
  UpdateConfigurationTemplateDto,
  UploadTemplateFileDto,
} from "./configuration-templates.dto";
import { ConfigurationTemplatesService } from "./configuration-templates.service";
import { TemplateUploadCleanupInterceptor } from "./template-upload-cleanup.interceptor";

@Controller("configuration-templates")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@ApiTags("Configuration Templates")
@ApiAccessToken()
export class ConfigurationTemplatesController {
  constructor(private readonly templates: ConfigurationTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "List configuration templates" })
  @ApiOkResponse({ type: ConfigurationTemplateResponseDto, isArray: true })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
  ) {
    return this.templates.list(
      user.workspaceId,
      user.role === UserRole.ADMIN,
      departmentId,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a template and its visible versions" })
  @ApiOkResponse({ type: ConfigurationTemplateResponseDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.templates.get(
      user.workspaceId,
      id,
      user.role === UserRole.ADMIN,
    );
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Create a template with draft version 1" })
  @ApiCreatedResponse({ type: ConfigurationTemplateResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConfigurationTemplateDto,
  ) {
    return this.templates.create(user.workspaceId, user.id, dto);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Update template metadata" })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateConfigurationTemplateDto,
  ) {
    return this.templates.update(user.workspaceId, id, dto);
  }

  @Post(":id/drafts")
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Clone the latest published version into a new draft",
  })
  @ApiCreatedResponse({ description: "Editable draft with copied manifest." })
  createDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.templates.createDraft(user.workspaceId, id, user.id);
  }

  @Post(":id/archive")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Archive a configuration template" })
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.templates.archive(user.workspaceId, id);
  }

  @Put("versions/:versionId/manifest")
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Atomically replace draft folders and ordered command stages",
  })
  @ApiOkResponse({ description: "Updated draft manifest." })
  replaceManifest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @Body() dto: ReplaceTemplateManifestDto,
  ) {
    return this.templates.replaceManifest(user.workspaceId, versionId, dto);
  }

  @Post("versions/:versionId/files")
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: ConfigurationTemplatesService.maxFileBytes() },
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          const directory =
            process.env.PROBOXAI_UPLOAD_TEMP_DIR ??
            path.join(tmpdir(), "proboxai-template-uploads");
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          callback(null, directory);
        },
        filename: (_request, _file, callback) => callback(null, randomUUID()),
      }),
    }),
    TemplateUploadCleanupInterceptor,
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["destinationPath", "file"],
      properties: {
        destinationPath: {
          type: "string",
          example: "docs/brand/brand-book.pdf",
        },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiOperation({
    summary: "Upload and register an immutable MinIO-backed file",
  })
  uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @Body() dto: UploadTemplateFileDto,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true }))
    file: {
      originalname: string;
      mimetype: string;
      path: string;
      size: number;
    },
  ) {
    return this.templates.uploadFile(
      user.workspaceId,
      versionId,
      dto.destinationPath,
      file,
    );
  }

  @Patch("versions/:versionId/files/:fileId")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Change a draft file destination path" })
  moveFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @Param("fileId") fileId: string,
    @Body() dto: MoveTemplateFileDto,
  ) {
    return this.templates.moveFile(user.workspaceId, versionId, fileId, dto);
  }

  @Delete("versions/:versionId/files/:fileId")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Remove a file registration from a draft" })
  removeFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.templates.removeFile(user.workspaceId, versionId, fileId);
  }

  @Post("versions/:versionId/publish")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Validate and immutably publish a draft version" })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
  ) {
    return this.templates.publish(user.workspaceId, versionId, user.id);
  }
}
