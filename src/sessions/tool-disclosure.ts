import { historyText } from "./session-history";
import type { Prisma } from "@prisma/client";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const MAX_TEXT = 65536;
const MAX_IMAGE = 512 * 1024;

/** Bounded display snapshots for already authorized session readers. Never execute content. */
export function toolDisclosure(item: Record<string, unknown>) {
  let truncated = false;
  let budget = 128 * 1024;
  const text = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    // Strip terminal escape sequences before redaction; leave no executable markup.
    const clean = historyText(
      // eslint-disable-next-line no-control-regex
      v.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""),
    ).replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g,
      "[REDACTED PRIVATE KEY]",
    );
    const size = Math.max(0, Math.min(MAX_TEXT, budget));
    const result = clean.slice(0, size);
    budget -= result.length;
    truncated ||= clean.length > size;
    return result;
  };
  const json = (v: unknown, depth = 0): Prisma.JsonValue => {
    budget -= 4;
    if (depth > 8 || budget <= 0) {
      truncated = true;
      return "[TRUNCATED]";
    }
    if (typeof v === "string") return text(v);
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (Array.isArray(v)) {
      truncated ||= v.length > 100;
      return v.slice(0, 100).map((x) => json(x, depth + 1));
    }
    const entries = Object.entries(object(v));
    truncated ||= entries.length > 100;
    return Object.fromEntries(
      entries
        .slice(0, 100)
        .map(([key, value]) => [
          text(key) ?? "",
          /password|passwd|secret|token|credential|api[_-]?key|access[_-]?key|cookie|authorization/i.test(
            key,
          )
            ? "[REDACTED]"
            : json(value, depth + 1),
        ]),
    );
  };
  const images: { src: string; label: string }[] = [];
  const image = (data: unknown, mime: unknown, label: unknown) => {
    if (images.length >= 4) {
      truncated = true;
      return;
    }
    if (
      typeof data !== "string" ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        String(mime),
      )
    )
      return;
    if (data.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      truncated = true;
      return;
    }
    images.push({
      src: `data:${String(mime)};base64,${data}`,
      label: text(label) ?? "",
    });
  };
  const result = object(item.result);
  const blocks = Array.isArray(result.content)
    ? result.content.slice(0, 100)
    : [];
  truncated ||= Array.isArray(result.content) && result.content.length > 100;
  // Inline raster content only: no external requests, SVG, HTML or file URLs.
  const content = blocks.map((block) => {
    const b = object(block);
    if (b.type !== "image") return block;
    image(b.data, b.mimeType, item.tool);
    return { type: "image", mimeType: b.mimeType, preview: "SEE_IMAGES" };
  });
  if (Array.isArray(item.previews))
    for (const preview of item.previews.slice(0, 4)) {
      const p = object(preview);
      image(p.data, p.mimeType, p.label);
    }
  truncated ||= Array.isArray(item.previews) && item.previews.length > 4;
  const changes = Array.isArray(item.changes)
    ? item.changes.slice(0, 100).map((v) => {
        const c = object(v);
        return { path: text(c.path), kind: json(c.kind), diff: text(c.diff) };
      })
    : [];
  const terminal = ["completed", "failed", "declined"].includes(
    String(item.status),
  );
  const code = item.exit_code ?? item.exitCode;
  const details = {
    version: 1,
    policy: "AUTHORIZED_SESSION_DETAIL_V1",
    updateMode: "SNAPSHOT",
    label: text(
      item.command ??
        (typeof item.server === "string" && typeof item.tool === "string"
          ? `${item.server}.${item.tool}`
          : item.tool) ??
        item.query ??
        item.path,
    ),
    cwd: text(item.cwd),
    input: json(
      item.arguments ??
        (item.type === "command_execution"
          ? {
              command: item.command ?? null,
              actions: item.commandActions ?? [],
            }
          : (item.path ?? item.query ?? null)),
    ),
    output: json(
      item.aggregated_output ??
        item.aggregatedOutput ??
        (item.result != null ? { ...result, content } : (item.output ?? null)),
    ),
    error: json(item.error ?? null),
    progress: text(item.progress),
    exitCode:
      terminal &&
      typeof code === "number" &&
      Number.isInteger(code) &&
      code >= -2147483648 &&
      code <= 2147483647
        ? code
        : null,
    changes,
    images,
    previewUnavailable: item.previewUnavailable === true,
    truncated: false,
    runCompletion: "USE_SERVER_STATE",
  };
  details.truncated =
    truncated || (Array.isArray(item.changes) && item.changes.length > 100);
  return details;
}
