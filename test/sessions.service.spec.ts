import { randomUUID } from "node:crypto";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { SessionsService } from "../src/sessions/sessions.service";

function setup(selectedProjectId?: string) {
  const session = {
    id: "session",
    workspaceId: "workspace",
    task: { managerId: "actor", workspaceId: "workspace" },
    taskId: "task",
    selectedProjectId,
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
    project: {
      findFirst: jest.fn(async () => ({
        id: selectedProjectId,
        name: "Pilot project",
        status: "READY",
        directoryName: "project",
        department: {
          homePath: "/opt/apps",
          workspaceId: "workspace",
          status: "ACTIVE",
        },
        members: [{ userId: "actor" }],
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
  it("repairs an idle retired selection once, preserving the thread and recording its old values", async () => {
    const { session, service, prisma } = setup();
    session.model = "retired-test-model";
    const expected = {
      providerId: session.providerId,
      model: session.model,
      reasoningEffort: session.effectiveReasoningEffort,
    };
    const next = {
      providerId: "openai",
      model: "gpt-6-sol",
      reasoningEffort: "high",
    };
    await expect(
      service.repairModel("actor", "session", { expected, ...next }),
    ).resolves.toEqual(next);
    expect(session.codexThreadId).toBe("existing-thread");
    expect(session.status).toBe("COMPLETED");
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "session.model-selection",
          rawPayload: { previous: expected, effective: next, actorId: "actor" },
        }),
      }),
    );
    await service.repairModel("actor", "session", { expected, ...next });
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
  });
  it("rejects a repair after the record changed or a turn started", async () => {
    const { session, service, prisma } = setup();
    const dto = {
      expected: {
        providerId: "anthropic",
        model: "stale",
        reasoningEffort: "high",
      },
      providerId: "openai",
      model: "gpt-6-sol",
      reasoningEffort: "high",
    };
    await expect(service.repairModel("actor", "session", dto)).rejects.toThrow(
      "selection changed",
    );
    session.status = "RUNNING";
    await expect(service.repairModel("actor", "session", dto)).rejects.toThrow(
      "idle session",
    );
    expect(prisma.proboxAiSession.update).not.toHaveBeenCalled();
  });
  it("resumes the existing provider thread with its saved model and effort", async () => {
    const h = setup("pilot-project");
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
        imageEditorActor: { projectId: "pilot-project", userId: "actor" },
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
