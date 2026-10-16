import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
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
import { TaskDeadlinesService } from "./task-deadlines.service";
import {
  DeadlineAuditQueryDto,
  DeadlineAuditResponseDto,
  DeadlineMutationResponseDto,
  PutDeadlineDto,
  TaskDeadlineResponseDto,
} from "./task-deadlines.dto";
@Controller("tasks/:taskId/deadline")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Task deadlines")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class TaskDeadlinesController {
  constructor(private readonly deadlines: TaskDeadlinesService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_READ)
  @ApiOperation({
    summary: "Read a task deadline",
    description:
      "Existing task read scope: assigned manager or current tasks.read-all within workspace. Null means unset/cleared. Calendar-only dates are not UTC instants; timed values retain the pinned instant, local clock, zone and explicit offset.",
  })
  @ApiOkResponse({ type: TaskDeadlineResponseDto })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
  ) {
    return this.deadlines.read(actor, taskId);
  }
  @Get("edit")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_DEADLINES_MANAGE)
  @ApiOperation({
    summary: "Read an authorized task deadline edit snapshot",
    description:
      "Dedicated deadline permission plus current ownership/membership for linked human tasks, or current execution-manager identity for unlinked tasks. Read-all is not edit authority; manage-only users may read this narrow snapshot.",
  })
  @ApiOkResponse({ type: TaskDeadlineResponseDto })
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
  ) {
    return this.deadlines.read(actor, taskId, true);
  }
  @Put()
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_DEADLINES_MANAGE)
  @ApiRevision("task deadline")
  @ApiOperation({
    summary: "Set or clear a task deadline atomically",
    description:
      "Stable requestId and original If-Match required. Date-only remains a calendar date. Timed deadlines require local HH:mm, IANA timeZone and matching explicit utcOffset; nonexistent local times and mismatched offsets reject, repeated hours are explicitly selected by offset. Null clears. No notification/schedule, runner status or task assignment is changed.",
  })
  @ApiOkResponse({ type: DeadlineMutationResponseDto })
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: PutDeadlineDto,
  ) {
    return this.deadlines.put(actor, taskId, revision, dto);
  }
  @Get("operations/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_DEADLINES_MANAGE)
  @ApiOperation({ summary: "Reconcile a deadline change without replay" })
  @ApiOkResponse({ type: DeadlineMutationResponseDto })
  operation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
  ) {
    return this.deadlines.operation(actor, taskId, requestId);
  }
  @Get("audit")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASK_DEADLINES_MANAGE)
  @ApiOperation({
    summary: "Read bounded deadline history in current deadline edit scope",
  })
  @ApiOkResponse({ type: DeadlineAuditResponseDto })
  audit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Query() query: DeadlineAuditQueryDto,
  ) {
    return this.deadlines.audit(actor, taskId, query);
  }
}
