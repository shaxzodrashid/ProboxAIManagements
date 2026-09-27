import { ForbiddenException } from "@nestjs/common";
import { Permissions } from "../src/authorization/permission.catalog";
import { TelegramSessionRelay } from "../src/telegram/telegram-session-relay.service";

function setup() {
  const binding = {
    sessionId: "session-1",
    userId: "user",
    chatId: 42n,
    projectId: "project",
    lastSequence: 0,
    toolState: {},
    toolMessageId: null,
    finished: false,
    session: { cwd: "/opt/apps/project", task: { title: "Fix" } },
  };
  const final = { id: "session-1", status: "COMPLETED", lastSequence: 5 };
  const actor = { id: "user", permissions: Object.values(Permissions) };
  const event = (sequence: number, type: string, item?: unknown) => ({
    id: `event-${sequence}`,
    sequence,
    type,
    rawPayload: { item },
  });
  const rows = [
    event(1, "item.completed", {
      id: "a",
      type: "agent_message",
      text: "Checking",
    }),
    event(2, "item.started", { id: "b", type: "command_execution" }),
    event(3, "item.completed", {
      id: "b",
      type: "command_execution",
      status: "completed",
    }),
    event(4, "item.completed", {
      id: "c",
      type: "agent_message",
      text: "Done: [report](report.txt)",
    }),
    event(5, "turn.completed"),
  ];
  const prisma = {
    telegramSession: {
      findMany: jest.fn(async () =>
        binding.finished
          ? []
          : [{ ...binding, toolState: { ...binding.toolState } }],
      ),
      update: jest.fn(async ({ data }) => Object.assign(binding, data)),
      updateMany: jest.fn(async ({ data }) => {
        Object.assign(binding, data);
        return { count: 1 };
      }),
    },
    sessionEvent: {
      findMany: jest.fn(async ({ where }) =>
        rows.filter((row) => row.sequence > where.sequence.gt),
      ),
    },
    proboxAiSession: { findUniqueOrThrow: jest.fn(async () => final) },
  };
  let id = 0;
  const telegram = {
    sendMessage: jest.fn(
      async (_chat: bigint, _text: string, _keyboard?: unknown) => ({
        message_id: ++id,
      }),
    ),
    deleteMessage: jest.fn(),
  };
  const identities = { actor: jest.fn(async () => actor) };
  const projects = { get: jest.fn(), downloadFile: jest.fn() };
  const sessions = { get: jest.fn() };
  const createRelay = () =>
    new TelegramSessionRelay(
      prisma as never,
      telegram as never,
      identities as never,
      projects as never,
      sessions as never,
    );
  return {
    binding,
    final,
    actor,
    rows,
    prisma,
    telegram,
    identities,
    projects,
    sessions,
    createRelay,
  };
}

describe("Telegram persisted session relay", () => {
  it("coalesces tool events, sends the final with file buttons, and does not replay delivered events", async () => {
    const h = setup();
    await h.createRelay().tick();
    const messages = h.telegram.sendMessage.mock.calls;
    expect(messages.map((call) => call[1])).toEqual([
      "Session session-\nChecking",
      "Session session-\nTool activity: 1 call\nCommand: 1",
      "Session session-\nDone: [report](report.txt)",
      "Session session-: completed.\nSelect this session to continue, or /new for a fresh task.",
    ]);
    expect(messages[2]![2]).toMatchObject({
      inline_keyboard: [
        [{ text: "📎 report.txt", callback_data: "f:event-4:0" }],
        [],
      ],
    });
    expect(h.binding.lastSequence).toBe(5);
    expect(h.binding.finished).toBe(true);
    await h.createRelay().tick();
    expect(h.telegram.sendMessage).toHaveBeenCalledTimes(4);
  });

  it("leaves undelivered events pending on Telegram failure and retries from the durable cursor", async () => {
    const h = setup();
    h.telegram.sendMessage.mockRejectedValueOnce(new Error("offline"));
    await h.createRelay().tick();
    expect(h.binding.lastSequence).toBe(0);
    expect(h.binding.finished).toBe(false);
    await h.createRelay().tick();
    expect(h.binding.finished).toBe(true);
    expect(h.binding.lastSequence).toBe(5);
  });

  it("stops sending if project access is revoked", async () => {
    const h = setup();
    h.projects.get.mockRejectedValue(new ForbiddenException());
    await h.createRelay().tick();
    expect(h.telegram.sendMessage).not.toHaveBeenCalled();
    expect(h.binding.finished).toBe(true);
  });

  it("retries an unsent tool batch even when no new events arrive", async () => {
    const h = setup();
    h.rows.splice(0, 1);
    h.rows.splice(2);
    h.final.status = "RUNNING";
    h.telegram.sendMessage.mockRejectedValueOnce(new Error("offline"));
    await h.createRelay().tick();
    expect(h.binding.lastSequence).toBe(0);
    await h.createRelay().tick();
    expect(h.binding.lastSequence).toBe(3);
    expect(h.telegram.sendMessage).toHaveBeenLastCalledWith(
      42n,
      expect.stringContaining("Tool activity: 1 call"),
    );
  });

  it("does not permanently disable delivery after a transient access-query failure", async () => {
    const h = setup();
    h.projects.get.mockRejectedValue(new Error("DB offline"));
    await h.createRelay().tick();
    expect(h.binding.finished).toBe(false);
    expect(h.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("does not announce completion before all final events have been drained", async () => {
    const h = setup();
    h.final.lastSequence = 6;
    await h.createRelay().tick();
    expect(h.binding.finished).toBe(false);
    expect(h.telegram.sendMessage).toHaveBeenCalledTimes(3);
  });
});
