import { Injectable } from "@nestjs/common";
import { Prisma, TaskBoardAudit } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  validWorkflowStatusName,
  workflowStatusSnapshot,
} from "./task-workflow-status";
import {
  humanTaskSelection,
  humanTaskSnapshot,
  advanceHumanTask,
  humanJson,
} from "./human-task-state";
import {
  operationError,
  databaseOperationError,
} from "../openapi/operation-errors";
import {
  BoardAuditQueryDto,
  CreateBoardStatusDto,
  UpdateBoardStatusDto,
  ReorderBoardStatusesDto,
  RemoveBoardStatusDto,
} from "./task-boards.dto";

const boardSelection = {
  id: true,
  projectId: true,
  revision: true,
  statuses: {
    select: { id: true, name: true, color: true, position: true },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.TaskBoardSelect;
type Board = Prisma.TaskBoardGetPayload<{ select: typeof boardSelection }>;
function snapshot(board: Board) {
  if (
    board.statuses.length < 1 ||
    board.statuses.length > 100 ||
    board.statuses.some((status, index) => status.position !== index)
  )
    throw operationError(
      503,
      "TASK_BOARD_UNAVAILABLE",
      "Workflow metadata is unavailable",
      "readTaskBoard",
    );
  return {
    ...board,
    statuses: board.statuses.map(workflowStatusSnapshot),
  };
}
function outcome(row: TaskBoardAudit) {
  return {
    requestId: row.requestId,
    revision: row.revision,
    action: row.action,
    actorId: row.actorId,
    affectedTasks: row.affectedTasks,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  };
}
@Injectable()
export class TaskBoardsService {
  constructor(private readonly prisma: PrismaService) {}
  private async scoped(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    manage: boolean,
  ) {
    projectId = projectId.toLowerCase();
    const user = await authenticationDependency(() =>
      tx.user.findFirst({
        where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
        select: {
          roleAssignments: {
            select: {
              role: {
                select: { permissions: { select: { permissionKey: true } } },
              },
            },
          },
        },
      }),
    );
    const permissions =
      user?.roleAssignments.flatMap(({ role }) =>
        role.permissions.map(({ permissionKey }) => permissionKey),
      ) ?? [];
    if (
      !user ||
      !permissions.includes(
        manage
          ? Permissions.TASK_STATUSES_MANAGE
          : Permissions.TASK_BOARDS_READ,
      ) ||
      (!manage && !permissions.includes(Permissions.PROJECTS_READ))
    )
      throw operationError(
        403,
        "TASK_BOARD_ACCESS_CHANGED",
        "Workflow access is no longer available",
        "checkTaskBoardAccess",
      );
    const project = await tx.project.findFirst({
      where: { id: projectId, workspaceId: actor.workspaceId },
      select: {
        id: true,
        status: true,
        archivedAt: true,
        readAccessEnabled: true,
        members: { where: { userId: actor.id }, select: { userId: true } },
      },
    });
    if (!project)
      throw operationError(
        404,
        "TASK_BOARD_NOT_FOUND",
        "Task board not found",
        "readTaskBoard",
      );
    const member = project.members.length > 0;
    const allowed = manage
      ? member || permissions.includes(Permissions.PROJECTS_MANAGE_ALL)
      : member ||
        project.readAccessEnabled ||
        permissions.includes(Permissions.PROJECTS_READ_ALL);
    if (!allowed)
      throw operationError(
        403,
        "TASK_BOARD_ACCESS_DENIED",
        "Project scope does not permit this workflow action",
        "checkTaskBoardAccess",
      );
    const board = await tx.taskBoard.findUnique({
      where: { projectId },
      select: boardSelection,
    });
    if (!board)
      throw operationError(
        503,
        "TASK_BOARD_UNAVAILABLE",
        "Workflow metadata is unavailable",
        "readTaskBoard",
      );
    return { board, project };
  }
  read(actor: AuthenticatedUser, projectId: string, manage = false) {
    return this.prisma.$transaction(
      async (tx) =>
        snapshot((await this.scoped(tx, actor, projectId, manage)).board),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  operation(actor: AuthenticatedUser, projectId: string, requestId: string) {
    requestId = requestId.toLowerCase();
    return this.prisma.$transaction(
      async (tx) => {
        const { board } = await this.scoped(tx, actor, projectId, true);
        const row = await tx.taskBoardAudit.findUnique({
          where: { boardId_requestId: { boardId: board.id, requestId } },
        });
        if (!row)
          throw operationError(
            404,
            "TASK_BOARD_OPERATION_NOT_FOUND",
            "Workflow operation not found",
            "readTaskBoardOperation",
          );
        return outcome(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  audit(
    actor: AuthenticatedUser,
    projectId: string,
    query: BoardAuditQueryDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const { board } = await this.scoped(tx, actor, projectId, true);
        const limit = query.limit ?? 50;
        const rows = await tx.taskBoardAudit.findMany({
          where: {
            boardId: board.id,
            revision: { gt: query.afterRevision ?? 0 },
          },
          orderBy: { revision: "asc" },
          take: limit + 1,
        });
        const hasMore = rows.length > limit,
          items = rows.slice(0, limit).map(outcome);
        return {
          items,
          hasMore,
          nextAfterRevision: hasMore ? items.at(-1)!.revision : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private mutation<Input extends { requestId: string }>(
    actor: AuthenticatedUser,
    projectId: string,
    revision: number,
    action: string,
    input: Input,
    apply: (tx: Prisma.TransactionClient, board: Board) => Promise<number>,
  ) {
    const requestId = input.requestId.toLowerCase();
    const normalizedInput = { ...input, requestId };
    const canonicalInput = JSON.parse(
      JSON.stringify(normalizedInput, Object.keys(normalizedInput).sort()),
    );
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          actorId: actor.id,
          action,
          revision,
          input: canonicalInput,
        }),
      )
      .digest("hex");
    return this.prisma
      .$transaction(
        async (tx) => {
          await lockWorkspace(tx, actor.workspaceId);
          const { board, project } = await this.scoped(
            tx,
            actor,
            projectId,
            true,
          );
          const existing = await tx.taskBoardAudit.findUnique({
            where: {
              boardId_requestId: {
                boardId: board.id,
                requestId,
              },
            },
          });
          if (existing) {
            if (existing.inputHash !== inputHash)
              throw operationError(
                409,
                "TASK_BOARD_REQUEST_CONFLICT",
                "Request identity was used for a different workflow mutation",
                "updateTaskBoard",
              );
            return outcome(existing);
          }
          if (project.archivedAt || project.status === "DELETING")
            throw operationError(
              409,
              "TASK_BOARD_PROJECT_DELETING",
              "Project archival or deletion blocks workflow mutations",
              "updateTaskBoard",
            );
          if (board.revision !== revision)
            throw operationError(
              409,
              "STALE_REVISION",
              "Workflow changed; reread and resolve before retrying",
              "updateTaskBoard",
            );
          if (revision >= 2147483647)
            throw operationError(
              409,
              "REVISION_EXHAUSTED",
              "Workflow revision cannot advance",
              "updateTaskBoard",
            );
          const before = snapshot(board);
          const affectedTasks = await apply(tx, board);
          await tx.taskBoard.update({
            where: { id: board.id },
            data: { revision: { increment: 1 } },
          });
          const after = snapshot(
            await tx.taskBoard.findUniqueOrThrow({
              where: { id: board.id },
              select: boardSelection,
            }),
          );
          return outcome(
            await tx.taskBoardAudit.create({
              data: {
                boardId: board.id,
                revision: revision + 1,
                requestId,
                inputHash,
                actorId: actor.id,
                action,
                before: before as Prisma.InputJsonValue,
                after: after as Prisma.InputJsonValue,
                affectedTasks,
              },
            }),
          );
        },
        { timeout: 30000 },
      )
      .catch((error) => databaseOperationError(error, "updateTaskBoard"));
  }
  create(
    actor: AuthenticatedUser,
    projectId: string,
    revision: number,
    dto: CreateBoardStatusDto,
  ) {
    dto = { ...dto, name: dto.name.trim() };
    return this.mutation(
      actor,
      projectId,
      revision,
      "CREATE_STATUS",
      dto,
      async (tx, board) => {
        if (!validWorkflowStatusName(dto.name))
          throw operationError(
            400,
            "STATUS_NAME_INVALID",
            "Status name must be nonblank and at most 120 Unicode characters",
            "createStatus",
            "name",
          );
        if (board.statuses.length >= 100)
          throw operationError(
            409,
            "STATUS_LIMIT",
            "A board supports at most 100 statuses",
            "createStatus",
          );
        await tx.taskBoardStatus.create({
          data: {
            boardId: board.id,
            name: dto.name,
            color: dto.color,
            position: board.statuses.length,
          },
        });
        return 0;
      },
    );
  }
  update(
    actor: AuthenticatedUser,
    projectId: string,
    statusId: string,
    revision: number,
    dto: UpdateBoardStatusDto,
  ) {
    statusId = statusId.toLowerCase();
    dto = {
      ...dto,
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
    };
    return this.mutation(
      actor,
      projectId,
      revision,
      "UPDATE_STATUS",
      { ...dto, statusId },
      async (tx, board) => {
        if (!board.statuses.some((s) => s.id === statusId))
          throw operationError(
            404,
            "STATUS_NOT_FOUND",
            "Status not found",
            "updateStatus",
          );
        if (dto.name === undefined && dto.color === undefined)
          throw operationError(
            400,
            "STATUS_EDIT_EMPTY",
            "Supply name or color",
            "updateStatus",
          );
        if (dto.name !== undefined && !validWorkflowStatusName(dto.name))
          throw operationError(
            400,
            "STATUS_NAME_INVALID",
            "Status name must be nonblank and at most 120 Unicode characters",
            "updateStatus",
            "name",
          );
        await tx.taskBoardStatus.update({
          where: { id: statusId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.color !== undefined ? { color: dto.color } : {}),
          },
        });
        return 0;
      },
    );
  }
  reorder(
    actor: AuthenticatedUser,
    projectId: string,
    revision: number,
    dto: ReorderBoardStatusesDto,
  ) {
    dto = { ...dto, statusIds: dto.statusIds.map((id) => id.toLowerCase()) };
    return this.mutation(
      actor,
      projectId,
      revision,
      "REORDER_STATUSES",
      dto,
      async (tx, board) => {
        if (
          dto.statusIds.length !== board.statuses.length ||
          new Set(dto.statusIds).size !== board.statuses.length ||
          dto.statusIds.some((id) => !board.statuses.some((s) => s.id === id))
        )
          throw operationError(
            400,
            "STATUS_ORDER_INVALID",
            "Supply every current status exactly once",
            "reorderStatuses",
            "statusIds",
          );
        await tx.taskBoardStatus.updateMany({
          where: { boardId: board.id },
          data: { position: { increment: board.statuses.length } },
        });
        for (const [position, id] of dto.statusIds.entries())
          await tx.taskBoardStatus.update({
            where: { id },
            data: { position },
          });
        return 0;
      },
    );
  }
  remove(
    actor: AuthenticatedUser,
    projectId: string,
    statusId: string,
    revision: number,
    dto: RemoveBoardStatusDto,
  ) {
    statusId = statusId.toLowerCase();
    dto = {
      ...dto,
      ...(dto.replacementStatusId
        ? { replacementStatusId: dto.replacementStatusId.toLowerCase() }
        : {}),
    };
    return this.mutation(
      actor,
      projectId,
      revision,
      "REMOVE_STATUS",
      { ...dto, statusId },
      async (tx, board) => {
        const status = board.statuses.find((s) => s.id === statusId);
        if (!status)
          throw operationError(
            404,
            "STATUS_NOT_FOUND",
            "Status not found",
            "removeStatus",
          );
        if (board.statuses.length <= 1)
          throw operationError(
            409,
            "STATUS_LAST_REQUIRED",
            "A board must retain a status",
            "removeStatus",
          );
        if (dto.replacementStatusId === statusId)
          throw operationError(
            400,
            "STATUS_REPLACEMENT_INVALID",
            "Replacement must be another status",
            "removeStatus",
            "replacementStatusId",
          );
        if (
          dto.replacementStatusId &&
          !board.statuses.some((s) => s.id === dto.replacementStatusId)
        )
          throw operationError(
            404,
            "STATUS_NOT_FOUND",
            "Status not found",
            "removeStatus",
          );
        const count = await tx.taskBoardEntry.count({
          where: { boardId: board.id, statusId },
        });
        if (count && !dto.replacementStatusId)
          throw operationError(
            409,
            "STATUS_IN_USE",
            "Choose a replacement before removing a used status",
            "removeStatus",
            "replacementStatusId",
          );
        if (
          await tx.taskBoardEntry.count({
            where: {
              boardId: board.id,
              statusId,
              task: { workspaceId: { not: actor.workspaceId } },
            },
          })
        )
          throw operationError(
            409,
            "TASK_BOARD_SCOPE_INVALID",
            "Workflow associations require reconciliation",
            "removeStatus",
          );
        if (count) {
          const mover = await tx.user.findFirst({
            where: {
              id: actor.id,
              workspaceId: actor.workspaceId,
              status: "OPEN",
              projectMemberships: { some: { projectId: board.projectId } },
              roleAssignments: {
                some: {
                  role: {
                    permissions: {
                      some: { permissionKey: Permissions.TASK_WORKFLOW_MOVE },
                    },
                  },
                },
              },
            },
            select: { id: true },
          });
          const tasks = await tx.task.findMany({
            where: { boardEntry: { boardId: board.id, statusId } },
            select: humanTaskSelection,
          });
          if (
            !mover ||
            tasks.some(
              (task) =>
                !task.assignees.some(
                  (assignment) => assignment.userId === actor.id,
                ),
            )
          )
            throw operationError(
              403,
              "TASK_BOARD_MOVE_ASSIGNMENT_REQUIRED",
              "Moving tasks during status removal requires move permission and assignment to every affected task",
              "removeStatus",
            );
          for (const task of tasks) {
            if ((task.humanState?.revision ?? 0) >= 2147483647)
              throw operationError(
                409,
                "REVISION_EXHAUSTED",
                "Human task revision cannot advance",
                "removeStatus",
              );
            const before = humanTaskSnapshot(task);
            await tx.taskBoardEntry.update({
              where: { taskId: task.id },
              data: { statusId: dto.replacementStatusId! },
            });
            const state = await advanceHumanTask(tx, task.id);
            const after = humanTaskSnapshot(
              await tx.task.findUniqueOrThrow({
                where: { id: task.id },
                select: humanTaskSelection,
              }),
            );
            await tx.taskHumanAudit.create({
              data: {
                taskId: task.id,
                requestId: dto.requestId.toLowerCase(),
                actorId: actor.id,
                action: "STATUS_REMOVED_MOVE",
                revision: state.revision,
                inputHash: createHash("sha256")
                  .update(
                    JSON.stringify({
                      action: "STATUS_REMOVED_MOVE",
                      actorId: actor.id,
                      statusId,
                      replacementStatusId: dto.replacementStatusId,
                      revision: before.revision,
                    }),
                  )
                  .digest("hex"),
                before: humanJson(before),
                after: humanJson(after),
              },
            });
          }
        }
        await tx.taskBoardStatus.delete({ where: { id: statusId } });
        for (const entry of board.statuses.filter(
          (s) => s.position > status.position,
        ))
          await tx.taskBoardStatus.update({
            where: { id: entry.id },
            data: { position: entry.position - 1 },
          });
        return count;
      },
    );
  }
}
