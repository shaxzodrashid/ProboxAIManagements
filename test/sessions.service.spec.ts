import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { SessionsService } from "../src/sessions/sessions.service";

function setup() {
  const session = {
    id: "session",
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
  const prisma = {
    proboxAiSession: {
      findUnique: jest.fn(async () => ({ ...session })),
      findUniqueOrThrow: jest.fn(async () => session),
      updateMany: jest.fn(async () => {
        if (session.status === "RUNNING") return { count: 0 };
        session.status = "RUNNING";
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(session, data)),
    },
    proboxAiTurn: {
      create: jest.fn().mockResolvedValue({ id: "turn" }),
      update: jest.fn(),
    },
    task: { update: jest.fn() },
    sessionEvent: { create: jest.fn() },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  const runner = { start: jest.fn().mockResolvedValue(0) };
  const service = new SessionsService(
    prisma as never,
    runner as never,
    { publish: jest.fn() } as never,
    new ModelCatalogService(),
  );
  return { service, runner, prisma, session };
}

describe("Session continuity and terminal state", () => {
  it("resumes the existing provider thread with its saved model and effort", async () => {
    const h = setup();
    await h.service.startTurn("session", "Follow up");
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
      h.service.startTurn("session", "One"),
      h.service.startTurn("session", "Two"),
    ]);
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
    await h.service.startTurn("session", "Task");
    expect(h.session.status).toBe("FAILED");
    expect(h.prisma.task.update).toHaveBeenLastCalledWith({
      where: { id: "task" },
      data: { status: "FAILED" },
    });
  });

  it("records spawn failures before publishing terminal state", async () => {
    const h = setup();
    h.runner.start.mockRejectedValue(new Error("spawn failed"));
    await h.service.startTurn("session", "Task");
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
