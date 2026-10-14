import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { TaskBoardsService } from "./task-boards.service";
import {
  BoardAuditQueryDto,
  BoardAuditResponseDto,
  BoardMutationResponseDto,
  CreateBoardStatusDto,
  RemoveBoardStatusDto,
  ReorderBoardStatusesDto,
  TaskBoardResponseDto,
  UpdateBoardStatusDto,
} from "./task-boards.dto";

@Controller("projects/:projectId/task-board")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Task boards")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class TaskBoardsController {
  constructor(private readonly boards: TaskBoardsService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_BOARDS_READ, Permissions.PROJECTS_READ)
  @ApiOperation({
    summary: "Read workflow metadata for a readable project",
    description:
      "Dedicated board permission plus existing project read scope. No task roster, execution status or session data. Each project has one board; columns are independent human workflow.",
  })
  @ApiOkResponse({ type: TaskBoardResponseDto })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
  ) {
    return this.boards.read(actor, projectId);
  }
  @Get("edit")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiOperation({
    summary: "Read the status-management snapshot",
    description:
      "Requires current dedicated status permission plus actual project membership or projects.manage-all. Existing project editing/read-all is not a substitute. Provides revision for If-Match without granting task reads.",
  })
  @ApiOkResponse({ type: TaskBoardResponseDto })
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
  ) {
    return this.boards.read(actor, projectId, true);
  }
  @Post("statuses")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiRevision("task board")
  @ApiOperation({
    summary: "Create a workflow status",
    description:
      "Stable request identity and board revision; appended after existing statuses, maximum100. No role or project-edit grant is inferred.",
  })
  @ApiCreatedResponse({ type: BoardMutationResponseDto })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: CreateBoardStatusDto,
  ) {
    return this.boards.create(actor, projectId, revision, dto);
  }
  @Patch("statuses/:statusId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiRevision("task board")
  @ApiOperation({ summary: "Rename or recolor a stable workflow status" })
  @ApiOkResponse({ type: BoardMutationResponseDto })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("statusId", new ParseUUIDPipe({ version: "4" })) statusId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: UpdateBoardStatusDto,
  ) {
    return this.boards.update(actor, projectId, statusId, revision, dto);
  }
  @Put("statuses/order")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiRevision("task board")
  @ApiOperation({
    summary: "Replace the complete ordered status list",
    description:
      "Every current status exactly once; order does not change identity or completion meaning.",
  })
  @ApiOkResponse({ type: BoardMutationResponseDto })
  reorder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: ReorderBoardStatusesDto,
  ) {
    return this.boards.reorder(actor, projectId, revision, dto);
  }
  @Delete("statuses/:statusId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiRevision("task board")
  @ApiOperation({
    summary: "Move referenced tasks atomically and remove a status",
    description:
      "Occupied status requires an explicit same-board replacement. Tasks move and removal/order/revision/audit commit together. The last status cannot be removed. Never changes runner execution status.",
  })
  @ApiOkResponse({ type: BoardMutationResponseDto })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("statusId", new ParseUUIDPipe({ version: "4" })) statusId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: RemoveBoardStatusDto,
  ) {
    return this.boards.remove(actor, projectId, statusId, revision, dto);
  }
  @Get("operations/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiOperation({
    summary: "Reconcile a workflow mutation by stable request identity",
    description:
      "Saved outcomes never reapply operations and always recheck current management scope.",
  })
  @ApiOkResponse({ type: BoardMutationResponseDto })
  operation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
  ) {
    return this.boards.operation(actor, projectId, requestId);
  }
  @Get("audit")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_STATUSES_MANAGE)
  @ApiOperation({
    summary: "Read bounded workflow configuration history",
    description:
      "Exclusive revision cursor; scoped to this board, no task IDs, paths or request hashes.",
  })
  @ApiOkResponse({ type: BoardAuditResponseDto })
  audit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: BoardAuditQueryDto,
  ) {
    return this.boards.audit(actor, projectId, query);
  }
}
