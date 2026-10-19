import { SessionEvent } from "@prisma/client";
import { RunnerEvent } from "./proboxai-runner.service";
import { commandDisclosure } from "./command-disclosure";

export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const toolTypes = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "collab_tool_call",
  "web_search",
]);
const statuses = new Set(["in_progress", "completed", "failed", "declined"]);
function boundedText(value: string) {
  let redacted = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (
      /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/.test(key) &&
      secret &&
      secret.length >= 8
    )
      redacted = redacted.split(secret).join("[REDACTED]");
  }
  return { text: redacted.slice(0, 16384), truncated: redacted.length > 16384 };
}
/** Content projection, not an exhaustive secret detector. Raw tool details and reasoning are excluded. */
export function safeRunnerEvent(event: RunnerEvent) {
  const item = record(event.payload.item);
  if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
    const candidate =
      typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(item.id)
        ? item.id
        : null;
    const id =
      candidate && boundedText(candidate).text === candidate ? candidate : null;
    // codex exec 0.162.1 emits assistant text only as completed, full items.
    // Do not treat a future/alternate provider's partial event as a known snapshot.
    if (
      event.type === "item.completed" &&
      item.type === "agent_message" &&
      typeof item.text === "string"
    ) {
      const projected = boundedText(item.text);
      return {
        type: event.type,
        payload: {
          projectionVersion: 2,
          item: { id, type: "agent_message", text: projected.text },
          truncated: projected.truncated,
        },
      };
    }
    if (toolTypes.has(String(item.type)))
      return {
        type: event.type,
        payload: {
          projectionVersion: item.type === "command_execution" ? 3 : 1,
          item: {
            id,
            type: String(item.type),
            status: statuses.has(String(item.status))
              ? String(item.status)
              : event.type === "item.completed"
                ? "completed"
                : "in_progress",
          },
          omitted: true,
          omissionReason: "TOOL_DETAILS_EXCLUDED",
          ...(item.type === "command_execution"
            ? { commandDetails: commandDisclosure(event.type, item) }
            : {}),
        },
      };
  }
  if (
    [
      "turn.started",
      "turn.completed",
      "turn.failed",
      "runner.error",
      "error",
      "thread.started",
    ].includes(event.type)
  )
    return {
      type: event.type,
      payload: {
        projectionVersion: 1,
        authoritative: false,
        omitted: true,
        omissionReason: "RUNNER_DETAILS_EXCLUDED",
      },
    };
  return {
    type: "runner.omitted",
    payload: {
      projectionVersion: 1,
      omitted: true,
      omissionReason: "UNSUPPORTED_EVENT",
    },
  };
}
export function eventResponse(e: SessionEvent) {
  const legacy = ![1, 2, 3].includes(e.projectionVersion);
  // Historical partial text has no verified update semantics. Preserve its
  // bounded display frame without upgrading it to a completed snapshot.
  const historicalItem = record(record(e.rawPayload).item);
  const historicalText =
    e.projectionVersion !== 2 &&
    ["item.started", "item.updated", "item.completed"].includes(e.type) &&
    historicalItem.type === "agent_message" &&
    typeof historicalItem.text === "string";
  const projected =
    legacy ||
    e.projectionVersion === 3 ||
    toolTypes.has(String(historicalItem.type))
      ? safeRunnerEvent({
          type: e.type,
          payload: record(e.rawPayload),
          rawLine: "",
        })
      : { type: e.type, payload: e.rawPayload };
  const item = record(record(projected.payload).item);
  let data = record(projected.payload);
  if (
    historicalItem.type === "command_execution" &&
    ["item.started", "item.updated", "item.completed"].includes(e.type)
  ) {
    // Rebuild the public envelope on every read. Historical raw commands never
    // acquire new disclosure rights; v3 can only retain its stored safe subset.
    const safe = safeRunnerEvent({
      type: e.type,
      payload: {
        item: {
          id: historicalItem.id,
          type: historicalItem.type,
          status: historicalItem.status,
        },
      },
      rawLine: "",
    });
    data = record(safe.payload);
    if (e.projectionVersion === 3) {
      data.commandDetails = commandDisclosure(
        e.type,
        {
          ...record(data.item),
          status: historicalItem.status,
          commandDetails: record(e.rawPayload).commandDetails,
        },
        true,
      );
    } else {
      delete data.commandDetails;
      data.projectionVersion = 1;
    }
  }
  if (historicalText || item.type === "agent_message") {
    const safe = safeRunnerEvent({
      type: "item.completed",
      payload: { item: historicalText ? historicalItem : item },
      rawLine: "",
    }).payload;
    const safeItem = record(record(safe).item);
    const truncated =
      record(safe).truncated === true ||
      record(e.rawPayload).truncated === true;
    const verified = e.projectionVersion === 2 && e.type === "item.completed";
    data = {
      ...record(safe),
      truncated,
      projectionVersion: verified ? 2 : 1,
      textUpdate: {
        version: 1,
        mode: verified ? "SNAPSHOT" : "UNVERIFIED_FRAME",
        identity: {
          sessionId: e.sessionId,
          turnId: e.turnId,
          itemId: safeItem.id,
          // No valid item/turn identity: never merge unrelated null IDs.
          eventId: safeItem.id && e.turnId ? null : e.id,
        },
        revision: e.sequence,
        phase: verified ? "ITEM_COMPLETED" : "PROVISIONAL",
        continuation: truncated
          ? "TRUNCATED"
          : verified
            ? "ITEM_COMPLETE"
            : "UNKNOWN",
        runCompletion: "USE_SERVER_STATE",
      },
    };
  }
  return {
    id: e.id,
    sessionId: e.sessionId,
    turnId: e.turnId,
    sequence: e.sequence,
    type: historicalText ? e.type : projected.type,
    createdAt: e.createdAt,
    source:
      e.projectionVersion === 1 &&
      ["session.state", "session.interruption"].includes(e.type)
        ? "SERVER"
        : "RUNNER",
    legacyProjection: legacy,
    data,
  };
}
