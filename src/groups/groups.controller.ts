import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
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
  ApiOperationErrors,
  ApiErrorResponseDto,
  ApiReadAvailability,
} from "../openapi/api-docs";
import {
  ChatGroupCreationResponseDto,
  ChatGroupQueryDto,
  ChatGroupResponseDto,
  CreateChatGroupDto,
} from "./groups.dto";
import { GroupsService } from "./groups.service";

@Controller("chat-groups")
@ApiTags("Chat group metadata")
@UseGuards(JwtAuthGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiValidationErrors()
@ApiResourceErrors()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}
  @Post()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Create group metadata",
    description:
      "Every current OPEN human account may create metadata without global permissions. Creator becomes initial owner with an explicit membership and invitation grant; other accounts are not admitted. Normal member text sending is enabled by default. No history, admins or agents are created. Reuse requestId and normalized name for durable replay; changed input returns 409.",
  })
  @ApiCreatedResponse({ type: ChatGroupCreationResponseDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description:
      "GROUP_REQUEST_CONFLICT when the same creator/requestId was used with a different normalized name. Existing group and receipt remain unchanged. Other state conflicts require readback before retry.",
  })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "Authentication dependencies unavailable or OPERATION_OUTCOME_UNKNOWN. Read the creation receipt and retry with the same requestId and input; never invent a new request ID to recover an uncertain outcome.",
  })
  @ApiOperationErrors()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateChatGroupDto,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.create(actor, dto);
  }

  @Get("creations/:requestId")
  @ApiReadAvailability()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read your group creation outcome",
    description:
      "Creator-only frozen initial metadata. Unknown or other creator request IDs return opaque 404. Current OPEN authentication required.",
  })
  @ApiOkResponse({ type: ChatGroupCreationResponseDto })
  readCreation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.read(actor, requestId, true);
  }

  @Get(":groupId")
  @ApiReadAvailability()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read created or currently admitted group metadata",
    description:
      "Creator or currently admitted member only. Roles or workspace membership grant no access. Metadata is platform scoped; current workspace is checked for active authentication only. No roster, message history or invitation-management authority follows from this read.",
  })
  @ApiOkResponse({ type: ChatGroupResponseDto })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Query() _query: ChatGroupQueryDto,
  ) {
    return this.groups.read(actor, groupId);
  }
}
