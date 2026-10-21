import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { readDependency } from "../prisma/read-dependency";
import { createHistoryMembership } from "./group-history-admission";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import {
  CreateGroupInvitationDto,
  GroupPageQueryDto,
  DirectCardQueryDto,
} from "./group-admission.dto";
const fail = (status: number, message: string) =>
  operationError(status, "GROUP_ADMISSION_REJECTED", message, "groupAdmission");
const groupSelect = {
  id: true,
  name: true,
  creatorId: true,
  ownerId: true,
  createdAt: true,
} as const;
const inviteInclude = { card: { select: { conversationId: true } } } as const;
type Invitation = Prisma.ChatGroupInvitationGetPayload<{
  include: typeof inviteInclude;
}>;
const invitation = (row: Invitation) => ({
  id: row.id,
  groupId: row.groupId,
  groupName: row.initialGroupName,
  inviterId: row.inviterId,
  recipientId: row.recipientId,
  mode: row.mode,
  historyAccess: row.historyAccess,
  status: row.status,
  conversationId: row.card?.conversationId ?? null,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
});
@Injectable()
export class GroupAdmissionService {
  constructor(private readonly prisma: PrismaService) {}
  private async now(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    if (!rows[0]) throw fail(503, "Admission clock unavailable");
    return rows[0].now;
  }
  private read<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return readDependency("readGroupAdmission", () =>
      this.prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 10000,
        maxWait: 2000,
      }),
    );
  }
  private async active(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    const user = await tx.user.findFirst({
      where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
      select: { id: true },
    });
    if (!user || (actor.type !== undefined && actor.type !== "access"))
      throw fail(403, "Current human account required");
  }
  private async locked(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    groupId: string,
    involved: string[],
  ) {
    const ids = [...new Set([actor.id, ...involved])].sort();
    const before = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, workspaceId: true },
    });
    if (before.length !== ids.length) throw fail(404, "Account unavailable");
    for (const workspaceId of [
      ...new Set([...before.map((u) => u.workspaceId), actor.workspaceId]),
    ].sort())
      await lockWorkspace(tx, workspaceId);
    const groups = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "ChatGroup" WHERE "id"=${groupId} FOR UPDATE`;
    if (!groups.length) throw fail(404, "Group unavailable");
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`,
    );
    const current = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, workspaceId: true, status: true },
    });
    if (
      current.some(
        (u) => before.find((b) => b.id === u.id)?.workspaceId !== u.workspaceId,
      )
    )
      throw fail(409, "Account context changed; reconcile before retrying");
    await this.active(tx, actor);
    const group = await tx.chatGroup.findUniqueOrThrow({
      where: { id: groupId },
    });
    return { group, current };
  }
  private async inviteRight(
    tx: Prisma.TransactionClient,
    groupId: string,
    accountId: string,
  ) {
    const member = await tx.chatGroupMembership.findUnique({
      where: { groupId_accountId: { groupId, accountId } },
    });
    const right = await tx.chatGroupInvitationPermission.findUnique({
      where: { groupId_accountId: { groupId, accountId } },
    });
    if (!member || !right?.canInvite)
      throw fail(403, "Owner-granted invitation permission required");
  }
  private async permissions(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    groupId: string,
  ) {
    await this.active(tx, actor);
    const group = await tx.chatGroup.findFirst({
      where: { id: groupId, ownerId: actor.id },
      select: { permissionRevision: true },
    });
    if (!group) throw fail(404, "Owned group unavailable");
    return {
      revision: group.permissionRevision,
      items: await tx.chatGroupInvitationPermission.findMany({
        where: { groupId },
        orderBy: { accountId: "asc" },
        select: { accountId: true, canInvite: true },
      }),
    };
  }
  getPermissions(actor: AuthenticatedUser, groupId: string) {
    return this.read((tx) =>
      this.permissions(tx, actor, groupId.toLowerCase()),
    );
  }
  setPermission(
    actor: AuthenticatedUser,
    groupId: string,
    accountId: string,
    revision: number,
    canInvite: boolean,
  ) {
    groupId = groupId.toLowerCase();
    accountId = accountId.toLowerCase();
    return this.prisma
      .$transaction(
        async (tx) => {
          const { group, current } = await this.locked(tx, actor, groupId, [
            accountId,
          ]);
          if (group.ownerId !== actor.id)
            throw fail(404, "Owned group unavailable");
          if (group.permissionRevision !== revision)
            throw fail(409, "Group invitation permissions changed; reread");
          if (
            (canInvite &&
              !current.some(
                (u) => u.id === accountId && u.status === "OPEN",
              )) ||
            !(await tx.chatGroupMembership.findUnique({
              where: { groupId_accountId: { groupId, accountId } },
            }))
          )
            throw fail(404, "Active group member unavailable");
          const prior = await tx.chatGroupInvitationPermission.findUnique({
            where: { groupId_accountId: { groupId, accountId } },
          });
          if (prior?.canInvite !== canInvite) {
            await tx.chatGroupInvitationPermission.upsert({
              where: { groupId_accountId: { groupId, accountId } },
              create: { groupId, accountId, canInvite, grantedById: actor.id },
              update: { canInvite, grantedById: actor.id },
            });
            await tx.chatGroup.update({
              where: { id: groupId },
              data: { permissionRevision: { increment: 1 } },
            });
            await tx.chatGroupPermissionAudit.create({
              data: {
                groupId,
                actorId: actor.id,
                accountId,
                canInvite,
                revision: revision + 1,
              },
            });
          }
          return this.permissions(tx, actor, groupId);
        },
        { timeout: 10000, maxWait: 2000 },
      )
      .catch((e) => databaseOperationError(e, "setGroupInvitationPermission"));
  }
  create(
    actor: AuthenticatedUser,
    groupId: string,
    dto: CreateGroupInvitationDto,
  ) {
    groupId = groupId.toLowerCase();
    const recipientId = dto.recipientId.toLowerCase(),
      requestId = dto.requestId.toLowerCase(),
      historyAccess = dto.historyAccess ?? "NONE";
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({ groupId, recipientId, mode: dto.mode, historyAccess }),
      )
      .digest("hex");
    return this.prisma
      .$transaction(
        async (tx) => {
          const { group, current } = await this.locked(tx, actor, groupId, [
            recipientId,
          ]);
          await this.inviteRight(tx, groupId, actor.id);
          if (!current.some((u) => u.id === recipientId && u.status === "OPEN"))
            throw fail(404, "Recipient unavailable");
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"group-invite:" + actor.id + ":" + requestId}, 0))`;
          const prior = await tx.chatGroupInvitation.findUnique({
            where: { inviterId_requestId: { inviterId: actor.id, requestId } },
            include: inviteInclude,
          });
          if (prior) {
            if (prior.inputHash !== inputHash)
              throw fail(409, "Invitation request ID has different input");
            return { requestId, invitation: invitation(prior) };
          }
          if (
            await tx.chatGroupMembership.findUnique({
              where: { groupId_accountId: { groupId, accountId: recipientId } },
            })
          )
            throw fail(409, "Account is already admitted");
          if (
            await tx.chatGroupInvitation.findFirst({
              where: { groupId, recipientId, status: "PENDING" },
            })
          )
            throw fail(409, "An invitation is already pending");
          const now = await this.now(tx);
          const row = await tx.chatGroupInvitation.create({
            data: {
              groupId,
              initialGroupName: group.name,
              inviterId: actor.id,
              recipientId,
              requestId,
              inputHash,
              mode: dto.mode,
              historyAccess,
              status: dto.mode === "DIRECT" ? "ADDED" : "PENDING",
              createdAt: now,
              resolvedAt: dto.mode === "DIRECT" ? now : null,
            },
          });
          if (dto.mode === "DIRECT")
            await createHistoryMembership(
              tx,
              {
                groupId,
                accountId: recipientId,
                invitationId: row.id,
                historyAccess,
                joinedAt: now,
              },
              group.lastMessageSequence,
            );
          else {
            const pair = [actor.id, recipientId].sort();
            const lowerAccountId = pair[0]!,
              upperAccountId = pair[1]!;
            const thread = await tx.humanDirectConversation.upsert({
              where: {
                lowerAccountId_upperAccountId: {
                  lowerAccountId,
                  upperAccountId,
                },
              },
              create: { lowerAccountId, upperAccountId },
              update: {},
            });
            const next = await tx.humanDirectConversation.update({
              where: { id: thread.id },
              data: { lastSequence: { increment: 1 } },
            });
            await tx.directInvitationCard.create({
              data: {
                conversationId: thread.id,
                invitationId: row.id,
                sequence: next.lastSequence,
              },
            });
          }
          return {
            requestId,
            invitation: invitation(
              await tx.chatGroupInvitation.findUniqueOrThrow({
                where: { id: row.id },
                include: inviteInclude,
              }),
            ),
          };
        },
        { timeout: 10000, maxWait: 2000 },
      )
      .catch((e) => databaseOperationError(e, "createGroupInvitation"));
  }
  outcome(actor: AuthenticatedUser, groupId: string, requestId: string) {
    return this.read(async (tx) => {
      await this.active(tx, actor);
      await this.inviteRight(tx, groupId.toLowerCase(), actor.id);
      const row = await tx.chatGroupInvitation.findUnique({
        where: {
          inviterId_requestId: {
            inviterId: actor.id,
            requestId: requestId.toLowerCase(),
          },
        },
        include: inviteInclude,
      });
      if (!row || row.groupId !== groupId.toLowerCase())
        throw fail(404, "Invitation unavailable");
      return { requestId: row.requestId, invitation: invitation(row) };
    });
  }
  memberships(actor: AuthenticatedUser, query: GroupPageQueryDto) {
    return this.read(async (tx) => {
      await this.active(tx, actor);
      const limit = query.limit ?? 50;
      const rows = await tx.chatGroupMembership.findMany({
        where: {
          accountId: actor.id,
          ...(query.afterId
            ? { groupId: { gt: query.afterId.toLowerCase() } }
            : {}),
        },
        take: limit + 1,
        orderBy: { groupId: "asc" },
        select: {
          groupId: true,
          historyAccess: true,
          joinedAt: true,
          group: { select: groupSelect },
        },
      });
      return {
        items: rows
          .slice(0, limit)
          .map(({ group, historyAccess, joinedAt }) => ({
            group,
            historyAccess,
            joinedAt,
          })),
        hasMore: rows.length > limit,
        nextAfterId: rows.length > limit ? rows[limit - 1]!.groupId : null,
      };
    });
  }
  conversations(actor: AuthenticatedUser, query: GroupPageQueryDto) {
    return this.read(async (tx) => {
      await this.active(tx, actor);
      const limit = query.limit ?? 50;
      const rows = await tx.humanDirectConversation.findMany({
        where: {
          OR: [{ lowerAccountId: actor.id }, { upperAccountId: actor.id }],
          cards: { some: {} },
          ...(query.afterId ? { id: { gt: query.afterId.toLowerCase() } } : {}),
        },
        take: limit + 1,
        orderBy: { id: "asc" },
        select: {
          id: true,
          lowerAccountId: true,
          upperAccountId: true,
          lastSequence: true,
        },
      });
      return {
        items: rows.slice(0, limit).map((row) => ({
          id: row.id,
          counterpartId:
            row.lowerAccountId === actor.id
              ? row.upperAccountId
              : row.lowerAccountId,
          lastSequence: row.lastSequence,
        })),
        hasMore: rows.length > limit,
        nextAfterId: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }
  cards(
    actor: AuthenticatedUser,
    conversationId: string,
    query: DirectCardQueryDto,
  ) {
    return this.read(async (tx) => {
      await this.active(tx, actor);
      const thread = await tx.humanDirectConversation.findFirst({
        where: {
          id: conversationId.toLowerCase(),
          OR: [{ lowerAccountId: actor.id }, { upperAccountId: actor.id }],
        },
        select: { id: true, lowerAccountId: true, upperAccountId: true },
      });
      if (!thread) throw fail(404, "Conversation unavailable");
      const limit = query.limit ?? 50;
      const rows = await tx.directInvitationCard.findMany({
        where: {
          conversationId: thread.id,
          sequence: { gt: query.afterSequence ?? 0 },
          invitation: {
            OR: [
              {
                inviterId: thread.lowerAccountId,
                recipientId: thread.upperAccountId,
              },
              {
                inviterId: thread.upperAccountId,
                recipientId: thread.lowerAccountId,
              },
            ],
          },
        },
        take: limit + 1,
        orderBy: { sequence: "asc" },
        include: { invitation: { include: inviteInclude } },
      });
      const groupIds = [...new Set(rows.map((row) => row.invitation.groupId))];
      const inviterIds = [
        ...new Set(rows.map((row) => row.invitation.inviterId)),
      ];
      const [users, rights, members] = await Promise.all([
        tx.user.findMany({
          where: { id: { in: inviterIds }, status: "OPEN" },
          select: { id: true },
        }),
        tx.chatGroupInvitationPermission.findMany({
          where: {
            groupId: { in: groupIds },
            accountId: { in: inviterIds },
            canInvite: true,
          },
          select: { groupId: true, accountId: true },
        }),
        tx.chatGroupMembership.findMany({
          where: {
            groupId: { in: groupIds },
            accountId: { in: [...inviterIds, actor.id] },
          },
          select: { groupId: true, accountId: true },
        }),
      ]);
      const open = new Set(users.map((user) => user.id));
      const allowed = new Set(
        rights.map((row) => row.groupId + ":" + row.accountId),
      );
      const admitted = new Set(
        members.map((row) => row.groupId + ":" + row.accountId),
      );
      return {
        items: rows.slice(0, limit).map((row) => ({
          id: row.id,
          kind: "GROUP_INVITATION" as const,
          sequence: row.sequence,
          invitation: invitation(row.invitation),
          actions: {
            accept:
              row.invitation.status === "PENDING" &&
              row.invitation.recipientId === actor.id &&
              open.has(row.invitation.inviterId) &&
              allowed.has(
                row.invitation.groupId + ":" + row.invitation.inviterId,
              ) &&
              admitted.has(
                row.invitation.groupId + ":" + row.invitation.inviterId,
              ) &&
              !admitted.has(row.invitation.groupId + ":" + actor.id),
            decline:
              row.invitation.status === "PENDING" &&
              row.invitation.recipientId === actor.id,
          },
          createdAt: row.createdAt,
        })),
        hasMore: rows.length > limit,
        nextAfterSequence:
          rows.length > limit ? rows[limit - 1]!.sequence : null,
      };
    });
  }
  decide(
    actor: AuthenticatedUser,
    conversationId: string,
    invitationId: string,
    accept: boolean,
  ) {
    conversationId = conversationId.toLowerCase();
    invitationId = invitationId.toLowerCase();
    return this.prisma
      .$transaction(
        async (tx) => {
          const initial = await tx.chatGroupInvitation.findFirst({
            where: {
              id: invitationId,
              recipientId: actor.id,
              mode: "APPROVABLE",
              card: { conversationId },
            },
            select: { groupId: true, inviterId: true },
          });
          if (!initial) throw fail(404, "Invitation unavailable");
          const { current, group } = await this.locked(
            tx,
            actor,
            initial.groupId,
            [initial.inviterId],
          );
          const row = await tx.chatGroupInvitation.findUniqueOrThrow({
            where: { id: invitationId },
            include: inviteInclude,
          });
          const target = accept ? "ACCEPTED" : "DECLINED";
          if (accept) {
            if (
              !current.some(
                (u) => u.id === row.inviterId && u.status === "OPEN",
              )
            )
              throw fail(409, "Invitation is currently unavailable");
            await this.inviteRight(tx, row.groupId, row.inviterId);
          }
          if (row.status === target) return invitation(row);
          if (row.status !== "PENDING")
            throw fail(409, "Invitation was already decided differently");
          const now = await this.now(tx);
          if (accept) {
            if (
              await tx.chatGroupMembership.findUnique({
                where: {
                  groupId_accountId: {
                    groupId: row.groupId,
                    accountId: actor.id,
                  },
                },
              })
            )
              throw fail(409, "Account is already admitted");
            await createHistoryMembership(
              tx,
              {
                groupId: row.groupId,
                accountId: actor.id,
                historyAccess: row.historyAccess,
                invitationId: row.id,
                joinedAt: now,
              },
              group.lastMessageSequence,
            );
          }
          return invitation(
            await tx.chatGroupInvitation.update({
              where: { id: row.id },
              data: { status: target, resolvedAt: now },
              include: inviteInclude,
            }),
          );
        },
        { timeout: 10000, maxWait: 2000 },
      )
      .catch((e) => databaseOperationError(e, "decideGroupInvitation"));
  }
}
