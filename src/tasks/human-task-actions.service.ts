import { Injectable } from "@nestjs/common";
import { Prisma, TaskPriority } from "@prisma/client";
import { createHash } from "node:crypto";
import { maxLength } from "class-validator";
import {
  TASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
} from "./task-text-limits";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  operationError,
  databaseOperationError,
} from "../openapi/operation-errors";
import {
  humanTaskSelection,
  humanTaskSnapshot,
  humanJson,
  humanOutcome,
  advanceHumanTask,
  HumanTask,
} from "./human-task-state";
import { HumanTaskHistoryQueryDto } from "./human-tasks.dto";
import { parseTaskDeadline } from "./task-deadline-value";
import { DeadlineInputDto } from "./task-deadlines.dto";

type Input = { requestId: string; [key: string]: unknown };
export type HumanAction =
  | "LINK"
  | "DETAILS"
  | "ASSIGNEES"
  | "CHECKLIST_CREATE"
  | "CHECKLIST_UPDATE"
  | "CHECKLIST_DELETE"
  | "CHECKLIST_COMPLETE"
  | "CHECKLIST_REORDER"
  | "COMMENT"
  | "MOVE";
const actionPermissions: Record<HumanAction, string> = {
  LINK: Permissions.TASKS_CREATE,
  DETAILS: Permissions.TASK_DETAILS_MANAGE,
  ASSIGNEES: Permissions.TASK_ASSIGNEES_MANAGE,
  CHECKLIST_CREATE: Permissions.TASK_CHECKLIST_MANAGE,
  CHECKLIST_UPDATE: Permissions.TASK_CHECKLIST_MANAGE,
  CHECKLIST_DELETE: Permissions.TASK_CHECKLIST_MANAGE,
  CHECKLIST_COMPLETE: Permissions.TASK_CHECKLIST_COMPLETE,
  CHECKLIST_REORDER: Permissions.TASK_CHECKLIST_MANAGE,
  COMMENT: Permissions.TASK_COMMENTS_CREATE,
  MOVE: Permissions.TASK_WORKFLOW_MOVE,
};
const fail = (status: number, message: string) =>
  operationError(status, "HUMAN_TASK_OPERATION_REJECTED", message, "humanTask");
function normalized(input: Input): Input {
  const value = { ...input };
  for (const key of ["requestId", "statusId", "itemId", "assigneeId"])
    if (typeof value[key] === "string") value[key] = value[key].toLowerCase();
  if (Array.isArray(value.assigneeIds))
    value.assigneeIds = value.assigneeIds
      .map((id) => String(id).toLowerCase())
      .sort();
  if (typeof value.title === "string") value.title = value.title.trim();
  if (typeof value.body === "string") value.body = value.body.trim();
  if (Array.isArray(value.itemIds))
    value.itemIds = value.itemIds.map((id) => String(id).toLowerCase());
  return value;
}
@Injectable()
export class HumanTaskActionsService {
  constructor(private readonly prisma: PrismaService) {}
  private async project(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    permission?: string,
  ) {
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
    const keys =
      user?.roleAssignments.flatMap((a) =>
        a.role.permissions.map((p) => p.permissionKey),
      ) ?? [];
    if (!user || (permission && !keys.includes(permission)))
      throw fail(403, "Human task action permission is unavailable");
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        workspaceId: actor.workspaceId,
        members: { some: { userId: actor.id } },
      },
      select: {
        id: true,
        archivedAt: true,
        status: true,
        taskBoard: { select: { id: true } },
      },
    });
    if (!project) throw fail(404, "Project task scope not found");
    return project;
  }
  private async task(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
  ) {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        workspaceId: actor.workspaceId,
        boardEntry: { status: { board: { projectId } } },
      },
      select: humanTaskSelection,
    });
    if (!task) throw fail(404, "Task not found");
    return task;
  }
  history(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    query: HumanTaskHistoryQueryDto,
    comments = false,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.project(tx, actor, projectId.toLowerCase());
        await this.task(
          tx,
          actor,
          projectId.toLowerCase(),
          taskId.toLowerCase(),
        );
        const limit = query.limit ?? 50,
          where = {
            taskId: taskId.toLowerCase(),
            revision: { gt: query.afterRevision ?? 0 },
          };
        if (comments) {
          const rows = await tx.taskComment.findMany({
            where,
            orderBy: { revision: "asc" },
            take: limit + 1,
            select: {
              id: true,
              authorId: true,
              body: true,
              revision: true,
              createdAt: true,
            },
          });
          return {
            items: rows.slice(0, limit),
            hasMore: rows.length > limit,
            nextAfterRevision:
              rows.length > limit ? rows[limit - 1]!.revision : null,
          };
        }
        const rows = await tx.taskHumanAudit.findMany({
          where,
          orderBy: { revision: "asc" },
          take: limit + 1,
        });
        return {
          items: rows.slice(0, limit).map(humanOutcome),
          hasMore: rows.length > limit,
          nextAfterRevision:
            rows.length > limit ? rows[limit - 1]!.revision : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  operation(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    requestId: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.project(tx, actor, projectId.toLowerCase());
        await this.task(
          tx,
          actor,
          projectId.toLowerCase(),
          taskId.toLowerCase(),
        );
        const row = await tx.taskHumanAudit.findUnique({
          where: {
            taskId_requestId: {
              taskId: taskId.toLowerCase(),
              requestId: requestId.toLowerCase(),
            },
          },
        });
        if (!row) throw fail(404, "Human task operation not found");
        return humanOutcome(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private owner(task: HumanTask, actor: AuthenticatedUser) {
    if (task.creatorId !== actor.id)
      throw fail(403, "Only the task owner may edit its definition");
  }
  private assigned(task: HumanTask, actor: AuthenticatedUser) {
    if (!task.assignees.some((a) => a.userId === actor.id))
      throw fail(403, "Task assignment is required for this action");
  }
  private async recipients(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    ids: string[],
    retainedIds: string[] = [],
  ) {
    if (new Set(ids).size !== ids.length || ids.length > 100)
      throw fail(400, "Assignee IDs must be a unique bounded set");
    const sameWorkspace = await tx.user.count({
      where: { id: { in: ids }, workspaceId: actor.workspaceId },
    });
    if (sameWorkspace !== ids.length)
      throw fail(404, "Assignees must belong to this workspace");
    // Keep existing inactive assignments briefly during a handoff; fresh action
    // scope still denies them. Only newly added relationships may grant work.
    const added = ids.filter((id) => !retainedIds.includes(id));
    const count = await tx.user.count({
      where: {
        id: { in: added },
        workspaceId: actor.workspaceId,
        status: "OPEN",
        projectMemberships: { some: { projectId } },
      },
    });
    if (count !== added.length)
      throw fail(404, "Assignees must be current OPEN project members");
  }
  mutate(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    revision: number,
    action: HumanAction,
    original: Input,
  ) {
    projectId = projectId.toLowerCase();
    taskId = taskId.toLowerCase();
    const input = normalized(original),
      requestId = input.requestId;
    // Pin request identity to submitted civil values, independent of runtime
    // timezone rules. Parse only new writes after fresh authority and replay.
    const hashInput = { ...input };
    if (input.deadline !== undefined && input.deadline !== null) {
      const deadline = input.deadline as DeadlineInputDto;
      hashInput.deadline = {
        date: deadline.date,
        time: deadline.time ?? null,
        timeZone:
          typeof deadline.timeZone === "string"
            ? deadline.timeZone.toLowerCase()
            : (deadline.timeZone ?? null),
        utcOffset: deadline.utcOffset ?? null,
      };
    }
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          actorId: actor.id,
          projectId,
          taskId,
          revision,
          action,
          input: Object.fromEntries(
            Object.entries(hashInput).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }),
      )
      .digest("hex");
    return this.prisma
      .$transaction(async (tx) => {
        await lockWorkspace(tx, actor.workspaceId);
        const project = await this.project(
          tx,
          actor,
          projectId,
          actionPermissions[action],
        );
        let task =
          action === "LINK"
            ? await tx.task.findFirst({
                where: { id: taskId, workspaceId: actor.workspaceId },
                select: humanTaskSelection,
              })
            : await this.task(tx, actor, projectId, taskId);
        if (
          !task ||
          (task.boardEntry &&
            task.boardEntry.status.board.projectId !== projectId)
        )
          throw fail(404, "Task not found");
        if (
          [
            "LINK",
            "DETAILS",
            "ASSIGNEES",
            "CHECKLIST_CREATE",
            "CHECKLIST_UPDATE",
            "CHECKLIST_DELETE",
            "CHECKLIST_REORDER",
          ].includes(action)
        )
          this.owner(task, actor);
        if (["COMMENT", "MOVE"].includes(action)) this.assigned(task, actor);
        if (action === "CHECKLIST_COMPLETE") {
          this.assigned(task, actor);
          const item = task.checklist.find((i) => i.id === input.itemId);
          if (!item) throw fail(404, "Checklist item not found");
          if (item.assigneeId !== actor.id)
            throw fail(
              403,
              "Only the checklist item's assignee may change completion",
            );
        }
        const prior = await tx.taskHumanAudit.findUnique({
          where: { taskId_requestId: { taskId, requestId } },
        });
        if (prior) {
          if (prior.inputHash !== inputHash)
            throw fail(409, "Request identity was reused for different input");
          return humanOutcome(prior);
        }
        if (project.archivedAt || project.status === "DELETING")
          throw fail(
            409,
            "Archived or deleting projects cannot accept human task actions",
          );
        if ((task.humanState?.revision ?? 0) !== revision)
          throw fail(
            409,
            "Human task revision changed; reread before retrying",
          );
        if (revision >= 2147483647)
          throw fail(409, "Human task revision cannot advance");
        if (input.deadline !== undefined)
          input.deadline = parseTaskDeadline(
            input.deadline as DeadlineInputDto | null,
          );
        const before = task.boardEntry ? humanTaskSnapshot(task) : null;
        let comment: {
          id: string;
          authorId: string;
          body: string;
          revision: number;
          createdAt: Date;
        } | null = null;
        const sameBoardStatus = async () => {
          if (!project.taskBoard) throw fail(503, "Task board is unavailable");
          const status = await tx.taskBoardStatus.findFirst({
            where: {
              id: String(input.statusId),
              boardId: project.taskBoard.id,
            },
          });
          if (!status)
            throw fail(404, "Workflow status not found in this project");
          return status;
        };
        if (action === "LINK") {
          if (task.boardEntry || task.humanState || revision !== 0)
            throw fail(
              409,
              "Task is already linked; project transfer is not supported",
            );
          const status = await sameBoardStatus();
          await tx.taskBoardEntry.create({
            data: { taskId, boardId: status.boardId, statusId: status.id },
          });
          await tx.taskAssignee.create({ data: { taskId, userId: actor.id } });
        } else if (action === "DETAILS") {
          if (
            input.title === undefined &&
            input.description === undefined &&
            input.priority === undefined
          )
            throw fail(400, "At least one task detail is required");
          if (
            input.title !== undefined &&
            (typeof input.title !== "string" ||
              !input.title.trim() ||
              !maxLength(input.title, TASK_TITLE_MAX_LENGTH))
          )
            throw fail(400, "Invalid task title");
          if (
            input.description !== undefined &&
            (typeof input.description !== "string" ||
              !maxLength(input.description, TASK_DESCRIPTION_MAX_LENGTH))
          )
            throw fail(400, "Invalid task description");
          if (input.priority !== undefined) {
            if (
              input.priority !== null &&
              !Object.values(TaskPriority).includes(
                input.priority as TaskPriority,
              )
            )
              throw fail(400, "Invalid human task priority");
            await tx.taskHumanState.upsert({
              where: { taskId },
              create: {
                taskId,
                priority: input.priority as TaskPriority | null,
              },
              update: { priority: input.priority as TaskPriority | null },
            });
          }
          if (input.title !== undefined || input.description !== undefined)
            await tx.task.update({
              where: { id: taskId },
              data: {
                ...(input.title !== undefined
                  ? { title: input.title as string }
                  : {}),
                ...(input.description !== undefined
                  ? { description: input.description as string }
                  : {}),
              },
            });
        } else if (action === "ASSIGNEES") {
          const ids = input.assigneeIds as string[];
          await this.recipients(
            tx,
            actor,
            projectId,
            ids,
            task.assignees.map((assignment) => assignment.userId),
          );
          if (task.checklist.some((item) => !ids.includes(item.assigneeId)))
            throw fail(
              409,
              "Reassign or remove checklist items before removing their task assignee",
            );
          await tx.taskAssignee.deleteMany({
            where: { taskId, userId: { notIn: ids } },
          });
          await tx.taskAssignee.createMany({
            data: ids.map((userId) => ({ taskId, userId })),
            skipDuplicates: true,
          });
        } else if (action === "MOVE") {
          const status = await sameBoardStatus();
          await tx.taskBoardEntry.update({
            where: { taskId },
            data: { statusId: status.id },
          });
        } else if (action === "COMMENT") {
          if (
            typeof input.body !== "string" ||
            !input.body.trim() ||
            input.body.length > 4000
          )
            throw fail(400, "Comment must be bounded plain text");
          comment = await tx.taskComment.create({
            data: {
              taskId,
              authorId: actor.id,
              body: input.body,
              revision: revision + 1,
            },
            select: {
              id: true,
              authorId: true,
              body: true,
              revision: true,
              createdAt: true,
            },
          });
        } else if (
          action === "CHECKLIST_CREATE" ||
          action === "CHECKLIST_UPDATE"
        ) {
          if (action === "CHECKLIST_CREATE" && task.checklist.length >= 200)
            throw fail(409, "Checklist limit reached");
          const item = task.checklist.find((i) => i.id === input.itemId);
          if (action === "CHECKLIST_UPDATE" && !item)
            throw fail(404, "Checklist item not found");
          if (action === "CHECKLIST_CREATE" && item)
            throw fail(409, "Checklist item identity already exists");
          if (
            input.title !== undefined &&
            (typeof input.title !== "string" ||
              !input.title.trim() ||
              input.title.length > 200)
          )
            throw fail(400, "Invalid checklist title");
          if (
            action === "CHECKLIST_UPDATE" &&
            input.title === undefined &&
            input.assigneeId === undefined &&
            input.deadline === undefined
          )
            throw fail(400, "At least one checklist detail is required");
          if (input.assigneeId !== undefined) {
            if (!task.assignees.some((a) => a.userId === input.assigneeId))
              throw fail(404, "Checklist assignee must be a task assignee");
            await this.recipients(tx, actor, projectId, [
              String(input.assigneeId),
            ]);
          }
          if (action === "CHECKLIST_CREATE")
            await tx.taskChecklistItem.create({
              data: {
                id: String(input.itemId),
                taskId,
                title: String(input.title),
                assigneeId: String(input.assigneeId),
                position: task.checklist.length,
                deadline:
                  input.deadline == null
                    ? Prisma.DbNull
                    : humanJson(input.deadline),
              },
            });
          else
            await tx.taskChecklistItem.update({
              where: { id: String(input.itemId) },
              data: {
                ...(input.deadline !== undefined
                  ? {
                      deadline:
                        input.deadline === null
                          ? Prisma.DbNull
                          : humanJson(input.deadline),
                    }
                  : {}),
                ...(input.title !== undefined
                  ? { title: input.title as string }
                  : {}),
                ...(input.assigneeId !== undefined
                  ? { assigneeId: input.assigneeId as string }
                  : {}),
              },
            });
        } else if (action === "CHECKLIST_DELETE") {
          if (!task.checklist.some((i) => i.id === input.itemId))
            throw fail(404, "Checklist item not found");
          await tx.taskChecklistItem.delete({
            where: { id: String(input.itemId) },
          });
          const rest = task.checklist.filter((i) => i.id !== input.itemId);
          await tx.taskChecklistItem.updateMany({
            where: { taskId },
            data: { position: { increment: 200 } },
          });
          for (const [position, item] of rest.entries())
            await tx.taskChecklistItem.update({
              where: { id: item.id },
              data: { position },
            });
        } else if (action === "CHECKLIST_REORDER") {
          const ids = input.itemIds;
          if (
            !Array.isArray(ids) ||
            ids.length > 200 ||
            new Set(ids).size !== ids.length ||
            ids.some((id) => typeof id !== "string")
          )
            throw fail(
              400,
              "Checklist order must be a unique bounded array of item IDs",
            );
          const currentIds = new Set(task.checklist.map((item) => item.id));
          if (ids.some((id) => !currentIds.has(id)))
            throw fail(404, "Checklist item not found");
          if (ids.length !== task.checklist.length)
            throw fail(409, "Checklist order must include every current item");
          // Free the original unique task/position slots before assigning final
          // positions. Both phases and the audit commit in the same transaction.
          await tx.taskChecklistItem.updateMany({
            where: { taskId },
            data: { position: { increment: 200 } },
          });
          for (const [position, id] of ids.entries())
            await tx.taskChecklistItem.update({
              where: { id },
              data: { position },
            });
        } else if (action === "CHECKLIST_COMPLETE") {
          if (typeof input.completed !== "boolean")
            throw fail(400, "Completion must be a boolean");
          await tx.taskChecklistItem.update({
            where: { id: String(input.itemId) },
            data: {
              completed: input.completed,
              completedById: input.completed ? actor.id : null,
              completedAt: input.completed ? new Date() : null,
            },
          });
        }
        await advanceHumanTask(tx, taskId);
        task = await this.task(tx, actor, projectId, taskId);
        return humanOutcome(
          await tx.taskHumanAudit.create({
            data: {
              taskId,
              requestId,
              inputHash,
              actorId: actor.id,
              action,
              revision: revision + 1,
              before: before ? humanJson(before) : Prisma.JsonNull,
              after: humanJson(humanTaskSnapshot(task)),
              comment: comment ? humanJson(comment) : Prisma.DbNull,
            },
          }),
        );
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError)
          throw databaseOperationError(error, "humanTask");
        throw error;
      });
  }
}
