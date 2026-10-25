import { randomBytes, randomUUID } from "node:crypto";
import { AuthService } from "../src/auth/auth.service";
import { Prisma } from "@prisma/client";
import { BrowserSessionService } from "../src/browser-sessions/browser-session.service";
import {
  browserDigest,
  browserSessionConfig,
  decryptBrowserBundle,
  encryptBrowserBundle,
} from "../src/browser-sessions/browser-session.config";
import { browserProxyAllowed } from "../src/browser-sessions/browser-session.controller";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  untilFixture,
} from "./support/frontend-session-harness";

describe("browser boundary configuration", () => {
  const key = randomBytes(32).toString("base64url");
  it("defaults off and refuses non-HTTPS production and reused keys", () => {
    expect(browserSessionConfig({}).enabled).toBe(false);
    expect(() =>
      browserSessionConfig({
        BROWSER_SESSIONS_ENABLED: "true",
        NODE_ENV: "production",
        BROWSER_SESSION_ORIGIN: "http://localhost",
        BROWSER_SESSION_KEY: key,
      }),
    ).toThrow();
    expect(() =>
      browserSessionConfig({
        BROWSER_SESSIONS_ENABLED: "true",
        BROWSER_SESSION_ORIGIN: "https://example.test",
        BROWSER_SESSION_KEY: key,
        JWT_SECRET: key,
      }),
    ).toThrow();
  });
  it("authenticates ciphertext to its session and key", () => {
    const c = browserSessionConfig({
      BROWSER_SESSIONS_ENABLED: "true",
      BROWSER_SESSION_ORIGIN: "https://example.test",
      BROWSER_SESSION_KEY: key,
    });
    const value = encryptBrowserBundle(c, "session-a", { secret: "test" });
    expect(decryptBrowserBundle(c, "session-a", value)).toEqual({
      secret: "test",
    });
    expect(() => decryptBrowserBundle(c, "session-b", value)).toThrow();
    expect(() =>
      decryptBrowserBundle({ ...c, key: randomBytes(32) }, "session-a", value),
    ).toThrow();
  });
  it("allowlists exact methods/routes without auth, recursive, deletion or file proxies", () => {
    for (const path of [
      "auth/login",
      "browser/session",
      "projects/projects-home",
      "projects/../auth/login",
      "users/me/avatar",
      "sessions/http://evil.test",
    ])
      expect(browserProxyAllowed("GET", path)).toBe(false);
    expect(
      browserProxyAllowed("GET", `sessions/${randomUUID()}/events/stream`),
    ).toBe(true);
    expect(browserProxyAllowed("DELETE", `sessions/${randomUUID()}`)).toBe(
      false,
    );
  });
});

const integration =
  process.env.PROFILE_TEST_DATABASE_URL === fixtureDatabaseUrl
    ? describe
    : describe.skip;
integration("isolated browser cookie HTTP boundary", () => {
  let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
  let origin: string;
  beforeAll(async () => {
    f = await createFrontendSessionHarness(fixtureDatabaseUrl);
    origin = new URL(f.manifest.baseUrl).origin;
  }, 30_000);
  afterAll(async () => {
    await f?.close();
  }, 30_000);
  function client() {
    let cookie = "",
      csrf = "";
    return {
      get cookie() {
        return cookie;
      },
      get csrf() {
        return csrf;
      },
      async call(
        path: string,
        method = "GET",
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await fetch(f.manifest.baseUrl + path, {
          method,
          headers: {
            Cookie: cookie,
            Origin: origin,
            ...(method === "GET"
              ? {}
              : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const set = response.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0]!;
        const text = await response.text();
        const value = text ? JSON.parse(text) : null;
        if (value?.csrfToken) csrf = value.csrfToken;
        return { status: response.status, value, response };
      },
      async signIn() {
        await this.call("/browser/session");
        return this.call("/browser/login", "POST", {
          username: f.manifest.username,
          password: f.manifest.password,
        });
      },
    };
  }
  it("rotates anonymous IDs, retains tab CSRF and never exposes tokens", async () => {
    const c = client(),
      first = await c.call("/browser/session");
    const old = c.cookie,
      csrf = c.csrf;
    expect(first.value.authenticated).toBe(false);
    expect(first.response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Lax/,
    );
    await c.call("/browser/session");
    expect(c.csrf).toBe(csrf);
    const result = await c.signIn();
    expect(result.status).toBe(200);
    expect(result.value.authenticated).toBe(true);
    expect(c.cookie).not.toBe(old);
    expect(c.csrf).not.toBe(csrf);
    expect(JSON.stringify(result.value)).not.toMatch(
      /accessToken|refreshToken|passwordHash/,
    );
    expect((await c.call("/browser/api/users/me")).value.id).toBe(
      f.manifest.userId,
    );
    expect(
      (
        await fetch(f.manifest.baseUrl + "/users/me", {
          headers: { Cookie: c.cookie },
        })
      ).status,
    ).toBe(401);
    expect((await c.call("/browser/api/auth/login")).status).toBe(404);
  });
  it("denies foreign/missing/null origins, wrong CSRF, browser bearer and extra login fields", async () => {
    const c = client();
    await c.call("/browser/session");
    const credentials = {
      username: f.manifest.username,
      password: f.manifest.password,
    };
    for (const Origin of ["https://evil.test", "null", ""])
      expect(
        (await c.call("/browser/login", "POST", credentials, { Origin }))
          .status,
      ).toBe(403);
    expect(
      (
        await fetch(f.manifest.baseUrl + "/browser/login", {
          method: "POST",
          headers: {
            Cookie: c.cookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": c.csrf,
          },
          body: JSON.stringify(credentials),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await c.call("/browser/login", "POST", credentials, {
          "X-CSRF-Token": browserDigest("wrong"),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await c.call("/browser/session", "GET", undefined, {
          Authorization: "Bearer forged",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await c.call("/browser/login", "POST", {
          ...credentials,
          workspaceId: f.manifest.workspaceId,
        })
      ).status,
    ).toBe(400);
  });
  it("retains bad credential 401 and persists no authenticated browser", async () => {
    const c = client();
    await c.call("/browser/session");
    expect(
      (
        await c.call("/browser/login", "POST", {
          username: f.manifest.username,
          password: "incorrect",
        })
      ).status,
    ).toBe(401);
    expect((await c.call("/browser/api/users/me")).status).toBe(401);
  });
  it("emits the production Host-prefixed Secure HttpOnly cookie without Domain", async () => {
    const config = f.app.get(BrowserSessionService).config;
    const previous = config.secure;
    config.secure = true;
    try {
      const value = await client().call("/browser/session");
      const cookie = value.response.headers.get("set-cookie")!;
      expect(cookie).toMatch(/^__Host-probox_sid=/);
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("Domain=");
    } finally {
      config.secure = previous;
    }
  });
  it("serializes concurrent refresh and fails closed on refresh dependency failure", async () => {
    const c = client();
    await c.signIn();
    const service = f.app.get(BrowserSessionService),
      id = browserDigest(c.cookie.split("=")[1]!);
    const row = await f.prisma.browserSession.findUniqueOrThrow({
      where: { id },
    });
    const bundle = decryptBrowserBundle<Record<string, unknown>>(
      service.config,
      id,
      row.bundle,
    );
    await f.prisma.browserSession.update({
      where: { id },
      data: {
        bundle: encryptBrowserBundle(service.config, id, {
          ...bundle,
          accessExpiresAt: 1,
        }),
      },
    });
    const spy = jest.spyOn(f.app.get(AuthService), "sessionAccessToken");
    try {
      const results = await Promise.all([
        c.call("/browser/api/users/me"),
        c.call("/browser/api/authorization/me"),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(spy).toHaveBeenCalledTimes(1);
      const current = await f.prisma.browserSession.findUniqueOrThrow({
        where: { id },
      });
      const refreshed = decryptBrowserBundle<Record<string, unknown>>(
        service.config,
        id,
        current.bundle,
      );
      await f.prisma.browserSession.update({
        where: { id },
        data: {
          bundle: encryptBrowserBundle(service.config, id, {
            ...refreshed,
            accessExpiresAt: 1,
          }),
        },
      });
      spy.mockImplementationOnce(() => {
        throw new (require("@nestjs/common").ServiceUnavailableException)();
      });
      expect((await c.call("/browser/api/users/me")).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
  it("enforces idle/absolute expiry and current workspace/status", async () => {
    for (const field of ["idleExpiresAt", "absoluteExpiresAt"] as const) {
      const c = client();
      await c.signIn();
      await f.prisma.browserSession.update({
        where: { id: browserDigest(c.cookie.split("=")[1]!) },
        data: { [field]: new Date(0) },
      });
      expect((await c.call("/browser/api/users/me")).status).toBe(401);
    }
    const c = client();
    await c.signIn();
    await f.prisma.browserSession.update({
      where: { id: browserDigest(c.cookie.split("=")[1]!) },
      data: { workspaceId: randomUUID() },
    });
    expect((await c.call("/browser/api/users/me")).status).toBe(401);
  });
  it("logout revokes one browser and its issued access token, preserving other browsers", async () => {
    const a = client(),
      b = client();
    await a.signIn();
    await b.signIn();
    const row = await f.prisma.browserSession.findUniqueOrThrow({
      where: { id: browserDigest(a.cookie.split("=")[1]!) },
    });
    const bundle = decryptBrowserBundle<{ accessToken: string }>(
      f.app.get(BrowserSessionService).config,
      row.id,
      row.bundle,
    );
    const oldCookie = a.cookie;
    expect((await a.call("/browser/logout", "POST", {})).status).toBe(204);
    expect(
      (
        await fetch(f.manifest.baseUrl + "/browser/api/users/me", {
          headers: { Cookie: oldCookie },
        })
      ).status,
    ).toBe(401);
    expect((await b.call("/browser/api/users/me")).status).toBe(200);
    expect(
      (
        await fetch(f.manifest.baseUrl + "/users/me", {
          headers: { Authorization: `Bearer ${bundle.accessToken}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await f.prisma.sessionToken.findUniqueOrThrow({
          where: { id: row.refreshId! },
        })
      ).revokedAt,
    ).not.toBeNull();
  });
  it("does not convert a storage outage into an anonymous success", async () => {
    const c = client();
    await c.signIn();
    const spy = jest.spyOn(f.prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("offline", {
        code: "P1001",
        clientVersion: "fixture",
      }),
    );
    try {
      expect((await c.call("/browser/session")).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
  it("rolls back refresh issuance when encrypted browser persistence fails", async () => {
    const c = client();
    await c.call("/browser/session");
    const before = await f.prisma.sessionToken.count({
      where: { userId: f.manifest.userId },
    });
    const original = f.prisma.$transaction.bind(f.prisma);
    const implementation = async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      original(async (tx) => {
        const insert = jest
          .spyOn(tx.browserSession, "create")
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError(
              "fixture storage failure",
              { code: "P2024", clientVersion: "fixture" },
            ),
          );
        try {
          return await callback(tx);
        } finally {
          insert.mockRestore();
        }
      });
    const spy = jest
      .spyOn(f.prisma, "$transaction")
      .mockImplementationOnce(implementation as never);
    try {
      const response = await c.call("/browser/login", "POST", {
        username: f.manifest.username,
        password: f.manifest.password,
      });
      expect(response.status).toBe(503);
      expect(response.response.headers.get("set-cookie")).toBeNull();
      expect(
        await f.prisma.sessionToken.count({
          where: { userId: f.manifest.userId },
        }),
      ).toBe(before);
      expect((await c.call("/browser/session")).value.authenticated).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  });
  it("closes an active SSE after browser logout without interrupting its accepted run", async () => {
    const c = client();
    await c.signIn();
    f.runner.holdOutput(true);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let sessionId: string | undefined;
    try {
      const created = await c.call("/browser/api/sessions", "POST", {
        taskId: f.manifest.taskId,
        projectId: f.manifest.projectId,
        prompt: "Controlled logout stream only",
        sandbox: "read-only",
        model: "gpt-6-sol",
      });
      expect(created.status).toBe(201);
      sessionId = created.value.id;
      const timeout = AbortSignal.timeout(9000);
      const response = await fetch(
        `${f.manifest.baseUrl}/browser/api/sessions/${sessionId}/events/stream?after=0`,
        { headers: { Cookie: c.cookie, Origin: origin }, signal: timeout },
      );
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      await reader.read();
      expect((await c.call("/browser/logout", "POST", {})).status).toBe(204);
      let stopped = false;
      try {
        while (!(await reader.read()).done) {
          /* Drain until revoked stream closes. */
        }
        stopped = true;
      } catch {
        stopped = true;
      }
      expect(stopped).toBe(true);
      expect(timeout.aborted).toBe(false);
      expect(
        (
          await f.prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).status,
      ).toBe("RUNNING");
    } finally {
      await reader?.cancel().catch(() => {});
      f.runner.holdOutput(false);
      if (sessionId)
        await untilFixture(
          async () =>
            (
              await f.prisma.proboxAiSession.findUniqueOrThrow({
                where: { id: sessionId! },
              })
            ).status === "COMPLETED",
        );
    }
  }, 15_000);
  it("cannot resurrect a browser when logout waits behind refresh", async () => {
    const c = client();
    await c.signIn();
    const service = f.app.get(BrowserSessionService),
      id = browserDigest(c.cookie.split("=")[1]!);
    const row = await f.prisma.browserSession.findUniqueOrThrow({
      where: { id },
    });
    const bundle = decryptBrowserBundle<Record<string, unknown>>(
      service.config,
      id,
      row.bundle,
    );
    await f.prisma.browserSession.update({
      where: { id },
      data: {
        bundle: encryptBrowserBundle(service.config, id, {
          ...bundle,
          accessExpiresAt: 1,
        }),
      },
    });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const prisma = f.prisma;
    const original = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      original(async (tx) => {
        const mint = jest
          .spyOn(tx.refreshCredential, "create")
          .mockImplementationOnce((async (
            args: Prisma.RefreshCredentialCreateArgs,
          ) => {
            entered();
            await gate;
            mint.mockRestore();
            return tx.refreshCredential.create(args);
          }) as never);
        try {
          return await fn(tx);
        } finally {
          mint.mockRestore();
        }
      })) as never);
    const cookie = c.cookie;
    try {
      const reading = c.call("/browser/api/users/me");
      await started;
      const loggingOut = c.call("/browser/logout", "POST", {});
      release();
      await reading;
      expect((await loggingOut).status).toBe(204);
      const current = await f.prisma.browserSession.findUniqueOrThrow({
        where: { id },
      });
      expect(current.revokedAt).not.toBeNull();
      expect(
        (
          await fetch(f.manifest.baseUrl + "/browser/api/users/me", {
            headers: { Cookie: cookie },
          })
        ).status,
      ).toBe(401);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it("reloads OPEN status and keeps another workspace out of protected resources", async () => {
    const a = client();
    await a.signIn();
    await f.prisma.user.update({
      where: { id: f.manifest.userId },
      data: { status: "BANNED" },
    });
    try {
      expect((await a.call("/browser/api/users/me")).status).toBe(401);
    } finally {
      await f.prisma.user.update({
        where: { id: f.manifest.userId },
        data: { status: "OPEN" },
      });
    }
    const workspace = await f.prisma.workspace.create({
      data: { slug: `browser-isolation-${randomUUID()}` },
    });
    try {
      const original = await f.prisma.user.findUniqueOrThrow({
        where: { id: f.manifest.userId },
      });
      const username = `browser-${randomUUID().slice(0, 12)}`;
      const user = await f.prisma.user.create({
        data: {
          workspaceId: workspace.id,
          fullName: "Other fixture",
          phoneNumber: `fixture-${randomUUID()}`,
          username,
          passwordHash: original.passwordHash,
          status: "OPEN",
          roleAssignments: {
            create: {
              role: {
                create: {
                  workspaceId: workspace.id,
                  key: "test",
                  name: "Test",
                  permissions: { create: { permissionKey: "tasks.read" } },
                },
              },
            },
          },
        },
      });
      const b = client();
      await b.call("/browser/session");
      expect(
        (
          await b.call("/browser/login", "POST", {
            username,
            password: f.manifest.password,
          })
        ).status,
      ).toBe(200);
      expect((await b.call("/browser/api/users/me")).value.id).toBe(user.id);
      expect(
        (await b.call(`/browser/api/tasks/${f.manifest.taskId}`)).status,
      ).toBe(404);
      expect((await a.call("/browser/api/users/me")).value.id).toBe(
        f.manifest.userId,
      );
    } finally {
      await f.prisma.user.deleteMany({ where: { workspaceId: workspace.id } });
      await f.prisma.role.deleteMany({ where: { workspaceId: workspace.id } });
      await f.prisma.workspace.delete({ where: { id: workspace.id } });
    }
  });
  it("forwards sequenced SSE and REST without token URLs or idle extension", async () => {
    const c = client();
    await c.signIn();
    const created = await c.call("/browser/api/sessions", "POST", {
      taskId: f.manifest.taskId,
      projectId: f.manifest.projectId,
      prompt: "Controlled browser stream only",
      sandbox: "read-only",
      model: "gpt-6-sol",
    });
    expect(created.status).toBe(201);
    const id = browserDigest(c.cookie.split("=")[1]!);
    const before = await f.prisma.browserSession.findUniqueOrThrow({
      where: { id },
    });
    const stream = await fetch(
      `${f.manifest.baseUrl}/browser/api/sessions/${created.value.id}/events/stream?after=0`,
      {
        headers: { Cookie: c.cookie, Origin: origin },
        signal: AbortSignal.timeout(10_000),
      },
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      completed = false,
      lastSequence = 0;
    try {
      while (!completed) {
        const chunk = await reader.read();
        if (chunk.done) throw Error("EOF is not completion");
        buffer += decoder
          .decode(chunk.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          expect(
            Number(
              frame
                .split("\n")
                .find((line) => line.startsWith("id: "))!
                .slice(4),
            ),
          ).toBe(event.sequence);
          expect(event.sequence).toBeGreaterThan(lastSequence);
          lastSequence = event.sequence;
          completed =
            event.type === "session.state" &&
            event.data.sessionStatus === "COMPLETED";
        }
      }
    } finally {
      await reader.cancel();
    }
    expect(
      (await c.call(`/browser/api/sessions/${created.value.id}`)).value.status,
    ).toBe("COMPLETED");
    const after = await f.prisma.browserSession.findUniqueOrThrow({
      where: { id },
    });
    expect(after.idleExpiresAt).toEqual(before.idleExpiresAt);
  }, 15_000);
});
