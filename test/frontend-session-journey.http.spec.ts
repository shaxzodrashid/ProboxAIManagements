import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";

const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
describe("controlled handoff target restrictions", () => {
  it.each([
    undefined,
    "postgresql://profile_test@remote:55439/profile_test",
    fixtureDatabaseUrl + "?host=remote",
  ])("rejects every non-fixture connection", (value) => {
    expect(() => requireFixtureDatabase(value)).toThrow("isolated fixture URL");
  });
});
(url ? describe : describe.skip)(
  "real login to controlled session output/completion HTTP",
  () => {
    let h: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
      token: string;
    const call = async (
      method: string,
      path: string,
      body?: object,
      status = 200,
    ) => {
      const response = await fetch(h.manifest.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      expect(response.status).toBe(status);
      return value;
    };
    const create = () =>
      call(
        "POST",
        "/sessions",
        {
          taskId: h.manifest.taskId,
          projectId: h.manifest.projectId,
          prompt: "Never execute this prompt; controlled output only",
          sandbox: "read-only",
          providerId: "openai",
          model: "gpt-6-sol",
          reasoningEffort: "medium",
        },
        201,
      );
    const completed = async (id: string) => {
      await untilFixture(
        async () =>
          (await h.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }))
            .status === "COMPLETED",
      );
      return call("GET", `/sessions/${id}`);
    };
    async function stream(id: string, after = 0, lastEventId?: number) {
      const response = await fetch(
        `${h.manifest.baseUrl}/sessions/${id}/events/stream${lastEventId === undefined ? `?after=${after}` : ""}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(lastEventId === undefined
              ? {}
              : { "Last-Event-ID": String(lastEventId) }),
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      const events: { sequence: number; type: string; data: any }[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done)
            throw new Error("Transport EOF did not establish completion");
          buffer = (
            buffer + decoder.decode(chunk.value, { stream: true })
          ).replace(/\r\n/g, "\n");
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const lines = frame.split("\n"),
              data = lines.find((line) => line.startsWith("data: "));
            if (!data) continue;
            const event = JSON.parse(data.slice(6));
            expect(
              Number(lines.find((line) => line.startsWith("id: "))!.slice(4)),
            ).toBe(event.sequence);
            events.push(event);
            if (
              event.type === "session.state" &&
              event.data.sessionStatus === "COMPLETED"
            )
              return events;
          }
        }
      } finally {
        await reader.cancel();
      }
    }
    beforeAll(async () => {
      h = await createFrontendSessionHarness(url!);
      const response = await fetch(h.manifest.baseUrl + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: h.manifest.username,
          password: h.manifest.password,
        }),
      });
      expect(response.status).toBe(200);
      token = (await response.json()).accessToken;
    }, 30000);
    afterAll(async () => {
      h?.runner.holdOutput(false);
      await h?.close();
    }, 20000);
    it("uses the real API from identity/setup through sequenced SSE and authoritative completion", async () => {
      expect((await call("GET", "/users/me")).id).toBe(h.manifest.userId);
      expect((await call("GET", "/authorization/me")).permissions).toContain(
        "sessions.create",
      );
      expect((await call("GET", "/projects"))[0].id).toBe(h.manifest.projectId);
      expect((await call("GET", "/tasks"))[0].id).toBe(h.manifest.taskId);
      const catalog = await call("GET", "/sessions/model-catalog");
      expect(catalog.providers[0].models.length).toBeGreaterThan(0);
      expect(
        (
          await call("POST", "/sessions/directory-preflight", {
            taskId: h.manifest.taskId,
            projectId: h.manifest.projectId,
            sandbox: "read-only",
          })
        ).valid,
      ).toBe(true);
      const created = await create();
      expect(created.initialTurn.id).toBeTruthy();
      expect(created.status).toBe("RUNNING");
      const events = await stream(created.id),
        detail = await completed(created.id);
      expect(events.map((e) => e.sequence)).toEqual(
        Array.from({ length: events.length }, (_, i) => i + 1),
      );
      expect(
        events.some((e) =>
          e.data.item?.text.includes("Controlled local fixture output"),
        ),
      ).toBe(true);
      expect(detail.turns[0].status).toBe("COMPLETED");
      expect(detail.stopConfirmation).toBe("LOCAL_EXIT_OBSERVED");
      const history = await call(
        "GET",
        `/sessions/${created.id}/events?after=0&limit=100`,
      );
      expect(history.events).toEqual(events);
      expect(history.highWaterSequence).toBe(events.at(-1)!.sequence);
      expect(
        h.runner.starts.filter((x) => x.sessionId === created.id),
      ).toHaveLength(1);
      expect(
        (await call("GET", `/sessions?taskId=${h.manifest.taskId}`)).items.some(
          (s: any) => s.id === created.id,
        ),
      ).toBe(true);
    }, 20000);
    it("reconnects by Last-Event-ID without duplicate persisted sequences", async () => {
      const created = await create();
      await completed(created.id);
      const history = await call(
          "GET",
          `/sessions/${created.id}/events?after=0&limit=100`,
        ),
        pivot = history.events[1].sequence;
      const resumed = await stream(created.id, 0, pivot);
      expect(resumed).toEqual(
        history.events.filter((e: any) => e.sequence > pivot),
      );
      await call(
        "GET",
        `/sessions/${created.id}/events/stream?after=0&untilSequence=1`,
        undefined,
        400,
      );
    }, 20000);
    it("deduplicates exact follow-ups, rejects changed/active requests, and keeps the session model", async () => {
      const created = await create();
      await completed(created.id);
      h.runner.holdOutput(true);
      try {
        const requestId = randomUUID(),
          body = { requestId, prompt: "Controlled follow-up" };
        const accepted = await call(
          "POST",
          `/sessions/${created.id}/turns`,
          body,
          202,
        );
        const same = await call(
          "POST",
          `/sessions/${created.id}/turns`,
          body,
          202,
        );
        expect(same.turnId).toBe(accepted.turnId);
        expect(
          (
            await call(
              "GET",
              `/sessions/${created.id}/turns/by-request/${requestId}`,
            )
          ).turnId,
        ).toBe(accepted.turnId);
        await call(
          "POST",
          `/sessions/${created.id}/turns`,
          { ...body, prompt: "Changed" },
          409,
        );
        await call(
          "POST",
          `/sessions/${created.id}/turns`,
          { requestId: randomUUID(), prompt: "Another active turn" },
          409,
        );
        await untilFixture(
          async () =>
            h.runner.starts.filter((x) => x.sessionId === created.id).length ===
            2,
        );
      } finally {
        h.runner.holdOutput(false);
      }
      const detail = await completed(created.id);
      expect(detail.turns).toHaveLength(2);
      expect(
        h.runner.starts
          .filter((x) => x.sessionId === created.id)
          .map((x) => [x.providerId, x.model, x.reasoningEffort]),
      ).toEqual([
        ["openai", "gpt-6-sol", "medium"],
        ["openai", "gpt-6-sol", "medium"],
      ]);
    }, 20000);
    it.each(["event", "lease"])(
      "keeps %s persistence from holding the session while a workspace mutation is ahead of it",
      async (path) => {
        h.runner.holdOutput(true);
        const created = await create();
        await untilFixture(
          async () =>
            !!(await h.prisma.sessionEvent.findFirst({
              where: { sessionId: created.id, type: "turn.started" },
            })),
        );
        const database = new PrismaClient({
          datasources: { db: { url: fixtureDatabaseUrl } },
        });
        let releaseWorkspace!: () => void,
          workspaceHeld!: () => void,
          releaseEvent!: () => void,
          firstLock!: (kind: string) => void;
        const releaseWorkspaceWait = new Promise<void>((r) => {
            releaseWorkspace = r;
          }),
          workspaceHeldWait = new Promise<void>((r) => {
            workspaceHeld = r;
          });
        const releaseEventWait = new Promise<void>((r) => {
            releaseEvent = r;
          }),
          firstLockWait = new Promise<string>((r) => {
            firstLock = r;
          });
        const blocker = database.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${h.manifest.workspaceId} FOR UPDATE`;
            workspaceHeld();
            await releaseWorkspaceWait;
          },
          { timeout: 10000 },
        );
        await workspaceHeldWait;
        const original = h.prisma.$transaction.bind(h.prisma);
        const transaction = jest
          .spyOn(h.prisma, "$transaction")
          .mockImplementation(((
            operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            original(async (tx) =>
              operation(
                new Proxy(tx, {
                  get(target, key, receiver) {
                    if (key !== "$queryRaw")
                      return Reflect.get(target, key, receiver);
                    return async (...args: unknown[]) => {
                      const sql = String(args[0]);
                      if (
                        sql.includes('"Workspace"') &&
                        sql.includes("FOR UPDATE")
                      )
                        firstLock("workspace");
                      const result = await (
                        target.$queryRaw as (
                          ...args: unknown[]
                        ) => Promise<unknown>
                      )(...args);
                      if (
                        !sql.includes('"Workspace"') &&
                        sql.includes('"ProboxAiSession"') &&
                        sql.includes("FOR UPDATE")
                      ) {
                        firstLock("session-held");
                        await releaseEventWait;
                      }
                      return result;
                    };
                  },
                }),
              ),
            )) as never);
        const event =
          path === "event"
            ? h.runner.emitForTest(created.id, "thread.started", {
                thread_id: `fixture_rechecked_${created.id}`,
              })
            : (
                h.sessions as unknown as {
                  renewLease: (id: string, turnId: string) => Promise<void>;
                }
              ).renewLease(created.id, created.initialTurn.id);
        try {
          await firstLockWait;
          // Physical lock availability, not a query-text/order-only assertion.
          await expect(
            database.$transaction(
              (tx) =>
                tx.$queryRaw`SELECT id FROM "ProboxAiSession" WHERE id = ${created.id} FOR UPDATE NOWAIT`,
            ),
          ).resolves.toHaveLength(1);
        } finally {
          releaseWorkspace();
          releaseEvent();
          await Promise.allSettled([blocker, event]);
          transaction.mockRestore();
          await database.$disconnect();
          h.runner.holdOutput(false);
          await completed(created.id);
        }
      },
      20000,
    );
    it("targets interruption to the observed turn and reconciles persisted terminal state", async () => {
      h.runner.holdOutput(true);
      const created = await create();
      try {
        await untilFixture(async () =>
          h.runner.starts.some((x) => x.sessionId === created.id),
        );
        await call(
          "POST",
          `/sessions/${created.id}/interrupt`,
          { turnId: randomUUID() },
          404,
        );
        const result = await call("POST", `/sessions/${created.id}/interrupt`, {
          turnId: created.initialTurn.id,
        });
        expect(result).toMatchObject({
          interrupted: true,
          turnId: created.initialTurn.id,
        });
        expect(result.requestedAt).toBeTruthy();
        await untilFixture(
          async () =>
            (
              await h.prisma.proboxAiSession.findUniqueOrThrow({
                where: { id: created.id },
              })
            ).status === "INTERRUPTED",
        );
        const detail = await call("GET", `/sessions/${created.id}`);
        expect(detail.turns[0].status).toBe("INTERRUPTED");
        expect(detail.stopConfirmation).toBe("LOCAL_EXIT_OBSERVED");
      } finally {
        h.runner.holdOutput(false);
      }
    }, 20000);
  },
);
