import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { SessionListQueryDto } from "./session-list.dto";

const select = {
  id: true,
  taskId: true,
  status: true,
  stopConfirmation: true,
  createdAt: true,
  updatedAt: true,
} as const;
type Cursor = {
  version: 1;
  scope: string;
  asOf: string;
  after: { createdAt: string; id: string };
};
const dateValid = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 24 &&
  !value.startsWith("0000") &&
  Number.isFinite(new Date(value).getTime()) &&
  new Date(value).toISOString() === value;

export async function listSessions(
  prisma: PrismaService,
  actor: AuthenticatedUser,
  query: SessionListQueryDto,
) {
  const projectId = query.projectId?.toLowerCase();
  // Retain existing unfiltered cursor identities; bind project-filtered cursors
  // to their explicit task-board scope without treating the hash as authority.
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        actor.id,
        actor.workspaceId,
        query.taskId ?? null,
        [...(query.statuses ?? [])].sort(),
        ...(projectId ? [["task-board-project", projectId]] : []),
      ]),
    )
    .digest("hex");
  let cursor: Cursor | undefined;
  if (query.cursor !== undefined) {
    try {
      if (query.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(query.cursor))
        throw new Error();
      const decoded = JSON.parse(
        Buffer.from(query.cursor, "base64url").toString("utf8"),
      );
      if (
        !decoded ||
        decoded.version !== 1 ||
        decoded.scope !== scope ||
        !dateValid(decoded.asOf) ||
        !decoded.after ||
        !dateValid(decoded.after.createdAt) ||
        typeof decoded.after.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(decoded.after.id) ||
        new Date(decoded.after.createdAt) > new Date(decoded.asOf) ||
        Object.keys(decoded).sort().join() !== "after,asOf,scope,version" ||
        Object.keys(decoded.after).sort().join() !== "createdAt,id"
      )
        throw new Error();
      cursor = decoded;
    } catch {
      throw new BadRequestException("Invalid session list cursor");
    }
  }
  const limit = query.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new BadRequestException("Invalid session list page size");
  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.user.findFirst({
          where: {
            id: actor.id,
            workspaceId: actor.workspaceId,
            status: "OPEN",
          },
          select: {
            roleAssignments: {
              select: {
                role: {
                  select: { permissions: { select: { permissionKey: true } } },
                },
              },
            },
          },
        });
        if (
          !current ||
          !current.roleAssignments.some((a) =>
            a.role.permissions.some((p) => p.permissionKey === "sessions.read"),
          )
        )
          throw new ForbiddenException(
            "Session list access is no longer available",
          );
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT CURRENT_TIMESTAMP AS now`;
        const asOf = cursor?.asOf ?? clock!.now.toISOString();
        if (new Date(asOf) > clock!.now)
          throw new BadRequestException("Invalid session list cursor");
        const where: Prisma.ProboxAiSessionWhereInput = {
          workspaceId: actor.workspaceId,
          task: {
            workspaceId: actor.workspaceId,
            managerId: actor.id,
            ...(projectId
              ? {
                  boardEntry: {
                    is: {
                      status: {
                        board: {
                          projectId,
                          project: {
                            workspaceId: actor.workspaceId,
                            members: { some: { userId: actor.id } },
                          },
                        },
                      },
                    },
                  },
                }
              : {}),
          },
          ...(query.taskId ? { taskId: query.taskId } : {}),
          ...(query.statuses ? { status: { in: query.statuses } } : {}),
          createdAt: { lte: new Date(asOf) },
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: new Date(cursor.after.createdAt) } },
                  {
                    createdAt: new Date(cursor.after.createdAt),
                    id: { lt: cursor.after.id },
                  },
                ],
              }
            : {}),
        };
        const rows = await tx.proboxAiSession.findMany({
          where,
          select,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        });
        const page = rows.slice(0, limit);
        // Only explicit project queries have already established the human-task
        // membership authority needed for task display. Hydrate one page in one
        // batch inside this same snapshot; global summaries keep their old shape.
        const tasks =
          projectId && page.length
            ? await tx.task.findMany({
                where: {
                  id: { in: [...new Set(page.map((row) => row.taskId))] },
                  workspaceId: actor.workspaceId,
                },
                select: { id: true, title: true },
              })
            : [];
        const taskContexts = new Map(
          tasks.map((task) => [
            task.id,
            { id: task.id, title: task.title, projectId: projectId! },
          ]),
        );
        if (projectId && page.some((row) => !taskContexts.has(row.taskId)))
          throw new Error("Authorized task context unavailable");
        const items = page.map((row) => ({
          ...row,
          ...(projectId ? { task: taskContexts.get(row.taskId)! } : {}),
          stopConfirmation: [
            "NOT_OBSERVED",
            "NOT_STARTED",
            "STOP_UNCONFIRMED",
            "LOCAL_EXIT_OBSERVED",
          ].includes(row.stopConfirmation)
            ? row.stopConfirmation
            : "NOT_OBSERVED",
        }));
        const hasMore = rows.length > limit;
        const last = items.at(-1);
        const nextCursor =
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  version: 1,
                  scope,
                  asOf,
                  after: {
                    createdAt: last.createdAt.toISOString(),
                    id: last.id,
                  },
                } satisfies Cursor),
              ).toString("base64url")
            : null;
        return { items, hasMore, nextCursor, asOf };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException({
      code: "SESSION_LIST_UNAVAILABLE",
      message: "Session list unavailable; retry an authorized fresh read",
    });
  }
}
