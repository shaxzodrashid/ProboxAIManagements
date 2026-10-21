import { ChatGroupMembership, Prisma } from "@prisma/client";
import { operationError } from "../openapi/operation-errors";

export function requireGroupHistoryBoundary(
  member: ChatGroupMembership,
  action: string,
) {
  if (
    member.historyAccess !== "ALL" &&
    (!member.historyEpoch ||
      member.historyCutoffSequence === null ||
      member.historyCutoffSequence < 0)
  )
    throw operationError(
      409,
      "GROUP_HISTORY_BOUNDARY_UNAVAILABLE",
      "Original admission boundary is unavailable; history has been preserved",
      action,
    );
}

// The same frozen per-topic admission window governs history and reaction targets.
export async function groupMessageLowerBoundary(
  tx: Prisma.TransactionClient,
  member: ChatGroupMembership,
  topicId: string | null,
  upper: number,
  action: string,
) {
  const unavailable = () =>
    operationError(
      409,
      "GROUP_HISTORY_BOUNDARY_UNAVAILABLE",
      "Original admission boundary is unavailable; history has been preserved",
      action,
    );
  let lower = 0;
  if (member.historyAccess !== "ALL") {
    requireGroupHistoryBoundary(member, action);
    lower = member.historyCutoffSequence!;
    if (
      member.historyAccess === "LAST_100" ||
      member.historyAccess === "LAST_300"
    ) {
      const boundary = await tx.chatGroupHistoryBoundary.findUnique({
        where: {
          groupId_accountId_topicKey: {
            groupId: member.groupId,
            accountId: member.accountId,
            topicKey: topicId ?? "MAIN",
          },
        },
      });
      if (boundary) {
        if (
          boundary.firstSequence < 1 ||
          boundary.firstSequence > member.historyCutoffSequence!
        )
          throw unavailable();
        lower = boundary.firstSequence - 1;
      }
    }
  }
  if (lower > upper) throw unavailable();
  return lower;
}
