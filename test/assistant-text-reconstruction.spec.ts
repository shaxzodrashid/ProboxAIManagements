import { AssistantTextReconstruction } from "../src/sessions/assistant-text-reconstruction";
import {
  eventResponse,
  safeRunnerEvent,
} from "../src/sessions/safe-session-event";

const frame = (
  sequence: number,
  text: string,
  options: {
    turnId?: string | null;
    itemId?: string | null;
    version?: number;
    type?: string;
    sessionId?: string;
  } = {},
) => {
  const type = options.type ?? "item.completed";
  const payload = {
    item: {
      id: options.itemId === undefined ? "item_1" : options.itemId,
      type: "agent_message",
      text,
    },
  };
  const projected = safeRunnerEvent({ type, payload, rawLine: "private" });
  const version = options.version ?? 2;
  return eventResponse({
    id: "event_" + sequence,
    sessionId: options.sessionId ?? "session",
    turnId: options.turnId === undefined ? "turn" : options.turnId,
    sequence,
    type: version === 2 ? projected.type : type,
    rawPayload: version === 2 ? projected.payload : payload,
    projectionVersion: version,
    createdAt: new Date(0),
  } as any);
};

describe("SESSION09 snapshot reconstruction", () => {
  it("replaces, deduplicates and ignores old revisions across reordered replay", () => {
    const ordered = new AssistantTextReconstruction("session");
    const reordered = new AssistantTextReconstruction("session");
    const events = [frame(1, "old"), frame(2, "new"), frame(3, "final")];
    events.forEach((e) => ordered.apply(e));
    [events[2]!, events[0]!, events[2]!, events[1]!, events[0]!].forEach((e) =>
      reordered.apply(e),
    );
    expect([...reordered.messages.values()]).toEqual([
      ...ordered.messages.values(),
    ]);
    expect([...reordered.messages.values()]).toMatchObject([
      { text: "final", phase: "ITEM_COMPLETED" },
    ]);
    expect(reordered.after).toBe(3);
    expect(reordered.needsReplay).toBe(false);
  });
  it("scopes reused item IDs to turns and null identities to distinct events", () => {
    const state = new AssistantTextReconstruction("session");
    [
      frame(1, "one"),
      frame(2, "two", { turnId: "other" }),
      frame(3, "no item", { itemId: null }),
      frame(4, "no item again", { itemId: null }),
      frame(5, "no turn", { turnId: null }),
    ].forEach((e) => state.apply(e));
    state.apply(frame(6, "foreign", { sessionId: "foreign" }));
    expect(state.messages.size).toBe(5);
    expect(state.after).toBe(5);
  });
  it("presents distinct messages in first-sequence order after reordered delivery and later replacement", () => {
    const events = [
      frame(1, "A", { itemId: "A" }),
      frame(2, "B", { itemId: "B" }),
      frame(3, "C", { itemId: "C" }),
      frame(4, "A replaced", { itemId: "A" }),
    ];
    const ordered = new AssistantTextReconstruction("session");
    const shuffled = new AssistantTextReconstruction("session");
    events.forEach((e) => ordered.apply(e));
    [events[3]!, events[2]!, events[0]!, events[1]!].forEach((e) =>
      shuffled.apply(e),
    );
    expect([...shuffled.messages.values()]).toEqual([
      ...ordered.messages.values(),
    ]);
    expect([...shuffled.messages.values()].map((m) => m.text)).toEqual([
      "A replaced",
      "B",
      "C",
    ]);
    expect(shuffled.needsReplay).toBe(false);
  });
  it("reconnect replay keeps existing messages and marks a missing sequence until recovered", () => {
    const state = new AssistantTextReconstruction("session");
    state.apply(frame(1, "first"));
    state.apply(frame(3, "last"));
    expect(state.after).toBe(1);
    expect(state.needsReplay).toBe(true);
    state.apply(frame(1, "first"));
    state.apply(frame(2, "middle"));
    state.apply(frame(3, "last"));
    expect(state.after).toBe(3);
    expect(state.needsReplay).toBe(false);
    expect([...state.messages.values()][0]!.text).toBe("last");
  });
  it.each([0, 1])(
    "keeps historical v%s started/updated/completed text provisional and never appends",
    (version) => {
      const state = new AssistantTextReconstruction("session");
      ["item.started", "item.updated", "item.completed"].forEach((type, i) =>
        state.apply(frame(i + 1, "legacy " + i, { type, version })),
      );
      expect([...state.messages.values()]).toMatchObject([
        { text: "legacy 2", phase: "PROVISIONAL", continuation: "UNKNOWN" },
      ]);
    },
  );
  it("does not infer partial or delta semantics for unsupported live assistant events", () => {
    for (const type of [
      "item.started",
      "item.updated",
      "response.output_text.delta",
    ]) {
      const event = safeRunnerEvent({
        type,
        payload: {
          item: {
            id: "item_1",
            type: "agent_message",
            text: "private fragment",
          },
          delta: "private fragment",
        },
        rawLine: "private",
      });
      expect(event).toMatchObject({
        type: "runner.omitted",
        payload: { omissionReason: "UNSUPPORTED_EVENT" },
      });
      expect(JSON.stringify(event)).not.toContain("fragment");
    }
  });
  it("keeps truncation and item completion distinct from run success", () => {
    const e = frame(1, "a".repeat(20000));
    expect(e.data).toMatchObject({
      truncated: true,
      textUpdate: {
        mode: "SNAPSHOT",
        continuation: "TRUNCATED",
        runCompletion: "USE_SERVER_STATE",
      },
    });
    const state = new AssistantTextReconstruction("session");
    state.apply(e);
    expect([...state.messages.values()][0]!.text).toHaveLength(16384);
    expect([...state.messages.values()][0]!.continuation).toBe("TRUNCATED");
    expect(state).not.toHaveProperty("runCompleted");
  });
  it("bounds unresolved reorder tracking and requests a rebuild on overflow", () => {
    const state = new AssistantTextReconstruction("session");
    for (let i = 2; i <= 103; i++) state.apply(frame(i, "answer"));
    expect(state.requiresRebuild).toBe(true);
    expect(state.needsReplay).toBe(true);
    expect(state.after).toBe(0);
  });
  it("does not complete a provisional message when its continuation is missing and server run state completes", () => {
    const state = new AssistantTextReconstruction("session");
    state.apply(frame(1, "partial", { version: 1, type: "item.updated" }));
    state.apply(
      eventResponse({
        id: "state",
        sessionId: "session",
        turnId: "turn",
        sequence: 2,
        type: "session.state",
        projectionVersion: 1,
        rawPayload: { authoritative: true, sessionStatus: "COMPLETED" },
        createdAt: new Date(0),
      } as any),
    );
    expect([...state.messages.values()]).toMatchObject([
      { text: "partial", phase: "PROVISIONAL", continuation: "UNKNOWN" },
    ]);
    expect(state.needsReplay).toBe(false);
  });
});
