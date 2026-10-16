import {
  Controller,
  Body,
  Header,
  Headers,
  BadRequestException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiConflictResponse,
  ApiServiceUnavailableResponse,
  ApiResponse,
} from "@nestjs/swagger";
import { Observable } from "rxjs";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { Permissions } from "../authorization/permission.catalog";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ProjectInitializationService } from "./project-initialization.service";
import {
  InitializationEventsQueryDto,
  InitializationPersistedEventDto,
  InitializationStreamEventDto,
} from "./initialization-events.dto";
import {
  RecoverProjectEnqueueDto,
  ProjectEnqueueRecoveryStateDto,
  ProjectEnqueueRecoveryResponseDto,
} from "./project-enqueue-recovery.dto";

@Controller("projects/:projectId/initializations")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permissions.PROJECT_INITIALIZATIONS_READ)
@ApiTags("Project Initializations")
@ApiAccessToken()
export class ProjectInitializationsController {
  constructor(private readonly initializations: ProjectInitializationService) {}

  @Get("recovery")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECT_INITIALIZATIONS_MANAGE)
  @ApiOperation({
    summary: "Read initial-enqueue recovery state",
    description:
      "Current member/authorized administrator management scope. Distinguishes no attempt from an existing failed attempt and returns the pinned template without private logs/paths.",
  })
  @ApiOkResponse({ type: ProjectEnqueueRecoveryStateDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  recovery(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
  ) {
    return this.initializations.enqueueRecoveryState(user, projectId);
  }

  @Post("recover-enqueue")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.PROJECT_INITIALIZATIONS_MANAGE)
  @ApiOperation({
    summary: "Ensure the project's first pinned setup attempt is registered",
    description:
      "Failed/initializing project with no attempts only. Repeating the same project/template returns attempt 1 without retrying or duplicating it. Registration is not execution completion. On unknown outcome, read recovery state and reconcile the same project/template; never recreate the project.",
  })
  @ApiOkResponse({ type: ProjectEnqueueRecoveryResponseDto })
  @ApiConflictResponse({
    description: "Pinned template, lifecycle, readiness or history mismatch.",
  })
  @ApiServiceUnavailableResponse({
    description:
      "PROJECT_ENQUEUE_OUTCOME_UNKNOWN; reconcile the same project/template.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  recoverEnqueue(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Body() dto: RecoverProjectEnqueueDto,
  ) {
    return this.initializations.recoverEnqueue(
      user,
      projectId,
      dto.templateVersionId,
    );
  }

  @Get()
  @ApiOperation({ summary: "List project initialization attempts" })
  @ApiOkResponse({ description: "Newest attempt first, including step logs." })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.initializations.list(user, projectId);
  }

  @Get(":initializationId")
  @ApiOperation({ summary: "Get initialization status and bounded step logs" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("initializationId") initializationId: string,
  ) {
    return this.initializations.get(user, projectId, initializationId);
  }

  @Get(":initializationId/events")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Replay bounded persisted initialization events",
    description:
      "At most 100 events per page, in contiguous sequence order. Advance after using the last returned sequence; a full page may have more. Current account, workspace, grants and project read scope are checked in the same snapshot. Unavailable sequences return 409 INITIALIZATION_HISTORY_UNAVAILABLE.",
  })
  @ApiOkResponse({ type: InitializationPersistedEventDto, isArray: true })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("initializationId", new ParseUUIDPipe({ version: "4" }))
    initializationId: string,
    @Query() query: InitializationEventsQueryDto,
  ) {
    return this.initializations.events(
      user,
      projectId,
      initializationId,
      query.after,
      query.limit,
    );
  }

  @Sse(":initializationId/events/stream")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Replay and stream initialization events",
    description:
      "Persisted polling eliminates the replay-to-live handoff gap. Use after or Last-Event-ID (must agree if both supplied), then deduplicate by initialization/sequence. Each batch rechecks current account, workspace, grants and project scope. Stream ends at token expiry, access loss or transport error; reconcile with REST. No worker launch or cancellation is performed by subscribing.",
  })
  @ApiProduces("text/event-stream")
  @ApiResponse({ status: 200, type: InitializationStreamEventDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("initializationId", new ParseUUIDPipe({ version: "4" }))
    initializationId: string,
    @Query() query: InitializationEventsQueryDto,
    @Headers("last-event-id") lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    if (query.limit !== undefined)
      throw new BadRequestException(
        "Page size is supported only on event history reads",
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
    return this.initializations.stream(
      user,
      projectId,
      initializationId,
      after ?? 0,
    );
  }

  @Post(":initializationId/cancel")
  @RequirePermissions(Permissions.PROJECT_INITIALIZATIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel a queued or running initialization" })
  @ApiOkResponse({ description: "Processes stopped and staging quarantined." })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("initializationId") initializationId: string,
  ) {
    return this.initializations.cancel(user, projectId, initializationId);
  }

  @Post("retry")
  @RequirePermissions(Permissions.PROJECT_INITIALIZATIONS_MANAGE)
  @ApiOperation({
    summary: "Retry the latest failed initialization from clean staging",
  })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.initializations.retry(user, projectId);
  }
}
