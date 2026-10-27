import { Prisma } from "@prisma/client";
import { operationError } from "../openapi/operation-errors";
/** Caller holds workspace lock. Labels may shift; only moved card changes relative order. */
export async function placeTaskCard(
  tx: Prisma.TransactionClient,
  boardId: string,
  statusId: string,
  taskId: string,
  beforeTaskId: string | null,
) {
  const rows = await tx.$queryRaw<
    Array<{ taskId: string; shared: boolean }>
  >`SELECT e."taskId", e.shared FROM (SELECT "taskId", "boardId", "statusId", position, false AS shared FROM "TaskBoardEntry" UNION ALL SELECT "taskId", "boardId", "statusId", position, true AS shared FROM "TaskSharedBoardEntry") e JOIN "Task" t ON t.id=e."taskId" WHERE e."boardId"=${boardId} AND e."statusId"=${statusId} ORDER BY e.position, t."createdAt" DESC, t.id DESC`;
  const moved = rows.find((r) => r.taskId === taskId)!;
  const rest = rows.filter((r) => r.taskId !== taskId);
  const index =
    beforeTaskId === null
      ? rest.length
      : rest.findIndex((r) => r.taskId === beforeTaskId);
  if (!moved || index < 0)
    throw operationError(
      409,
      "TASK_CARD_ORDER_CHANGED",
      "Placement target is no longer in this column; refresh",
      "moveTaskCard",
    );
  rest.splice(index, 0, moved);
  const labels = Prisma.join(
    rest.map(
      (row, position) =>
        Prisma.sql`(${row.taskId}::text, ${position}::integer)`,
    ),
  );
  await tx.$executeRaw(
    Prisma.sql`UPDATE "TaskBoardEntry" e SET position=v.position FROM (VALUES ${labels}) v(id,position) WHERE e."taskId"=v.id AND e."boardId"=${boardId}`,
  );
  await tx.$executeRaw(
    Prisma.sql`UPDATE "TaskSharedBoardEntry" e SET position=v.position FROM (VALUES ${labels}) v(id,position) WHERE e."taskId"=v.id AND e."boardId"=${boardId}`,
  );
}
