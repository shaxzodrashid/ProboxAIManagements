import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import { PrismaService } from "../prisma/prisma.service";
import { readDependency } from "../prisma/read-dependency";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  groupMessageLowerBoundary,
  requireGroupHistoryBoundary,
} from "./group-message-visibility";
import {
  GroupReactionQueryDto,
  SetGroupReactionDto,
} from "./group-reactions.dto";

const action = "groupMessageReactions";
const unavailable = () =>
  operationError(404, "GROUP_MESSAGE_NOT_FOUND", "Message unavailable", action);
@Injectable()
export class GroupReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private transaction<T>(
    actor: AuthenticatedUser,
    groupId: string,
    messageId: string,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Shared admission/revocation/sending-policy fence; policy does not gate reactions.
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
          throw operationError(
            403,
            "GROUP_ACCOUNT_UNAVAILABLE",
            "Current human account required",
            action,
          );
        const member = await tx.chatGroupMembership.findUnique({
          where: { groupId_accountId: { groupId, accountId: actor.id } },
        });
        const group = await tx.chatGroup.findUnique({
          where: { id: groupId },
          select: { lastMessageSequence: true },
        });
        if (!member || !group) throw unavailable();
        // Missing legacy admission proof must not become a message-existence oracle.
        requireGroupHistoryBoundary(member, action);
        const message = await tx.chatGroupMessage.findFirst({
          where: { id: messageId, groupId },
          select: { sequence: true, topicId: true },
        });
        if (!message) throw unavailable();
        const lower = await groupMessageLowerBoundary(
          tx,
          member,
          message.topicId,
          group.lastMessageSequence,
          action,
        );
        if (
          message.sequence <= lower ||
          message.sequence > group.lastMessageSequence
        )
          throw unavailable();
        return callback(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
        maxWait: 2000,
      },
    );
  }

  read(
    actor: AuthenticatedUser,
    groupId: string,
    messageId: string,
    query: GroupReactionQueryDto,
  ) {
    groupId = groupId.toLowerCase();
    messageId = messageId.toLowerCase();
    const limit = query.limit ?? 50;
    return readDependency(action, () =>
      this.transaction(actor, groupId, messageId, async (tx) => {
        const rows = await tx.chatGroupMessageReaction.groupBy({
          by: ["emoji"],
          where: {
            messageId,
            ...(query.after === undefined
              ? {}
              : { emoji: { gt: query.after } }),
          },
          orderBy: { emoji: "asc" },
          take: limit + 1,
          _count: { _all: true },
        });
        const page = rows.slice(0, limit);
        const own = new Set(
          (
            await tx.chatGroupMessageReaction.findMany({
              where: {
                messageId,
                accountId: actor.id,
                emoji: { in: page.map((r) => r.emoji) },
              },
              select: { emoji: true },
            })
          ).map((r) => r.emoji),
        );
        return {
          items: page.map((r) => ({
            emoji: r.emoji,
            count: r._count._all,
            mine: own.has(r.emoji),
          })),
          nextAfter: rows.length > limit ? page[page.length - 1]!.emoji : null,
        };
      }),
    );
  }

  set(
    actor: AuthenticatedUser,
    groupId: string,
    messageId: string,
    dto: SetGroupReactionDto,
  ) {
    groupId = groupId.toLowerCase();
    messageId = messageId.toLowerCase();
    return this.transaction(actor, groupId, messageId, async (tx) => {
      if (dto.present)
        await tx.chatGroupMessageReaction.upsert({
          where: {
            messageId_accountId_emoji: {
              messageId,
              accountId: actor.id,
              emoji: dto.emoji,
            },
          },
          create: { messageId, accountId: actor.id, emoji: dto.emoji },
          update: {},
        });
      else
        await tx.chatGroupMessageReaction.deleteMany({
          where: { messageId, accountId: actor.id, emoji: dto.emoji },
        });
      return { emoji: dto.emoji, present: dto.present };
    }).catch((error) => databaseOperationError(error, action));
  }
}
