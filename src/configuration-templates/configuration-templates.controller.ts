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
  ParseFilePipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { EffectiveFileInterceptor } from "../storage/upload-limits";
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
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiTemplateErrors,
  ApiUploadSizeError,
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  ConfigurationTemplateDetailResponseDto,
  ConfigurationTemplateListResponseDto,
  ConfigurationTemplateCreatedResponseDto,
  TemplateScalarResponseDto,
  TemplateManifestResponseDto,
  TemplateFileMutationResponseDto,
  TemplateFileRemovedResponseDto,
  TemplateUploadConfigurationResponseDto,
  CreateConfigurationTemplateDto,
  MoveTemplateFileDto,
  ReplaceTemplateManifestDto,
  UpdateConfigurationTemplateDto,
  UploadTemplateFileDto,
} from "./configuration-templates.dto";
import { ConfigurationTemplatesService } from "./configuration-templates.service";
import { TemplateUploadCleanupInterceptor } from "./template-upload-cleanup.interceptor";
import {
  hasPermission,
  Permissions,
} from "../authorization/permission.catalog";

@Controller("configuration-templates")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permissions.TEMPLATES_READ)
@ApiTags("Configuration Templates")
@ApiAccessToken()
@ApiTemplateErrors()
export class ConfigurationTemplatesController {
  constructor(private readonly templates: ConfigurationTemplatesService) {}

  @Get("versions/:versionId/revision")
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({
    summary: "Read a workspace-scoped mutation revision without a read grant",
  })
  @ApiOkResponse({ type: RevisionResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  revision(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") id: string,
  ) {
    return this.templates.revision(user.workspaceId, id);
  }

  @Get()
  @ApiOperation({ summary: "List configuration templates" })
  @ApiOkResponse({ type: ConfigurationTemplateListResponseDto, isArray: true })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
  ) {
    return this.templates.list(
      user.workspaceId,
      hasPermission(user, Permissions.TEMPLATES_MANAGE),
      departmentId,
    );
  }

  @Get("upload-configuration")
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({
    summary: "Read effective template upload limits",
    description:
      "Management permission required; metadata does not imply storage health or draft writability. Both per-file and per-version limits remain enforced.",
  })
  @ApiOkResponse({ type: TemplateUploadConfigurationResponseDto })
  uploadConfiguration() {
    return this.templates.uploadConfiguration();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a template and its visible versions" })
  @ApiOkResponse({ type: ConfigurationTemplateDetailResponseDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.templates.get(
      user.workspaceId,
      id,
      hasPermission(user, Permissions.TEMPLATES_MANAGE),
    );
  }

  @Post()
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({ summary: "Create a template with draft version 1" })
  @ApiCreatedResponse({ type: ConfigurationTemplateCreatedResponseDto })
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
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({ summary: "Update template metadata" })
  @ApiOkResponse({ type: TemplateScalarResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateConfigurationTemplateDto,
  ) {
    return this.templates.update(user.workspaceId, id, dto);
  }

  @Post(":id/drafts")
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({
    summary: "Clone the latest published version into a new draft",
  })
  @ApiCreatedResponse({
    type: TemplateManifestResponseDto,
    description: "Editable draft with copied manifest.",
  })
  createDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.templates.createDraft(user.workspaceId, id, user.id);
  }

  @Post(":id/archive")
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({ summary: "Archive a configuration template" })
  @ApiCreatedResponse({ type: TemplateScalarResponseDto })
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.templates.archive(user.workspaceId, id);
  }

  @Put("versions/:versionId/manifest")
  @ApiRevision()
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({
    summary: "Atomically replace draft folders and ordered command stages",
  })
  @ApiOkResponse({
    type: TemplateManifestResponseDto,
    description: "Updated draft manifest including preserved files.",
  })
  replaceManifest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: ReplaceTemplateManifestDto,
  ) {
    return this.templates.replaceManifest(
      user.workspaceId,
      versionId,
      dto,
      revision,
    );
  }

  @Post("versions/:versionId/files")
  @ApiRevision()
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @UseInterceptors(
    EffectiveFileInterceptor(() => ({
      limits: { fileSize: ConfigurationTemplatesService.maxFileBytes() + 1 },
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
    })),
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
  @ApiCreatedResponse({ type: TemplateFileMutationResponseDto })
  @ApiUploadSizeError()
  uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @ExpectedRevision() revision: number,
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
      revision,
    );
  }

  @Patch("versions/:versionId/files/:fileId")
  @ApiRevision()
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({ summary: "Change a draft file destination path" })
  @ApiOkResponse({ type: TemplateFileMutationResponseDto })
  moveFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @ExpectedRevision() revision: number,
    @Param("fileId") fileId: string,
    @Body() dto: MoveTemplateFileDto,
  ) {
    return this.templates.moveFile(
      user.workspaceId,
      versionId,
      fileId,
      dto,
      revision,
    );
  }

  @Delete("versions/:versionId/files/:fileId")
  @ApiRevision()
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({ summary: "Remove a file registration from a draft" })
  @ApiOkResponse({ type: TemplateFileRemovedResponseDto })
  removeFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @ExpectedRevision() revision: number,
    @Param("fileId") fileId: string,
  ) {
    return this.templates.removeFile(
      user.workspaceId,
      versionId,
      fileId,
      revision,
    );
  }

  @Post("versions/:versionId/publish")
  @ApiRevision()
  @RequirePermissions(Permissions.TEMPLATES_MANAGE)
  @ApiOperation({ summary: "Validate and immutably publish a draft version" })
  @ApiCreatedResponse({ type: TemplateManifestResponseDto })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param("versionId") versionId: string,
    @ExpectedRevision() revision: number,
  ) {
    return this.templates.publish(
      user.workspaceId,
      versionId,
      user.id,
      revision,
    );
  }
}
