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
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/auth.decorator";
import { JwtAuthGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiOperationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ChatGroupQueryDto } from "./groups.dto";
import {
  GroupReactionPageDto,
  GroupReactionQueryDto,
  OwnGroupReactionDto,
  SetGroupReactionDto,
} from "./group-reactions.dto";
import { GroupReactionsService } from "./group-reactions.service";

@Controller("chat-groups/:groupId/messages/:messageId/reactions")
@UseGuards(JwtAuthGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiTags("Human group reactions")
export class GroupReactionsController {
  constructor(private readonly reactions: GroupReactionsService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Read visible message reaction counts and your own presence",
    description:
      "Current admitted OPEN human and exact per-topic history visibility required on every request. At most100 emoji groups per page, database emoji order; nextAfter is the last exact emoji. Current state, not a frozen snapshot. Counts and your own boolean only, no reactor identities/profiles, hidden message counts or history. Sending restrictions affect text only.",
  })
  @ApiOkResponse({ type: GroupReactionPageDto })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Param("messageId", new ParseUUIDPipe({ version: "4" })) messageId: string,
    @Query() query: GroupReactionQueryDto,
  ) {
    return this.reactions.read(actor, groupId, messageId, query);
  }
  @Put()
  @Header("Cache-Control", "no-store")
  @ApiOperationErrors()
  @ApiOperation({
    summary: "Set one of your own emoji reactions",
    description:
      "Idempotent desired presence, scoped to this message/current account/exact Unicode emoji. Multiple distinct own emojis coexist. Never changes another account or emoji. Current OPEN membership and per-topic message visibility rechecked under the shared group fence; new-text sending restrictions do not block adding/removing reactions. No new permission grants. After an uncertain outcome, reread current reactions and reconcile intent before retrying; retries are desired-state operations, not historical receipts. Concurrent opposite intentions serialize in accepted lock order, with no stale-intent guarantee. No edit/delete/topic/rejoin or actor roster policy is introduced.",
  })
  @ApiOkResponse({ type: OwnGroupReactionDto })
  set(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Param("messageId", new ParseUUIDPipe({ version: "4" })) messageId: string,
    @Body() dto: SetGroupReactionDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.reactions.set(actor, groupId, messageId, dto);
  }
}
