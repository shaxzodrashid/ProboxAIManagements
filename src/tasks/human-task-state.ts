import { Prisma, TaskHumanAudit } from "@prisma/client";
import { storedTaskDeadline } from "./task-deadline-value";
import { workflowStatusSnapshot } from "./task-workflow-status";
import { checklistSectionId, checklistSections } from "./checklist-tree";
import {
  publicIdentity,
  publicIdentitySelect,
} from "../accounts/public-identity";
export const humanTaskSelection = {
  id: true,
  workspaceId: true,
  title: true,
  description: true,
  creatorId: true,
  createdAt: true,
  updatedAt: true,
  humanState: {
    select: {
      revision: true,
      updatedAt: true,
      priority: true,
      archivedAt: true,
      deletedAt: true,
    },
  },
  sharedEntries: {
    select: { boardId: true },
    orderBy: { boardId: "asc" as const },
  },
  boardEntry: {
    select: {
      statusId: true,
      boardId: true,
      status: {
        select: {
          id: true,
          name: true,
          color: true,
          position: true,
          board: {
            select: {
              projectId: true,
              project: { select: { archivedAt: true } },
            },
          },
        },
      },
    },
  },
  assignees: { select: { userId: true }, orderBy: { userId: "asc" as const } },
  checklist: {
    select: {
      id: true,
      title: true,
      assigneeId: true,
      position: true,
      sectionBoardId: true,
      parentId: true,
      completed: true,
      completedById: true,
      completedAt: true,
      deadline: true,
    },
    orderBy: { position: "asc" as const },
  },
  deadline: { select: { value: true } },
} satisfies Prisma.TaskSelect;
export type HumanTask = Prisma.TaskGetPayload<{
  select: typeof humanTaskSelection;
}>;
/** Live public identity is selected only for fresh reads, never mutation history. */
export const humanTaskReadSelection = {
  ...humanTaskSelection,
  assignees: {
    ...humanTaskSelection.assignees,
    select: {
      userId: true,
      user: {
        select: { ...publicIdentitySelect, status: true, workspaceId: true },
      },
    },
  },
} satisfies Prisma.TaskSelect;
type HumanTaskRead = Prisma.TaskGetPayload<{
  select: typeof humanTaskReadSelection;
}>;
export function humanTaskSnapshot(
  task: HumanTask,
  currentBoardId = task.boardEntry!.boardId,
) {
  const sourceBoardId = task.boardEntry!.boardId;
  const items = task.checklist.map((item) => ({
    ...item,
    deadline: storedTaskDeadline(item.deadline ?? null),
  }));
  return {
    id: task.id,
    projectId: task.boardEntry!.status.board.projectId,
    title: task.title,
    description: task.description,
    ownerId: task.creatorId,
    statusId: task.boardEntry!.statusId,
    revision: task.humanState?.revision ?? 0,
    priority: task.humanState?.priority ?? null,
    lifecycle: {
      state: task.humanState?.deletedAt
        ? "DELETED"
        : task.humanState?.archivedAt ||
            task.boardEntry!.status.board.project.archivedAt
          ? "ARCHIVED"
          : "ACTIVE",
      archivedAt: task.humanState?.archivedAt ?? null,
      deletedAt: task.humanState?.deletedAt ?? null,
      sourceProjectArchivedAt: task.boardEntry!.status.board.project.archivedAt,
    },
    assigneeIds: task.assignees.map((a) => a.userId),
    checklist: items.map(({ sectionBoardId, ...item }) => ({
      ...item,
      sectionId: checklistSectionId(task.id, sectionBoardId ?? sourceBoardId),
    })),
    checklistSections: checklistSections(
      task.id,
      sourceBoardId,
      task.sharedEntries.map((entry) => entry.boardId),
      items,
      currentBoardId,
    ),
    deadline: storedTaskDeadline(task.deadline?.value ?? null),
    projectArchivedAt: task.boardEntry!.status.board.project.archivedAt,
    createdAt: task.createdAt,
    updatedAt: task.humanState?.updatedAt ?? task.updatedAt,
  };
}
export const humanJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
/** Fresh display metadata is deliberately excluded from frozen mutation/audit outcomes. */
export function humanTaskReadSnapshot(
  task: HumanTaskRead,
  currentBoardId = task.boardEntry!.boardId,
) {
  return {
    ...humanTaskSnapshot(task, currentBoardId),
    workflowStatus: workflowStatusSnapshot(task.boardEntry!.status),
    assigneeIdentities: task.assignees
      .filter(
        ({ user }) =>
          user.status === "OPEN" && user.workspaceId === task.workspaceId,
      )
      .map(({ user }) => publicIdentity(user)),
  };
}
export function humanOutcome(row: TaskHumanAudit) {
  return {
    taskId: row.taskId,
    requestId: row.requestId,
    actorId: row.actorId,
    action: row.action,
    revision: row.revision,
    before: row.before,
    after: row.after,
    comment: row.comment ?? null,
    createdAt: row.createdAt,
  };
}
export function advanceHumanTask(tx: Prisma.TransactionClient, taskId: string) {
  return tx.taskHumanState.upsert({
    where: { taskId },
    create: { taskId, revision: 1 },
    update: { revision: { increment: 1 } },
  });
}
