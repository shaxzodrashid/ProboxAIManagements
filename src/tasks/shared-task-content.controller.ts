import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/auth.guards";
import { CurrentUser } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { SharedTaskContentService } from "./shared-task-content.service";
import {
  SharedTaskContentDto,
  SharedTaskContentQueryDto,
  SharedTaskHistoryDto,
  SharedTaskListDto,
  SharedTaskListQueryDto,
} from "./shared-task-content.dto";
import {
  HumanCommentsResponseDto,
  HumanTaskHistoryQueryDto,
} from "./human-tasks.dto";
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard)
@ApiTags("Shared human task content")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiReadAvailability()
@ApiResourceErrors()
@ApiValidationErrors()
export class SharedTaskContentController {
  constructor(private readonly tasks: SharedTaskContentService) {}
  @Get("shared-tasks")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "List explicitly shared tasks visible to this project's current members",
    description:
      "Current OPEN same-workspace membership; no global task-read grant required. Task-ID keyset pages recheck sharing. Destination workflow and project context only. Original human-task query/counts remain separate. Archived projects stay readable; no edit authority, execution data or other-project associations.",
  })
  @ApiOkResponse({ type: SharedTaskListDto })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: SharedTaskListQueryDto,
  ) {
    return this.tasks.list(actor, projectId, query);
  }
  @Get("tasks/:taskId/shared-content")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Read shared task fields and checklist in this destination context",
    description:
      "Requires current membership and an explicit current shared association. No source project/workflow metadata, sharing destinations, runner criteria, sessions or private profiles. Changes no edit permissions.",
  })
  @ApiOkResponse({ type: SharedTaskContentDto })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() _query: SharedTaskContentQueryDto,
  ) {
    return this.tasks.get(actor, projectId, taskId);
  }
  @Get("tasks/:taskId/shared-comments")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read canonical task comments while this task remains shared",
    description:
      "Current member/shared-task scope on every page. Includes existing canonical comments from before sharing. Read-only: posting/edit permissions remain unchanged. No per-side comment policy is implemented.",
  })
  @ApiOkResponse({ type: HumanCommentsResponseDto })
  comments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() query: HumanTaskHistoryQueryDto,
  ) {
    return this.tasks.history(actor, projectId, taskId, query, true);
  }
  @Get("tasks/:taskId/shared-history")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read canonical human-task audit history while shared",
    description:
      "Current member/shared-task scope on every page. Includes existing human-task history; frozen task snapshots omit source project/workflow metadata. No project-wide/other-task audit, execution history or private sharing-operation receipts. No per-side history policy is implemented.",
  })
  @ApiOkResponse({ type: SharedTaskHistoryDto })
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() query: HumanTaskHistoryQueryDto,
  ) {
    return this.tasks.history(actor, projectId, taskId, query);
  }
}
