/** Provisional disclosure policy. Match whole strings; never unwrap shells or redact-and-show. */
export const SAFE_COMMAND_LABELS = [
  "pnpm test",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm build",
  "git status --short",
  "git diff --check",
] as const;

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

function label(value: unknown): string | null {
  if (!SAFE_COMMAND_LABELS.some((allowed) => value === allowed)) return null;
  const text = value as string;
  // Even a fixed label must not disclose a known configured secret value.
  return Object.entries(process.env).some(
    ([key, secret]) =>
      /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/.test(key) &&
      secret &&
      secret.length >= 8 &&
      text.includes(secret),
  )
    ? null
    : text;
}

export function commandDisclosure(
  type: string,
  item: Record<string, unknown>,
  persisted = false,
) {
  const details = object(item.commandDetails);
  const trustedProjection =
    details.policy === "STRICT_ALLOWLIST_V1" && details.provisional === true;
  const terminal =
    type === "item.completed" &&
    ["completed", "failed"].includes(String(item.status));
  const candidate = persisted
    ? trustedProjection
      ? details.exitCode
      : null
    : item.exit_code;
  const commandLabel = label(
    persisted
      ? trustedProjection
        ? details.commandLabel
        : null
      : item.command,
  );
  return {
    policy: "STRICT_ALLOWLIST_V1" as const,
    provisional: true as const,
    commandLabel,
    commandState: commandLabel ? "ALLOWLISTED" : "OMITTED",
    exitCode:
      terminal &&
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= -2147483648 &&
      candidate <= 2147483647
        ? candidate
        : null,
    outputState: "OMITTED" as const,
    outputOmissionReason: "UNVERIFIED_CONTENT" as const,
    runCompletion: "USE_SERVER_STATE" as const,
  };
}
