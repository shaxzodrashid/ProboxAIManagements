import {
  cursorKey,
  decodeHistoryCursor,
  encodeHistoryCursor,
} from "../src/groups/group-history-cursor";
describe("opaque group-history continuations", () => {
  const key = cursorKey("synthetic cursor secret"),
    base = {
      v: 1 as const,
      scope: "a".repeat(64),
      membership: "b".repeat(64),
      upper: 500,
      lower: 10,
      before: 400,
    };
  it("round trips without exposing the payload and uses fresh nonces", () => {
    const token = encodeHistoryCursor(base, key);
    expect(decodeHistoryCursor(token, key)).toEqual(base);
    expect(token).not.toContain(base.scope);
    expect(encodeHistoryCursor(base, key)).not.toBe(token);
  });
  it("has constant length for small and large hidden counts", () => {
    expect(
      encodeHistoryCursor({ ...base, upper: 2, lower: 0, before: 1 }, key)
        .length,
    ).toBe(
      encodeHistoryCursor(
        { ...base, upper: 2147483647, before: 2147483646 },
        key,
      ).length,
    );
  });
  it("rejects key changes, bad versions and changed authentication tags", () => {
    const token = encodeHistoryCursor(base, key);
    expect(() =>
      decodeHistoryCursor(token, cursorKey("rotated fixture")),
    ).toThrow();
    expect(() => decodeHistoryCursor("2" + token.slice(1), key)).toThrow();
    expect(() => decodeHistoryCursor(token.slice(0, -2) + "AA", key)).toThrow();
  });
  it("rejects authenticated but inconsistent bounds", () => {
    for (const bad of [
      { ...base, before: 10 },
      { ...base, lower: 600 },
      { ...base, upper: -1 },
    ])
      expect(() =>
        decodeHistoryCursor(encodeHistoryCursor(bad, key), key),
      ).toThrow();
  });
});
