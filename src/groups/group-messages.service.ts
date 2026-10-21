import { Injectable, Inject, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { readDependency } from "../prisma/read-dependency";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import {
  SendGroupMessageDto,
  GroupHistoryQueryDto,
} from "./group-messages.dto";
import { GROUP_HISTORY_CURSOR_KEY } from "./group-history-cursor";
import { groupHistory } from "./group-history";

const fail = (status: number, code: string, message: string) =>
  operationError(status, code, message, "groupMessages");
const messageSelect = {
  id: true,
  groupId: true,
  authorId: true,
  requestId: true,
  text: true,
  sequence: true,
  createdAt: true,
} as const;
@Injectable()
export class GroupMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(GROUP_HISTORY_CURSOR_KEY)
    private readonly historyKey?: Buffer,
  ) {}
  history(
    actor: AuthenticatedUser,
    groupId: string,
    query: GroupHistoryQueryDto,
  ) {
    return groupHistory(this.prisma, actor, groupId, query, this.historyKey);
  }

  private async admitted(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    groupId: string,
  ) {
    const current = await tx.user.findFirst({
      where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
      select: { id: true },
    });
    if (!current || (actor.type !== undefined && actor.type !== "access"))
      throw fail(
        403,
        "GROUP_ACCOUNT_UNAVAILABLE",
        "Current human account required",
      );
    const group = await tx.chatGroup.findFirst({
      where: { id: groupId, memberships: { some: { accountId: actor.id } } },
      select: { ownerId: true, membersCanSend: true, sendingRevision: true },
    });
    if (!group)
      throw fail(404, "GROUP_NOT_FOUND", "Admitted group unavailable");
    return group;
  }
  private write<T>(
    actor: AuthenticatedUser,
    groupId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma
      .$transaction(
        async (tx) => {
          // Same order as admission/grant writes: workspace, group, account.
          await lockWorkspace(tx, actor.workspaceId);
          await tx.$queryRaw`SELECT "id" FROM "ChatGroup" WHERE "id"=${groupId} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT "accountId" FROM "ChatGroupMembership" WHERE "groupId"=${groupId} AND "accountId"=${actor.id} FOR UPDATE`;
          return fn(tx);
        },
        { timeout: 10000, maxWait: 2000 },
      )
      .catch((e) => databaseOperationError(e, "groupMessages"));
  }
  private read<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return readDependency("groupMessages", () =>
      this.prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 10000,
        maxWait: 2000,
      }),
    );
  }
  send(actor: AuthenticatedUser, groupId: string, dto: SendGroupMessageDto) {
    groupId = groupId.toLowerCase();
    const requestId = dto.requestId.toLowerCase();
    return this.write(actor, groupId, async (tx) => {
      const group = await this.admitted(tx, actor, groupId);
      const prior = await tx.chatGroupMessage.findUnique({
        where: {
          groupId_authorId_requestId: {
            groupId,
            authorId: actor.id,
            requestId,
          },
        },
        select: messageSelect,
      });
      if (prior) {
        if (prior.text !== dto.text)
          throw fail(
            409,
            "GROUP_MESSAGE_REQUEST_CONFLICT",
            "Request ID already has different text",
          );
        // A restriction stops new sends, not reconciliation of one's existing send.
        return prior;
      }
      if (!group.membersCanSend && group.ownerId !== actor.id)
        throw fail(
          403,
          "GROUP_SENDING_RESTRICTED",
          "Owner has restricted group sending",
        );
      const next = await tx.chatGroup.update({
        where: { id: groupId },
        data: { lastMessageSequence: { increment: 1 } },
        select: { lastMessageSequence: true },
      });
      return tx.chatGroupMessage.create({
        data: {
          groupId,
          authorId: actor.id,
          requestId,
          text: dto.text,
          sequence: next.lastMessageSequence,
        },
        select: messageSelect,
      });
    });
  }
  outcome(actor: AuthenticatedUser, groupId: string, requestId: string) {
    groupId = groupId.toLowerCase();
    requestId = requestId.toLowerCase();
    return this.read(async (tx) => {
      await this.admitted(tx, actor, groupId);
      const row = await tx.chatGroupMessage.findUnique({
        where: {
          groupId_authorId_requestId: {
            groupId,
            authorId: actor.id,
            requestId,
          },
        },
        select: messageSelect,
      });
      if (!row)
        throw fail(
          404,
          "GROUP_MESSAGE_NOT_FOUND",
          "Message request unavailable",
        );
      return row;
    });
  }
  policy(actor: AuthenticatedUser, groupId: string) {
    groupId = groupId.toLowerCase();
    return this.read(async (tx) => {
      const group = await this.admitted(tx, actor, groupId);
      return {
        membersCanSend: group.membersCanSend,
        revision: group.sendingRevision,
      };
    });
  }
  setPolicy(
    actor: AuthenticatedUser,
    groupId: string,
    revision: number,
    membersCanSend: boolean,
  ) {
    groupId = groupId.toLowerCase();
    return this.write(actor, groupId, async (tx) => {
      const group = await this.admitted(tx, actor, groupId);
      if (group.ownerId !== actor.id)
        throw fail(404, "GROUP_NOT_FOUND", "Owned group unavailable");
      if (group.sendingRevision !== revision)
        throw fail(
          409,
          "GROUP_SENDING_POLICY_CONFLICT",
          "Sending policy changed; reread",
        );
      if (group.membersCanSend === membersCanSend)
        return { membersCanSend, revision };
      await tx.chatGroup.update({
        where: { id: groupId },
        data: { membersCanSend, sendingRevision: { increment: 1 } },
      });
      await tx.chatGroupSendingAudit.create({
        data: {
          groupId,
          actorId: actor.id,
          membersCanSend,
          revision: revision + 1,
        },
      });
      return { membersCanSend, revision: revision + 1 };
    });
  }
}
