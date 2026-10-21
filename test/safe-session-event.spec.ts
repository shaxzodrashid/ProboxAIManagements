import {
  safeRunnerEvent,
  eventResponse,
  record,
} from "../src/sessions/safe-session-event";

describe("bounded persisted session projection", () => {
  const project = (type: string, payload: Record<string, unknown>) =>
    safeRunnerEvent({ type, payload, rawLine: "raw secret" });
  const command = (fields: Record<string, unknown>, type = "item.completed") =>
    project(type, {
      item: {
        id: "cmd_1",
        type: "command_execution",
        status: "completed",
        ...fields,
      },
    });
  it("publishes only the fixed label and terminal metadata while withholding all output", () => {
    expect(
      command({
        command: "pnpm test",
        exit_code: 1,
        aggregated_output: "password=private",
        cwd: "private",
      }).payload,
    ).toMatchObject({
      projectionVersion: 3,
      commandDetails: {
        policy: "STRICT_ALLOWLIST_V1",
        provisional: true,
        commandLabel: "pnpm test",
        commandState: "ALLOWLISTED",
        exitCode: 1,
        outputState: "OMITTED",
        runCompletion: "USE_SERVER_STATE",
      },
    });
    expect(
      JSON.stringify(
        command({
          command: "pnpm test",
          aggregated_output: "password=private",
          cwd: "private",
        }),
      ),
    ).not.toContain("private");
    expect(
      command({ command: "pnpm test", aggregated_output: "" }).payload,
    ).toMatchObject({ commandDetails: { outputState: "OMITTED" } });
  });
  it.each([
    "pnpm test --token=secret",
    "pnpm test; echo secret",
    "pnpm test\n",
    " pnpm test",
    "powershell -Command 'pnpm test'",
    "pnpm\u001b test",
  ])("does not infer safety from command %j", (value) => {
    expect(command({ command: value }).payload).toMatchObject({
      commandDetails: { commandLabel: null, commandState: "OMITTED" },
    });
    expect(JSON.stringify(command({ command: value }))).not.toContain(value);
  });
  it.each([null, "0", 0.1, 2147483648, -2147483649, NaN, Infinity])(
    "rejects malformed exit code %j",
    (exit_code) => {
      expect(command({ exit_code }).payload).toMatchObject({
        commandDetails: { exitCode: null },
      });
    },
  );
  it.each(["item.started", "item.updated"])(
    "does not infer terminal success from %s",
    (type) => {
      expect(
        command({ command: "pnpm test", exit_code: 0 }, type).payload,
      ).toMatchObject({ commandDetails: { exitCode: null } });
    },
  );
  it("withholds exit codes for declined or missing provider statuses", () => {
    for (const status of ["declined", undefined, "unknown", "in_progress"])
      expect(command({ status, exit_code: 0 }).payload).toMatchObject({
        commandDetails: { exitCode: null },
      });
  });
  it("revalidates persisted command details and never upgrades historical raw tools", () => {
    const base = {
      id: "e",
      sessionId: "s",
      turnId: "t",
      sequence: 1,
      type: "item.completed",
      createdAt: new Date(),
    };
    const payload = command({ command: "pnpm test", exit_code: 0 }).payload;
    const replay = eventResponse({
      ...base,
      projectionVersion: 3,
      rawPayload: { ...payload, private: "secret" },
    } as any);
    expect(replay.data).toEqual(payload);
    expect(replay.legacyProjection).toBe(false);
    const poisoned = {
      ...payload,
      commandDetails: {
        ...record(record(payload).commandDetails),
        commandLabel: "private command",
        exitCode: "0",
        output: "private output",
      },
    };
    expect(
      JSON.stringify(
        eventResponse({
          ...base,
          projectionVersion: 3,
          rawPayload: poisoned,
        } as any),
      ),
    ).not.toContain("private");
    for (const projectionVersion of [0, 1, 99]) {
      const old = eventResponse({
        ...base,
        projectionVersion,
        rawPayload: {
          ...payload,
          item: {
            id: "cmd_1",
            type: "command_execution",
            status: "completed",
            command: "pnpm test",
            exit_code: 0,
          },
        },
      } as any);
      expect(old.data.commandDetails).toBeUndefined();
      expect(JSON.stringify(old)).not.toContain("pnpm test");
    }
  });
  it("omits a fixed label if it matches a configured secret, including on replay", () => {
    const projected = command({ command: "pnpm test" }).payload;
    process.env.SESSION_TEST_SECRET = "pnpm test";
    try {
      expect(command({ command: "pnpm test" }).payload).toMatchObject({
        commandDetails: { commandLabel: null },
      });
      expect(
        eventResponse({
          id: "e",
          type: "item.completed",
          projectionVersion: 3,
          rawPayload: projected,
        } as any).data,
      ).toMatchObject({ commandDetails: { commandLabel: null } });
    } finally {
      delete process.env.SESSION_TEST_SECRET;
    }
  });
  it("does not trust new-version raw fields, missing statuses or mismatched tool types", () => {
    const raw = {
      item: { id: "cmd_1", type: "command_execution" },
      commandDetails: {
        policy: "STRICT_ALLOWLIST_V1",
        provisional: true,
        commandLabel: "pnpm test",
        exitCode: 0,
        output: "private",
      },
      command: "private",
    };
    const replay = (rawPayload: unknown, type = "item.completed") =>
      eventResponse({ id: "e", type, projectionVersion: 3, rawPayload } as any);
    expect(replay(raw).data).toMatchObject({
      commandDetails: { exitCode: null },
    });
    expect(JSON.stringify(replay(raw))).not.toContain("private");
    const mismatched = replay({
      ...raw,
      item: { type: "file_change", changes: "private" },
    });
    expect(mismatched.data.commandDetails).toBeUndefined();
    expect(JSON.stringify(mismatched)).not.toContain("private");
    expect(replay(raw, "session.state")).toMatchObject({
      type: "runner.omitted",
      source: "RUNNER",
      data: { omissionReason: "UNSUPPORTED_EVENT" },
    });
  });
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
