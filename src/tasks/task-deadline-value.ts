import { validBirthDate } from "../accounts/profile-birthday";
import { operationError } from "../openapi/operation-errors";
import { DeadlineInputDto, DeadlineValueDto } from "./task-deadlines.dto";
const clock = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const zoneName = /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/;
const offset = /^[+-](?:(?:0[0-9]|1[0-3]):[0-5][0-9]|14:00)$/;
function invalid(field: string, message: string): never {
  throw operationError(
    400,
    "TASK_DEADLINE_INVALID",
    message,
    "setTaskDeadline",
    `deadline.${field}`,
  );
}
export function parseTaskDeadline(
  input: DeadlineInputDto | null,
): DeadlineValueDto | null {
  if (input === null) return null;
  if (!input || !validBirthDate(input.date))
    invalid("date", "Deadline must contain a real YYYY-MM-DD calendar date");
  if (input.time == null) {
    if (input.timeZone != null || input.utcOffset != null)
      invalid(
        "time",
        "A timezone/offset requires a local time; date-only values have no timezone",
      );
    return {
      kind: "DATE",
      date: input.date,
      time: null,
      timeZone: null,
      utcOffset: null,
      instant: null,
    };
  }
  if (!clock.test(input.time)) invalid("time", "Deadline time must be HH:mm");
  if (!input.timeZone || !zoneName.test(input.timeZone))
    invalid("timeZone", "Timed deadlines require a supported IANA time zone");
  if (
    !input.utcOffset ||
    !offset.test(input.utcOffset) ||
    input.utcOffset === "-00:00"
  )
    invalid(
      "utcOffset",
      "Timed deadlines require an explicit known offset from -14:00 to +14:00",
    );
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: input.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    invalid("timeZone", "Timed deadlines require a supported IANA time zone");
  }
  const instant = new Date(`${input.date}T${input.time}:00${input.utcOffset}`);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.getUTCFullYear() < 1 ||
    instant.getUTCFullYear() > 9999
  )
    invalid(
      "date",
      "Deadline instant falls outside the supported calendar range",
    );
  const parts = Object.fromEntries(
    formatter!.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year!.padStart(4, "0")}-${parts.month}-${parts.day}`;
  if (
    localDate !== input.date ||
    `${parts.hour}:${parts.minute}` !== input.time ||
    parts.second !== "00"
  )
    invalid(
      "utcOffset",
      "Local date/time and offset do not match this timezone; choose a valid occurrence",
    );
  return {
    kind: "TIMED",
    date: input.date,
    time: input.time,
    timeZone: formatter!.resolvedOptions().timeZone,
    utcOffset: input.utcOffset,
    instant: instant.toISOString(),
  };
}
/** Preserve the pinned instant; do not reinterpret it using updated timezone rules. */
export function storedTaskDeadline(value: unknown): DeadlineValueDto | null {
  if (value === null) return null;
  const v = value as DeadlineValueDto;
  let knownZone = true;
  if (v?.kind === "TIMED") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v.timeZone ?? undefined });
      knownZone = typeof v.timeZone === "string";
    } catch {
      knownZone = false;
    }
  }
  const valid =
    !!v &&
    typeof v === "object" &&
    validBirthDate(v.date) &&
    ((v.kind === "DATE" &&
      v.time === null &&
      v.timeZone === null &&
      v.utcOffset === null &&
      v.instant === null) ||
      (v.kind === "TIMED" &&
        knownZone &&
        typeof v.time === "string" &&
        clock.test(v.time) &&
        typeof v.timeZone === "string" &&
        zoneName.test(v.timeZone) &&
        typeof v.utcOffset === "string" &&
        offset.test(v.utcOffset) &&
        v.utcOffset !== "-00:00" &&
        typeof v.instant === "string" &&
        Number.isFinite(new Date(v.instant).getTime()) &&
        new Date(v.instant).getUTCFullYear() >= 1 &&
        new Date(v.instant).getUTCFullYear() <= 9999 &&
        new Date(`${v.date}T${v.time}:00${v.utcOffset}`).toISOString() ===
          v.instant));
  if (!valid)
    throw operationError(
      503,
      "TASK_DEADLINE_UNAVAILABLE",
      "Task deadline data is unavailable",
      "readTaskDeadline",
    );
  return {
    kind: v.kind,
    date: v.date,
    time: v.time,
    timeZone: v.timeZone,
    utcOffset: v.utcOffset,
    instant: v.instant,
  };
}
