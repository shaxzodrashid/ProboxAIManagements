import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { readDependency } from "../prisma/read-dependency";
import {
  humanTaskReadSelection,
  humanTaskReadSnapshot,
} from "./human-task-state";
import { workflowStatusSnapshot } from "./task-workflow-status";
import { SharedTaskListQueryDto } from "./shared-task-content.dto";
import { HumanTaskHistoryQueryDto } from "./human-tasks.dto";

const taskSelect = {
  ...humanTaskReadSelection,
  humanState: {
    select: { ...humanTaskReadSelection.humanState.select, completed: true },
  },
} satisfies Prisma.TaskSelect;
const entrySelect = {
  taskId: true,
  boardId: true,
  status: { select: { id: true, name: true, color: true, position: true } },
  task: { select: taskSelect },
} satisfies Prisma.TaskSharedBoardEntrySelect;
type Entry = Prisma.TaskSharedBoardEntryGetPayload<{
  select: typeof entrySelect;
}>;
const missing = () => new NotFoundException("Shared task scope not found");
function content(
  entry: Entry,
  project: { id: string; archivedAt: Date | null },
) {
  return {
    ...humanTaskReadSnapshot(entry.task, entry.boardId),
    projectId: project.id,
    statusId: entry.status.id,
    workflowStatus: workflowStatusSnapshot(entry.status),
    projectArchivedAt: project.archivedAt,
    completed: entry.task.humanState!.completed,
  };
}
const pick = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(
    keys.filter((k) => k in row).map((k) => [k, row[k]]),
  );
};
function snapshot(value: unknown) {
  const row = pick(value, [
    "id",
    "title",
    "description",
    "ownerId",
    "revision",
    "lifecycle",
    "checklistSections",
    "priority",
    "assigneeIds",
    "checklist",
    "deadline",
    "createdAt",
    "updatedAt",
  ]);
  if (!row) return null;
  const deadline = (v: unknown) =>
    pick(v, ["kind", "date", "time", "timeZone", "utcOffset", "instant"]);
  const checklistItem = (item: unknown, depth = 0): unknown => {
    const result = pick(item, [
      "id",
      "title",
      "assigneeId",
      "position",
      "parentId",
      "sectionId",
      "completed",
      "completedById",
      "completedAt",
      "deadline",
    ]);
    if (!result) return null;
    result.deadline = deadline(result.deadline);
    const children = pick(item, ["children"])?.children;
    if (Array.isArray(children) && depth < 8)
      result.children = children
        .slice(0, 200)
        .map((child) => checklistItem(child, depth + 1));
    return result;
  };
  if (row.lifecycle)
    row.lifecycle = pick(row.lifecycle, [
      "state",
      "archivedAt",
      "deletedAt",
      "sourceProjectArchivedAt",
    ]);
  if (Array.isArray(row.checklistSections))
    row.checklistSections = row.checklistSections.map((section) => {
      // currentSide is a frozen source-view flag, not the requesting side's identity.
      const selected = pick(section, [
        "id",
        "original",
        "active",
        "currentSide",
      ]);
      const items = pick(section, ["items"])?.items;
      return selected
        ? {
            ...selected,
            items: Array.isArray(items)
              ? items.slice(0, 200).map((item) => checklistItem(item))
              : [],
          }
        : null;
    });
  row.deadline = deadline(row.deadline);
  row.checklist = Array.isArray(row.checklist)
    ? row.checklist.map((item) => checklistItem(item))
    : [];
  return row;
}
@Injectable()
export class SharedTaskContentService {
  constructor(private readonly prisma: PrismaService) {}
  private read<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    return readDependency("readSharedTaskContent", () =>
      this.prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 10000,
        maxWait: 2000,
      }),
    );
  }
  private async project(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    id: string,
  ) {
    if (actor.type !== undefined && actor.type !== "access") throw missing();
    const row = await tx.project.findFirst({
      where: {
        id: id.toLowerCase(),
        workspaceId: actor.workspaceId,
        members: {
          some: {
            userId: actor.id,
            user: { status: "OPEN", workspaceId: actor.workspaceId },
          },
        },
      },
      select: {
        id: true,
        archivedAt: true,
        taskBoard: { select: { id: true } },
      },
    });
    if (!row?.taskBoard) throw missing();
    return row;
  }
  private async entry(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    boardId: string,
    taskId: string,
  ) {
    const row = await tx.taskSharedBoardEntry.findFirst({
      where: {
        boardId,
        taskId: taskId.toLowerCase(),
        task: {
          workspaceId: actor.workspaceId,
          boardEntry: { isNot: null },
          humanState: { isNot: null },
        },
      },
      select: entrySelect,
    });
    if (!row) throw missing();
    return row;
  }
  list(
    actor: AuthenticatedUser,
    projectId: string,
    query: SharedTaskListQueryDto,
  ) {
    return this.read(async (tx) => {
      const project = await this.project(tx, actor, projectId);
      const limit = query.limit ?? 50;
      const rows = await tx.taskSharedBoardEntry.findMany({
        where: {
          boardId: project.taskBoard!.id,
          ...(query.afterTaskId
            ? { taskId: { gt: query.afterTaskId.toLowerCase() } }
            : {}),
          task: {
            workspaceId: actor.workspaceId,
            boardEntry: { isNot: null },
            humanState: { isNot: null },
          },
        },
        orderBy: { taskId: "asc" },
        take: limit + 1,
        select: entrySelect,
      });
      return {
        items: rows.slice(0, limit).map((row) => content(row, project)),
        hasMore: rows.length > limit,
        nextAfterTaskId: rows.length > limit ? rows[limit - 1]!.taskId : null,
      };
    });
  }
  get(actor: AuthenticatedUser, projectId: string, taskId: string) {
    return this.read(async (tx) => {
      const project = await this.project(tx, actor, projectId);
      return content(
        await this.entry(tx, actor, project.taskBoard!.id, taskId),
        project,
      );
    });
  }
  history(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    query: HumanTaskHistoryQueryDto,
    comments = false,
  ) {
    return this.read(async (tx) => {
      const project = await this.project(tx, actor, projectId);
      await this.entry(tx, actor, project.taskBoard!.id, taskId);
      const where = {
          taskId: taskId.toLowerCase(),
          revision: { gt: query.afterRevision ?? 0 },
        },
        limit = query.limit ?? 50;
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
        items: rows.slice(0, limit).map((row) => ({
          taskId: row.taskId,
          requestId: row.requestId,
          actorId: row.actorId,
          action: row.action,
          revision: row.revision,
          before: snapshot(row.before),
          after: snapshot(row.after),
          comment: pick(row.comment, [
            "id",
            "authorId",
            "body",
            "revision",
            "createdAt",
          ]),
          createdAt: row.createdAt,
        })),
        hasMore: rows.length > limit,
        nextAfterRevision:
          rows.length > limit ? rows[limit - 1]!.revision : null,
      };
    });
  }
}
