import {
  safeRunnerEvent,
  eventResponse,
} from "../src/sessions/safe-session-event";
import {
  archiveRunnerEvent,
  archiveHash,
} from "../src/sessions/session-history";

const project = (item: Record<string, unknown>, type = "item.completed") =>
  safeRunnerEvent({ type, payload: { item }, rawLine: "" });
const replay = (payload: unknown) =>
  eventResponse({
    id: "event",
    sessionId: "session",
    turnId: "turn",
    sequence: 1,
    createdAt: new Date(),
    type: "item.completed",
    projectionVersion: 4,
    rawPayload: payload,
  } as never);

describe("authorized tool detail snapshots", () => {
  it("retains exact commands, read specifications and output across replay without raw passthrough", () => {
    const item = {
      id: "cmd",
      type: "command_execution",
      status: "completed",
      command: "cat src/app.ts",
      commandActions: [{ type: "read", path: "src/app.ts" }],
      aggregated_output: "export const answer = 42;",
      exit_code: 0,
      cwd: "/workspace",
      privateUnknown: "hidden",
    };
    const data = project(item).payload;
    expect(data).toMatchObject({
      projectionVersion: 4,
      toolDetails: {
        label: item.command,
        input: { command: item.command, actions: item.commandActions },
        output: item.aggregated_output,
        exitCode: 0,
      },
    });
    expect(replay(data).data).toEqual(data);
    expect(JSON.stringify(data)).not.toContain("privateUnknown");
  });
  it("redacts nested MCP credentials and renders only inline raster image previews", () => {
    const data = project({
      id: "mcp",
      type: "mcp_tool_call",
      server: "files",
      tool: "read",
      status: "completed",
      arguments: { path: "a.png", api_key: "hide-me" },
      result: {
        content: [
          { type: "text", text: "password=hide-me" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
        ],
      },
    }).payload;
    expect(JSON.stringify(data)).not.toContain("hide-me");
    expect(data).toMatchObject({
      toolDetails: {
        input: { path: "a.png", api_key: "[REDACTED]" },
        images: [{ src: "data:image/png;base64,aGVsbG8=" }],
      },
    });
    expect(replay(data).data).toEqual(data);
  });
  it("preserves per-file diffs and explicitly marks oversized content", () => {
    const data = project({
      id: "patch",
      type: "file_change",
      changes: [{ path: "a.ts", kind: { type: "update" }, diff: "-old\n+new" }],
      aggregated_output: "a".repeat(70000),
    }).payload;
    expect(data).toMatchObject({
      toolDetails: {
        truncated: true,
        changes: [{ path: "a.ts", diff: "-old\n+new" }],
      },
    });
  });
  it("recovers only verified historical archives, keeping missing/tampered archives unavailable", () => {
    const archived = archiveRunnerEvent({
      type: "item.completed",
      payload: {
        item: {
          id: "cmd",
          type: "command_execution",
          status: "completed",
          command: "uname -a",
          aggregated_output: "fixture Linux",
        },
      },
      rawLine: "",
    });
    const base = {
      id: "event",
      sessionId: "session",
      turnId: "turn",
      sequence: 1,
      createdAt: new Date(),
      type: "item.completed",
      projectionVersion: 1,
      rawPayload: {
        item: { id: "cmd", type: "command_execution", status: "completed" },
      },
      archivePayload: archived,
      archiveHash: archiveHash(archived),
      archivePolicyVersion: 1,
    };
    expect(eventResponse(base as never).data).toMatchObject({
      toolDetails: { label: "uname -a", output: "fixture Linux" },
    });
    expect(
      eventResponse({ ...base, archiveHash: "tampered" } as never).data
        .toolDetails,
    ).toBeUndefined();
    expect(
      eventResponse({ ...base, archivePayload: null } as never).data
        .toolDetails,
    ).toBeUndefined();
  });
  it("uses revisioned assistant snapshots for live deltas without claiming turn completion", () => {
    const data = safeRunnerEvent({
      type: "item.updated",
      rawLine: "",
      payload: {
        snapshot: true,
        item: { id: "answer", type: "agent_message", text: "partial" },
      },
    });
    const event = eventResponse({
      id: "e",
      sessionId: "s",
      turnId: "t",
      sequence: 4,
      createdAt: new Date(),
      type: data.type,
      projectionVersion: 4,
      rawPayload: data.payload,
    } as never);
    expect(event.data).toMatchObject({
      item: { text: "partial" },
      textUpdate: {
        mode: "SNAPSHOT",
        continuation: "IN_PROGRESS",
        revision: 4,
        runCompletion: "USE_SERVER_STATE",
      },
    });
  });
});
