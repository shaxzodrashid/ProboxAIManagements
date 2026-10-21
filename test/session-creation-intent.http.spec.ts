import { randomBytes, randomUUID } from "node:crypto";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)("durable initial session intent HTTP", () => {
  let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
    token: string;
  let schedule: jest.SpyInstance;
  const oldKeys = process.env.SESSION_INPUT_KEYS,
    oldId = process.env.SESSION_INPUT_KEY_ID;
  const call = async (
    method: string,
    path: string,
    body?: object,
    status = 200,
  ) => {
    const response = await fetch(f.manifest.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    expect({
      status: response.status,
      ...(response.status !== status ? { value } : {}),
    }).toEqual({ status });
    return value;
  };
  const input = (requestId = randomUUID()) => ({
    requestId,
    taskId: f.manifest.taskId,
    projectId: f.manifest.projectId,
    prompt: "Controlled fixture execution only",
    sandbox: "read-only",
    providerId: "openai",
    model: "gpt-6-sol",
    reasoningEffort: "medium",
  });
  beforeAll(async () => {
    process.env.SESSION_INPUT_KEYS = JSON.stringify({
      fixture: randomBytes(32).toString("base64url"),
    });
    process.env.SESSION_INPUT_KEY_ID = "fixture";
    f = await createFrontendSessionHarness(fixtureDatabaseUrl);
    f.sessions.onModuleDestroy();
    schedule = jest
      .spyOn(
        f.sessions as unknown as { scheduleCreationDispatch(): void },
        "scheduleCreationDispatch",
      )
      .mockImplementation(() => undefined);
    const response = await fetch(f.manifest.baseUrl + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: f.manifest.username,
        password: f.manifest.password,
      }),
    });
    expect(response.status).toBe(200);
    token = (await response.json()).accessToken;
  }, 30000);
  afterAll(async () => {
    if (f) {
      f.runner.interruptAll();
      await f.prisma.proboxAiSession.updateMany({
        where: {
          creatorId: f.manifest.userId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: {
          status: "INTERRUPTED",
          runOwner: null,
          runLeaseExpiresAt: null,
        },
      });
      schedule?.mockRestore();
      await f.close();
    }
    if (oldKeys === undefined) delete process.env.SESSION_INPUT_KEYS;
    else process.env.SESSION_INPUT_KEYS = oldKeys;
    if (oldId === undefined) delete process.env.SESSION_INPUT_KEY_ID;
    else process.env.SESSION_INPUT_KEY_ID = oldId;
  }, 30000);
  it("returns the same minimal receipt for concurrent transport retries", async () => {
    const body = input();
    const receipts = await Promise.all([
      call("POST", "/sessions/creations", body, 201),
      call("POST", "/sessions/creations", body, 201),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(Object.keys(receipts[0]).sort()).toEqual([
      "accepted",
      "acceptedAt",
      "initialTurnId",
      "requestId",
      "sessionId",
    ]);
    expect(
      await f.prisma.proboxAiSession.count({
        where: {
          creatorId: f.manifest.userId,
          creationRequestId: body.requestId,
        },
      }),
    ).toBe(1);
    expect(
      await f.prisma.proboxAiTurn.count({
        where: { sessionId: receipts[0].sessionId },
      }),
    ).toBe(1);
    expect(await call("GET", `/sessions/creations/${body.requestId}`)).toEqual(
      receipts[0],
    );
    await call(
      "POST",
      "/sessions/creations",
      { ...body, prompt: "different" },
      409,
    );
  });
  it("accepts identical intentional reruns immediately under different intent IDs", async () => {
    const body = input();
    const first = await call("POST", "/sessions/creations", body, 201);
    const second = await call(
      "POST",
      "/sessions/creations",
      { ...body, requestId: randomUUID() },
      201,
    );
    expect(second.sessionId).not.toBe(first.sessionId);
    const row = await f.prisma.proboxAiSession.findUniqueOrThrow({
      where: { id: second.sessionId },
      include: { turns: true },
    });
    expect(row.status).toBe("QUEUED");
    expect(row.runOwner).toBeNull();
    expect(row.turns[0]?.encryptedPrompt).toMatch(/^v1\.fixture\./);
    expect(row.runtimeProvenance).toEqual(
      expect.objectContaining({ archivePolicyVersion: 1, runnerVersion: null }),
    );
  });
  it("claims committed pending work once and recovers without the original callback", async () => {
    const receipt = await call("POST", "/sessions/creations", input(), 201);
    const before = f.runner.starts.length;
    await Promise.all([
      f.sessions.dispatchPendingCreations(),
      f.sessions.dispatchPendingCreations(),
    ]);
    await untilFixture(
      async () =>
        (
          await f.prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: receipt.sessionId },
          })
        ).status === "COMPLETED",
    );
    expect(
      f.runner.starts.filter((start) => start.sessionId === receipt.sessionId),
    ).toHaveLength(1);
    expect(f.runner.starts.length).toBeGreaterThan(before);
    await f.sessions.dispatchPendingCreations();
    expect(
      f.runner.starts.filter((start) => start.sessionId === receipt.sessionId),
    ).toHaveLength(1);
    const archive = await call("GET", `/sessions/${receipt.sessionId}/archive`);
    expect(archive.archiveEvents.length).toBeLessThanOrEqual(1);
    expect(archive.record).toBeDefined();
    const turns = await call("GET", `/sessions/${receipt.sessionId}/turns`);
    expect(JSON.stringify(turns)).not.toContain("encryptedPrompt");
  }, 30000);
  it("does not create a run when protection configuration is unavailable", async () => {
    const keys = process.env.SESSION_INPUT_KEYS;
    delete process.env.SESSION_INPUT_KEYS;
    const body = input();
    try {
      await call("POST", "/sessions/creations", body, 503);
      expect(
        await f.prisma.proboxAiSession.count({
          where: {
            creatorId: f.manifest.userId,
            creationRequestId: body.requestId,
          },
        }),
      ).toBe(0);
    } finally {
      process.env.SESSION_INPUT_KEYS = keys;
    }
    await call("POST", "/sessions/creations", body, 201);
  });
  const standby = () =>
    new SessionsService(
      f.prisma as PrismaService,
      f.runner as never,
      new SessionEventsService(),
      new ModelCatalogService(),
    );
  it("serializes claims from separate worker instances", async () => {
    const receipt = await call("POST", "/sessions/creations", input(), 201);
    await Promise.all([
      standby().dispatchPendingCreations(),
      standby().dispatchPendingCreations(),
    ]);
    await untilFixture(
      async () =>
        (
          await f.prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: receipt.sessionId },
          })
        ).status === "COMPLETED",
    );
    expect(
      f.runner.starts.filter((start) => start.sessionId === receipt.sessionId),
    ).toHaveLength(1);
    expect(
      (
        await f.prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: receipt.sessionId },
        })
      ).dispatchAttempts,
    ).toBe(1);
  });
  it("reclaims an expired claim that never reached the external start boundary", async () => {
    const receipt = await call("POST", "/sessions/creations", input(), 201);
    const crashed = standby();
    const launch = jest
      .spyOn(
        crashed as unknown as {
          launchAccepted(sessionId: string, turnId: string): void;
        },
        "launchAccepted",
      )
      .mockImplementation(() => undefined);
    await crashed.dispatchPendingCreations();
    launch.mockRestore();
    const claimed = await f.prisma.proboxAiSession.findUniqueOrThrow({
      where: { id: receipt.sessionId },
    });
    expect(claimed.status).toBe("RUNNING");
    expect(
      f.runner.starts.filter((start) => start.sessionId === receipt.sessionId),
    ).toHaveLength(0);
    await f.prisma.proboxAiSession.update({
      where: { id: receipt.sessionId },
      data: { runLeaseExpiresAt: new Date(0) },
    });
    await standby().reconcileExpiredRuns();
    await untilFixture(
      async () =>
        (
          await f.prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: receipt.sessionId },
          })
        ).status === "COMPLETED",
    );
    expect(
      f.runner.starts.filter((start) => start.sessionId === receipt.sessionId),
    ).toHaveLength(1);
    expect(
      (
        await f.prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: receipt.sessionId },
        })
      ).dispatchAttempts,
    ).toBe(2);
  });
  it("interrupts an ambiguous external start and never dispatches it again", async () => {
    const body = input(),
      receipt = await call("POST", "/sessions/creations", body, 201);
    await f.prisma.proboxAiTurn.update({
      where: { id: receipt.initialTurnId },
      data: { status: "RUNNING", executionStartedAt: new Date() },
    });
    await f.prisma.proboxAiSession.update({
      where: { id: receipt.sessionId },
      data: {
        status: "RUNNING",
        runOwner: randomUUID(),
        runLeaseExpiresAt: new Date(0),
        stopConfirmation: "STOP_UNCONFIRMED",
      },
    });
    await standby().reconcileExpiredRuns();
    await standby().dispatchPendingCreations();
    const row = await f.prisma.proboxAiSession.findUniqueOrThrow({
      where: { id: receipt.sessionId },
    });
    expect(row.status).toBe("INTERRUPTED");
    expect(row.stopConfirmation).toBe("STOP_UNCONFIRMED");
    expect(
      f.runner.starts.filter((start) => start.sessionId === receipt.sessionId),
    ).toHaveLength(0);
    expect(await call("POST", "/sessions/creations", body, 201)).toEqual(
      receipt,
    );
  });
  it("fails before external start if the retained decryption key becomes unavailable", async () => {
    const receipt = await call("POST", "/sessions/creations", input(), 201),
      keys = process.env.SESSION_INPUT_KEYS;
    delete process.env.SESSION_INPUT_KEYS;
    try {
      await standby().dispatchPendingCreations();
      await untilFixture(
        async () =>
          (
            await f.prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: receipt.sessionId },
            })
          ).status === "FAILED",
      );
      const row = await f.prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: receipt.sessionId },
      });
      expect(row.stopConfirmation).toBe("NOT_STARTED");
      expect(row.recoveryReason).toBe("INPUT_UNAVAILABLE");
      expect(
        f.runner.starts.filter(
          (start) => start.sessionId === receipt.sessionId,
        ),
      ).toHaveLength(0);
    } finally {
      process.env.SESSION_INPUT_KEYS = keys;
    }
  });
  it("rechecks current permissions for receipt and every history page", async () => {
    const receipt = await call("POST", "/sessions/creations", input(), 201);
    const assignment = await f.prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: f.manifest.userId },
    });
    await f.prisma.rolePermission.deleteMany({
      where: {
        roleId: assignment.roleId,
        permissionKey: { in: ["sessions.create", "sessions.read"] },
      },
    });
    try {
      await call(
        "GET",
        `/sessions/creations/${receipt.requestId}`,
        undefined,
        403,
      );
      await call(
        "GET",
        `/sessions/${receipt.sessionId}/archive`,
        undefined,
        403,
      );
      await call("GET", `/sessions/${receipt.sessionId}/turns`, undefined, 403);
    } finally {
      await f.prisma.rolePermission.createMany({
        data: ["sessions.create", "sessions.read"].map((permissionKey) => ({
          roleId: assignment.roleId,
          permissionKey,
        })),
        skipDuplicates: true,
      });
    }
  });
  it("persists full sanitized assistant detail and reported usage while tool retrieval stays strict", async () => {
    await standby().dispatchPendingCreations();
    await untilFixture(
      async () =>
        (await f.prisma.proboxAiSession.count({
          where: {
            creatorId: f.manifest.userId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
        })) === 0,
    );
    const secret = "archive-fixture-secret-only-123456789",
      text = "full visible assistant response ".repeat(1500);
    const oldSecret = process.env.FIXTURE_API_KEY;
    process.env.FIXTURE_API_KEY = secret;
    const receipt = await call(
      "POST",
      "/sessions/creations",
      { ...input(), prompt: `exact original ${secret}` },
      201,
    );
    let received = "";
    const execute = jest
      .spyOn(f.runner, "start")
      .mockImplementationOnce(async (options, onEvent) => {
        expect(options.archiveToDatabase).toBe(true);
        received = options.prompt;
        await onEvent({
          type: "item.completed",
          payload: { item: { type: "agent_message", text: text + secret } },
          rawLine: "",
        });
        await onEvent({
          type: "item.completed",
          payload: {
            item: {
              type: "command_execution",
              command: `echo ${secret}`,
              aggregated_output: `tool ${secret}`,
              exit_code: 0,
            },
          },
          rawLine: "",
        });
        await onEvent({
          type: "item.completed",
          payload: {
            item: { type: "reasoning", text: "hidden-private-reasoning" },
          },
          rawLine: "",
        });
        await onEvent({
          type: "turn.completed",
          payload: { usage: { input_tokens: 13, output_tokens: 34 } },
          rawLine: "",
        });
        return 0;
      });
    try {
      await standby().dispatchPendingCreations();
      await untilFixture(
        async () =>
          (
            await f.prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: receipt.sessionId },
            })
          ).status === "COMPLETED",
      );
      expect(received).toBe(`exact original ${secret}`);
      const events = await f.prisma.sessionEvent.findMany({
        where: { sessionId: receipt.sessionId },
        orderBy: { sequence: "asc" },
      });
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(JSON.stringify(events)).not.toContain("hidden-private-reasoning");
      const assistant = events.find((event) =>
        JSON.stringify(event.archivePayload).includes(text),
      )!;
      expect(assistant).toBeDefined();
      expect(JSON.stringify(assistant.rawPayload).length).toBeLessThan(
        text.length,
      );
      const detail = await call(
        "GET",
        `/sessions/${receipt.sessionId}/archive?after=${assistant.sequence - 1}&limit=1`,
      );
      expect(JSON.stringify(detail.archiveEvents)).toContain(text);
      const tool = events.find((event) =>
        JSON.stringify(event.archivePayload).includes("command_execution"),
      )!;
      const toolPage = await call(
        "GET",
        `/sessions/${receipt.sessionId}/archive?after=${tool.sequence - 1}&limit=1`,
      );
      expect(toolPage.archiveEvents[0].data.omissionReason).toBe(
        "STRICT_TOOL_DISCLOSURE",
      );
      const turns = await call("GET", `/sessions/${receipt.sessionId}/turns`);
      expect(turns.items[0].usageProvenance).toEqual(
        expect.objectContaining({
          source: "RUNNER_TURN_COMPLETED",
          normalizedCost: null,
          reportedUsage: { input_tokens: 13, output_tokens: 34 },
        }),
      );
    } finally {
      execute.mockRestore();
      if (oldSecret === undefined) delete process.env.FIXTURE_API_KEY;
      else process.env.FIXTURE_API_KEY = oldSecret;
    }
  });
  it("retains old records and paginates long-lived turns without exposing input ciphertext", async () => {
    const receipt = await call("POST", "/sessions/creations", input(), 201);
    const oldDate = new Date("2025-01-01T00:00:00Z");
    await f.prisma.proboxAiSession.update({
      where: { id: receipt.sessionId },
      data: { createdAt: oldDate },
    });
    await f.prisma.proboxAiTurn.update({
      where: { id: receipt.initialTurnId },
      data: { startedAt: oldDate },
    });
    await f.prisma.proboxAiTurn.createMany({
      data: Array.from({ length: 55 }, (_, n) => ({
        sessionId: receipt.sessionId,
        prompt: `historical turn ${n}`,
        status: "COMPLETED" as const,
        startedAt: new Date(oldDate.getTime() + n + 1),
        requestedById: f.manifest.userId,
      })),
    });
    const first = await call("GET", `/sessions/${receipt.sessionId}/turns`);
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    const second = await call(
      "GET",
      `/sessions/${receipt.sessionId}/turns?cursor=${first.nextCursor}`,
    );
    expect(second.items).toHaveLength(6);
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.items, ...second.items].map((turn) => turn.id)).size,
    ).toBe(56);
    const different = await call("POST", "/sessions/creations", input(), 201);
    await call(
      "GET",
      `/sessions/${different.sessionId}/turns?cursor=${first.nextCursor}`,
      undefined,
      400,
    );
    expect(
      (await call("GET", `/sessions/${receipt.sessionId}/archive`)).record
        .retentionPolicy,
    ).toBe("RETAIN_UNTIL_AUTHORIZED_DELETION");
  });
});
