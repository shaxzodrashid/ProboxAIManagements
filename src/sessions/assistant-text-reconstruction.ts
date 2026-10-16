import { eventResponse, record } from "./safe-session-event";

export interface AssistantTextMessage {
  identity: Record<string, unknown>;
  revision: number;
  firstSequence: number;
  text: string;
  phase: "ITEM_COMPLETED" | "PROVISIONAL";
  continuation: "ITEM_COMPLETE" | "TRUNCATED" | "UNKNOWN";
}

/** Reference consumer for authorized REST/SSE envelopes. Never concatenate frames.
 * Keep this instance on reconnect, or replay from zero to rebuild all messages.
 * A gap requires REST replay after `after`; overflow requires a fresh rebuild.
 */
export class AssistantTextReconstruction {
  private readonly frames = new Map<string, AssistantTextMessage>();
  private readonly pending = new Set<number>();
  private overflow = false;
  after = 0;

  constructor(readonly sessionId: string) {}

  get messages(): ReadonlyMap<string, AssistantTextMessage> {
    return new Map(
      [...this.frames.entries()].sort(
        (a, b) => a[1].firstSequence - b[1].firstSequence,
      ),
    );
  }

  get needsReplay() {
    return this.overflow || this.pending.size > 0;
  }

  get requiresRebuild() {
    return this.overflow;
  }

  apply(event: ReturnType<typeof eventResponse>) {
    if (
      event.sessionId !== this.sessionId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1 ||
      this.overflow
    )
      return;
    if (event.sequence > this.after) {
      this.pending.add(event.sequence);
      while (this.pending.delete(this.after + 1)) this.after++;
      if (this.pending.size > 100) {
        this.pending.clear();
        this.overflow = true;
        return;
      }
    }
    const data = record(event.data);
    const update = record(data.textUpdate);
    const identity = record(update.identity);
    const item = record(data.item);
    if (
      update.version !== 1 ||
      !["SNAPSHOT", "UNVERIFIED_FRAME"].includes(String(update.mode)) ||
      identity.sessionId !== this.sessionId ||
      identity.turnId !== event.turnId ||
      update.revision !== event.sequence ||
      item.type !== "agent_message" ||
      typeof item.text !== "string"
    )
      return;
    const key = JSON.stringify([
      this.sessionId,
      identity.eventId ? "EVENT" : "ITEM",
      identity.eventId ?? identity.turnId,
      identity.eventId ? null : identity.itemId,
    ]);
    const previous = this.frames.get(key);
    const firstSequence = Math.min(
      previous?.firstSequence ?? event.sequence,
      event.sequence,
    );
    if (previous && previous.revision >= event.sequence) {
      previous.firstSequence = firstSequence;
      return;
    }
    this.frames.set(key, {
      identity,
      revision: event.sequence,
      firstSequence,
      text: item.text,
      phase:
        update.phase === "ITEM_COMPLETED" ? "ITEM_COMPLETED" : "PROVISIONAL",
      continuation:
        update.continuation === "TRUNCATED"
          ? "TRUNCATED"
          : update.continuation === "ITEM_COMPLETE"
            ? "ITEM_COMPLETE"
            : "UNKNOWN",
    });
  }
}
