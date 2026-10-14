import {
  parseTaskDeadline,
  storedTaskDeadline,
} from "../src/tasks/task-deadline-value";
describe("calendar and unambiguous timed deadlines", () => {
  it.each([
    "0001-01-01",
    "0099-12-31",
    "2000-02-29",
    "2026-10-13",
    "9999-12-31",
  ])("preserves calendar-only %s without an instant", (date) => {
    expect(parseTaskDeadline({ date })).toEqual({
      kind: "DATE",
      date,
      time: null,
      timeZone: null,
      utcOffset: null,
      instant: null,
    });
  });
  it.each([
    "0000-01-01",
    "1900-02-29",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
  ])("rejects invalid calendar %s", (date) => {
    expect(() => parseTaskDeadline({ date })).toThrow();
  });
  it("does not shift date-only values with the viewer/runtime timezone", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = zone;
        expect(parseTaskDeadline({ date: "2026-10-13" })?.date).toBe(
          "2026-10-13",
        );
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it.each([
    ["Asia/Tashkent", "+05:00", "2026-10-13T12:30:00.000Z"],
    ["Asia/Kathmandu", "+05:45", "2026-10-13T11:45:00.000Z"],
    ["UTC", "+00:00", "2026-10-13T17:30:00.000Z"],
  ])(
    "pins the local date/time instant for %s",
    (timeZone, utcOffset, instant) => {
      expect(
        parseTaskDeadline({
          date: "2026-10-13",
          time: "17:30",
          timeZone,
          utcOffset,
        }),
      ).toMatchObject({ kind: "TIMED", instant });
    },
  );
  it("supports a midnight whose instant is on the preceding UTC date", () => {
    expect(
      parseTaskDeadline({
        date: "2026-10-13",
        time: "00:00",
        timeZone: "Asia/Tashkent",
        utcOffset: "+05:00",
      }),
    ).toMatchObject({
      date: "2026-10-13",
      instant: "2026-10-12T19:00:00.000Z",
    });
  });
  it("requires explicit occurrence selection for a repeated DST hour", () => {
    const input = {
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/New_York",
    };
    expect(parseTaskDeadline({ ...input, utcOffset: "-04:00" })?.instant).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(parseTaskDeadline({ ...input, utcOffset: "-05:00" })?.instant).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    expect(() => parseTaskDeadline(input)).toThrow();
  });
  it.each(["-04:00", "-05:00"])(
    "rejects a nonexistent DST local time with %s",
    (utcOffset) => {
      expect(() =>
        parseTaskDeadline({
          date: "2026-03-08",
          time: "02:30",
          timeZone: "America/New_York",
          utcOffset,
        }),
      ).toThrow();
    },
  );
  it.each([
    { date: "2026-10-13", time: "17:30", timeZone: "UTC", utcOffset: "+01:00" },
    { date: "2026-10-13", time: "17:30", timeZone: "UTC", utcOffset: "-00:00" },
    { date: "2026-10-13", time: "24:00", timeZone: "UTC", utcOffset: "+00:00" },
    {
      date: "2026-10-13",
      time: "17:30",
      timeZone: "Unknown/Nowhere",
      utcOffset: "+00:00",
    },
    { date: "2026-10-13", timeZone: "UTC" },
    { date: "2026-10-13", time: "17:30", timeZone: "UTC", utcOffset: "+14:30" },
  ])("rejects inconsistent deadline metadata %#", (input) => {
    expect(() => parseTaskDeadline(input)).toThrow();
  });
  it("retains pinned timed provenance without applying current timezone conversion rules on reads", () => {
    const stored = {
      kind: "TIMED",
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/New_York",
      utcOffset: "-04:00",
      instant: "2026-11-01T05:30:00.000Z",
    };
    expect(storedTaskDeadline(stored)).toEqual(stored);
    expect(
      storedTaskDeadline({ ...stored, secret: "never projected" }),
    ).toEqual(stored);
  });
  it.each([
    { kind: "unknown" },
    {
      kind: "TIMED",
      date: "2026-10-13",
      time: "17:30",
      timeZone: "Unknown/Nowhere",
      utcOffset: "+00:00",
      instant: "2026-10-13T17:30:00.000Z",
    },
    {
      kind: "TIMED",
      date: "9999-12-31",
      time: "23:59",
      timeZone: "UTC",
      utcOffset: "-14:00",
      instant: "+010000-01-01T13:59:00.000Z",
    },
    {
      kind: "DATE",
      date: "2026-02-30",
      time: null,
      timeZone: null,
      utcOffset: null,
      instant: null,
    },
    {
      kind: "TIMED",
      date: "2026-10-13",
      time: "17:30",
      timeZone: "UTC",
      utcOffset: "+00:00",
      instant: "2026-10-13T00:00:00.000Z",
    },
  ])("fails unavailable for malformed persisted data %#", (value) => {
    try {
      storedTaskDeadline(value);
      throw new Error("must reject");
    } catch (error: any) {
      expect(error.getStatus()).toBe(503);
    }
  });
  it("clears explicitly and accepts null optional time fields for date-only", () => {
    expect(parseTaskDeadline(null)).toBeNull();
    expect(
      parseTaskDeadline({
        date: "2026-10-13",
        time: null,
        timeZone: null,
        utcOffset: null,
      })?.kind,
    ).toBe("DATE");
  });
});
