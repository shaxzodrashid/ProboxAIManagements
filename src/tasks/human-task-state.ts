import { Prisma, TaskHumanAudit } from "@prisma/client";
import { storedTaskDeadline } from "./task-deadline-value";
import { workflowStatusSnapshot } from "./task-workflow-status";
export const humanTaskSelection = {
  id: true,
  workspaceId: true,
  title: true,
  description: true,
  creatorId: true,
  createdAt: true,
  updatedAt: true,
  humanState: { select: { revision: true, updatedAt: true, priority: true } },
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
export function humanTaskSnapshot(task: HumanTask) {
  return {
    id: task.id,
    projectId: task.boardEntry!.status.board.projectId,
    title: task.title,
    description: task.description,
    ownerId: task.creatorId,
    statusId: task.boardEntry!.statusId,
    revision: task.humanState?.revision ?? 0,
    priority: task.humanState?.priority ?? null,
    assigneeIds: task.assignees.map((a) => a.userId),
    checklist: task.checklist.map((item) => ({
      ...item,
      deadline: storedTaskDeadline(item.deadline ?? null),
    })),
    deadline: storedTaskDeadline(task.deadline?.value ?? null),
    projectArchivedAt: task.boardEntry!.status.board.project.archivedAt,
    createdAt: task.createdAt,
    updatedAt: task.humanState?.updatedAt ?? task.updatedAt,
  };
}
export const humanJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
/** Fresh display metadata is deliberately excluded from frozen mutation/audit outcomes. */
export function humanTaskReadSnapshot(task: HumanTask) {
  return {
    ...humanTaskSnapshot(task),
    workflowStatus: workflowStatusSnapshot(task.boardEntry!.status),
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
