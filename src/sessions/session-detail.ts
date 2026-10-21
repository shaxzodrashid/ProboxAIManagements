import { BadRequestException, ConflictException } from "@nestjs/common";
import { SessionEvent } from "@prisma/client";
import { archiveHash, historyText } from "./session-history";
import { record } from "./safe-session-event";

const MAX_TEXT = 1024 * 1024;
/** Redact the entire field before paging. Never cut a credential at a page boundary. */
function text(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_TEXT) return null;
  // Explicit control matching is required to prevent terminal colour escapes
  // splitting credential labels before the redactor sees them.
  // eslint-disable-next-line no-control-regex
  let normalized = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  // Unknown terminal escape formats are not interpreted or displayed.
  if (normalized.includes(String.fromCharCode(27))) return null;
  // eslint-disable-next-line no-control-regex
  normalized = normalized.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  // Unlike display-only legacy projections, detail must also hide short known
  // configured credentials. Over-redaction is preferable to exposing a value.
  const secrets = Object.entries(process.env)
    .filter(
      ([key, secret]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/i.test(key) && !!secret,
    )
    .map(([, secret]) => secret!)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    normalized = normalized.split(secret).join("[REDACTED]");
    if (normalized.length > MAX_TEXT) return null;
  }
  const credentials = normalized.replace(
    /(\b[\w-]{0,64}(?:password|passwd|secret|token|credential|api[_-]?key|access[_-]?key|cookie|authorization)[\w-]{0,64}["']?\s*(?:[:=]|\s)\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi,
    "$1[REDACTED]",
  );
  const safe = historyText(credentials).replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g,
    "[REDACTED PRIVATE KEY]",
  );
  return safe.length <= MAX_TEXT ? safe : null;
}
function bounded(value: unknown, maximum: number) {
  const safe = text(value);
  // Omit oversized identifiers/commands/paths rather than displaying partial instructions.
  return safe !== null && safe.length <= maximum ? safe : null;
}
function verifiedArchive(event: SessionEvent, stored: Record<string, unknown>) {
  try {
    // Old archives retain arbitrary JSON. Bound verification work and fail closed
    // on malformed/deep objects rather than recursively returning their fields.
    return (
      JSON.stringify(stored).length <= 4 * MAX_TEXT &&
      archiveHash(stored) === event.archiveHash
    );
  } catch {
    return false;
  }
}

/** Allowlisted schemas from codex exec_events.rs and our captureFinalDiff adapter.
 * No recursive passthrough, local archive-file reads, decryption or provider calls.
 */
export function sessionDetailProjection(event: SessionEvent) {
  const stored = record(event.archivePayload);
  const base = {
    projectionVersion: 1,
    policy: "REDACTED_SESSION_DETAIL_V1",
    source: "UNAVAILABLE",
    completeness: "UNAVAILABLE",
    runCompletion: "USE_SERVER_STATE",
    kind: "UNAVAILABLE",
    availability: "UNSUPPORTED_SCHEMA",
    command: null as string | null,
    exitCode: null as number | null,
    content: null as string | null,
    changes: null as { path: string | null; kind: string }[] | null,
  };
  if (event.archivePayload == null)
    return { ...base, availability: "LEGACY_DETAIL_UNAVAILABLE" };
  if (
    event.archivePolicyVersion !== 1 ||
    stored.policyVersion !== 1 ||
    stored.source !== "RUNNER_REPORTED" ||
    (stored.type !== event.type &&
      !(stored.type === "workspace.diff" && event.type === "runner.omitted")) ||
    !event.archiveHash ||
    !verifiedArchive(event, stored)
  )
    return { ...base, availability: "UNVERIFIED_ARCHIVE" };
  const data = record(stored.data),
    item = record(data.item);
  const reported = {
    ...base,
    source: "RUNNER_REPORTED",
    completeness: "REPORTED_FRAME_ONLY",
  };
  if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
    if (item.type === "command_execution") {
      const content = text(item.aggregated_output);
      return {
        ...reported,
        kind: "COMMAND",
        availability:
          content === null ? "CONTENT_UNAVAILABLE_OR_OVERSIZED" : "AVAILABLE",
        command: bounded(item.command, 8192),
        exitCode:
          event.type === "item.completed" &&
          ["completed", "failed"].includes(String(item.status)) &&
          typeof item.exit_code === "number" &&
          Number.isInteger(item.exit_code) &&
          item.exit_code >= -2147483648 &&
          item.exit_code <= 2147483647
            ? item.exit_code
            : null,
        content,
      };
    }
    if (item.type === "file_change") {
      if (!Array.isArray(item.changes) || item.changes.length > 10000)
        return {
          ...reported,
          kind: "FILE_CHANGES",
          availability: "CONTENT_UNAVAILABLE_OR_OVERSIZED",
        };
      const changes = item.changes.map((entry: unknown) => {
        const change = record(entry);
        return {
          path: bounded(change.path, 4096),
          kind: ["add", "delete", "update"].includes(String(change.kind))
            ? String(change.kind)
            : "UNAVAILABLE",
        };
      });
      return {
        ...reported,
        kind: "FILE_CHANGES",
        availability: "AVAILABLE",
        changes,
      };
    }
  }
  if (
    stored.type === "workspace.diff" &&
    data.stage === "final" &&
    data.redactionPolicy === "BEST_EFFORT_V1"
  ) {
    const binary =
      typeof data.diff === "string" &&
      /GIT binary patch|Binary files .* differ/.test(data.diff);
    const content = binary ? null : text(data.diff);
    return {
      ...reported,
      kind: "WORKSPACE_DIFF",
      completeness: "FINAL_WORKSPACE_DIFF_NOT_PER_TOOL_ATTRIBUTION",
      availability: binary
        ? "BINARY_DIFF_OMITTED"
        : content === null
          ? "CONTENT_UNAVAILABLE_OR_OVERSIZED"
          : "AVAILABLE",
      content,
    };
  }
  return base;
}

export function sessionDetailPage(
  event: SessionEvent,
  offset = 0,
  limit = 4096,
  revision?: string,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_TEXT ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 16384
  )
    throw new BadRequestException("Invalid session detail page");
  const projection = sessionDetailProjection(event);
  const projectionHash = archiveHash({
    sessionId: event.sessionId,
    eventId: event.id,
    projection,
  });
  if (
    (offset > 0 && !revision) ||
    (revision !== undefined && revision !== projectionHash)
  )
    throw new ConflictException(
      "Session detail projection changed; restart at offset zero",
    );
  const totalUnits =
    projection.changes?.length ?? projection.content?.length ?? 0;
  if (offset > totalUnits)
    throw new BadRequestException(
      "Session detail offset exceeds available content",
    );
  const pageSize = projection.changes ? Math.min(limit, 100) : limit;
  const end = Math.min(offset + pageSize, totalUnits);
  return {
    eventId: event.id,
    sessionId: event.sessionId,
    turnId: event.turnId,
    sequence: event.sequence,
    type:
      projection.kind === "WORKSPACE_DIFF"
        ? "workspace.diff"
        : [
              "item.started",
              "item.updated",
              "item.completed",
              "workspace.diff",
            ].includes(event.type)
          ? event.type
          : "UNSUPPORTED_EVENT",
    createdAt: event.createdAt,
    archivePolicyVersion: event.archivePolicyVersion,
    ...projection,
    content: projection.content?.slice(offset, end) ?? null,
    changes: projection.changes?.slice(offset, end) ?? null,
    projectionHash,
    offset,
    totalUnits,
    units: projection.changes ? "CHANGES" : "UTF16_CODE_UNITS",
    nextOffset: end < totalUnits ? end : null,
    truncated: end < totalUnits,
    redaction: "BEST_EFFORT_CURRENT_CONFIGURATION",
  };
}
