import { createHash } from "node:crypto";

/** Stable across delivery retries/restarts; a new Telegram update is new work. */
export function telegramTurnRequestId(
  actorId: string,
  chatId: bigint,
  updateId: number,
) {
  const bytes = createHash("sha256")
    .update(
      JSON.stringify([
        "proboxai.telegram.turn.v1",
        actorId,
        chatId.toString(),
        updateId,
      ]),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
