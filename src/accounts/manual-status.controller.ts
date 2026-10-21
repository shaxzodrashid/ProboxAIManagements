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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiConflictResponse,
  ApiServiceUnavailableResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/auth.decorator";
import { JwtAuthGuard } from "../auth/auth.guards";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiErrorResponseDto,
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import {
  ManualStatusMutationResponseDto,
  ManualStatusQueryDto,
  ManualStatusResponseDto,
  PublicManualStatusResponseDto,
  SetManualStatusDto,
} from "./manual-status.dto";
import { ManualStatusService } from "./manual-status.service";

@Controller("users/me/status")
@UseGuards(JwtAuthGuard)
@ApiTags("Manual availability")
@ApiAccessToken()
@ApiServiceUnavailableResponse({
  type: ApiErrorResponseDto,
  description:
    "MANUAL_STATUS_UNAVAILABLE: status data/read or write reconciliation is unavailable. Distinguish this operation code from authentication infrastructure/refresh failure; an uncertain write does not prove rollback.",
})
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class ManualStatusController {
  constructor(private readonly status: ManualStatusService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ManualStatusResponseDto })
  @ApiOperation({
    summary: "Read your shared manual availability",
    description:
      "OPEN human self access, including zero workspace permissions. Null means unset; no selected default, expiry or connection presence. One value for everyone; legacy STATUS audiences have no effect. Custom text and badge symbols remain unsupported.",
  })
  self(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() _query: ManualStatusQueryDto,
  ) {
    return this.status.self(actor);
  }
  @Put()
  @Header("Cache-Control", "no-store")
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description:
      "MANUAL_STATUS_REVISION_CONFLICT: current value changed. MANUAL_STATUS_REQUEST_CONFLICT: request ID reused with different original revision or availability. Preserve the draft and reconcile; no automatic stale retry.",
  })
  @ApiRevision("manual availability")
  @ApiValidationErrors()
  @ApiOkResponse({ type: ManualStatusMutationResponseDto })
  @ApiOperation({
    summary: "Set or clear your shared manual availability",
    description:
      "Explicitly shares the selected Available/Away/Busy value with everyone, including anonymous profile viewers. Null clears to unset. Exact request/revision retry returns its frozen receipt; changed reuse or stale revision conflicts. 500/503 or lost transport does not prove rollback: read the same operation or retry unchanged. No agent execution, approval bypass, privacy edit, custom text, symbol or presence inference.",
  })
  set(
    @CurrentUser() actor: AuthenticatedUser,
    @ExpectedRevision() revision: number,
    @Body() dto: SetManualStatusDto,
    @Query() _query: ManualStatusQueryDto,
  ) {
    return this.status.set(actor, revision, dto);
  }
  @Get("operations/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ManualStatusMutationResponseDto })
  @ApiOperation({
    summary: "Reconcile your own status change",
    description:
      "Fresh OPEN self scope. Frozen human actor and result only; historical receipt does not reapply status or imply current value. No public actor history.",
  })
  readback(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: ManualStatusQueryDto,
  ) {
    return this.status.readback(actor, requestId);
  }
}

@Controller("profiles")
@UseGuards(OptionalJwtAuthGuard)
@ApiTags("Public profiles")
@ApiServiceUnavailableResponse({
  type: ApiErrorResponseDto,
  description:
    "MANUAL_STATUS_UNAVAILABLE: status data is temporarily unavailable. Authentication infrastructure failures remain separate from status reload failure.",
})
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class PublicManualStatusController {
  constructor(private readonly status: ManualStatusService) {}
  @Get(":accountId/status")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PublicManualStatusResponseDto })
  @ApiOperation({
    summary: "Read one shared manual availability",
    description:
      "Same current value for everyone, including anonymous, cross-workspace and owner viewers. Exact stored identity wins; alternate UUID casing resolves only a unique account. Ambiguous/missing/inactive profiles share404. Supplied invalid authentication rejects. Legacy STATUS audience records do not hide or vary this value. No online/offline, last-active time, workspace, actor history or private profile fields.",
  })
  read(
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) accountId: string,
    @Query() _query: ManualStatusQueryDto,
  ) {
    return this.status.publicStatus(accountId);
  }
}
