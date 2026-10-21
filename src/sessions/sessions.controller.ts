import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  BadRequestException,
  HttpCode,
  ParseUUIDPipe,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiServiceUnavailableResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiExtraModels,
  getSchemaPath,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Observable } from "rxjs";
import {
  DirectoryPreflightDto,
  ProjectExecutionQueryDto,
  DirectoryPreflightResponseDto,
  ProjectExecutionResponseDto,
  CreateSessionDto,
  RequestFollowUpDto,
  RequestInterruptDto,
  CreatedSessionResponseDto,
  TurnAcceptanceResponseDto,
  InterruptSessionResponseDto,
  SessionDetailResponseDto,
  SessionEventDto,
  ModelCatalogQueryDto,
  SessionHistoryQueryDto,
  SessionHistoryResponseDto,
} from "./dto";
import { SessionsService } from "./sessions.service";
import {
  SessionDetailQueryDto,
  SessionDetailPageDto,
} from "./session-detail.dto";
import {
  KeyedCreateSessionDto,
  SessionCreationQueryDto,
  SessionCreationReceiptDto,
} from "./session-creation.dto";
import {
  SessionArchiveResponseDto,
  SessionArchiveQueryDto,
  SessionTurnsQueryDto,
  SessionTurnsResponseDto,
} from "./session-archive.dto";
import {
  SessionListQueryDto,
  SessionListResponseDto,
} from "./session-list.dto";
import { SessionEventsService } from "./session-events.service";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiErrorResponseDto,
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
  ApiReadAvailability,
} from "../openapi/api-docs";
import { Permissions } from "../authorization/permission.catalog";
import { ModelCatalogResponseDto } from "./model-catalog.dto";

@Controller("sessions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Sessions")
@ApiAccessToken()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly events: SessionEventsService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiOperation({
    summary: "List sessions for your assigned tasks",
    description:
      "Current OPEN/workspace/sessions.read and assigned-manager scope only; no read-all/admin bypass. Explicit statuses and optional task/project filters, bounded keyset paging by createdAt/id descending. projectId requires current project membership and the task's explicit board association, independent of saved execution context. Only project-filtered items include current task id/title/projectId; global and task-only summaries keep their minimal shape. No project label, process liveness or complete active count is implied. Each page reevaluates status/assignment/membership; titles are current per page and asOf is a creation cutoff, not a retained snapshot.",
  })
  @ApiOkResponse({ type: SessionListResponseDto })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description: "SESSION_LIST_UNAVAILABLE; retry an authorized fresh read.",
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SessionListQueryDto,
  ) {
    return this.sessions.list(user, query);
  }
  @Post("directory-preflight")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary:
      "Validate an authorized session directory without creating a session",
    description:
      "Assigned task manager only. Does not provision paths or list roots. Validation is an observation and is repeated at launch; external filesystem races remain possible.",
  })
  @ApiOkResponse({ type: DirectoryPreflightResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  preflight(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DirectoryPreflightDto,
  ) {
    return this.sessions.preflight(user.id, dto);
  }

  @Get("projects/:projectId/execution-context")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary: "Resolve an authorized selected project for session setup",
    description:
      "Current project member or projects.manage-all only. Returns minimal project/directory readiness; canStartSession also requires an assigned task. No directory listing or model/sandbox capability expansion.",
  })
  @ApiOkResponse({ type: ProjectExecutionResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  executionContext(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: ProjectExecutionQueryDto,
  ) {
    return this.sessions.projectExecutionContext(
      user.id,
      projectId,
      query.taskId,
      query.sandbox,
    );
  }
  @Get("model-catalog")
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary: "List managed session models and thinking efforts",
    description:
      "Returns the current managed catalog. Clients must only offer each model's supportedReasoningEfforts and use defaultReasoningEffort when no effort is chosen.",
  })
  @ApiOkResponse({
    description: "Catalog used to validate new sessions.",
    type: ModelCatalogResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  modelCatalog(@Query() query: ModelCatalogQueryDto) {
    return this.sessions.listModelCatalog(query.providerId);
  }
  @Post()
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary: "Start a managed coding session",
    description:
      "Requires sessions.create. Creates the session immediately and starts its first turn asynchronously. Watch the SSE endpoint for runner events and completion.",
  })
  @ApiCreatedResponse({
    description: "Session created and queued for its first turn.",
    type: CreatedSessionResponseDto,
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
  @Post("creations")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary: "Accept one durable initial run intent",
    description:
      "Persist requestId before sending. Same creator/intent and matching normalized payload returns the original minimal receipt without another session/turn/dispatch. Changed input conflicts. An intentional rerun uses a new UUID immediately, even for identical input; no per-task30-day lock. Requires configured protected-input keys. Accepted QUEUED work is durable and recovered by polling. Unknown external execution is reconciled, never blindly replayed. Legacy POST /sessions remains separately non-idempotent.",
  })
  @ApiCreatedResponse({ type: SessionCreationReceiptDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: "Creation intent already has different input.",
  })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "Acceptance/input dependency unavailable or outcome unknown; retry original requestId/input, never silently choose a new intent.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  submitCreation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: KeyedCreateSessionDto,
    @Query() _query: SessionCreationQueryDto,
  ) {
    return this.sessions.submitCreation(user, dto);
  }
  @Get("creations/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_CREATE)
  @ApiOperation({
    summary: "Read your retained initial-run acceptance",
    description:
      "Current original creator/workspace/assigned-manager/create scope. Receipt is frozen; current run state uses existing session reads.404 means not visible now, not proof an in-flight create cannot commit. Retry the same POST/input/intent to settle uncertainty. Mapping lives with the retained run; there is no age-based purge or lifetime guarantee after authorized hard deletion.",
  })
  @ApiOkResponse({ type: SessionCreationReceiptDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  creationOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: SessionCreationQueryDto,
  ) {
    return this.sessions.creationOutcome(user, requestId);
  }
  @Get(":id/archive")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiReadAvailability()
  @ApiOperation({
    summary:
      "Read long-lived authorized session record and retained event detail",
    description:
      "Current assigned manager/workspace/sessions.read on every page; no administrator/read-all bypass. Existing sequence high-water pagination, current secret redaction, no hidden model reasoning. Retained detail can exceed the bounded live projection; legacy/unavailable and strict tool-text omissions are explicit. No automatic30-day content cleanup, research export or training. Authorized deletion cascades to the run's database history.",
  })
  @ApiOkResponse({ type: SessionArchiveResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() query: SessionArchiveQueryDto,
  ) {
    return this.sessions.history(
      user.id,
      id,
      query.after,
      query.limit ?? 1,
      query.untilSequence,
      true,
    );
  }
  @Get(":id/events/:eventId/details")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Read a redacted retained command, output or file-change page",
    description:
      "Current OPEN assigned manager/workspace/sessions.read on every request. Version1 allowlists runner command/aggregated_output/exit_code, file-change path/kind and adapter final workspace diff. Redacts whole fields before paging; no hidden reasoning, MCP/collaboration/web/stderr passthrough or raw-file fallback. One Mi UTF16 units per text field maximum; oversized fields are unavailable, commands over8192 and paths over4096 units are omitted. Page limit1–16384 text units or at most100 changes. Supply returned projectionHash as revision after offset zero;409 means restart because projection/redaction changed. No expiry is introduced. Treat text as untrusted plain text; final diff is workspace evidence, not verified per-tool attribution.",
  })
  @ApiOkResponse({ type: SessionDetailPageDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  @ApiConflictResponse({
    description: "Projection revision changed or missing for continuation",
  })
  eventDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("eventId", new ParseUUIDPipe({ version: "4" })) eventId: string,
    @Query() query: SessionDetailQueryDto,
  ) {
    return this.sessions.eventDetail(
      user.id,
      id,
      eventId,
      query.offset,
      query.limit,
      query.revision,
    );
  }
  @Get(":id/turns")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiOperation({
    summary: "Page retained session inputs and reported usage",
    description:
      "Current assigned-manager/workspace/read scope;50-row startedAt/id keyset with a fixed acceptance-time boundary. Prompts are redacted history, never decrypted execution payloads. Usage provenance is nullable for legacy/unreported data; costs are not estimated or invented. Cursor possession grants no access.",
  })
  @ApiOkResponse({ type: SessionTurnsResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  turns(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() query: SessionTurnsQueryDto,
  ) {
    return this.sessions.retainedTurns(user, id, query.cursor);
  }
  @Get(":id")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiReadAvailability()
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
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_MANAGE)
  @ApiOperation({
    summary: "Start a follow-up turn",
    description:
      "Requires sessions.manage. One active turn per session. The turn is persisted before asynchronous launch. New REST follow-ups opt into durable dispatch: if the callback is lost, expired ownership can be recovered only while the turn remains QUEUED and never started. Current authority/directory are rechecked. Started/ambiguous executions are never automatically replayed; legacy pending rows keep their prior recovery policy. Reuse the same requestId and prompt to reconcile uncertainty without creating another turn.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Session ID." })
  @ApiAcceptedResponse({
    type: TurnAcceptanceResponseDto,
    description:
      "Durable acceptance and current persisted run state; acceptance does not mean run success.",
  })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: "An active turn or a request ID bound to another submission.",
  })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "Unknown submission outcome; reconcile or retry the same request ID.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  turn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: RequestFollowUpDto,
  ) {
    return this.sessions.acceptFollowUp(user.id, id, dto.prompt, dto.requestId);
  }
  @Get(":id/turns/by-request/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_MANAGE)
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Reconcile a known follow-up submission",
    description:
      "Assigned manager only. Readable with sessions.manage; does not require sessions.read. Returns the same accepted turn's current state. Newly accepted never-started REST turns may recover after lease expiry; an already-started or ambiguous execution is never automatically replayed. An unavailable read does not justify generating a replacement request ID.",
  })
  @ApiOkResponse({ type: TurnAcceptanceResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  byRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
  ) {
    return this.sessions.turnByRequest(user.id, id, requestId);
  }

  @Post(":id/interrupt")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_MANAGE)
  @ApiOperation({
    summary: "Interrupt the active local runner",
    description:
      "Requires sessions.manage. Persists an interruption request; repeated requests return its outcome. Signal acceptance is not stop confirmation.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Session ID." })
  @ApiOkResponse({
    description: "Interruption signal sent to the local runner.",
    type: InterruptSessionResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  interrupt(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: RequestInterruptDto,
  ) {
    return this.sessions.interrupt(user.id, id, dto.turnId);
  }
  @Get(":id/events")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Read bounded persisted session history",
    description:
      "Assigned manager only. Snapshot and high-water sequence share one transaction; advance using nextCursor. Explicit omission markers preserve ordering. No actor field represents the viewer as event author.",
  })
  @ApiOkResponse({ type: SessionHistoryResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() query: SessionHistoryQueryDto,
  ) {
    return this.sessions.history(
      user.id,
      id,
      query.after,
      query.limit,
      query.untilSequence,
    );
  }
  @Sse(":id/events/stream")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.SESSIONS_READ)
  @ApiOperation({
    summary: "Replay and stream committed session events",
    description:
      "Persisted polling with no history-to-live gap. Use after or Last-Event-ID (identical if both supplied). Reconnect after the last delivered sequence and deduplicate by sequence. Current account/grants/assignment are checked each batch. Stream ends at access-token expiry or authorization loss; transport errors require REST reconciliation.",
  })
  @ApiExtraModels(SessionEventDto)
  @ApiResponse({
    status: 200,
    content: {
      "text/event-stream": {
        schema: { $ref: getSchemaPath(SessionEventDto) },
      },
    },
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() query: SessionHistoryQueryDto,
    @Headers("last-event-id") lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    if (query.untilSequence !== undefined)
      throw new BadRequestException(
        "Fixed boundary is supported only on history reads",
      );
    let after = query.after;
    if (lastEventId !== undefined) {
      if (
        !/^(0|[1-9][0-9]{0,9})$/.test(lastEventId) ||
        Number(lastEventId) > 2147483647
      )
        throw new BadRequestException("Invalid Last-Event-ID");
      if (after !== undefined && after !== Number(lastEventId))
        throw new BadRequestException("Conflicting event cursors");
      after = Number(lastEventId);
    }
    await this.sessions.history(user.id, id, after ?? 0, 1);
    return this.sessions.stream(
      user.id,
      id,
      after ?? 0,
      user.accessExpiresAt ?? Date.now(),
    );
  }
}
