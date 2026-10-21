import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/auth.guards";
import { CurrentUser } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiOperationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import { ChatGroupQueryDto } from "./groups.dto";
import { GroupAdmissionService } from "./group-admission.service";
import {
  CreateGroupInvitationDto,
  DirectCardQueryDto,
  DirectConversationsDto,
  DirectInvitationCardsDto,
  GroupInvitationDecisionDto,
  GroupInvitationDto,
  GroupInvitationOutcomeDto,
  GroupInvitationPermissionsDto,
  GroupMembershipListDto,
  GroupPageQueryDto,
  SetGroupInvitationPermissionDto,
} from "./group-admission.dto";
@Controller()
@UseGuards(JwtAuthGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiTags("Human group admission and invitation DMs")
export class GroupAdmissionController {
  constructor(private readonly groups: GroupAdmissionService) {}
  @Get("chat-groups/:groupId/invitation-permissions")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Owner reads explicit invitation grants",
    description:
      "Owner-only. Workspace/global roles do not bypass ownership. No public roster or permission delegation to nonowners.",
  })
  @ApiOkResponse({ type: GroupInvitationPermissionsDto })
  permissions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.getPermissions(actor, id);
  }
  @Put("chat-groups/:groupId/invitation-permissions/:accountId")
  @Header("Cache-Control", "no-store")
  @ApiRevision("group invitation permissions")
  @ApiOperationErrors()
  @ApiOperation({
    summary: "Owner grants or removes a current member's invitation right",
    description:
      "Revision-checked, owner-only explicit right for both DIRECT and APPROVABLE modes. Current OPEN member required. General roles and invitation rights do not authorize further delegation. Current pending acceptance rechecks this right.",
  })
  @ApiOkResponse({ type: GroupInvitationPermissionsDto })
  setPermission(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) accountId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: SetGroupInvitationPermissionDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.setPermission(
      actor,
      id,
      accountId,
      revision,
      dto.canInvite,
    );
  }
  @Post("chat-groups/:groupId/invitations")
  @Header("Cache-Control", "no-store")
  @ApiOperationErrors()
  @ApiOperation({
    summary: "Create direct admission or a structured approvable invitation DM",
    description:
      "Current owner-granted invitation right and OPEN recipient. Inviter selects historyAccess, default NONE; no additional owner/admin approval. DIRECT admits atomically; APPROVABLE persists a GROUP_INVITATION DM card without admission. Stable inviter/requestId and matching input replay the same invitation; different input conflicts. Does not contact external messaging or launch an agent.",
  })
  @ApiCreatedResponse({ type: GroupInvitationOutcomeDto })
  invite(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: CreateGroupInvitationDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.create(actor, id, dto);
  }
  @Get("chat-groups/:groupId/invitations/by-request/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Reconcile your invitation request",
    description:
      "Current invitation right required; caller/request/group scoped. Returns immutable creation fields plus current invitation status. Missing404 does not prove an in-flight create cannot commit; retry the same requestId/input.",
  })
  @ApiOkResponse({ type: GroupInvitationOutcomeDto })
  outcome(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.outcome(actor, id, requestId);
  }
  @Get("users/me/chat-groups")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Discover your admitted group memberships",
    description:
      "Self-only, including approved cross-workspace admissions. Group-ID keyset, current OPEN account, no group roster. History policy/time are admission metadata; message/topic history retrieval is not implemented by this endpoint.",
  })
  @ApiOkResponse({ type: GroupMembershipListDto })
  memberships(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: GroupPageQueryDto,
  ) {
    return this.groups.memberships(actor, query);
  }
  @Get("direct-conversations")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "List your human invitation-card DM conversations",
    description:
      "Two authenticated participants only; no workspace-role bypass or arbitrary participant selector. Conversation-ID keyset. This slice has structured group invitation cards, no ordinary text-message creation.",
  })
  @ApiOkResponse({ type: DirectConversationsDto })
  conversations(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: GroupPageQueryDto,
  ) {
    return this.groups.conversations(actor, query);
  }
  @Get("direct-conversations/:conversationId/messages")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Read your durable structured invitation cards",
    description:
      "Current authenticated participant only; sequence cursor is not authorization. Cards contain frozen group name, invited history policy and current invitation status. They grant no group history/membership before acceptance and expose no unrelated conversations or private profiles.",
  })
  @ApiOkResponse({ type: DirectInvitationCardsDto })
  cards(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("conversationId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() query: DirectCardQueryDto,
  ) {
    return this.groups.cards(actor, id, query);
  }
  @Put(
    "direct-conversations/:conversationId/invitations/:invitationId/decision",
  )
  @Header("Cache-Control", "no-store")
  @ApiOperationErrors()
  @ApiOperation({
    summary: "Recipient accepts or declines an approvable group invitation",
    description:
      "Only the exact recipient, bound invitation/card/conversation. Accept rechecks the inviter's current OPEN membership and owner-granted right under the group fence. Admission freezes the inviter-selected history policy/time; no extra owner/admin approval. Same decision is idempotent; opposite decision conflicts. No removal, rejoin or retroactive history changes.",
  })
  @ApiOkResponse({ type: GroupInvitationDto })
  decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("conversationId", new ParseUUIDPipe({ version: "4" }))
    conversationId: string,
    @Param("invitationId", new ParseUUIDPipe({ version: "4" }))
    invitationId: string,
    @Body() dto: GroupInvitationDecisionDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.decide(actor, conversationId, invitationId, dto.accept);
  }
}
