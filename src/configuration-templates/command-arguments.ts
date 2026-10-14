// New requests omit arguments for no-argument commands. Older manifests stored
// that omission as JSON/SQL null; only persisted readers accept that encoding.
export function structuredCommandArguments(
  value: unknown,
  persisted = false,
): string[] {
  if (value === undefined || (persisted && value === null)) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && [...item].length <= 4096)
  )
    throw new Error(
      "Structured command arguments must be an array of strings, each at most 4096 characters",
    );
  return value;
}
