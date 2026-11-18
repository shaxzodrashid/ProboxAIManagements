import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { backendReleaseVersion } from "../release-version";
import type { RunnerEvent, RunnerOptions } from "./proboxai-runner.service";

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const types: Record<string, string> = {
  agentMessage: "agent_message",
  commandExecution: "command_execution",
  fileChange: "file_change",
  mcpToolCall: "mcp_tool_call",
  imageView: "image_view",
  collabAgentToolCall: "collab_tool_call",
  webSearch: "web_search",
};

/** One app-server process per managed turn. Durable callbacks apply backpressure.
 * The wire protocol uses snapshots at the public boundary, never appendable deltas.
 */
export async function runAppServerSession(
  child: ChildProcessWithoutNullStreams,
  options: RunnerOptions,
  onEvent: (event: RunnerEvent) => Promise<void>,
  prepareItem: (
    item: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Promise<number> {
  let requestId = 0,
    threadId = "",
    turnId = "",
    exitCode: number | null = null;
  let usage: Record<string, unknown> = {};
  const pending = new Map<
    number,
    {
      resolve(v: Record<string, unknown>): void;
      reject(e: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  const items = new Map<string, Record<string, unknown>>();
  const failPending = (error: Error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  const inputError = (error: Error) => {
    failPending(error);
    child.kill();
  };
  child.stdin.on("error", inputError);
  child.on("error", inputError);
  const dirty = new Set<string>();
  let lastFlush = 0;
  const write = (value: unknown) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const request = (
    method: string,
    params: unknown,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Runner ${method} timed out`));
        child.kill();
      }, 60000);
      pending.set(id, { resolve, reject, timer });
      write({ id, method, params });
    });
  const emit = async (type: string, payload: Record<string, unknown>) =>
    onEvent({ type, payload, rawLine: "" });
  const flush = async () => {
    for (const id of dirty) {
      const item = items.get(id);
      if (item) await emit("item.updated", { item, snapshot: true });
    }
    dirty.clear();
    lastFlush = Date.now();
  };
  const normalize = (raw: Record<string, unknown>) => ({
    ...raw,
    type: types[String(raw.type)],
    aggregated_output: raw.aggregatedOutput,
    exit_code: raw.exitCode,
    status: raw.status === "inProgress" ? "in_progress" : raw.status,
  });
  const handle = async (message: Record<string, unknown>) => {
    if (typeof message.id === "number" && !message.method) {
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error)
          waiter.reject(
            new Error(
              String(record(message.error).message ?? "Runner request failed"),
            ),
          );
        else waiter.resolve(record(message.result));
      }
      return;
    }
    const method = String(message.method),
      p = record(message.params);
    // Noninteractive managed runs never grant new approvals or answer elicitation.
    if (message.id !== undefined) {
      write({
        id: message.id,
        error: {
          code: -32601,
          message: "Interactive requests are unavailable in managed sessions",
        },
      });
      await emit("runner.error", {
        message: "Runner requested unsupported interactive input",
        method,
      });
      return;
    }
    if (p.threadId && p.threadId !== threadId) return;
    if (p.turnId && turnId && p.turnId !== turnId) return;
    if (method === "turn/started") {
      turnId = String(record(p.turn).id ?? "");
      await emit("turn.started", {});
    } else if (method === "item/started" || method === "item/completed") {
      const raw = record(p.item);
      if (!types[String(raw.type)] || typeof raw.id !== "string") return;
      const item = await prepareItem(normalize(raw));
      if (method === "item/completed") {
        // Some providers omit final aggregate text; retain the streamed snapshot.
        const old = items.get(raw.id);
        if (item.aggregated_output == null && old?.aggregated_output != null)
          item.aggregated_output = old.aggregated_output;
        if (item.type === "agent_message" && !item.text && old?.text)
          item.text = old.text;
      }
      items.set(raw.id, item);
      dirty.delete(raw.id);
      await emit(
        method === "item/started" ? "item.started" : "item.completed",
        { item, snapshot: true },
      );
      if (method === "item/completed") items.delete(raw.id);
    } else if (
      [
        "item/agentMessage/delta",
        "item/commandExecution/outputDelta",
        "item/fileChange/outputDelta",
      ].includes(method)
    ) {
      if (typeof p.itemId !== "string" || typeof p.delta !== "string") return;
      let item = items.get(p.itemId);
      if (!item && method === "item/agentMessage/delta") {
        item = { id: p.itemId, type: "agent_message", text: "" };
        items.set(p.itemId, item);
      }
      if (!item) return;
      const field =
        method === "item/agentMessage/delta" ? "text" : "aggregated_output";
      item[field] = (String(item[field] ?? "") + p.delta).slice(0, 1024 * 1024);
      dirty.add(p.itemId);
      // Coalesce only replaceable display snapshots; lifecycle events stay ordered.
      if (Date.now() - lastFlush >= 50) await flush();
    } else if (method === "thread/tokenUsage/updated") {
      usage = record(record(p.tokenUsage).total);
    } else if (method === "item/mcpToolCall/progress") {
      const item =
        typeof p.itemId === "string" ? items.get(p.itemId) : undefined;
      if (item && typeof p.message === "string") {
        item.progress = p.message.slice(0, 65536);
        await emit("item.updated", { item, snapshot: true });
      }
    } else if (method === "error") {
      await emit("runner.error", { message: record(p.error).message });
    } else if (method === "turn/completed") {
      await flush();
      const turn = record(p.turn);
      exitCode = turn.status === "completed" ? 0 : 1;
      await emit(exitCode === 0 ? "turn.completed" : "turn.failed", {
        error: turn.error,
        usage: {
          input_tokens: usage.inputTokens,
          cached_input_tokens: usage.cachedInputTokens,
          output_tokens: usage.outputTokens,
          reasoning_output_tokens: usage.reasoningOutputTokens,
        },
      });
      child.stdin.end();
    }
  };
  const consume = (async () => {
    const decoder = new StringDecoder("utf8");
    let remainder = "";
    for await (const chunk of child.stdout) {
      remainder += decoder.write(chunk);
      if (remainder.length > 16 * 1024 * 1024)
        throw new Error("Runner frame exceeds delivery limit");
      let newline: number;
      while ((newline = remainder.indexOf("\n")) >= 0) {
        const line = remainder.slice(0, newline).trim();
        remainder = remainder.slice(newline + 1);
        if (line) await handle(record(JSON.parse(line)));
      }
    }
    remainder += decoder.end();
    if (remainder.trim()) await handle(record(JSON.parse(remainder)));
    if (exitCode === null)
      throw new Error("Runner closed without a terminal turn event");
    return exitCode;
  })();
  // Attach failure handling before waiting for handshake replies.
  void consume.catch((error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error as Error);
    }
    pending.clear();
    child.kill();
  });
  try {
    await request("initialize", {
      clientInfo: { name: "proboxai", version: backendReleaseVersion },
      capabilities: { experimentalApi: false },
    });
    write({ method: "initialized", params: {} });
    const started = await request(
      options.threadId ? "thread/resume" : "thread/start",
      {
        ...(options.threadId ? { threadId: options.threadId } : {}),
        model: options.model,
        modelProvider: options.providerId,
        cwd: options.cwd,
        sandbox: options.sandbox,
        approvalPolicy: "never",
      },
    );
    threadId = String(record(started.thread).id ?? "");
    if (!threadId) throw new Error("Runner did not return a thread identity");
    await emit("thread.started", { thread_id: threadId });
    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: options.prompt, text_elements: [] }],
      cwd: options.cwd,
      model: options.model,
      effort: options.reasoningEffort,
      approvalPolicy: "never",
    });
    return await consume;
  } finally {
    child.stdin.off("error", inputError);
    child.off("error", inputError);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Runner session closed"));
    }
    pending.clear();
    if (exitCode === null) child.kill();
  }
}
