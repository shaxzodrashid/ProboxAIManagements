import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { validateSync } from "class-validator";
import { plainToInstance } from "class-transformer";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import { advanceHumanTask } from "./human-task-state";
import { ShareTaskDto } from "./shared-tasks.dto";
import { BoardMutationDto } from "./task-boards.dto";

type Action = "SHARE" | "UNSHARE" | "MOVE_LOCAL" | "CONFIRM_COMPLETION";
const fail = (status: number, message: string) =>
  operationError(status, "TASK_SHARING_REJECTED", message, "taskSharing");
@Injectable()
export class SharedTasksService {
  constructor(private readonly prisma: PrismaService) {}
  private transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    write = false,
  ) {
    return this.prisma
      .$transaction(fn, {
        isolationLevel: write
          ? Prisma.TransactionIsolationLevel.ReadCommitted
          : Prisma.TransactionIsolationLevel.RepeatableRead,
      })
      .catch((error: unknown) => databaseOperationError(error, "taskSharing"));
  }
  private async actor(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    permission?: string,
  ) {
    if (actor.type !== undefined && actor.type !== "access")
      throw fail(403, "Human task access required");
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
    if (
      !user ||
      (permission &&
        !user.roleAssignments.some((a) =>
          a.role.permissions.some((p) => p.permissionKey === permission),
        ))
    )
      throw fail(403, "Task sharing permission is unavailable");
  }
  private async project(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    id: string,
  ) {
    const row = await tx.project.findFirst({
      where: {
        id,
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
    if (!row?.taskBoard) throw fail(404, "Project task scope not found");
    return row;
  }
  private async task(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    id: string,
  ) {
    const row = await tx.task.findFirst({
      where: { id, workspaceId: actor.workspaceId },
      select: {
        id: true,
        creatorId: true,
        humanState: { select: { revision: true, completed: true } },
        boardEntry: {
          select: {
            boardId: true,
            status: { select: { board: { select: { projectId: true } } } },
          },
        },
        assignees: { select: { userId: true } },
      },
    });
    if (!row?.boardEntry || !row.humanState)
      throw fail(404, "Human task not found");
    return row;
  }
  private async scope(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    action: Action,
    targetProjectId: string | null,
    writePermission = true,
  ) {
    if (action === "CONFIRM_COMPLETION" && actor.type !== "access")
      throw fail(403, "Authenticated human confirmation is required");
    await this.actor(
      tx,
      actor,
      writePermission
        ? action === "MOVE_LOCAL"
          ? Permissions.TASK_WORKFLOW_MOVE
          : action === "CONFIRM_COMPLETION"
            ? Permissions.TASK_DETAILS_MANAGE
            : Permissions.TASKS_CREATE
        : undefined,
    );
    const project = await this.project(tx, actor, projectId),
      task = await this.task(tx, actor, taskId);
    if (action === "MOVE_LOCAL") {
      const entry = await tx.taskSharedBoardEntry.findUnique({
        where: { taskId_boardId: { taskId, boardId: project.taskBoard!.id } },
      });
      if (!entry) throw fail(404, "Shared task not found in this project");
      if (!task.assignees.some((a) => a.userId === actor.id))
        throw fail(403, "Task assignment is required for movement");
      return { project, task, target: project };
    }
    if (task.boardEntry!.status.board.projectId !== projectId)
      throw fail(404, "Original task scope not found");
    if (task.creatorId !== actor.id)
      throw fail(403, "Task creator ownership is required");
    if (action === "CONFIRM_COMPLETION")
      return { project, task, target: project };
    if (!targetProjectId || targetProjectId === projectId)
      throw fail(400, "Choose a different destination project");
    const target = await this.project(tx, actor, targetProjectId);
    return { project, task, target };
  }
  state(actor: AuthenticatedUser, projectId: string, taskId: string) {
    projectId = projectId.toLowerCase();
    taskId = taskId.toLowerCase();
    return this.transaction(async (tx) => {
      await this.actor(tx, actor);
      const project = await this.project(tx, actor, projectId);
      const task = await tx.task.findFirst({
        where: { id: taskId, workspaceId: actor.workspaceId },
        select: {
          humanState: { select: { revision: true, completed: true } },
          boardEntry: { select: { boardId: true, statusId: true } },
        },
      });
      if (!task?.humanState || !task.boardEntry)
        throw fail(404, "Human task not found");
      const entry =
        task.boardEntry.boardId === project.taskBoard!.id
          ? task.boardEntry
          : await tx.taskSharedBoardEntry.findUnique({
              where: {
                taskId_boardId: { taskId, boardId: project.taskBoard!.id },
              },
              select: { statusId: true },
            });
      if (!entry) throw fail(404, "Human task not found in this project");
      return {
        taskId,
        projectId,
        statusId: entry.statusId,
        revision: task.humanState.revision,
        completed: task.humanState.completed,
      };
    });
  }
  edit(actor: AuthenticatedUser, projectId: string, taskId: string) {
    projectId = projectId.toLowerCase();
    taskId = taskId.toLowerCase();
    return this.transaction(async (tx) => {
      await this.actor(tx, actor);
      await this.project(tx, actor, projectId);
      const task = await this.task(tx, actor, taskId);
      if (task.boardEntry!.status.board.projectId !== projectId)
        throw fail(404, "Original task scope not found");
      if (task.creatorId !== actor.id)
        throw fail(403, "Task owner required for sharing");
      const shares = await tx.taskSharedBoardEntry.findMany({
        where: {
          taskId,
          status: {
            board: {
              project: {
                workspaceId: actor.workspaceId,
                members: { some: { userId: actor.id } },
              },
            },
          },
        },
        select: {
          statusId: true,
          status: { select: { board: { select: { projectId: true } } } },
        },
        orderBy: { boardId: "asc" },
      });
      return {
        taskId,
        revision: task.humanState!.revision,
        shares: shares.map((s) => ({
          projectId: s.status.board.projectId,
          statusId: s.statusId,
        })),
      };
    });
  }
  mutate(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    targetProjectId: string | null,
    revision: number,
    action: Action,
    original: BoardMutationDto | ShareTaskDto,
  ) {
    const dto = plainToInstance(
      action === "UNSHARE" || action === "CONFIRM_COMPLETION"
        ? BoardMutationDto
        : ShareTaskDto,
      original,
    );
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      !Number.isInteger(revision) ||
      revision < 0 ||
      revision >= 2147483647
    )
      throw fail(400, "Invalid sharing input or revision");
    projectId = projectId.toLowerCase();
    taskId = taskId.toLowerCase();
    targetProjectId = targetProjectId?.toLowerCase() ?? null;
    const requestId = dto.requestId.toLowerCase(),
      statusId = "statusId" in dto ? String(dto.statusId).toLowerCase() : null;
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          actorId: actor.id,
          projectId,
          taskId,
          targetProjectId,
          revision,
          action,
          requestId,
          statusId,
        }),
      )
      .digest("hex");
    return this.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const { project, task, target } = await this.scope(
        tx,
        actor,
        projectId,
        taskId,
        action,
        targetProjectId,
      );
      const prior = await tx.taskSharingOperation.findUnique({
        where: { taskId_requestId: { taskId, requestId } },
      });
      if (prior) {
        if (prior.inputHash !== inputHash)
          throw fail(
            409,
            "Sharing request identity was reused for different input",
          );
        return prior.outcome;
      }
      if (
        project.archivedAt ||
        target.archivedAt ||
        project.status === "DELETING" ||
        target.status === "DELETING"
      )
        throw fail(
          409,
          "Archived or deleting projects cannot accept sharing changes",
        );
      if (task.humanState!.revision !== revision)
        throw fail(409, "Human task changed; reread before retrying");
      const boardId = target.taskBoard!.id,
        where = { taskId_boardId: { taskId, boardId } };
      const createdAt = new Date();
      if (action === "CONFIRM_COMPLETION") {
        if (task.humanState!.completed === true)
          throw fail(
            409,
            "Canonical completion is already confirmed; reconcile the original request",
          );
        await tx.taskHumanState.update({
          where: { taskId },
          data: {
            completed: true,
            completedById: actor.id,
            completedAt: createdAt,
          },
        });
      } else if (action === "UNSHARE")
        await tx.taskSharedBoardEntry.deleteMany({
          where: { taskId, boardId },
        });
      else {
        if (
          !(await tx.taskBoardStatus.findFirst({
            where: { id: statusId!, boardId },
            select: { id: true },
          }))
        )
          throw fail(404, "Destination workflow status not found");
        if (action === "MOVE_LOCAL")
          await tx.taskSharedBoardEntry.update({
            where,
            data: { statusId: statusId! },
          });
        else {
          const existing = await tx.taskSharedBoardEntry.findUnique({ where });
          if (existing && existing.statusId !== statusId)
            throw fail(
              409,
              "Sharing does not overwrite an existing local workflow column",
            );
          if (!existing) {
            if (
              (await tx.taskSharedBoardEntry.count({ where: { taskId } })) >=
              100
            )
              throw fail(409, "A task supports at most 100 additional boards");
            await tx.taskSharedBoardEntry.create({
              data: {
                taskId,
                boardId,
                statusId: statusId!,
                createdById: actor.id,
              },
            });
          }
        }
      }
      const state = await advanceHumanTask(tx, taskId);
      const outcome = {
        taskId,
        requestId,
        actorId: actor.id,
        action,
        revision: state.revision,
        projectId,
        targetProjectId,
        statusId,
        ...(action === "CONFIRM_COMPLETION" ? { completed: true } : {}),
        createdAt: createdAt.toISOString(),
      };
      await tx.taskSharingOperation.create({
        data: {
          taskId,
          requestId,
          actorId: actor.id,
          projectId,
          targetProjectId,
          action,
          revision: state.revision,
          inputHash,
          outcome,
          createdAt,
        },
      });
      return outcome;
    }, true);
  }
  operation(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    requestId: string,
  ) {
    projectId = projectId.toLowerCase();
    taskId = taskId.toLowerCase();
    requestId = requestId.toLowerCase();
    return this.transaction(async (tx) => {
      const row = await tx.taskSharingOperation.findUnique({
        where: { taskId_requestId: { taskId, requestId } },
      });
      if (!row || row.projectId !== projectId || row.actorId !== actor.id)
        throw fail(404, "Sharing operation not found");
      await this.scope(
        tx,
        actor,
        projectId,
        taskId,
        row.action as Action,
        row.targetProjectId,
      );
      return row.outcome;
    });
  }
}
