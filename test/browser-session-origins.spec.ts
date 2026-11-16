import { randomBytes } from "node:crypto";
import type { Request } from "express";
import {
  browserSessionConfig,
  browserCookieName,
} from "../src/browser-sessions/browser-session.config";
import { BrowserSessionService } from "../src/browser-sessions/browser-session.service";
const base = {
  BROWSER_SESSIONS_ENABLED: "true",
  BROWSER_SESSION_KEY: randomBytes(32).toString("base64url"),
};
const origins = [
  "https://app.example.test",
  "https://dev.example.test",
  "https://localhost:5173",
];
const config = () =>
  browserSessionConfig({
    ...base,
    NODE_ENV: "production",
    BROWSER_SESSION_ORIGINS: origins.join(","),
  });
describe("browser session origin allowlist", () => {
  it("accepts three exact origins, trims and deduplicates entries", () => {
    const c = browserSessionConfig({
      ...base,
      BROWSER_SESSION_ORIGINS: origins.join(", ") + ", " + origins[0],
    });
    expect(c.origins).toEqual(origins);
    expect(c.secure).toBe(true);
    expect(browserCookieName(c)).toBe("__Host-probox_sid");
  });
  it("keeps legacy single-origin configuration and plural precedence", () => {
    expect(
      browserSessionConfig({ ...base, BROWSER_SESSION_ORIGIN: origins[0] })
        .origins,
    ).toEqual([origins[0]]);
    expect(
      browserSessionConfig({
        ...base,
        BROWSER_SESSION_ORIGIN: origins[0],
        BROWSER_SESSION_ORIGINS: origins[1],
      }).origins,
    ).toEqual([origins[1]]);
  });
  it.each([
    "*",
    "https://*.example.test",
    "https://example.test/",
    "https://example.test/path",
    "https://u:p@example.test",
    "https://example.test?x=1",
    "null",
    "file://",
    "https://example.test,",
    "http://public.example.test",
  ])("rejects invalid origin %s", (value) => {
    expect(() =>
      browserSessionConfig({ ...base, BROWSER_SESSION_ORIGINS: value }),
    ).toThrow();
  });
  it("never downgrades secure cookies for mixed or production HTTP", () => {
    expect(() =>
      browserSessionConfig({
        ...base,
        BROWSER_SESSION_ORIGINS: origins[0] + ",http://localhost:5173",
      }),
    ).toThrow();
    expect(() =>
      browserSessionConfig({
        ...base,
        NODE_ENV: "production",
        BROWSER_SESSION_ORIGINS: "http://localhost:5173",
      }),
    ).toThrow();
    const c = browserSessionConfig({
      ...base,
      BROWSER_SESSION_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
    });
    expect(browserCookieName(c)).toBe("probox_dev_sid");
  });
  const request = (origin?: string, extra = {}, json = true) =>
    ({
      headers: { ...(origin === undefined ? {} : { origin }), ...extra },
      is: () => (json ? "application/json" : false),
    }) as unknown as Request;
  const assertOrigin = (req: Request, unsafe = false) =>
    BrowserSessionService.prototype.assertOrigin.call(
      { config: config() },
      req,
      unsafe,
    );
  it("accepts every configured origin for safe and unsafe same-origin proxy requests", () => {
    for (const origin of origins)
      for (const unsafe of [false, true])
        expect(() =>
          assertOrigin(
            request(origin, { "sec-fetch-site": "same-origin" }),
            unsafe,
          ),
        ).not.toThrow();
  });
  it.each([
    "https://evil.test",
    "https://app.example.test.evil.test",
    "https://app.example.test:444",
    "null",
    "",
  ])("rejects foreign origin %s", (origin) => {
    for (const unsafe of [false, true])
      expect(() => assertOrigin(request(origin), unsafe)).toThrow();
  });
  it("preserves missing-origin, fetch metadata, bearer and JSON defenses", () => {
    expect(() => assertOrigin(request(), false)).not.toThrow();
    expect(() => assertOrigin(request(), true)).toThrow();
    expect(() =>
      assertOrigin(request(origins[0], { "sec-fetch-site": "cross-site" })),
    ).toThrow();
    expect(() =>
      assertOrigin(request(origins[0], { authorization: "Bearer test" })),
    ).toThrow();
    expect(() => assertOrigin(request(origins[0], {}, false), true)).toThrow();
  });
});
