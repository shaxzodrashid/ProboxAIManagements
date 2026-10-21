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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
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
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import { ChatGroupQueryDto } from "./groups.dto";
import { GroupMessagesService } from "./group-messages.service";
import {
  GroupMessageDto,
  GroupSendingPolicyDto,
  SendGroupMessageDto,
  SetGroupSendingPolicyDto,
  GroupHistoryQueryDto,
  GroupHistoryPageDto,
} from "./group-messages.dto";

@Controller("chat-groups/:groupId")
@UseGuards(JwtAuthGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiTags("Human group messages")
export class GroupMessagesController {
  constructor(private readonly messages: GroupMessagesService) {}
  @Get("messages")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiResourceErrors()
  @ApiOperation({
    summary: "Read admitted group text history",
    description:
      "Current OPEN member only, including explicit cross-workspace admissions. Newest-first opaque paging, frozen per-topic pre-admission window plus later messages. Omit topicId for existing unthreaded messages. No request receipts, raw sequences, hidden counts, profiles or roster. Every page rechecks authority and frozen admission; legacy unproven boundaries fail closed409. ALL needs no historical cutoff. No topic-management, rejoin or retroactive-history operation is added.",
  })
  @ApiOkResponse({ type: GroupHistoryPageDto })
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Query() query: GroupHistoryQueryDto,
  ) {
    return this.messages.history(actor, groupId, query);
  }
  @Post("messages")
  @Header("Cache-Control", "no-store")
  @ApiOperationErrors()
  @ApiOperation({
    summary: "Send a plain-text group message",
    description:
      "Current admitted OPEN human members can send by default, with no extra grant. An explicit owner restriction permits only the admitted OPEN owner to create new messages. No invitation or administration authority follows. Current membership/account checked under the shared group fence. Stable group/author/requestId and exact text replay the same message; changed text409. No history browsing, attachments, topics, external delivery or agents. After an uncertain response, reconcile and retry the same request/input;404 is not proof an in-flight write cannot commit.",
  })
  @ApiCreatedResponse({ type: GroupMessageDto })
  send(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Body() dto: SendGroupMessageDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.messages.send(actor, groupId, dto);
  }
  @Get("messages/by-request/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Reconcile your own group message send",
    description:
      "Author/request/group scoped; current OPEN account and membership required. Other authors and nonmembers receive opaque404. Existing receipts remain readable after a sending restriction; they do not permit a new send. Does not expose another member's messages or pre-admission history.",
  })
  @ApiOkResponse({ type: GroupMessageDto })
  outcome(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.messages.outcome(actor, groupId, requestId);
  }
  @Get("sending-policy")
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Read your admitted group's sending policy",
    description:
      "Current admitted OPEN humans only. Default membersCanSend=true; false means new messages are owner-only. No roster or invitation-management grants.",
  })
  @ApiOkResponse({ type: GroupSendingPolicyDto })
  policy(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.messages.policy(actor, groupId);
  }
  @Put("sending-policy")
  @Header("Cache-Control", "no-store")
  @ApiRevision("group sending policy")
  @ApiOperationErrors()
  @ApiOperation({
    summary: "Owner explicitly restricts or restores normal group sending",
    description:
      "Current admitted OPEN owner only. Revision-checked, audited changes, serialized with sends. Workspace roles and invitation grants grant no policy authority. A restriction affects new sends after it wins the fence, not already accepted messages. Same-value writes do not create an audit/revision. On an uncertain outcome reread the policy before retrying.",
  })
  @ApiOkResponse({ type: GroupSendingPolicyDto })
  setPolicy(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: SetGroupSendingPolicyDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.messages.setPolicy(
      actor,
      groupId,
      revision,
      dto.membersCanSend,
    );
  }
}
