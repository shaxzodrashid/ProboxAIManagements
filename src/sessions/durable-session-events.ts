import { Prisma } from "@prisma/client";
import { ProboxAiRunner } from "./proboxai-runner.service";
import { record, publicSessionEventSelect } from "./safe-session-event";

/** Caller holds the session lock; sequence/hash and payload commit in the same transaction. */
export async function appendSessionEvent(
  tx: Prisma.TransactionClient,
  sessionId: string,
  turnId: string | null,
  type: string,
  payload: Prisma.InputJsonValue,
  archive?: {
    payload: Prisma.InputJsonValue;
    hash: string;
    policyVersion: number;
  },
) {
  const session = await tx.proboxAiSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { lastSequence: true },
  });
  const previous = await tx.sessionEvent.findFirst({
    where: { sessionId },
    orderBy: { sequence: "desc" },
    select: { payloadHash: true },
  });
  const sequence = session.lastSequence + 1;
  const event = await tx.sessionEvent.create({
    select: publicSessionEventSelect,
    data: {
      sessionId,
      turnId,
      sequence,
      type,
      rawPayload: payload,
      ...(archive
        ? {
            archivePayload: archive.payload,
            archiveHash: archive.hash,
            archivePolicyVersion: archive.policyVersion,
          }
        : {}),
      projectionVersion:
        ["item.started", "item.updated", "item.completed"].includes(type) &&
        record(payload).projectionVersion === 3 &&
        record(record(payload).item).type === "command_execution"
          ? 3
          : type === "item.completed" && record(payload).projectionVersion === 2
            ? 2
            : 1,
      previousHash: previous?.payloadHash,
      payloadHash: ProboxAiRunner.hash(
        JSON.stringify(payload),
        previous?.payloadHash,
      ),
    },
  });
  await tx.proboxAiSession.update({
    where: { id: sessionId },
    data: { lastSequence: sequence },
  });
  return event;
}
