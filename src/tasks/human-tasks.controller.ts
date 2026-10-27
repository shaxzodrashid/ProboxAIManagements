import {
  Controller,
  Sse,
  Get,
  Header,
  Param,
  Query,
  ParseUUIDPipe,
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
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
  ApiErrorResponseDto,
} from "../openapi/api-docs";
import { HumanTaskReadResponseDto } from "./human-tasks.dto";
import { HumanTasksService } from "./human-tasks.service";
import {
  HumanTaskQueryDto,
  HumanTaskQueryResponseDto,
} from "./human-task-query.dto";

@Controller("projects/:projectId/tasks")
@UseGuards(JwtAuthGuard)
@ApiTags("Human tasks")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class HumanTasksController {
  constructor(private readonly tasks: HumanTasksService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read deliberately linked human tasks as a current project member",
    description:
      "Membership is sufficient; no tasks.read grant or task assignment is needed. Public project access and execution read-all do not substitute. Archived projects remain readable by current members. Current workflow label/color/palette is included without board management authority. Order: Urgent, High, Medium, Low, unset, then createdAt descending and id descending. Excludes execution criteria/status, sessions, transcripts, credentials and filesystem paths. No historical links are inferred. This compatibility list remains unpaginated.",
  })
  @ApiOkResponse({ type: HumanTaskReadResponseDto, isArray: true })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
  ) {
    return this.tasks.read(actor, projectId);
  }
  @Get("query")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Query bounded human tasks with scoped summaries",
    description:
      "Current OPEN project membership is sufficient. scope=all combines originals and explicit destination shares with local status; omit scope for compatible original-only reads. sort=position uses persisted local card order. Filters, counts and current public assignee identities share one page snapshot; no execution content or private profile lookup. Default50/max100, highest priority/newest creation first. Exact deadline sorting puts timed values first by pinned instant, then date-only by calendar date, unset last. Direction applies within each bucket. Existing deadlineDate calendar comparator and array list remain compatible. Generation changes return409 on continuation; refresh. Public names/lifecycle are current per-page display metadata and do not advance task query generation.",
  })
  @ApiOkResponse({ type: HumanTaskQueryResponseDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description:
      "HUMAN_TASK_QUERY_CHANGED: refresh from the first page; do not merge different generations.",
  })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "Sanitized human task query dependency failure; retry a fresh authorized read.",
  })
  query(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: HumanTaskQueryDto,
  ) {
    return this.tasks.query(actor, projectId, query);
  }
  @Sse("events/stream")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Stream caller-scoped board invalidations",
    description:
      "SSE board.invalidated carries an opaque generation only; initial event always requires REST reconciliation. Polls persisted committed state every second with fresh OPEN membership/session checks; no replay or task/audit payload. Heartbeats while unchanged. Reconnect and refresh REST on close. Does not grant board configuration or execution access.",
  })
  events(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
  ) {
    return this.tasks.events(actor, projectId);
  }
  @Get(":taskId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read one human task within current project membership",
  })
  @ApiOkResponse({ type: HumanTaskReadResponseDto })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
  ) {
    return this.tasks.read(actor, projectId, taskId);
  }
}
