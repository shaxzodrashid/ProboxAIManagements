import {
  safeRunnerEvent,
  eventResponse,
} from "../src/sessions/safe-session-event";

describe("bounded persisted session projection", () => {
  const project = (type: string, payload: Record<string, unknown>) =>
    safeRunnerEvent({ type, payload, rawLine: "raw secret" });
  it("bounds assistant text and omits untrusted identifiers and unknown fields", () => {
    const p = project("item.completed", {
      item: {
        id: "C:/private/id",
        type: "agent_message",
        text: "a".repeat(20000),
        reasoning: "private",
        secret: "raw",
      },
    });
    expect(p.payload).toMatchObject({
      truncated: true,
      item: { id: null, text: "a".repeat(16384) },
    });
    expect(JSON.stringify(p)).not.toMatch(/private|secret|raw/);
  });
  it("redacts known environment secret values in assistant content", () => {
    process.env.SESSION_TEST_SECRET = "session-test-secret-value";
    try {
      expect(
        project("item.completed", {
          item: {
            id: "session-test-secret-value",
            type: "agent_message",
            text: "value session-test-secret-value",
          },
        }).payload,
      ).toMatchObject({ item: { id: null, text: "value [REDACTED]" } });
    } finally {
      delete process.env.SESSION_TEST_SECRET;
    }
  });
  it.each([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "collab_tool_call",
    "web_search",
  ])("excludes private %s details", (type) => {
    const p = project("item.completed", {
      item: {
        id: "valid_id",
        type,
        command: "private",
        arguments: { secret: "private" },
        output: "private",
        status: "completed",
      },
    });
    expect(p.payload).toMatchObject({
      omitted: true,
      omissionReason: "TOOL_DETAILS_EXCLUDED",
      item: { id: "valid_id", type, status: "completed" },
    });
    expect(JSON.stringify(p)).not.toContain("private");
  });
  it.each(["reasoning", "unknown"])("does not expose %s items", (type) => {
    expect(
      project("item.completed", { item: { type, text: "hidden" } }),
    ).toMatchObject({ type: "runner.omitted", payload: { omitted: true } });
  });
  it("cannot forge authoritative state with a runner event", () => {
    expect(
      project("session.state", {
        authoritative: true,
        sessionStatus: "COMPLETED",
      }),
    ).toMatchObject({ type: "runner.omitted" });
  });
  it("retains legacy sequence and attribution while projecting unknown payloads", () => {
    const e = eventResponse({
      id: "e",
      sessionId: "s",
      turnId: "t",
      sequence: 1,
      type: "session.state",
      rawPayload: { private: "hidden" },
      projectionVersion: 0,
      createdAt: new Date(),
    } as any);
    expect(e).toMatchObject({
      id: "e",
      sequence: 1,
      turnId: "t",
      legacyProjection: true,
      source: "RUNNER",
      type: "runner.omitted",
    });
  });
});
