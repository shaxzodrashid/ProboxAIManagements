import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { readDependency } from "../prisma/read-dependency";
import { operationError } from "../openapi/operation-errors";
import { GroupHistoryQueryDto } from "./group-messages.dto";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  requireCursorKey,
} from "./group-history-cursor";
import { groupMessageLowerBoundary } from "./group-message-visibility";
const fail = (status: number, code: string, message: string) =>
  operationError(status, code, message, "readGroupHistory");
const digest = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function groupHistory(
  prisma: PrismaService,
  actor: AuthenticatedUser,
  groupId: string,
  query: GroupHistoryQueryDto,
  key?: Buffer,
) {
  groupId = groupId.toLowerCase();
  const topicId = query.topicId?.toLowerCase() ?? null,
    limit = query.limit ?? 50;
  return readDependency("readGroupHistory", () =>
    prisma.$transaction(
      async (tx) => {
        await lockWorkspace(tx, actor.workspaceId);
        await tx.$queryRaw`SELECT "id" FROM "ChatGroup" WHERE "id"=${groupId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "accountId" FROM "ChatGroupMembership" WHERE "groupId"=${groupId} AND "accountId"=${actor.id} FOR UPDATE`;
        const current = await tx.user.findFirst({
          where: {
            id: actor.id,
            workspaceId: actor.workspaceId,
            status: "OPEN",
          },
          select: { id: true },
        });
        if (!current || (actor.type !== undefined && actor.type !== "access"))
          throw fail(
            403,
            "GROUP_ACCOUNT_UNAVAILABLE",
            "Current human account required",
          );
        const member = await tx.chatGroupMembership.findUnique({
          where: { groupId_accountId: { groupId, accountId: actor.id } },
        });
        const group = await tx.chatGroup.findUnique({
          where: { id: groupId },
          select: { lastMessageSequence: true },
        });
        if (!member || !group)
          throw fail(404, "GROUP_NOT_FOUND", "Admitted group unavailable");
        const encryptionKey = requireCursorKey(key);
        const scope = digest([
          actor.id,
          actor.workspaceId,
          groupId,
          topicId,
          limit,
        ]);
        const membership = digest([
          member.historyEpoch,
          member.historyCutoffSequence,
          member.historyAccess,
          member.joinedAt.toISOString(),
          member.invitationId,
        ]);
        const lower = await groupMessageLowerBoundary(
          tx,
          member,
          topicId,
          group.lastMessageSequence,
          "readGroupHistory",
        );
        let upper = group.lastMessageSequence,
          before: number | undefined;
        if (query.cursor) {
          const cursor = decodeHistoryCursor(query.cursor, encryptionKey);
          if (cursor.scope !== scope)
            throw fail(
              400,
              "GROUP_HISTORY_CURSOR_INVALID",
              "Invalid message page continuation",
            );
          if (cursor.membership !== membership || cursor.lower !== lower)
            throw fail(
              409,
              "GROUP_HISTORY_CHANGED",
              "History admission changed; restart paging",
            );
          if (cursor.upper > upper)
            throw fail(
              409,
              "GROUP_HISTORY_CHANGED",
              "Message history changed; restart paging",
            );
          upper = cursor.upper;
          before = cursor.before;
        }
        if (lower > upper)
          throw fail(
            409,
            "GROUP_HISTORY_BOUNDARY_UNAVAILABLE",
            "Original admission boundary is unavailable; history has been preserved",
          );
        const rows = await tx.chatGroupMessage.findMany({
          where: {
            groupId,
            topicId,
            sequence: {
              gt: lower,
              lte: upper,
              ...(before === undefined ? {} : { lt: before }),
            },
          },
          orderBy: { sequence: "desc" },
          take: limit + 1,
          select: {
            id: true,
            authorId: true,
            text: true,
            createdAt: true,
            topicId: true,
            sequence: true,
          },
        });
        const items = rows.slice(0, limit);
        return {
          items: items.map(({ sequence: _sequence, ...item }) => item),
          nextCursor:
            rows.length > limit
              ? encodeHistoryCursor(
                  {
                    v: 1,
                    scope,
                    membership,
                    upper,
                    lower,
                    before: items[items.length - 1]!.sequence,
                  },
                  encryptionKey,
                )
              : null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
        maxWait: 2000,
      },
    ),
  );
}
