import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, SessionEvent } from "@prisma/client";
import { eventResponse, record } from "./safe-session-event";
import { operationError } from "../openapi/operation-errors";
import type { RunnerEvent } from "./proboxai-runner.service";
export const SESSION_ARCHIVE_POLICY_VERSION = 1;
const unavailable = () =>
  operationError(
    503,
    "SESSION_INPUT_UNAVAILABLE",
    "Protected session input is temporarily unavailable",
    "sessionInput",
  );
function ring(required: boolean) {
  const raw = process.env.SESSION_INPUT_KEYS;
  if (!raw) {
    if (required) throw unavailable();
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw unavailable();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of Object.entries(parsed)) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof value !== "string")
        throw unavailable();
      const key = Buffer.from(value, "base64url");
      if (
        key.length !== 32 ||
        key.toString("base64url") !== value ||
        [process.env.JWT_SECRET, process.env.BROWSER_SESSION_KEY].includes(
          value,
        )
      )
        throw unavailable();
      keys.set(id, key);
    }
    if (!keys.size || keys.size > 32) throw unavailable();
    return keys;
  } catch {
    throw unavailable();
  }
}
function configuredSecrets() {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (
      !value ||
      value.length < 8 ||
      !/TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_INPUT_KEYS/.test(name)
    )
      continue;
    values.push(value);
    if (name === "SESSION_INPUT_KEYS") {
      try {
        for (const v of Object.values(
          JSON.parse(value) as Record<string, unknown>,
        ))
          if (typeof v === "string" && v.length >= 8) values.push(v);
      } catch {
        /* Never expose malformed key configuration. */
      }
    }
  }
  return values.sort((a, b) => b.length - a.length);
}
/** Best-effort redaction, never a claim to recognize every secret in arbitrary text. */
export function historyText(value: string) {
  let text = value;
  for (const secret of configuredSecrets())
    text = text.split(secret).join("[REDACTED]");
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED CREDENTIAL]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/:\/\/[^\s/@]+@/g, "://[REDACTED]@")
    .replace(
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}
export function protectSessionPrompt(
  prompt: string,
  sessionId: string,
  turnId: string,
  required = false,
) {
  const keys = ring(required);
  const inputHash = createHash("sha256").update(prompt).digest("hex");
  if (!keys) return { prompt, encryptedPrompt: null, inputHash };
  const id = process.env.SESSION_INPUT_KEY_ID ?? "";
  const key = keys.get(id);
  if (!key) throw unavailable();
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(
    Buffer.from(`proboxai:session-input:v1:${sessionId}:${turnId}`),
  );
  const bytes = Buffer.concat([cipher.update(prompt, "utf8"), cipher.final()]);
  return {
    prompt: historyText(prompt),
    encryptedPrompt: [
      "v1",
      id,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      bytes.toString("base64url"),
    ].join("."),
    inputHash,
  };
}
export function sessionExecutionPrompt(turn: {
  id: string;
  sessionId: string;
  prompt: string;
  encryptedPrompt?: string | null;
}) {
  if (!turn.encryptedPrompt) return turn.prompt;
  try {
    const parts = turn.encryptedPrompt.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") throw unavailable();
    const key = ring(true)!.get(parts[1]!);
    if (!key) throw unavailable();
    const iv = Buffer.from(parts[2]!, "base64url"),
      tag = Buffer.from(parts[3]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw unavailable();
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAuthTag(tag);
    cipher.setAAD(
      Buffer.from(`proboxai:session-input:v1:${turn.sessionId}:${turn.id}`),
    );
    return Buffer.concat([
      cipher.update(Buffer.from(parts[4]!, "base64url")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw unavailable();
  }
}
const usageFields = new Set([
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
]);
export function historyJson(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (depth > 32)
    return { omitted: true, omissionReason: "MAX_STRUCTURAL_DEPTH" };
  if (typeof value === "string") return historyText(value);
  if (value === null || value === undefined)
    return null as unknown as Prisma.InputJsonValue;
  if (typeof value === "number")
    return Number.isFinite(value)
      ? value
      : (null as unknown as Prisma.InputJsonValue);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => historyJson(v, depth + 1));
  if (typeof value !== "object") return "[OMITTED]";
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      /^(analysis|reasoning|chain_of_thought|hidden_reasoning|internal_reasoning|system_prompt|developer_prompt)$/i.test(
        key,
      )
    )
      continue;
    if (
      /password|credential|authorization|cookie|secret|api.?key|access.?token|refresh.?token/i.test(
        key,
      ) &&
      !usageFields.has(key)
    )
      result[key] = "[REDACTED]";
    else result[key] = historyJson(entry, depth + 1);
  }
  return result;
}
const visibleItems = new Set([
  "agent_message",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "collab_tool_call",
  "web_search",
]);
export function archiveRunnerEvent(event: RunnerEvent) {
  const item =
    event.payload.item && typeof event.payload.item === "object"
      ? (event.payload.item as Record<string, unknown>)
      : null;
  if (
    event.type.startsWith("item.") &&
    (!item || !visibleItems.has(String(item.type)))
  )
    return {
      type: event.type,
      omitted: true,
      omissionReason: "MODEL_INTERNAL_OR_UNCLASSIFIED_ITEM",
    };
  if (
    ![
      "item.started",
      "item.updated",
      "item.completed",
      "thread.started",
      "turn.started",
      "turn.completed",
      "turn.failed",
      "error",
      "runner.error",
      "runner.stderr",
      "workspace.diff",
      "workspace.diff_failed",
    ].includes(event.type)
  )
    return {
      type: event.type,
      omitted: true,
      omissionReason: "UNCLASSIFIED_EVENT",
    };
  const payload =
    event.type === "workspace.diff"
      ? { ...event.payload, path: undefined }
      : event.payload;
  return {
    type: event.type,
    source: "RUNNER_REPORTED",
    policyVersion: SESSION_ARCHIVE_POLICY_VERSION,
    data: historyJson(payload),
  };
}
export function archiveHash(payload: unknown) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, v]) => [key, canonical(v)]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
}
export function toolHistoryDisclosure(): "STRICT_METADATA" | "REDACTED_DETAIL" {
  return "STRICT_METADATA";
}
export function archiveEventResponse(event: SessionEvent) {
  const stored = record(event.archivePayload),
    item = record(record(stored.data).item);
  const toolText =
    [
      "command_execution",
      "file_change",
      "mcp_tool_call",
      "collab_tool_call",
      "web_search",
    ].includes(String(item.type)) ||
    ["workspace.diff", "runner.stderr"].includes(String(stored.type));
  const data =
    event.archivePayload == null
      ? {
          source: "LEGACY_SAFE_PROJECTION",
          retainedDetail: false,
          projection: eventResponse(event).data,
        }
      : toolText && toolHistoryDisclosure() === "STRICT_METADATA"
        ? {
            omitted: true,
            omissionReason: "STRICT_TOOL_DISCLOSURE",
            projection: eventResponse(event).data,
          }
        : historyJson(event.archivePayload);
  return {
    eventId: event.id,
    sequence: event.sequence,
    type: event.type,
    createdAt: event.createdAt,
    retainedDetail: event.archivePayload != null,
    policyVersion: event.archivePolicyVersion ?? null,
    storedHash: event.archiveHash ?? null,
    projectionHash: archiveHash(data),
    data,
  };
}
export async function sessionRuntimeProvenance(tx: Prisma.TransactionClient) {
  let applicationVersion: string | null = null;
  try {
    const data = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof data.version === "string") applicationVersion = data.version;
  } catch {
    /* Packaged metadata can be unavailable. */
  }
  const table = await tx.$queryRaw<
    { name: string | null }[]
  >`SELECT to_regclass('"_prisma_migrations"')::text AS name`;
  const migrations = table[0]?.name
    ? await tx.$queryRaw<
        { migration_name: string }[]
      >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1`
    : [];
  const commit = process.env.PROBOXAI_RELEASE_COMMIT;
  return {
    applicationVersion,
    nodeVersion: process.versions.node,
    schemaMigration: migrations[0]?.migration_name ?? null,
    codeCommit: commit && /^[a-f0-9]{40}$/i.test(commit) ? commit : null,
    codeCommitSource:
      commit && /^[a-f0-9]{40}$/i.test(commit)
        ? "OPERATOR_REPORTED"
        : "UNAVAILABLE",
    runnerVersion: null,
    archivePolicyVersion: SESSION_ARCHIVE_POLICY_VERSION,
  };
}
