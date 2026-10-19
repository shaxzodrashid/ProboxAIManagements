import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { Permissions } from "../authorization/permission.catalog";
import {
  ApiErrorResponseDto,
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import { BoardMutationDto } from "./task-boards.dto";
import { SharedTasksService } from "./shared-tasks.service";
import {
  ShareTaskDto,
  SharedTaskOperationDto,
  SharedTaskQueryDto,
  TaskSharingEditDto,
  SharedTaskStateDto,
} from "./shared-tasks.dto";

@Controller("projects/:projectId/tasks/:taskId")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Shared human tasks")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiServiceUnavailableResponse({
  type: ApiErrorResponseDto,
  description:
    "Dependency or commit outcome unavailable; preserve request identity and reconcile. Failure does not prove rollback.",
})
export class SharedTasksController {
  constructor(private readonly tasks: SharedTasksService) {}
  @Post("completion/confirm")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_DETAILS_MANAGE)
  @ApiRevision("human task")
  @ApiOkResponse({ type: SharedTaskOperationDto })
  @ApiOperation({
    summary: "Creator confirms canonical human completion",
    description:
      "Current OPEN human Task.creatorId, original project membership and tasks.details.manage required. RequestId and original human If-Match revision. One-way confirmation only; completed/owner selectors are not accepted. Owner-linked-agent-created tasks remain owned by the represented employee creator, with actual-agent creation history retained separately; this endpoint never grants agent execution or approval authority. Assignee column movement, checklist state and runner/session outcome do not confirm or reopen canonical completion. Receipt/state/revision commit atomically. Exact authorized replay retains original attribution/time; another new confirmation conflicts. No task-content/history sharing or mirror propagation policy is selected.",
  })
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: BoardMutationDto,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      null,
      revision,
      "CONFIRM_COMPLETION",
      dto,
    );
  }
  @Get("shared-state")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: SharedTaskStateDto })
  @ApiOperation({
    summary: "Read canonical completion and this board's local column",
    description:
      "Current OPEN same-workspace project membership plus an original or explicit shared association. Returns only task ID, authorized project ID, local status ID, aggregate revision and canonical completed/null. No title, description, other project IDs/counts, comments, audits, assignments or execution data. Archived associations remain readable. Does not grant completion writes.",
  })
  state(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.state(actor, projectId, taskId);
  }
  @Get("sharing")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: TaskSharingEditDto })
  @ApiOperation({
    summary: "Read owned task sharing associations",
    description:
      "Original project membership and task ownership. Includes only currently accessible destination project identities; no hidden share counts, other project metadata, comments, execution data or global task history.",
  })
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.edit(actor, projectId, taskId);
  }
  @Put("shares/:targetProjectId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_CREATE)
  @ApiRevision("human task")
  @ApiOkResponse({ type: SharedTaskOperationDto })
  @ApiOperation({
    summary: "Explicitly associate an owned task with another project board",
    description:
      "tasks.create, original task ownership and current membership in both same-workspace projects. Explicit destination status required. Preserves original link, assignments, execution context and board-local columns. Sharing-association foundation only: destination task-content/history reads require the separately selected disclosure contract. No membership or permission is granted.",
  })
  share(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("targetProjectId", new ParseUUIDPipe({ version: "4" }))
    targetProjectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: ShareTaskDto,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      targetProjectId,
      revision,
      "SHARE",
      dto,
    );
  }
  @Delete("shares/:targetProjectId")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_CREATE)
  @ApiRevision("human task")
  @ApiOkResponse({ type: SharedTaskOperationDto })
  @ApiOperation({
    summary: "Remove an owned task's explicit additional board association",
    description:
      "Fresh original owner, tasks.create and membership in both projects. Removes only the selected share; preserves original task, canonical human state, assignments, other shares and sessions. Archived/deleting contexts reject new changes. Exact authorized retry returns its saved receipt without reapplying.",
  })
  unshare(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("targetProjectId", new ParseUUIDPipe({ version: "4" }))
    targetProjectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: BoardMutationDto,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      targetProjectId,
      revision,
      "UNSHARE",
      dto,
    );
  }
  @Put("shared-workflow-status")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_WORKFLOW_MOVE)
  @ApiRevision("human task")
  @ApiOkResponse({ type: SharedTaskOperationDto })
  @ApiOperation({
    summary: "Move only this shared task's additional-board workflow column",
    description:
      "Current destination membership, task assignment and tasks.workflow.move. Same-board status only. Does not change another board, canonical completion, human task content or runner/session state. Minimal private operation receipt; no original-project history disclosure.",
  })
  move(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: ShareTaskDto,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      null,
      revision,
      "MOVE_LOCAL",
      dto,
    );
  }
  @Get("sharing-operations/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: SharedTaskOperationDto })
  @ApiOperation({
    summary: "Reconcile your authorized sharing operation",
    description:
      "Actor-bound historical acknowledgment only. Rechecks current permission, membership and owner/assignment authority. No automatic replay, private task content or hidden-project metadata. A 404 while an operation is in flight does not prove failure.",
  })
  operation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() _query: SharedTaskQueryDto,
  ) {
    return this.tasks.operation(actor, projectId, taskId, requestId);
  }
}
