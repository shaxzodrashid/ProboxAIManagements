import { Injectable } from "@nestjs/common";
import { Prisma, TaskDeadlineAudit } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  operationError,
  databaseOperationError,
} from "../openapi/operation-errors";
import { DeadlineAuditQueryDto, PutDeadlineDto } from "./task-deadlines.dto";
import { parseTaskDeadline, storedTaskDeadline } from "./task-deadline-value";
function outcome(row: TaskDeadlineAudit) {
  return {
    requestId: row.requestId,
    actorId: row.actorId,
    revision: row.revision,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  };
}
@Injectable()
// Authorization is separate from interpreting stored timezone metadata, so a
// committed request can be reconciled even after runtime timezone rules change.
export class TaskDeadlinesService {
  constructor(private readonly prisma: PrismaService) {}
  private async scoped(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    taskId: string,
    manage: boolean,
  ) {
    const current = await authenticationDependency(() =>
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
    const keys =
      current?.roleAssignments.flatMap(({ role }) =>
        role.permissions.map(({ permissionKey }) => permissionKey),
      ) ?? [];
    if (
      !current ||
      !keys.includes(
        manage ? Permissions.TASK_DEADLINES_MANAGE : Permissions.TASKS_READ,
      )
    )
      throw operationError(
        403,
        "TASK_DEADLINE_ACCESS_CHANGED",
        "Task deadline access is no longer available",
        "checkTaskDeadlineAccess",
      );
    const task = await tx.task.findFirst({
      where: {
        id: taskId.toLowerCase(),
        workspaceId: actor.workspaceId,
        ...(manage || keys.includes(Permissions.TASKS_READ_ALL)
          ? {}
          : { managerId: actor.id }),
      },
      select: {
        id: true,
        creatorId: true,
        managerId: true,
        humanState: { select: { archivedAt: true, deletedAt: true } },
        boardEntry: {
          select: {
            status: {
              select: {
                board: {
                  select: {
                    project: {
                      select: {
                        workspaceId: true,
                        archivedAt: true,
                        status: true,
                        members: {
                          where: { userId: actor.id },
                          select: { userId: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        deadline: { select: { revision: true, value: true } },
      },
    });
    const project = task?.boardEntry?.status.board.project;
    if (
      !task ||
      (manage &&
        (project
          ? project.workspaceId !== actor.workspaceId ||
            !project.members.length ||
            task.creatorId !== actor.id
          : task.managerId !== actor.id))
    )
      throw operationError(
        404,
        "TASK_DEADLINE_NOT_FOUND",
        "Task deadline not found",
        "readTaskDeadline",
      );
    return {
      taskId: task.id,
      record: task.deadline,
      inactive: !!(task.humanState?.archivedAt || task.humanState?.deletedAt),
      project: task.boardEntry?.status.board.project,
    };
  }
  read(actor: AuthenticatedUser, taskId: string, manage = false) {
    return this.prisma.$transaction(
      async (tx) => {
        const state = await this.scoped(tx, actor, taskId, manage);
        return {
          taskId: state.taskId,
          revision: state.record?.revision ?? 0,
          deadline: storedTaskDeadline(state.record?.value ?? null),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  put(
    actor: AuthenticatedUser,
    taskId: string,
    revision: number,
    dto: PutDeadlineDto,
  ) {
    const requestId = dto.requestId.toLowerCase();
    // Fingerprint stable caller input, not derived instants or mutable zone aliases.
    const input =
      dto.deadline === null
        ? null
        : {
            date: dto.deadline?.date,
            time: dto.deadline?.time ?? null,
            timeZone:
              typeof dto.deadline?.timeZone === "string"
                ? dto.deadline.timeZone.toLowerCase()
                : (dto.deadline?.timeZone ?? null),
            utcOffset: dto.deadline?.utcOffset ?? null,
          };
    const inputHash = createHash("sha256")
      .update(JSON.stringify({ actorId: actor.id, revision, input }))
      .digest("hex");
    return this.prisma
      .$transaction(
        async (tx) => {
          await lockWorkspace(tx, actor.workspaceId);
          const state = await this.scoped(tx, actor, taskId, true);
          const existing = await tx.taskDeadlineAudit.findUnique({
            where: { taskId_requestId: { taskId: state.taskId, requestId } },
          });
          if (existing) {
            if (existing.inputHash !== inputHash)
              throw operationError(
                409,
                "TASK_DEADLINE_REQUEST_CONFLICT",
                "Request identity was used for a different deadline change",
                "setTaskDeadline",
              );
            return outcome(existing);
          }
          if ((state.record?.revision ?? 0) !== revision)
            throw operationError(
              409,
              "STALE_REVISION",
              "Task deadline changed; reread and resolve",
              "setTaskDeadline",
            );
          if (
            state.inactive ||
            state.project?.archivedAt ||
            state.project?.status === "DELETING"
          )
            throw operationError(
              409,
              "TASK_DEADLINE_PROJECT_INACTIVE",
              "Archived or deleting projects cannot accept deadline changes",
              "setTaskDeadline",
            );
          if (revision >= 2147483647)
            throw operationError(
              409,
              "REVISION_EXHAUSTED",
              "Task deadline revision cannot advance",
              "setTaskDeadline",
            );
          const deadline = parseTaskDeadline(dto.deadline);
          const before = {
            taskId: state.taskId,
            revision: state.record?.revision ?? 0,
            deadline: storedTaskDeadline(state.record?.value ?? null),
          };
          const saved = await tx.taskDeadline.upsert({
            where: { taskId: before.taskId },
            create: {
              taskId: before.taskId,
              revision: 1,
              value:
                deadline === null
                  ? Prisma.DbNull
                  : (deadline as unknown as Prisma.InputJsonValue),
            },
            update: {
              revision: { increment: 1 },
              value:
                deadline === null
                  ? Prisma.DbNull
                  : (deadline as unknown as Prisma.InputJsonValue),
            },
          });
          const after = {
            taskId: before.taskId,
            revision: saved.revision,
            deadline: storedTaskDeadline(saved.value),
          };
          return outcome(
            await tx.taskDeadlineAudit.create({
              data: {
                taskId: before.taskId,
                requestId,
                inputHash,
                actorId: actor.id,
                revision: saved.revision,
                before: before as unknown as Prisma.InputJsonValue,
                after: after as unknown as Prisma.InputJsonValue,
              },
            }),
          );
        },
        { timeout: 30000 },
      )
      .catch((error) => databaseOperationError(error, "setTaskDeadline"));
  }
  operation(actor: AuthenticatedUser, taskId: string, requestId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const scoped = await this.scoped(tx, actor, taskId, true);
        const row = await tx.taskDeadlineAudit.findUnique({
          where: {
            taskId_requestId: {
              taskId: scoped.taskId,
              requestId: requestId.toLowerCase(),
            },
          },
        });
        if (!row)
          throw operationError(
            404,
            "TASK_DEADLINE_OPERATION_NOT_FOUND",
            "Deadline operation not found",
            "readTaskDeadlineOperation",
          );
        return outcome(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  audit(
    actor: AuthenticatedUser,
    taskId: string,
    query: DeadlineAuditQueryDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const scoped = await this.scoped(tx, actor, taskId, true),
          limit = query.limit ?? 50;
        const rows = await tx.taskDeadlineAudit.findMany({
          where: {
            taskId: scoped.taskId,
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
}
