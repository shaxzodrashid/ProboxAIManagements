import { HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { operationError } from "../openapi/operation-errors";
import { PrismaService } from "../prisma/prisma.service";
import {
  humanTaskReadSelection,
  humanTaskReadSnapshot,
} from "./human-task-state";
import { HumanTaskQueryDto, QueryPriorities } from "./human-task-query.dto";
const fail = (status: number, message: string) =>
  operationError(
    status,
    status === 409 ? "HUMAN_TASK_QUERY_CHANGED" : "HUMAN_TASK_QUERY_REJECTED",
    message,
    "queryHumanTasks",
  );
type Cursor = {
  version: 1;
  scope: string;
  generation: string;
  after: number;
  asOf: string;
};
const expressions: Record<string, string> = {
  priority:
    "CASE hs.priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE NULL END",
  deadlineDate: "d.value->>'date'",
  deadline:
    "CASE d.value->>'kind' WHEN 'TIMED' THEN 0 WHEN 'DATE' THEN 1 ELSE 2 END",
  createdAt: 't."createdAt"',
};
export async function queryHumanTasks(
  prisma: PrismaService,
  actor: AuthenticatedUser,
  projectId: string,
  query: HumanTaskQueryDto,
) {
  projectId = projectId.toLowerCase();
  const priorities = [...(query.priorities ?? [])].sort(),
    statusIds = [...(query.statusIds ?? [])]
      .map((id) => id.toLowerCase())
      .sort();
  const sort = query.sort ?? ["-priority", "-createdAt"],
    limit = query.limit ?? 50;
  const fields = sort.map((key) => key.replace(/^-/, ""));
  if (
    new Set(fields).size !== fields.length ||
    sort.some((key) => !expressions[key.replace(/^-/, "")]) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw fail(400, "Invalid human task query ordering/page size");
  if (new Set(statusIds).size !== statusIds.length)
    throw fail(400, "Status IDs must be a unique set");
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        actor.id,
        actor.workspaceId,
        projectId,
        query.q ?? null,
        priorities,
        statusIds,
        query.assigneeId?.toLowerCase() ?? null,
        sort,
      ]),
    )
    .digest("hex");
  let cursor: Cursor | undefined;
  if (query.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(query.cursor)) throw new Error();
      const c = JSON.parse(
        Buffer.from(query.cursor, "base64url").toString("utf8"),
      );
      if (
        Object.keys(c).sort().join() !==
          "after,asOf,generation,scope,version" ||
        c.version !== 1 ||
        c.scope !== scope ||
        !/^[a-f0-9]{64}$/.test(c.generation) ||
        !Number.isSafeInteger(c.after) ||
        c.after < 1 ||
        typeof c.asOf !== "string" ||
        c.asOf.length !== 24 ||
        c.asOf.startsWith("0000") ||
        new Date(c.asOf).toISOString() !== c.asOf
      )
        throw new Error();
      cursor = c;
    } catch {
      throw fail(400, "Invalid human task query cursor");
    }
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        const project = await authenticationDependency(() =>
          tx.project.findFirst({
            where: {
              id: projectId,
              workspaceId: actor.workspaceId,
              members: {
                some: {
                  userId: actor.id,
                  user: { workspaceId: actor.workspaceId, status: "OPEN" },
                },
              },
            },
            select: {
              archivedAt: true,
              taskBoard: { select: { revision: true } },
            },
          }),
        );
        if (!project) throw fail(404, "Project task scope not found");
        await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT CURRENT_TIMESTAMP AS now`;
        if (cursor && new Date(cursor.asOf) > clock!.now)
          throw fail(400, "Invalid human task query cursor");
        const clauses: Prisma.Sql[] = [
          Prisma.sql`t."workspaceId" = ${actor.workspaceId}`,
          Prisma.sql`b."projectId" = ${projectId}`,
        ];
        if (query.q !== undefined) {
          const pattern =
            "%" + query.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
          clauses.push(
            Prisma.sql`(t.title ILIKE ${pattern} OR t.description ILIKE ${pattern})`,
          );
        }
        if (priorities.length) {
          const values = priorities.filter((p) => p !== "UNSET");
          const options = values.length
            ? [Prisma.sql`hs.priority::text IN (${Prisma.join(values)})`]
            : [];
          if (priorities.includes("UNSET"))
            options.push(Prisma.sql`hs.priority IS NULL`);
          clauses.push(Prisma.sql`(${Prisma.join(options, " OR ")})`);
        }
        if (statusIds.length)
          clauses.push(Prisma.sql`e."statusId" IN (${Prisma.join(statusIds)})`);
        if (query.assigneeId)
          clauses.push(
            Prisma.sql`EXISTS (SELECT 1 FROM "TaskAssignee" a WHERE a."taskId"=t.id AND a."userId"=${query.assigneeId.toLowerCase()})`,
          );
        const order = Prisma.raw(
          sort
            .map((key) =>
              key.replace(/^-/, "") === "deadline"
                ? `${expressions.deadline} ASC, CASE WHEN d.value->>'kind'='TIMED' THEN (d.value->>'instant')::timestamptz END ${key.startsWith("-") ? "DESC" : "ASC"} NULLS LAST, CASE WHEN d.value->>'kind'='DATE' THEN d.value->>'date' END ${key.startsWith("-") ? "DESC" : "ASC"} NULLS LAST`
                : `${expressions[key.replace(/^-/, "")]} ${key.startsWith("-") ? "DESC" : "ASC"} NULLS LAST`,
            )
            .join(", ") + ", t.id DESC",
        );
        const base = Prisma.sql`FROM "Task" t JOIN "TaskBoardEntry" e ON e."taskId"=t.id JOIN "TaskBoardStatus" s ON s.id=e."statusId" JOIN "TaskBoard" b ON b.id=s."boardId" AND b.id=e."boardId" LEFT JOIN "TaskHumanState" hs ON hs."taskId"=t.id LEFT JOIN "TaskDeadline" d ON d."taskId"=t.id WHERE ${Prisma.join(clauses, " AND ")}`;
        const version = Prisma.sql`jsonb_build_array(t.id,t.title,t.description,t."createdAt",hs.priority,hs.revision,e."statusId",d.revision,d.value)::text`;
        // Bound digest materialization without transferring all task content.
        // Counting/ranking still scan the filtered set under query time budgets.
        const [budget] = await tx.$queryRaw<Array<{ bytes: bigint }>>(
          Prisma.sql`SELECT coalesce(sum(octet_length(${version}) + 1),0)::bigint AS bytes ${base}`,
        );
        if (budget!.bytes > 8n * 1024n * 1024n)
          throw operationError(
            503,
            "HUMAN_TASK_QUERY_SCOPE_LIMIT",
            "Human task query is too large; refine the filters",
            "queryHumanTasks",
          );
        const [summary] = await tx.$queryRaw<
          Array<{ total: bigint; generation: string }>
        >(
          Prisma.sql`SELECT count(*) AS total, encode(sha256(convert_to(coalesce(string_agg(${version}, ',' ORDER BY t.id), '') || ${JSON.stringify([project.archivedAt, project.taskBoard?.revision ?? null])}, 'UTF8')), 'hex') AS generation ${base}`,
        );
        const total = Number(summary!.total);
        if (!Number.isSafeInteger(total))
          throw fail(503, "Human task query total is unavailable");
        if (cursor && cursor.generation !== summary!.generation)
          throw fail(
            409,
            "Human task query changed; refresh from the first page",
          );
        if (cursor && cursor.after > total)
          throw fail(400, "Invalid human task query cursor");
        const counts = await tx.$queryRaw<
          Array<{ priority: string | null; statusId: string; count: bigint }>
        >(
          Prisma.sql`SELECT hs.priority::text AS priority, e."statusId", count(*) AS count ${base} GROUP BY hs.priority,e."statusId"`,
        );
        const ranked = await tx.$queryRaw<Array<{ id: string; rank: bigint }>>(
          Prisma.sql`SELECT id, rank FROM (SELECT t.id, row_number() OVER (ORDER BY ${order}) AS rank ${base}) ranked WHERE rank > ${cursor?.after ?? 0} ORDER BY rank LIMIT ${limit + 1}`,
        );
        const page = ranked.slice(0, limit),
          hasMore = ranked.length > limit;
        const rows = await tx.task.findMany({
          where: {
            id: { in: page.map((r) => r.id) },
            workspaceId: actor.workspaceId,
          },
          select: humanTaskReadSelection,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const items = page.map((row) =>
          humanTaskReadSnapshot(byId.get(row.id)!),
        );
        const priorityCounts = QueryPriorities.map((priority) => ({
          priority,
          count: counts
            .filter((r) => (r.priority ?? "UNSET") === priority)
            .reduce((n, r) => n + Number(r.count), 0),
        }));
        const byStatus = new Map<string, number>();
        for (const row of counts)
          byStatus.set(
            row.statusId,
            (byStatus.get(row.statusId) ?? 0) + Number(row.count),
          );
        const statusCounts = [...byStatus.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([statusId, count]) => ({ statusId, count }));
        const asOf = cursor?.asOf ?? clock!.now.toISOString();
        const nextCursor = hasMore
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                scope,
                generation: summary!.generation,
                after: Number(page.at(-1)!.rank),
                asOf,
              } satisfies Cursor),
            ).toString("base64url")
          : null;
        return {
          items,
          total,
          priorityCounts,
          statusCounts,
          hasMore,
          nextCursor,
          asOf,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 10000,
        maxWait: 2000,
      },
    );
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw fail(503, "Human task query is unavailable");
  }
}
