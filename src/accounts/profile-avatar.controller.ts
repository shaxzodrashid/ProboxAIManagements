import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/auth.decorator";
import { JwtAuthGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import {
  ApiErrorResponseDto,
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiUploadSizeError,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { EffectiveFileInterceptor } from "../storage/upload-limits";
import { AVATAR_UPLOAD_LIMIT } from "./profile-avatar-domain";
import {
  AvatarUploadDto,
  AvatarUploadQueryDto,
  AvatarUploadReceiptDto,
  DiscardedAvatarDto,
} from "./profile-avatar.dto";
import { ProfileAvatarService } from "./profile-avatar.service";

type ImageResponse = {
  setHeader(name: string, value: string): void;
  send(body: Buffer): unknown;
};
function sendPng(response: ImageResponse, body: Buffer) {
  response.setHeader("Content-Type", "image/png");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  return response.send(body);
}
@Controller("users/me/avatar-uploads")
@UseGuards(JwtAuthGuard)
@ApiTags("Profile avatars")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiServiceUnavailableResponse({
  type: ApiErrorResponseDto,
  description:
    "Storage/operation unavailable or upload outcome uncertain. Retain the upload requestId and reconcile; never infer rollback or automatically replace its identity.",
})
export class ProfileAvatarController {
  constructor(private readonly avatars: ProfileAvatarService) {}
  @Post()
  @Header("Cache-Control", "no-store")
  @UseInterceptors(
    EffectiveFileInterceptor(() => ({
      limits: { fileSize: AVATAR_UPLOAD_LIMIT, files: 1, fields: 4, parts: 5 },
    })),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["requestId", "file"],
      additionalProperties: false,
      properties: {
        requestId: { type: "string", format: "uuid" },
        file: {
          type: "string",
          format: "binary",
          description:
            "Static JPEG/PNG, actual bytes validated and decoded, at most 5 MiB. Normalized square PNG up to 512px; no original metadata.",
        },
        cropX: { type: "integer", minimum: 0, maximum: 8192 },
        cropY: { type: "integer", minimum: 0, maximum: 8192 },
        cropSize: { type: "integer", minimum: 1, maximum: 8192 },
      },
    },
  })
  @ApiCreatedResponse({ type: AvatarUploadReceiptDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description:
      "Upload request identity already belongs to different bytes or crop; preserve the original identity for reconciliation.",
  })
  @ApiUploadSizeError()
  @ApiOperation({
    summary: "Stage a validated self avatar without publishing it",
    description:
      "Current OPEN human self, including zero grants. Retain upload UUID for exact-byte/crop retries. Staging never changes the current image or audiences. Supply all crop fields after orientation or none for centered square. Stage expires after 24 hours. Main atomic Profile Save publishes avatarAssetId or null removes a current photo; crop Done only stages.",
  })
  stage(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AvatarUploadDto,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true }))
    file: { buffer: Buffer },
    @Query() _query: AvatarUploadQueryDto,
  ) {
    return this.avatars.stage(actor, dto, file.buffer);
  }
  @Get("operations/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AvatarUploadReceiptDto })
  @ApiOperation({
    summary: "Reconcile an owned avatar upload",
    description:
      "Matching immutable stored-object evidence can settle uncertain upload state without repeating put. Returns current stage/asset state, not the whole Profile Save receipt. UPLOADING remains uncertain; no raw storage keys, hashes or original metadata.",
  })
  readback(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: AvatarUploadQueryDto,
  ) {
    return this.avatars.readback(actor, requestId);
  }
  @Get(":assetId/content")
  @ApiProduces("image/png")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({
    schema: { type: "string", format: "binary" },
    description:
      "Owner-only normalized image/png, no-store and nosniff. Current ownership rechecked after storage fetch.",
  })
  @ApiOperation({
    summary: "Preview an owned ready avatar",
    description:
      "STAGED unexpired or current ACTIVE image only. Does not bypass public audience settings for other viewers. Expired, unavailable and foreign stages return the same 404.",
  })
  async preview(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("assetId", new ParseUUIDPipe({ version: "4" })) assetId: string,
    @Query() _query: AvatarUploadQueryDto,
    @Res() response: ImageResponse,
  ) {
    return sendPng(
      response,
      await this.avatars.preview(actor, assetId.toLowerCase()),
    );
  }
  @Delete(":assetId")
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description:
      "Active photos require main Profile Save; uncertain UPLOADING assets require reconciliation.",
  })
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: DiscardedAvatarDto })
  @ApiOperation({
    summary: "Discard an owned unpublished avatar draft",
    description:
      "Idempotently retires a staged draft for avatar-only cleanup. Active photos require atomic Profile Save removal. UPLOADING returns 409 until evidence is reconciled; no current-photo change or false physical-deletion acknowledgment.",
  })
  discard(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("assetId", new ParseUUIDPipe({ version: "4" })) assetId: string,
    @Query() _query: AvatarUploadQueryDto,
  ) {
    return this.avatars.discard(actor, assetId.toLowerCase());
  }
}

@Controller("profiles")
@UseGuards(OptionalJwtAuthGuard)
@ApiTags("Public profiles")
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiServiceUnavailableResponse({
  type: ApiErrorResponseDto,
  description:
    "Avatar or audience storage unavailable; never an empty-image or anonymous fallback.",
})
export class PublicProfileAvatarController {
  constructor(private readonly avatars: ProfileAvatarService) {}
  @Get(":accountId/avatar/:assetId")
  @ApiProduces("image/png")
  @Header("Cache-Control", "no-store")
  @ApiParam({ name: "accountId", format: "uuid" })
  @ApiParam({ name: "assetId", format: "uuid" })
  @ApiOkResponse({
    schema: { type: "string", format: "binary" },
    description:
      "Authorized normalized image/png with no-store/nosniff. Hidden, unset, removed and stale references return 404 without private image metadata.",
  })
  @ApiOperation({
    summary: "Read the current viewer-authorized avatar",
    description:
      "Evaluate AVATAR audience and current asset before and after storage fetch. Optional authentication rejects supplied invalid credentials. No direct bucket URL, public object key, original image or role bypass. Authenticated fetch is required for restricted audiences; never put tokens in an image URL.",
  })
  async read(
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) accountId: string,
    @Param("assetId", new ParseUUIDPipe({ version: "4" })) assetId: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Query() _query: AvatarUploadQueryDto,
    @Res() response: ImageResponse,
  ) {
    return sendPng(
      response,
      await this.avatars.publicContent(accountId, assetId.toLowerCase(), actor),
    );
  }
}
