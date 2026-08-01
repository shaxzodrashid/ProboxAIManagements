import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { map, Observable } from "rxjs";
import {
  CreateSessionDto,
  CreateTurnDto,
  InterruptSessionResponseDto,
  SessionDetailResponseDto,
  SessionEventDto,
  SessionResponseDto,
} from "./dto";
import { SessionsService } from "./sessions.service";
import { SessionEventsService } from "./session-events.service";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { Permissions } from "../authorization/permission.catalog";

@Controller("sessions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Sessions")
@ApiAccessToken()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly events: SessionEventsService,
  ) {}
  @Post()
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary: "Start a managed coding session",
    description:
      "Requires sessions.create. Creates the session immediately and starts its first turn asynchronously. Watch the SSE endpoint for runner events and completion.",
  })
  @ApiCreatedResponse({
    description: "Session created and queued for its first turn.",
    type: SessionResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessions.create(user.id, dto);
  }
  @Get(":id")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiOperation({
    summary: "Get a session and its turns",
    description: "Available only to the task's assigned manager.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Session ID." })
  @ApiOkResponse({
    description: "Session and chronological turn history.",
    type: SessionDetailResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.sessions.get(user.id, id);
  }
  @Post(":id/turns")
  @RequirePermissions(Permissions.SESSIONS_MANAGE)
  @ApiOperation({
    summary: "Start a follow-up turn",
    description:
      "Requires sessions.manage. The session must not already have a running turn. The turn runs asynchronously after this response.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Session ID." })
  @ApiCreatedResponse({ description: "Follow-up turn accepted and started." })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  turn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateTurnDto,
  ) {
    return this.sessions
      .get(user.id, id)
      .then(() => this.sessions.startTurn(id, dto.prompt));
  }
  @Post(":id/interrupt")
  @RequirePermissions(Permissions.SESSIONS_MANAGE)
  @ApiOperation({
    summary: "Interrupt the active local runner",
    description:
      "Requires sessions.manage. Returns `404` when no active process exists for the session.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Session ID." })
  @ApiOkResponse({
    description: "Interruption signal sent to the local runner.",
    type: InterruptSessionResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  interrupt(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.sessions.interrupt(user.id, id);
  }
  @Sse(":id/events/stream")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiOperation({
    summary: "Stream live session events",
    description:
      "Server-sent event stream for the session. Event `id` is a monotonically increasing sequence; `type` is the runner event type; `data` contains the runner payload plus the requesting actor ID.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Session ID." })
  @ApiProduces("text/event-stream")
  @ApiResponse({
    status: 200,
    description: "An open SSE stream of session events.",
    type: SessionEventDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<Observable<MessageEvent>> {
    await this.sessions.get(user.id, id);
    return this.events.stream(id).pipe(
      map(
        (event) =>
          ({
            id: String(event.id),
            type: event.type,
            data: { ...(event.data as object), actor: user.id },
          }) as unknown as MessageEvent,
      ),
    );
  }
}
