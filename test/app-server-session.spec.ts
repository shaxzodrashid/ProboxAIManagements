import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runAppServerSession } from "../src/sessions/app-server-session";
import type { RunnerEvent } from "../src/sessions/proboxai-runner.service";

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  const requests: Record<string, any>[] = [];
  const send = (v: unknown) =>
    !child.stdout.writableEnded && child.stdout.write(JSON.stringify(v) + "\n");
  child.stdin.on("data", (chunk: Buffer) => {
    const message = JSON.parse(chunk.toString()) as Record<string, any>;
    requests.push(message);
    if (!message.id) return;
    queueMicrotask(() =>
      send({
        id: message.id,
        result: message.method.startsWith("thread/")
          ? { thread: { id: "thread" } }
          : {},
      }),
    );
  });
  child.stdin.on("finish", () => child.stdout.end());
  return {
    child,
    requests,
    send,
    notify: (method: string, params: unknown) => send({ method, params }),
  };
}
const options = {
  sessionId: "s",
  cwd: "/workspace",
  sandbox: "read-only" as const,
  prompt: "fixture",
  providerId: "openai",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("managed app-server streaming", () => {
  it("delivers output before command completion, then replays complete file/MCP/image events", async () => {
    const f = fixture(),
      events: RunnerEvent[] = [];
    const running = runAppServerSession(
      f.child as never,
      options,
      async (e) => {
        events.push(structuredClone(e));
      },
      async (item) => item,
    );
    while (!f.requests.some((r) => r.method === "turn/start")) await tick();
    f.notify("turn/started", { threadId: "thread", turn: { id: "turn" } });
    f.notify("item/started", {
      threadId: "thread",
      turnId: "turn",
      item: {
        type: "commandExecution",
        id: "cmd",
        command: "echo fixture",
        status: "inProgress",
        aggregatedOutput: null,
      },
    });
    f.notify("item/commandExecution/outputDelta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "cmd",
      delta: "first line\n",
    });
    while (!events.some((e) => e.type === "item.updated")) await tick();
    expect(events.at(-1)?.payload.item).toMatchObject({
      id: "cmd",
      aggregated_output: "first line\n",
      status: "in_progress",
    });
    expect(events.some((e) => e.type === "item.completed")).toBe(false);
    f.notify("item/started", {
      threadId: "thread",
      item: {
        type: "mcpToolCall",
        id: "mcp",
        server: "files",
        tool: "read",
        arguments: { path: "a.ts" },
        status: "inProgress",
      },
    });
    f.notify("item/mcpToolCall/progress", {
      threadId: "thread",
      itemId: "mcp",
      message: "Reading file",
    });
    f.notify("item/commandExecution/outputDelta", {
      threadId: "other-thread",
      itemId: "cmd",
      delta: "wrong thread",
    });
    f.notify("item/completed", {
      threadId: "thread",
      item: {
        type: "commandExecution",
        id: "cmd",
        command: "echo fixture",
        status: "completed",
        aggregatedOutput: null,
        exitCode: 0,
      },
    });
    for (const item of [
      {
        type: "fileChange",
        id: "patch",
        changes: [
          { path: "a.ts", kind: { type: "update" }, diff: "-old\n+new" },
        ],
        status: "completed",
      },
      {
        type: "mcpToolCall",
        id: "mcp",
        tool: "read",
        arguments: { path: "a.ts" },
        result: { content: [{ type: "text", text: "new" }] },
        status: "completed",
      },
      { type: "imageView", id: "image", path: "/workspace/a.png" },
    ])
      f.notify("item/completed", { threadId: "thread", item });
    f.notify("turn/completed", {
      threadId: "thread",
      turn: { id: "turn", status: "completed" },
    });
    await expect(running).resolves.toBe(0);
    expect(
      events
        .filter((e) => e.type === "item.completed")
        .map((e) => (e.payload.item as any).type),
    ).toEqual([
      "command_execution",
      "file_change",
      "mcp_tool_call",
      "image_view",
    ]);
    expect(JSON.stringify(events)).not.toContain("wrong thread");
    expect(
      events.some((e) => (e.payload.item as any)?.progress === "Reading file"),
    ).toBe(true);
    expect(
      f.requests.find((r) => r.method === "thread/start")?.params,
    ).toMatchObject({ sandbox: "read-only", approvalPolicy: "never" });
  });
  it("does not turn unexpected EOF into successful completion", async () => {
    const f = fixture();
    const running = runAppServerSession(
      f.child as never,
      options,
      async () => {},
      async (item) => item,
    );
    f.child.stdout.end();
    await expect(running).rejects.toThrow("terminal turn event");
    expect(f.child.kill).toHaveBeenCalled();
  });
  it("rejects a broken startup pipe without leaving an unhandled stream error", async () => {
    const f = fixture();
    const running = runAppServerSession(
      f.child as never,
      options,
      async () => {},
      async (item) => item,
    );
    f.child.stdin.emit("error", new Error("fixture broken pipe"));
    f.child.stdout.end();
    await expect(running).rejects.toThrow("fixture broken pipe");
  });
});
