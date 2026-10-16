import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { Permissions } from "../authorization/permission.catalog";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import { BoardMutationDto } from "./task-boards.dto";
import { HumanTaskActionsService } from "./human-task-actions.service";
import {
  HumanTaskLinkDto,
  HumanTaskDetailsDto,
  HumanTaskAssigneesDto,
  HumanTaskMoveDto,
  HumanChecklistCreateDto,
  HumanChecklistUpdateDto,
  HumanChecklistCompleteDto,
  HumanChecklistReorderDto,
  HumanCommentCreateDto,
  HumanTaskMutationResponseDto,
  HumanTaskHistoryQueryDto,
  HumanTaskAuditResponseDto,
  HumanCommentsResponseDto,
} from "./human-tasks.dto";

@Controller("projects/:projectId/tasks/:taskId")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Human tasks")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class HumanTaskActionsController {
  constructor(private readonly tasks: HumanTaskActionsService) {}
  @Post("link")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_CREATE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Explicitly link an owned task to one project board",
    description:
      "Current project membership, tasks.create and task creator ownership required. Initial revision0 and explicit same-board status. Owner becomes first human assignee; AI manager/criteria/status/sessions remain unchanged. No project transfer or historical inference.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  link(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanTaskLinkDto,
  ) {
    return this.tasks.mutate(actor, projectId, taskId, revision, "LINK", {
      ...dto,
    });
  }
  @Patch("details")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_DETAILS_MANAGE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Edit an owned task's title, description or human priority",
    description:
      "Fresh owner plus tasks.details.manage and project membership. Assignment/admin/AI manager does not grant definition edits. Allowlisted fields only. Optional human priority URGENT/HIGH/MEDIUM/LOW; omit to retain, null clears; runner status remains independent.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  details(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanTaskDetailsDto,
  ) {
    return this.tasks.mutate(actor, projectId, taskId, revision, "DETAILS", {
      ...dto,
    });
  }
  @Put("assignees")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_ASSIGNEES_MANAGE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Replace an owned task's human assignee set",
    description:
      "At most100 assignees; newly added staff must be OPEN same-project members. Existing inactive relationships may remain only for explicit checklist handoff, never action access. Reassign/remove checklist items before removing their assignee. Execution manager is independent.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  assignees(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanTaskAssigneesDto,
  ) {
    return this.tasks.mutate(actor, projectId, taskId, revision, "ASSIGNEES", {
      ...dto,
    });
  }
  @Put("workflow-status")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_WORKFLOW_MOVE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Move an assigned task between its project workflow columns",
    description:
      "Current task assignment and dedicated move permission; ownership/read-all/admin does not bypass assignment. Never updates runner Task.status.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  move(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanTaskMoveDto,
  ) {
    return this.tasks.mutate(actor, projectId, taskId, revision, "MOVE", {
      ...dto,
    });
  }
  @Post("checklist")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_CHECKLIST_MANAGE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Append a single-assignee checklist item to an owned task",
    description:
      "Optional independent item deadline uses the task calendar/timezone contract. Omission or null starts without one. Owner, current project membership and checklist management permission required.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  createItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanChecklistCreateDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      revision,
      "CHECKLIST_CREATE",
      { ...dto },
    );
  }
  @Patch("checklist/:itemId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_CHECKLIST_MANAGE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Edit an owned task's checklist definition",
    description:
      "One existing task assignee per item. Reassignment preserves existing completion attribution/history; it does not claim a new completion. Optional deadline replaces the whole item value; omission retains it, null clears it. Uses the task calendar/timezone contract without changing task deadline or completion.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  updateItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("itemId", new ParseUUIDPipe({ version: "4" })) itemId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanChecklistUpdateDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      revision,
      "CHECKLIST_UPDATE",
      { ...dto, itemId },
    );
  }
  @Delete("checklist/:itemId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_CHECKLIST_MANAGE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Remove a checklist definition from an owned task",
    description:
      "Human audit retains the removed item and completion history. No task/session deletion occurs.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  removeItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("itemId", new ParseUUIDPipe({ version: "4" })) itemId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: BoardMutationDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      revision,
      "CHECKLIST_DELETE",
      { ...dto, itemId },
    );
  }
  @Put("checklist/:itemId/completion")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_CHECKLIST_COMPLETE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Check or uncheck only the caller's assigned checklist item",
    description:
      "Fresh current item assignee, task assignment, project membership and dedicated completion permission. Task owner/manager/admin and other assignees cannot complete it.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("itemId", new ParseUUIDPipe({ version: "4" })) itemId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanChecklistCompleteDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      revision,
      "CHECKLIST_COMPLETE",
      { ...dto, itemId },
    );
  }
  @Put("checklist/order")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_CHECKLIST_MANAGE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Reorder every checklist item of an owned task",
    description:
      "Current OPEN owner, project membership and checklist management permission. Submit every current item exactly once. Preserves IDs, titles, assignees, deadlines and completion. Shared human revision and durable audit/retry contract; archived or deleting projects reject new writes.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  reorderChecklist(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanChecklistReorderDto,
  ) {
    return this.tasks.mutate(
      actor,
      projectId,
      taskId,
      revision,
      "CHECKLIST_REORDER",
      { ...dto },
    );
  }
  @Post("comments")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_COMMENTS_CREATE)
  @ApiRevision("human task")
  @ApiOperation({
    summary: "Append a plain human comment to an assigned task",
    description:
      "Current task assignment, project membership and dedicated comment permission. No attachments, automatic execution imports, mentions/notifications or external fetching.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  comment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: HumanCommentCreateDto,
  ) {
    return this.tasks.mutate(actor, projectId, taskId, revision, "COMMENT", {
      ...dto,
    });
  }
  @Get("comments")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read bounded comments as a current project member",
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
  @Get("audit")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read bounded human task history as a current project member",
  })
  @ApiOkResponse({ type: HumanTaskAuditResponseDto })
  audit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() query: HumanTaskHistoryQueryDto,
  ) {
    return this.tasks.history(actor, projectId, taskId, query);
  }
  @Get("operations/:requestId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read a saved human action outcome without repeating it",
    description:
      "Current project membership suffices for readback even after assignment changes. Mutation retries still require their fresh action authority.",
  })
  @ApiOkResponse({ type: HumanTaskMutationResponseDto })
  operation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
  ) {
    return this.tasks.operation(actor, projectId, taskId, requestId);
  }
}
