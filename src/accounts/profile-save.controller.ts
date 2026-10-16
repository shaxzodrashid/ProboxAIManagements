import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/auth.decorator";
import { JwtAuthGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  CommitSelfProfileDto,
  ProfileEditResponseDto,
  ProfileSaveQueryDto,
  ProfileSaveReceiptDto,
} from "./profile-save.dto";
import { ProfileSaveService } from "./profile-save.service";

@Controller("users/me/profile")
@UseGuards(JwtAuthGuard)
@ApiTags("Profile Save")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiServiceUnavailableResponse({
  description:
    "PROFILE_SAVE_UNAVAILABLE: uncertain writes require same-identity reconciliation; this does not prove rollback.",
})
export class ProfileSaveController {
  constructor(private readonly saves: ProfileSaveService) {}
  @Get("edit")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ProfileEditResponseDto })
  @ApiOperation({
    summary: "Read one coherent self profile edit baseline",
    description:
      "OPEN human self, including zero permissions. One snapshot of profile, policies, shared availability and aggregate revision. Contacts remain separate explicit operations. No actor history.",
  })
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() _query: ProfileSaveQueryDto,
  ) {
    return this.saves.edit(actor);
  }
  @Put("changes")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ProfileSaveReceiptDto })
  @ApiConflictResponse({
    description:
      "PROFILE_SAVE_REVISION_CONFLICT or PROFILE_SAVE_REQUEST_CONFLICT. Preserve draft; no automatic stale retry.",
  })
  @ApiOperation({
    summary: "Commit the complete staged Profile Save atomically",
    description:
      "Use the edit revision and a UUIDv4 requestId. Supported profile fields, supplied audiences and optional availability commit together with one private receipt. Omitted fields retain values; null clears supported fields. Availability is shared with everyone regardless of legacy STATUS policy. Receipt is historical acknowledgment only; reread edit state for current values. Exact retries do not reapply. Existing PUT /users/me/profile and standalone status contracts remain compatible. Done stages locally; pre-submit Cancel sends nothing. No contacts, avatar uploads, role edits or agent execution.",
  })
  commit(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CommitSelfProfileDto,
    @Query() _query: ProfileSaveQueryDto,
  ) {
    return this.saves.commit(actor, dto);
  }
  @Get("operations/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ProfileSaveReceiptDto })
  @ApiOperation({
    summary: "Reconcile your whole Profile Save",
    description:
      "Fresh OPEN human owner and workspace checks. Minimal immutable acknowledgment, never old private content or current-state proof. A 404 while a request is still in flight is not proof of failure.",
  })
  readback(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: ProfileSaveQueryDto,
  ) {
    return this.saves.readback(actor, requestId);
  }
}
