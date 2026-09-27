import * as path from "node:path";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Plain text avoids Telegram Markdown failures for arbitrary code/model output.
export function splitMessage(text: string, limit = 4000): string[] {
  const chunks: string[] = [];
  while (text.length > limit) {
    let end = text.lastIndexOf("\n", limit);
    if (end < limit / 2) end = limit;
    if (/[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

export function fileReferences(text: string, cwd: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)/g))
    candidates.push(match[1]!.replace(/^<|>$/g, ""));
  for (const match of text.matchAll(/`([^`\n]+)`/g)) candidates.push(match[1]!);
  const files: string[] = [];
  for (let candidate of candidates) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      continue;
    }
    candidate = candidate.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, "");
    if (
      /^[a-z][a-z\d+.-]*:/i.test(candidate) &&
      !/^[a-z]:[\\/]/i.test(candidate)
    )
      continue;
    if (!candidate || candidate.includes("\0") || /[\r\n]/.test(candidate))
      continue;
    const resolved = path.resolve(cwd, candidate);
    const relative = path.relative(cwd, resolved).replace(/\\/g, "/");
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith("../") ||
      path.isAbsolute(relative)
    )
      continue;
    if (!files.includes(relative)) files.push(relative);
  }
  return files;
}

export type ToolState = Record<string, { label: string; status: string }>;
const TOOL_LABELS: Record<string, string> = {
  command_execution: "Command",
  file_change: "File change",
  mcp_tool_call: "Tool",
  collab_tool_call: "Agent task",
  web_search: "Web search",
};

export function trackTool(
  state: ToolState,
  type: string,
  payload: unknown,
): boolean {
  if (!type.startsWith("item.")) return false;
  const item = record(record(payload).item);
  const label = TOOL_LABELS[String(item.type)];
  if (!label || typeof item.id !== "string") return false;
  // Never copy command output, tool arguments or hidden reasoning to progress messages.
  state[item.id] = {
    label,
    status:
      typeof item.status === "string"
        ? item.status
        : type === "item.completed"
          ? "completed"
          : "in_progress",
  };
  return true;
}

export function toolSummary(state: ToolState): string {
  const items = Object.values(state);
  const labels = new Map<string, number>();
  for (const item of items)
    labels.set(item.label, (labels.get(item.label) ?? 0) + 1);
  const running = items.filter((item) => item.status === "in_progress").length;
  const failed = items.filter((item) =>
    ["failed", "declined"].includes(item.status),
  ).length;
  return (
    `Tool activity: ${items.length} call${items.length === 1 ? "" : "s"}\n` +
    [...labels].map(([label, count]) => `${label}: ${count}`).join(" · ") +
    (running ? `\n${running} in progress` : "") +
    (failed ? `\n${failed} failed or declined` : "")
  );
}
