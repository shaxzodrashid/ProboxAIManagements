import { randomUUID } from "node:crypto";
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
(url ? describe : describe.skip)("durable REST follow-up dispatch", () => {
  let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
    token: string;
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
    const result = await response.json();
    expect({
      status: response.status,
      ...(response.status !== status ? { result } : {}),
    }).toEqual({ status });
    return result;
  };
  const standby = () =>
    new SessionsService(
      f.prisma as PrismaService,
      f.runner as never,
      new SessionEventsService(),
      new ModelCatalogService(),
    );
  const completed = (id: string) =>
    untilFixture(
      async () =>
        (await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }))
          .status === "COMPLETED",
    );
  const create = async () => {
    const result = await call(
      "POST",
      "/sessions",
      {
        taskId: f.manifest.taskId,
        projectId: f.manifest.projectId,
        prompt: "Controlled synthetic initial turn",
        sandbox: "read-only",
      },
      201,
    );
    await completed(result.id);
    return result.id as string;
  };
  const defer = async (id: string, requestId = randomUUID()) => {
    const launch = jest
      .spyOn(
        f.sessions as unknown as {
          launchAccepted(id: string, turnId: string): void;
        },
        "launchAccepted",
      )
      .mockImplementation(() => undefined);
    try {
      return await call(
        "POST",
        `/sessions/${id}/turns`,
        { requestId, prompt: "Controlled follow-up" },
        202,
      );
    } finally {
      launch.mockRestore();
    }
  };
  const expire = (id: string) =>
    f.prisma.proboxAiSession.update({
      where: { id },
      data: { runLeaseExpiresAt: new Date(0) },
    });
  beforeAll(async () => {
    f = await createFrontendSessionHarness(fixtureDatabaseUrl);
    f.sessions.onModuleDestroy();
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
    if (!f) return;
    f.runner.interruptAll();
    await f.prisma.proboxAiSession.updateMany({
      where: {
        creatorId: f.manifest.userId,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { status: "INTERRUPTED", runOwner: null, runLeaseExpiresAt: null },
    });
    await f.close();
  }, 30000);
  it("recovers an accepted never-started follow-up after its process-local callback is lost", async () => {
    const id = await create();
    const suppress = jest
      .spyOn(
        f.sessions as unknown as {
          launchAccepted(sessionId: string, turnId: string): void;
        },
        "launchAccepted",
      )
      .mockImplementation(() => undefined);
    let receipt;
    try {
      receipt = await call(
        "POST",
        `/sessions/${id}/turns`,
        { requestId: randomUUID(), prompt: "Controlled follow-up" },
        202,
      );
    } finally {
      suppress.mockRestore();
    }
    await f.prisma.proboxAiSession.update({
      where: { id },
      data: { runLeaseExpiresAt: new Date(0) },
    });
    await standby().reconcileExpiredRuns();
    const state = await f.prisma.proboxAiSession.findUniqueOrThrow({
      where: { id },
    });
    expect(state.status).not.toBe("INTERRUPTED");
    await completed(id);
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(1);
  });
  it("preserves a live claim and serializes recovery across separate workers", async () => {
    const id = await create(),
      receipt = await defer(id);
    await standby().reconcileExpiredRuns();
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(0);
    await expire(id);
    await Promise.all([
      standby().reconcileExpiredRuns(),
      standby().reconcileExpiredRuns(),
    ]);
    await completed(id);
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(1);
    const prior = await f.prisma.proboxAiTurn.findUniqueOrThrow({
      where: { id: receipt.turnId },
    });
    expect(prior.durableDispatch).toBe(true);
    await call(
      "POST",
      `/sessions/${id}/turns`,
      { requestId: receipt.requestId, prompt: "Controlled follow-up" },
      202,
    );
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(1);
    await call(
      "POST",
      `/sessions/${id}/turns`,
      { requestId: receipt.requestId, prompt: "different" },
      409,
    );
  });
  it("rechecks revoked management permission before recovery can execute", async () => {
    const id = await create(),
      receipt = await defer(id);
    const assignment = await f.prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: f.manifest.userId },
    });
    await f.prisma.rolePermission.deleteMany({
      where: { roleId: assignment.roleId, permissionKey: "sessions.manage" },
    });
    try {
      await expire(id);
      await standby().reconcileExpiredRuns();
      await untilFixture(
        async () =>
          (await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }))
            .status === "FAILED",
      );
      expect(
        f.runner.starts.filter((start) => start.turnId === receipt.turnId),
      ).toHaveLength(0);
      expect(
        await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        stopConfirmation: "NOT_STARTED",
        recoveryReason: "AUTHORIZATION_LOST",
      });
      await call(
        "GET",
        `/sessions/${id}/turns/by-request/${receipt.requestId}`,
        undefined,
        403,
      );
    } finally {
      await f.prisma.rolePermission.create({
        data: { roleId: assignment.roleId, permissionKey: "sessions.manage" },
      });
    }
  });
  it("honors interruption of the queued turn before a recovery claim", async () => {
    const id = await create(),
      receipt = await defer(id);
    await call("POST", `/sessions/${id}/interrupt`, { turnId: receipt.turnId });
    await expire(id);
    await standby().reconcileExpiredRuns();
    expect(
      (await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }))
        .status,
    ).toBe("INTERRUPTED");
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(0);
  });
  it("does not replay an ambiguous external start or silently permit a new turn", async () => {
    const id = await create(),
      receipt = await defer(id);
    await f.prisma.proboxAiTurn.update({
      where: { id: receipt.turnId },
      data: { status: "RUNNING", executionStartedAt: new Date() },
    });
    await f.prisma.proboxAiSession.update({
      where: { id },
      data: {
        runLeaseExpiresAt: new Date(0),
        stopConfirmation: "STOP_UNCONFIRMED",
      },
    });
    await standby().reconcileExpiredRuns();
    expect(
      await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      status: "INTERRUPTED",
      stopConfirmation: "STOP_UNCONFIRMED",
    });
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(0);
    await call(
      "POST",
      `/sessions/${id}/turns`,
      { requestId: randomUUID(), prompt: "New work" },
      409,
    );
    expect(
      (
        await call(
          "POST",
          `/sessions/${id}/turns`,
          { requestId: receipt.requestId, prompt: "Controlled follow-up" },
          202,
        )
      ).turnId,
    ).toBe(receipt.turnId);
  });
  it("keeps legacy unopted never-started turns interrupted without execution", async () => {
    const id = await create(),
      receipt = await defer(id);
    await f.prisma.proboxAiTurn.update({
      where: { id: receipt.turnId },
      data: { durableDispatch: false },
    });
    await expire(id);
    await standby().reconcileExpiredRuns();
    expect(
      await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: "INTERRUPTED", stopConfirmation: "NOT_STARTED" });
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(0);
  });
  it("recovers a second lost claim and fences the original worker's late callback", async () => {
    const id = await create(),
      receipt = await defer(id),
      failedWorker = standby();
    const suppress = jest
      .spyOn(
        failedWorker as unknown as {
          launchAccepted(id: string, turnId: string): void;
        },
        "launchAccepted",
      )
      .mockImplementation(() => undefined);
    await expire(id);
    try {
      await failedWorker.reconcileExpiredRuns();
    } finally {
      suppress.mockRestore();
    }
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(0);
    await (
      f.sessions as unknown as {
        runAcceptedTurn(id: string, turnId: string): Promise<void>;
      }
    ).runAcceptedTurn(id, receipt.turnId);
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(0);
    await expire(id);
    await standby().reconcileExpiredRuns();
    await completed(id);
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(1);
    expect(
      (await f.prisma.proboxAiSession.findUniqueOrThrow({ where: { id } }))
        .dispatchAttempts,
    ).toBe(2);
  });
  it("recovers committed acceptance after a lost acknowledgement using the original key", async () => {
    const id = await create(),
      requestId = randomUUID(),
      transaction = f.prisma.$transaction.bind(f.prisma);
    const lost = jest
      .spyOn(f.prisma, "$transaction")
      .mockImplementationOnce((async (
        fn: Parameters<typeof transaction>[0],
      ) => {
        await transaction(fn);
        throw new Error("Synthetic lost commit acknowledgement");
      }) as unknown as typeof f.prisma.$transaction);
    try {
      await call(
        "POST",
        `/sessions/${id}/turns`,
        { requestId, prompt: "Controlled follow-up" },
        503,
      );
    } finally {
      lost.mockRestore();
    }
    const receipt = await call(
      "GET",
      `/sessions/${id}/turns/by-request/${requestId}`,
    );
    expect(receipt.status).toBe("QUEUED");
    expect(
      (
        await call(
          "POST",
          `/sessions/${id}/turns`,
          { requestId, prompt: "Controlled follow-up" },
          202,
        )
      ).turnId,
    ).toBe(receipt.turnId);
    await expire(id);
    await standby().reconcileExpiredRuns();
    await completed(id);
    expect(
      f.runner.starts.filter((start) => start.turnId === receipt.turnId),
    ).toHaveLength(1);
  });
});
