import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { AuthService } from "../src/auth/auth.service";
import { AuthLocale } from "../src/auth/auth.dto";
import { untilFixture } from "./support/frontend-session-harness";
import { Prisma } from "@prisma/client";
import { BrowserSessionService } from "../src/browser-sessions/browser-session.service";
import {
  browserDigest,
  browserSessionConfig,
  decryptBrowserBundle,
  encryptBrowserBundle,
} from "../src/browser-sessions/browser-session.config";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
} from "./support/frontend-session-harness";

const day = 24 * 60 * 60_000;
describe("rolling authentication policy and key retention", () => {
  const env = {
    BROWSER_SESSIONS_ENABLED: "true",
    BROWSER_SESSION_ORIGIN: "https://example.test",
    BROWSER_SESSION_KEY: randomBytes(32).toString("base64url"),
  };
  it("defaults to 90 days inactivity without an absolute cap and bounds overrides", () => {
    expect(browserSessionConfig(env)).toMatchObject({
      idleMs: 90 * day,
      absoluteMs: 0,
    });
    expect(
      browserSessionConfig({
        ...env,
        BROWSER_SESSION_IDLE_MS: "60000",
        BROWSER_SESSION_ABSOLUTE_MS: "3600000",
      }),
    ).toMatchObject({ idleMs: 60000, absoluteMs: 3600000 });
    for (const value of ["-1", "Infinity", String(366 * day), "999", "1.5"])
      expect(() =>
        browserSessionConfig({ ...env, BROWSER_SESSION_IDLE_MS: value }),
      ).toThrow();
  });
  it("decrypts retained keys and rewrites with the active key without accepting unknown IDs", () => {
    const old = browserSessionConfig(env);
    const fresh = browserSessionConfig({
      ...env,
      BROWSER_SESSION_KEY_ID: "v2",
      BROWSER_SESSION_KEY: randomBytes(32).toString("base64url"),
      BROWSER_SESSION_PREVIOUS_KEYS: JSON.stringify({
        v1: env.BROWSER_SESSION_KEY,
      }),
    });
    const previous = encryptBrowserBundle(old, "id", { value: "test-only" });
    expect(decryptBrowserBundle(fresh, "id", previous)).toEqual({
      value: "test-only",
    });
    expect(
      encryptBrowserBundle(
        fresh,
        "id",
        decryptBrowserBundle(fresh, "id", previous),
      ),
    ).toMatch(/^v2\./);
    expect(() =>
      decryptBrowserBundle({ ...fresh, previousKeys: {} }, "id", previous),
    ).toThrow();
    expect(() =>
      browserSessionConfig({
        ...env,
        BROWSER_SESSION_PREVIOUS_KEYS: '{"v1":"invalid"}',
      }),
    ).toThrow();
  });
});

const integration =
  process.env.PROFILE_TEST_DATABASE_URL === fixtureDatabaseUrl
    ? describe
    : describe.skip;
integration("rolling per-device authentication HTTP", () => {
  let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
  let service: BrowserSessionService;
  let clock: jest.SpyInstance | undefined;
  beforeAll(async () => {
    f = await createFrontendSessionHarness(fixtureDatabaseUrl);
    service = f.app.get(BrowserSessionService);
    service.config.idleMs = 90 * day;
    service.config.absoluteMs = 0;
  });
  afterEach(() => {
    clock?.mockRestore();
    clock = undefined;
  });
  afterAll(async () => {
    await f?.close();
  });
  function client(rolling = true) {
    let cookie = "",
      csrf = "";
    return {
      get cookie() {
        return cookie;
      },
      async call(
        path: string,
        method = "GET",
        body?: unknown,
        extra: Record<string, string> = {},
      ) {
        const response = await fetch(f.manifest.baseUrl + "/browser/" + path, {
          method,
          headers: {
            Cookie: cookie,
            Origin: service.config.origin,
            ...(rolling ? { "X-Browser-Session-Policy": "rolling-v1" } : {}),
            ...(method !== "GET"
              ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
              : {}),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const set = response.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0]!;
        const text = await response.text();
        const value = text ? JSON.parse(text) : null;
        if (value?.csrfToken) csrf = value.csrfToken;
        return { response, status: response.status, value };
      },
      async signIn() {
        await this.call("session");
        return this.call("login", "POST", {
          username: f.manifest.username,
          password: f.manifest.password,
        });
      },
      row() {
        return f.prisma.browserSession.findUniqueOrThrow({
          where: { id: browserDigest(cookie.split("=")[1]!) },
        });
      },
    };
  }
  async function forceRefresh(c: ReturnType<typeof client>) {
    const row = await c.row();
    const bundle = decryptBrowserBundle<Record<string, unknown>>(
      service.config,
      row.id,
      row.bundle,
    );
    await f.prisma.browserSession.update({
      where: { id: row.id },
      data: {
        bundle: encryptBrowserBundle(service.config, row.id, {
          ...bundle,
          accessExpiresAt: 1,
        }),
      },
    });
    return { row, bundle };
  }
  it("keeps unupgraded browser clients capped until they explicitly opt into the rolling contract", async () => {
    const c = client(false);
    const result = await c.signIn();
    expect(result.status).toBe(200);
    expect(result.value.expiryPolicy).toBe("absolute");
    expect(
      Date.parse(result.value.idleExpiresAt) - Date.now(),
    ).toBeLessThanOrEqual(30 * 60_000);
    expect(
      Date.parse(result.value.hardExpiresAt) - Date.now(),
    ).toBeLessThanOrEqual(8 * 60 * 60_000);
  });
  async function bearer(token: string) {
    return fetch(f.manifest.baseUrl + "/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  it("crosses eight hours and a simulated year of daily use while leaving authentication age unchanged", async () => {
    const c = client();
    const login = await c.signIn();
    expect(login.status).toBe(200);
    expect(login.value).toMatchObject({
      expiryPolicy: "rolling",
      hardExpiresAt: null,
    });
    const now = Date.now();
    clock = jest.spyOn(Date, "now");
    for (const elapsed of [
      9 / 24,
      ...Array.from({ length: 400 }, (_value, i) => i + 1),
    ]) {
      clock.mockReturnValue(now + elapsed * day);
      const response = await c.call("activity", "POST", {});
      expect(response.status).toBe(200);
      expect(response.value.authenticatedAt).toBe(login.value.authenticatedAt);
      expect(Date.parse(response.value.idleExpiresAt)).toBeGreaterThan(
        now + (elapsed + 89) * day,
      );
      expect(response.response.headers.get("set-cookie")).toContain("HttpOnly");
    }
    expect((await c.call("api/users/me")).status).toBe(200);
  });
  it("does not renew activity on GET/bootstrap, rejects background CSRF bypass, and cannot resurrect inactivity", async () => {
    const c = client();
    await c.signIn();
    const initial = await c.row();
    expect((await c.call("session")).status).toBe(200);
    expect((await c.call("api/users/me")).status).toBe(200);
    expect((await c.row()).idleExpiresAt).toEqual(initial.idleExpiresAt);
    expect(
      (await c.call("activity", "POST", {}, { "X-CSRF-Token": "wrong" }))
        .status,
    ).toBe(403);
    expect((await c.call("activity", "POST", { forged: true })).status).toBe(
      400,
    );
    clock = jest
      .spyOn(Date, "now")
      .mockReturnValue(initial.idleExpiresAt.getTime());
    expect((await c.call("activity", "POST", {})).status).toBe(401);
    expect((await c.call("session")).value.authenticated).toBe(false);
    expect(
      (
        await f.prisma.browserSession.findUniqueOrThrow({
          where: { id: initial.id },
        })
      ).idleExpiresAt,
    ).toEqual(initial.idleExpiresAt);
  });
  it("serializes concurrent refresh and retries with one immutable server-held successor after a lost response", async () => {
    const c = client();
    await c.signIn();
    const { row } = await forceRefresh(c);
    const responses = await Promise.all([
      c.call("api/users/me"),
      c.call("api/authorization/me"),
      c.call("api/users/me"),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const credentials = await f.prisma.refreshCredential.findMany({
      where: { sessionId: row.refreshId! },
    });
    expect(credentials).toHaveLength(2);
    expect(credentials.filter((x) => !x.consumedAt)).toHaveLength(1);
    const after = await c.row();
    // A lost HTTP response cannot expose a new credential; the same cookie recovers it.
    expect((await c.call("api/users/me")).status).toBe(200);
    expect((await c.row()).refreshId).toBe(after.refreshId);
    expect(
      await f.prisma.refreshCredential.count({
        where: { sessionId: row.refreshId! },
      }),
    ).toBe(2);
  });
  it("commits family revocation on consumed-credential replay and rejects already issued access tokens", async () => {
    const c = client();
    await c.signIn();
    const { row, bundle } = await forceRefresh(c);
    expect((await c.call("api/users/me")).status).toBe(200);
    const current = await c.row();
    const next = decryptBrowserBundle<{ accessToken: string }>(
      service.config,
      row.id,
      current.bundle,
    );
    await f.prisma.browserSession.update({
      where: { id: row.id },
      data: {
        bundle: encryptBrowserBundle(service.config, row.id, {
          ...bundle,
          accessExpiresAt: 1,
        }),
      },
    });
    expect((await c.call("api/users/me")).status).toBe(401);
    expect(
      (
        await f.prisma.sessionToken.findUniqueOrThrow({
          where: { id: row.refreshId! },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect((await bearer(next.accessToken)).status).toBe(401);
  });
  it("keeps other devices working after per-device logout and supports bounded owned-device revocation", async () => {
    const a = client(),
      b = client();
    await a.signIn();
    await b.signIn();
    const before = await a.row();
    const bundle = decryptBrowserBundle<{ accessToken: string }>(
      service.config,
      before.id,
      before.bundle,
    );
    const devices = await b.call("devices");
    expect(devices.status).toBe(200);
    expect(JSON.stringify(devices.value)).not.toMatch(
      /tokenHash|refreshToken|bundle|password/,
    );
    expect(
      (await b.call(`devices/${before.refreshId}/revoke`, "POST", {})).status,
    ).toBe(204);
    expect((await a.call("api/users/me")).status).toBe(401);
    expect((await bearer(bundle.accessToken)).status).toBe(401);
    expect((await b.call("api/users/me")).status).toBe(200);
  });
  it("requires a recent password for all-device revocation; OTP/grants cannot substitute and failed attempts are bounded", async () => {
    const c = client();
    await c.signIn();
    await f.prisma.browserSession.update({
      where: { id: (await c.row()).id },
      data: { authenticatedAt: new Date(Date.now() - day) },
    });
    expect((await c.call("devices/revoke-all", "POST", {})).value.code).toBe(
      "RECENT_AUTH_REQUIRED",
    );
    expect(
      (await c.call("reauthenticate", "POST", { code: "123456" })).status,
    ).toBe(400);
    for (let i = 0; i < 5; i++)
      expect(
        (await c.call("reauthenticate", "POST", { password: "wrong" })).status,
      ).toBe(401);
    expect(
      (
        await c.call("reauthenticate", "POST", {
          password: f.manifest.password,
        })
      ).status,
    ).toBe(429);
    await f.prisma.browserSession.update({
      where: { id: (await c.row()).id },
      data: { reauthBlockedUntil: new Date(0) },
    });
    expect(
      (
        await c.call("reauthenticate", "POST", {
          password: f.manifest.password,
        })
      ).status,
    ).toBe(200);
    const row = await c.row();
    const bundle = decryptBrowserBundle<{ accessToken: string }>(
      service.config,
      row.id,
      row.bundle,
    );
    expect((await c.call("devices/revoke-all", "POST", {})).status).toBe(204);
    expect((await bearer(bundle.accessToken)).status).toBe(401);
  });
  it("retains legacy absolute expiry without converting old rows into rolling sessions", async () => {
    const c = client();
    await c.signIn();
    const row = await c.row();
    await f.prisma.browserSession.update({
      where: { id: row.id },
      data: { rolling: false, absoluteExpiresAt: new Date(0) },
    });
    expect((await c.call("activity", "POST", {})).status).toBe(401);
  });
  it("sanitizes a failed rotation without consuming its credential", async () => {
    const c = client();
    await c.signIn();
    const { row } = await forceRefresh(c);
    const original = f.prisma.$transaction.bind(f.prisma);
    const spy = jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      original(async (tx) => {
        const create = jest
          .spyOn(tx.refreshCredential, "create")
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError(
              "private database details",
              { code: "P2024", clientVersion: "fixture" },
            ),
          );
        try {
          return await fn(tx);
        } finally {
          create.mockRestore();
        }
      })) as never);
    try {
      const response = await c.call("api/users/me");
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.value)).not.toContain(
        "private database details",
      );
      expect(
        await f.prisma.refreshCredential.count({
          where: { sessionId: row.refreshId!, consumedAt: null },
        }),
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect((await c.call("api/users/me")).status).toBe(200);
  });
  it("recovers a lost database commit acknowledgement without rotating twice or resurrecting logout", async () => {
    const c = client();
    await c.signIn();
    const { row } = await forceRefresh(c);
    const transaction = f.prisma.$transaction.bind(f.prisma);
    const spy = jest
      .spyOn(f.prisma, "$transaction")
      .mockImplementationOnce((async (
        fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        await transaction(fn);
        throw new Prisma.PrismaClientKnownRequestError("lost acknowledgement", {
          code: "P1001",
          clientVersion: "fixture",
        });
      }) as never);
    try {
      expect((await c.call("api/users/me")).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect((await c.call("api/users/me")).status).toBe(200);
    expect(
      await f.prisma.refreshCredential.count({
        where: { sessionId: row.refreshId! },
      }),
    ).toBe(2);
    expect((await c.call("logout", "POST", {})).status).toBe(204);
    expect((await c.call("api/users/me")).status).toBe(401);
  });
  it("rejects managed refresh credentials on the legacy API and preserves legacy refresh response shape", async () => {
    const c = client();
    await c.signIn();
    const { bundle } = await forceRefresh(c);
    const call = (path: string, body: unknown) =>
      fetch(f.manifest.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (await call("/auth/refresh", { refreshToken: bundle.refreshToken }))
        .status,
    ).toBe(401);
    const login = await (
      await call("/auth/login", {
        username: f.manifest.username,
        password: f.manifest.password,
      })
    ).json();
    const result = await call("/auth/refresh", {
      refreshToken: login.refreshToken,
    });
    expect(result.status).toBe(200);
    expect(Object.keys(await result.json())).toEqual(["accessToken"]);
  });
  it("rechecks current permissions and hides other accounts' device sessions", async () => {
    const c = client();
    await c.signIn();
    const rows = await f.prisma.userRoleAssignment.findMany({
      where: { userId: f.manifest.userId },
    });
    try {
      await f.prisma.userRoleAssignment.deleteMany({
        where: { userId: f.manifest.userId },
      });
      expect((await c.call("api/projects")).status).toBe(403);
      expect((await c.call("api/users/me")).status).toBe(200);
      expect(
        (await c.call("devices/auth-preservation-refresh/revoke", "POST", {}))
          .status,
      ).toBe(400);
      const otherUser = await f.prisma.user.create({
        data: {
          workspaceId: f.manifest.workspaceId,
          fullName: "Other fixture account",
          phoneNumber: randomBytes(16).toString("hex"),
          status: "OPEN",
        },
      });
      const other = await f.prisma.sessionToken.create({
        data: {
          userId: otherUser.id,
          purpose: "REFRESH",
          tokenHash: randomBytes(32).toString("hex"),
          expiresAt: new Date(Date.now() + day),
        },
      });
      try {
        expect(
          (await c.call(`devices/${other.id}/revoke`, "POST", {})).status,
        ).toBe(404);
        expect(
          (await c.call("devices")).value.items.some(
            (d: { id: string }) => d.id === other.id,
          ),
        ).toBe(false);
        expect(
          (
            await f.prisma.sessionToken.findUniqueOrThrow({
              where: { id: other.id },
            })
          ).revokedAt,
        ).toBeNull();
      } finally {
        await f.prisma.sessionToken.delete({ where: { id: other.id } });
        await f.prisma.user.delete({ where: { id: otherUser.id } });
      }
    } finally {
      await f.prisma.userRoleAssignment.createMany({ data: rows });
    }
  });
  it("revokes both browsers and issued JWTs after password reset without requiring an old token to expire", async () => {
    const c = client(),
      b = client();
    await c.signIn();
    await b.signIn();
    const user = await f.prisma.user.findUniqueOrThrow({
      where: { id: f.manifest.userId },
    });
    const row = await c.row();
    const bundle = decryptBrowserBundle<{ accessToken: string }>(
      service.config,
      row.id,
      row.bundle,
    );
    const raw = randomBytes(48).toString("base64url");
    await f.prisma.sessionToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    try {
      await f.app.get(AuthService).resetPassword(`Bearer ${raw}`, {
        password: "Changed-Password-42!",
        passwordConfirmation: "Changed-Password-42!",
      });
      expect((await c.call("api/users/me")).status).toBe(401);
      expect((await b.call("api/users/me")).status).toBe(401);
      expect((await bearer(bundle.accessToken)).status).toBe(401);
    } finally {
      await f.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: user.passwordHash,
          authRevokedAt: user.authRevokedAt,
        },
      });
    }
  });
  it("supports session-bound passwordless OTP step-up without accepting it for password-required accounts", async () => {
    const c = client(),
      other = client();
    await c.signIn();
    await other.signIn();
    expect(
      (await c.call("reauthenticate/otp/send", "POST", { locale: "EN" }))
        .status,
    ).toBe(403);
    const user = await f.prisma.user.findUniqueOrThrow({
      where: { id: f.manifest.userId },
    });
    const auth = f.app.get(AuthService);
    const delivery = jest
      .spyOn(auth, "deliverStepUpOtp")
      .mockResolvedValue(undefined);
    try {
      await f.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: null,
          verifiedAt: new Date(),
          telegramChatId: 123456n,
        },
      });
      expect((await c.call("session")).value.reauthenticationMethod).toBe(
        "telegram-otp",
      );
      expect(
        (
          await c.call("reauthenticate/otp/send", "POST", {
            locale: "EN",
            phoneNumber: "+998900000002",
          })
        ).status,
      ).toBe(400);
      expect(
        (await c.call("reauthenticate/otp/send", "POST", { locale: "EN" }))
          .status,
      ).toBe(200);
      const code = delivery.mock.calls.at(-1)![1];
      expect(delivery).toHaveBeenLastCalledWith(
        123456n,
        expect.stringMatching(/^\d{6}$/),
        AuthLocale.EN,
      );
      expect(
        (await other.call("reauthenticate/otp/verify", "POST", { code }))
          .status,
      ).toBe(401);
      expect(
        (await c.call("reauthenticate/otp/verify", "POST", { code })).status,
      ).toBe(200);
      expect(
        (await c.call("reauthenticate/otp/verify", "POST", { code })).status,
      ).toBe(401);
      expect((await c.call("devices/revoke-all", "POST", {})).status).toBe(204);
      expect((await other.call("api/users/me")).status).toBe(401);
    } finally {
      delivery.mockRestore();
      await f.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: user.passwordHash,
          telegramChatId: user.telegramChatId,
          verifiedAt: user.verifiedAt,
          authRevokedAt: user.authRevokedAt,
        },
      });
    }
  });
  it("closes a direct bearer stream on device revocation before JWT expiry", async () => {
    const c = client(),
      b = client();
    await c.signIn();
    await b.signIn();
    const row = await c.row();
    const bundle = decryptBrowserBundle<{ accessToken: string }>(
      service.config,
      row.id,
      row.bundle,
    );
    f.runner.holdOutput(true);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let sessionId: string | undefined;
    try {
      const created = await c.call("api/sessions", "POST", {
        taskId: f.manifest.taskId,
        projectId: f.manifest.projectId,
        prompt: "Synthetic revocation stream",
        sandbox: "read-only",
        model: "gpt-6-sol",
      });
      expect(created.status).toBe(201);
      sessionId = created.value.id;
      const stream = await fetch(
        `${f.manifest.baseUrl}/sessions/${sessionId}/events/stream?after=0`,
        {
          headers: { Authorization: `Bearer ${bundle.accessToken}` },
          signal: AbortSignal.timeout(6000),
        },
      );
      expect(stream.status).toBe(200);
      reader = stream.body!.getReader();
      await reader.read();
      expect(
        (await b.call(`devices/${row.refreshId}/revoke`, "POST", {})).status,
      ).toBe(204);
      const started = Date.now();
      try {
        while (!(await reader.read()).done) {
          /* drain already accepted batch */
        }
      } catch {
        /* closed transport */
      }
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await reader?.cancel().catch(() => undefined);
      f.runner.holdOutput(false);
      if (sessionId)
        await untilFixture(
          async () =>
            (await f.sessions.get(f.manifest.userId, sessionId!)).status ===
            "COMPLETED",
        );
    }
  }, 15_000);
});
