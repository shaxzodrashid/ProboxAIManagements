import { GroupHistoryAccess, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

/** Caller holds the group fence; messages and admissions serialize on that row. */
export async function createHistoryMembership(
  tx: Prisma.TransactionClient,
  data: {
    groupId: string;
    accountId: string;
    historyAccess: GroupHistoryAccess;
    joinedAt: Date;
    invitationId?: string;
  },
  cutoff: number,
) {
  const member = await tx.chatGroupMembership.create({
    data: {
      ...data,
      historyEpoch: randomUUID(),
      historyCutoffSequence: cutoff,
    },
  });
  if (data.historyAccess === "LAST_100" || data.historyAccess === "LAST_300") {
    const limit = data.historyAccess === "LAST_100" ? 100 : 300;
    // Count within each partition, never subtract N from a group-wide sequence.
    const boundaries = await tx.$queryRaw<
      { topicId: string | null; firstSequence: number }[]
    >`
      SELECT "topicId", min(sequence)::int AS "firstSequence" FROM (
        SELECT "topicId", sequence, row_number() OVER (PARTITION BY "topicId" ORDER BY sequence DESC) AS ordinal
        FROM "ChatGroupMessage" WHERE "groupId"=${data.groupId} AND sequence<=${cutoff}
      ) ranked WHERE ordinal<=${limit} GROUP BY "topicId"`;
    if (boundaries.length)
      await tx.chatGroupHistoryBoundary.createMany({
        data: boundaries.map((b) => ({
          groupId: data.groupId,
          accountId: data.accountId,
          topicKey: b.topicId ?? "MAIN",
          firstSequence: b.firstSequence,
        })),
      });
  }
  return member;
}
