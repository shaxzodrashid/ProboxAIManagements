import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Permissions } from "../src/authorization/permission.catalog";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";

function setup() {
  const actor = {
    id: "user",
    workspaceId: "workspace",
    roles: [],
    permissions: Object.values(Permissions) as string[],
  };
  const state = {
    userId: actor.id,
    projectId: "project",
    sessionId: null as string | null,
    providerId: "anthropic",
    model: "claude-fable-5-1",
    reasoningEffort: "max",
  };
  const binding = {
    sessionId: "session",
    projectId: "project",
    userId: actor.id,
    chatId: 42n,
  };
  const prisma = {
    telegramUpdate: { create: jest.fn().mockResolvedValue({}) },
    telegramConversation: {
      upsert: jest.fn().mockResolvedValue(state),
      update: jest
        .fn()
        .mockImplementation(async ({ data }) => Object.assign(state, data)),
    },
    telegramSession: {
      create: jest.fn().mockResolvedValue(binding),
      findFirst: jest.fn().mockResolvedValue(binding),
      update: jest.fn(),
    },
    task: { create: jest.fn().mockResolvedValue({ id: "task" }) },
    proboxAiSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    sessionEvent: { findUnique: jest.fn() },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  const projects = {
    taskDirectory: jest.fn().mockResolvedValue({
      project: { id: "project", name: "Existing project" },
      directory: "/opt/apps/project",
    }),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    downloadFile: jest.fn(),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ id: "session" }),
    launchTurn: jest.fn(),
    get: jest.fn().mockResolvedValue({
      id: "session",
      cwd: "/opt/apps/project",
      codexThreadId: "thread",
      status: "COMPLETED",
    }),
    interrupt: jest.fn(),
  };
  const telegram = {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
    answerCallback: jest.fn(),
    sendDocument: jest.fn(),
  };
  const identities = { actor: jest.fn().mockResolvedValue(actor) };
  const bot = new TelegramBotService(
    prisma as never,
    projects as never,
    sessions as never,
    new ModelCatalogService(),
    telegram as never,
    identities as never,
  );
  const message = (text: string, id = 1) =>
    ({
      update_id: id,
      message: {
        message_id: id,
        from: { id: 42 },
        chat: { id: 42, type: "private" },
        text,
      },
    }) as any;
  const callback = (data: string, id = 2) =>
    ({
      update_id: id,
      callback_query: {
        id: `callback-${id}`,
        from: { id: 42 },
        data,
        message: { message_id: 1, chat: { id: 42, type: "private" } },
      },
    }) as any;
  return {
    bot,
    actor,
    state,
    prisma,
    projects,
    sessions,
    telegram,
    identities,
    message,
    callback,
  };
}

describe("Telegram bot task workflow", () => {
  it("starts a task in an authorized existing project and binds events before launching", async () => {
    const h = setup();
    await h.bot.handle(h.message("Fix the report"));
    expect(h.projects.taskDirectory).toHaveBeenCalledWith(h.actor, "project");
    expect(h.sessions.create).toHaveBeenCalledWith(
      "user",
      expect.objectContaining({
        cwd: "/opt/apps/project",
        providerId: "anthropic",
        model: "claude-fable-5-1",
        reasoningEffort: "max",
        sandbox: "workspace-write",
      }),
      false,
    );
    expect(
      h.prisma.telegramSession.create.mock.invocationCallOrder[0],
    ).toBeLessThan(h.sessions.launchTurn.mock.invocationCallOrder[0]!);
    expect(h.sessions.launchTurn).toHaveBeenCalledWith(
      "session",
      "Fix the report",
    );
    expect(h.state.sessionId).toBe("session");
  });

  it("resumes the selected session without creating another task and rejects concurrent turns", async () => {
    const h = setup();
    h.state.sessionId = "session";
    await h.bot.handle(h.message("Now add tests"));
    expect(h.sessions.launchTurn).toHaveBeenCalledWith(
      "session",
      "Now add tests",
    );
    expect(h.sessions.create).not.toHaveBeenCalled();
    h.prisma.proboxAiSession.updateMany.mockResolvedValue({ count: 0 });
    await h.bot.handle(h.message("Another task", 3));
    expect(h.sessions.launchTurn).toHaveBeenCalledTimes(1);
    expect(h.telegram.sendMessage).toHaveBeenLastCalledWith(
      42n,
      expect.stringContaining("still running"),
    );
  });

  it("deduplicates Telegram retries before any task mutation", async () => {
    const h = setup();
    h.prisma.telegramUpdate.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "6",
      }),
    );
    await h.bot.handle(h.message("Fix it"));
    expect(h.prisma.task.create).not.toHaveBeenCalled();
  });

  it("ignores group traffic and leaves unlinked accounts to the contact flow", async () => {
    const h = setup();
    const update = h.message("Fix it");
    update.message.chat.type = "group";
    expect(await h.bot.handle(update)).toBe(true);
    expect(h.identities.actor).not.toHaveBeenCalled();
    h.identities.actor.mockResolvedValue(null as never);
    expect(await h.bot.handle(h.message("/start"))).toBe(false);
    expect(h.prisma.task.create).not.toHaveBeenCalled();
  });

  it("enforces current roles and membership rather than trusting project buttons", async () => {
    const h = setup();
    h.actor.permissions = [];
    await h.bot.handle(h.callback("p:project"));
    expect(h.projects.taskDirectory).not.toHaveBeenCalled();
    h.actor.permissions = Object.values(Permissions);
    h.projects.taskDirectory.mockRejectedValue(
      new ForbiddenException("Not a member"),
    );
    await h.bot.handle(h.message("Fix it", 3));
    expect(h.prisma.task.create).not.toHaveBeenCalled();
  });

  it("selects external provider models and rejects unsupported reasoning", async () => {
    const h = setup();
    await h.bot.handle(h.callback("m:deepmind:gemini-3.8-flash"));
    expect(h.state.model).toBe("gemini-3.8-flash");
    expect(h.state.reasoningEffort).toBe("medium");
    await h.bot.handle(h.callback("e:deepmind:gemini-3.8-flash:minimal", 3));
    expect(h.state.reasoningEffort).toBe("medium");
    expect(h.telegram.sendMessage).toHaveBeenLastCalledWith(
      42n,
      expect.stringContaining("not supported"),
    );
  });

  it("reauthorizes file callbacks and downloads only files referenced by the saved assistant message", async () => {
    const h = setup();
    const directory = await mkdtemp(join(tmpdir(), "telegram-files-"));
    try {
      const file = join(directory, "report.txt");
      await writeFile(file, "report bytes");
      h.prisma.sessionEvent.findUnique.mockResolvedValue({
        sessionId: "session",
        type: "item.completed",
        session: { cwd: directory },
        rawPayload: {
          item: { type: "agent_message", text: "[Report](report.txt:12)" },
        },
      });
      h.projects.downloadFile.mockResolvedValue({
        path: file,
        name: "report.txt",
      });
      await h.bot.handle(h.callback("f:event:0"));
      expect(h.projects.downloadFile).toHaveBeenCalledWith(
        h.actor,
        "project",
        "report.txt",
      );
      expect(h.telegram.sendDocument).toHaveBeenCalledWith(
        42n,
        Buffer.from("report bytes"),
        "report.txt",
      );
      h.prisma.telegramSession.findFirst.mockResolvedValue(null as never);
      await h.bot.handle(h.callback("f:event:0", 3));
      expect(h.telegram.sendDocument).toHaveBeenCalledTimes(1);
      expect(h.telegram.sendMessage).toHaveBeenLastCalledWith(
        42n,
        "Session not found.",
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
