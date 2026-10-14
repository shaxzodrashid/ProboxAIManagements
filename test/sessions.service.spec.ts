import { randomUUID } from "node:crypto";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { SessionsService } from "../src/sessions/sessions.service";

function setup() {
  const session = {
    id: "session",
    workspaceId: "workspace",
    task: { managerId: "actor", workspaceId: "workspace" },
    taskId: "task",
    status: "COMPLETED",
    cwd: "/opt/apps/project",
    sandbox: "workspace-write",
    model: "claude-fable-5-1",
    providerId: "anthropic",
    effectiveReasoningEffort: "max",
    codexThreadId: "existing-thread",
    startedAt: new Date(),
    lastSequence: 0,
    events: [],
  };
  const turn = {
    id: "turn",
    sessionId: "session",
    prompt: "",
    status: "QUEUED",
    executionStartedAt: null,
  };
  let created = false;
  let lastEvent: any = null;
  let lock = Promise.resolve();
  const prisma: any = {
    $queryRaw: jest.fn(async () => [{ now: new Date() }]),
    user: {
      findUnique: jest.fn(async () => ({
        workspaceId: "workspace",
        status: "OPEN",
        roleAssignments: [
          { role: { permissions: [{ permissionKey: "sessions.manage" }] } },
        ],
      })),
    },
    proboxAiSession: {
      findUnique: jest.fn(async () => ({ ...session })),
      findUniqueOrThrow: jest.fn(async () => session),
      findMany: jest.fn(async () => [session]),
      updateMany: jest.fn(async () => {
        if (session.status === "RUNNING") return { count: 0 };
        session.status = "RUNNING";
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(session, data)),
    },
    proboxAiTurn: {
      findUnique: jest.fn(async ({ where }) =>
        where.id ? turn : created ? turn : null,
      ),
      findFirst: jest.fn(async () => turn),
      create: jest.fn(async ({ data }) => {
        created = true;
        return Object.assign(turn, data);
      }),
      findUniqueOrThrow: jest.fn(async () => turn),
      updateMany: jest.fn(async ({ data }) => {
        if (turn.status !== "QUEUED") return { count: 0 };
        Object.assign(turn, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(turn, data)),
    },
    task: {
      update: jest.fn(),
      findUnique: jest.fn(async () => ({
        id: "task",
        workspaceId: "workspace",
        managerId: "actor",
      })),
    },
    sessionEvent: {
      findFirst: jest.fn(async () => lastEvent),
      create: jest.fn(
        async ({ data }) => (lastEvent = { id: randomUUID(), ...data }),
      ),
    },
    $transaction: jest.fn(async (operations: any) => {
      if (Array.isArray(operations)) return Promise.all(operations);
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((r) => {
        release = r;
      });
      await previous;
      try {
        return await operations(prisma);
      } finally {
        release();
      }
    }),
  };
  const runner = { start: jest.fn().mockResolvedValue(0) };
  const service = new SessionsService(
    prisma as never,
    runner as never,
    { publish: jest.fn() } as never,
    new ModelCatalogService(),
    {
      executionDirectory: jest.fn(async (cwd: string) => ({
        valid: true,
        normalizedPath: cwd,
        reason: null,
      })),
    } as never,
  );
  return { service, runner, prisma, session };
}

describe("Session continuity and terminal state", () => {
  it("resumes the existing provider thread with its saved model and effort", async () => {
    const h = setup();
    await h.service.acceptFollowUp(
      "actor",
      "session",
      "Follow up",
      randomUUID(),
    );
    await new Promise<void>((r) => setImmediate(r));
    expect(h.runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "existing-thread",
        providerId: "anthropic",
        model: "claude-fable-5-1",
        reasoningEffort: "max",
      }),
      expect.any(Function),
    );
    expect(h.session.status).toBe("COMPLETED");
    expect(h.prisma.task.update).toHaveBeenLastCalledWith({
      where: { id: "task" },
      data: { status: "COMPLETED" },
    });
  });

  it("claims turns atomically before creating a second runner", async () => {
    const h = setup();
    await Promise.allSettled([
      h.service.acceptFollowUp("actor", "session", "One", randomUUID()),
      h.service.acceptFollowUp("actor", "session", "Two", randomUUID()),
    ]);
    await new Promise<void>((r) => setImmediate(r));
    expect(h.runner.start).toHaveBeenCalledTimes(1);
    expect(h.prisma.proboxAiTurn.create).toHaveBeenCalledTimes(1);
  });

  it("treats a failed turn event as a failure even when the process exits zero", async () => {
    const h = setup();
    h.runner.start.mockImplementation(async (_options, event) => {
      await event({
        type: "turn.failed",
        payload: { error: { message: "provider error" } },
        rawLine: "",
      });
      return 0;
    });
    await h.service.acceptFollowUp("actor", "session", "Task", randomUUID());
    await new Promise<void>((r) => setImmediate(r));
    expect(h.session.status).toBe("FAILED");
    expect(h.prisma.task.update).toHaveBeenLastCalledWith({
      where: { id: "task" },
      data: { status: "FAILED" },
    });
  });

  it("records spawn failures before publishing terminal state", async () => {
    const h = setup();
    h.runner.start.mockRejectedValue(new Error("spawn failed"));
    await h.service.acceptFollowUp("actor", "session", "Task", randomUUID());
    await new Promise<void>((r) => setImmediate(r));
    expect(h.session.status).toBe("FAILED");
    expect(h.prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "runner.error" }),
      }),
    );
    expect(
      h.prisma.sessionEvent.create.mock.invocationCallOrder[0],
    ).toBeLessThan(
      h.prisma.proboxAiSession.update.mock.invocationCallOrder.at(-1)!,
    );
  });
});
