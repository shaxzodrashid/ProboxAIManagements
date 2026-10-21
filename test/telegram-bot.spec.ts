import { telegramTurnRequestId } from "../src/telegram/telegram-turn-request";
import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
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
    projectId: "project" as string | null,
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
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (
          !Object.entries(where).every(
            ([key, value]) => state[key as keyof typeof state] === value,
          )
        )
          return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      }),
      update: jest
        .fn()
        .mockImplementation(async ({ data }) => Object.assign(state, data)),
    },
    telegramSession: {
      create: jest.fn().mockResolvedValue(binding),
      findFirst: jest.fn().mockResolvedValue(binding),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    task: { create: jest.fn().mockResolvedValue({ id: "task" }) },
    proboxAiSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    sessionEvent: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (operation: any) =>
    typeof operation === "function"
      ? operation(prisma)
      : Promise.all(operation),
  );
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
    acceptTelegramTurn: jest
      .fn()
      .mockResolvedValue({ turnId: "turn", accepted: true, status: "QUEUED" }),
    get: jest.fn().mockResolvedValue({
      id: "session",
      cwd: "/opt/apps/project",
      codexThreadId: "thread",
      status: "COMPLETED",
      turns: [{ id: "latest-turn" }],
      stopConfirmation: "NOT_STARTED",
      recoveryReason: null as string | null,
    }),
    interrupt: jest.fn(),
  };
  const telegram = {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
    editMessage: jest.fn().mockResolvedValue(true),
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
        projectId: "project",
        providerId: "anthropic",
        model: "claude-fable-5-1",
        reasoningEffort: "max",
        sandbox: "workspace-write",
      }),
      false,
    );
    expect(
      h.prisma.telegramSession.create.mock.invocationCallOrder[0],
    ).toBeLessThan(h.sessions.acceptTelegramTurn.mock.invocationCallOrder[0]!);
    expect(h.sessions.acceptTelegramTurn).toHaveBeenCalledWith(
      "user",
      42n,
      "session",
      "Fix the report",
      telegramTurnRequestId("user", 42n, 1),
      true,
    );
    expect(h.state.sessionId).toBe("session");
  });

  it("resumes the selected session without creating another task and rejects concurrent turns", async () => {
    const h = setup();
    h.state.sessionId = "session";
    await h.bot.handle(h.message("Now add tests"));
    expect(h.sessions.acceptTelegramTurn).toHaveBeenCalledWith(
      "user",
      42n,
      "session",
      "Now add tests",
      telegramTurnRequestId("user", 42n, 1),
    );
    expect(h.sessions.create).not.toHaveBeenCalled();
    h.sessions.acceptTelegramTurn.mockRejectedValueOnce(
      new ForbiddenException("This session is still running"),
    );
    await h.bot.handle(h.message("Another task", 3));
    expect(h.sessions.acceptTelegramTurn).toHaveBeenCalledTimes(2);
    expect(h.telegram.sendMessage).toHaveBeenLastCalledWith(
      42n,
      expect.stringContaining("still running"),
      expect.anything(),
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

  it("does not accept another turn after a failed reply and duplicate webhook delivery", async () => {
    const h = setup();
    h.state.sessionId = "session";
    h.telegram.sendMessage.mockRejectedValueOnce(new Error("delivery failed"));
    await h.bot.handle(h.message("Follow up", 91));
    h.prisma.telegramUpdate.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "6",
      }),
    );
    await h.bot.handle(h.message("Follow up", 91));
    expect(h.sessions.acceptTelegramTurn).toHaveBeenCalledTimes(1);
    expect(h.sessions.acceptTelegramTurn.mock.calls[0][4]).toBe(
      telegramTurnRequestId("user", 42n, 91),
    );
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

  it("rejects old model buttons without saving or starting work", async () => {
    const h = setup();
    for (const data of [
      "m:deepmind:gemini-3.8-flash",
      "e:deepmind:gemini-3.8-flash:minimal",
      "v:openai",
    ])
      await h.bot.handle(h.callback(data));
    expect(h.state.model).toBe("claude-fable-5-1");
    expect(h.prisma.telegramConversation.updateMany).not.toHaveBeenCalled();
    expect(h.telegram.sendMessage).not.toHaveBeenCalled();
    expect(h.telegram.editMessage).toHaveBeenCalledTimes(3);
    expect(h.sessions.create).not.toHaveBeenCalled();
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
        expect.anything(),
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe("Telegram navigation and truthful action states", () => {
  const buttons = (h: ReturnType<typeof setup>) =>
    h.telegram.sendMessage.mock.calls.at(-1)?.[2]?.inline_keyboard.flat() ?? [];
  it("offers one menu with read navigation and never submits work on help or cancel", async () => {
    const h = setup();
    h.state.sessionId = "session";
    const initial = { ...h.state };
    await h.bot.handle(h.message("/help"));
    expect(buttons(h).map((b: any) => b.callback_data)).toEqual([
      "projects",
      "sessions",
      "models",
      "status",
      "new",
    ]);
    await h.bot.handle(h.message("/cancel", 2));
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(
      "running work continues",
    );
    await h.bot.handle(h.callback("home", 3));
    expect(h.state).toEqual(initial);
    expect(h.prisma.telegramConversation.update).not.toHaveBeenCalled();
    expect(h.sessions.acceptTelegramTurn).not.toHaveBeenCalled();
    expect(h.sessions.interrupt).not.toHaveBeenCalled();
  });
  it("acknowledges a button before durable work and scopes recent sessions to this user and chat", async () => {
    const h = setup();
    await h.bot.handle(h.callback("sessions"));
    expect(h.telegram.answerCallback.mock.invocationCallOrder[0]).toBeLessThan(
      h.prisma.telegramUpdate.create.mock.invocationCallOrder[0]!,
    );
    expect(h.prisma.telegramSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user", chatId: 42n },
        take: 20,
      }),
    );
    expect(buttons(h).map((b: any) => b.callback_data)).toEqual([
      "projects",
      "home",
    ]);
    expect(h.prisma.telegramConversation.update).not.toHaveBeenCalled();
  });
  it("keeps permission checks on the new read-navigation callbacks", async () => {
    const h = setup();
    h.actor.permissions = [];
    for (const [index, action] of [
      "sessions",
      "status",
      "models",
      "projects",
    ].entries())
      await h.bot.handle(h.callback(action, index + 1));
    expect(h.prisma.telegramSession.findMany).not.toHaveBeenCalled();
    expect(h.sessions.get).not.toHaveBeenCalled();
    expect(h.projects.list).not.toHaveBeenCalled();
    expect(h.prisma.telegramConversation.update).not.toHaveBeenCalled();
  });
  it("clamps stale project pagination to a ready page and retains a menu escape", async () => {
    const h = setup();
    h.projects.list.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        id: `p${i}`,
        name: `Ready ${i}`,
        status: "READY",
      })).concat([
        { id: "hidden", name: "Initializing", status: "INITIALIZING" },
      ]) as never,
    );
    await h.bot.handle(h.callback("projects:999"));
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain("page 2/2");
    expect(buttons(h).map((b: any) => b.callback_data)).toEqual([
      "p:p20",
      "projects:0",
      "home",
    ]);
    await h.bot.handle(h.callback("projects:Infinity", 3));
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain("page 1/2");
    expect(h.sessions.create).not.toHaveBeenCalled();
  });
  it("gives empty projects a menu and never treats typed text as a task without a project", async () => {
    const h = setup();
    h.state.projectId = null;
    await h.bot.handle(h.callback("projects"));
    expect(buttons(h).some((b: any) => b.callback_data === "home")).toBe(true);
    await h.bot.handle(h.message("Do work", 3));
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(
      "not submitted",
    );
    expect(h.prisma.task.create).not.toHaveBeenCalled();
  });
  it("saves only confirmed settings using a compare-and-swap and preserves project/session", async () => {
    const h = setup();
    h.state.sessionId = "selected-session";
    const button = (label: string) =>
      h.telegram.editMessage.mock.calls
        .at(-1)![3]
        .inline_keyboard.flat()
        .find((b: any) => b.text.includes(label)).callback_data;
    await h.bot.handle(h.callback("models"));
    await h.bot.handle(h.callback(button("GPT-6 Astra"), 3));
    expect(h.state.model).toBe("claude-fable-5-1");
    await h.bot.handle(h.callback(button("Confirm"), 4));
    expect(h.state.model).toBe("gpt-6-astra");
    expect(h.state.reasoningEffort).toBe("low");
    expect(h.state.projectId).toBe("project");
    expect(h.state.sessionId).toBe("selected-session");
    expect(h.prisma.telegramConversation.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user",
        providerId: "anthropic",
        model: "claude-fable-5-1",
        reasoningEffort: "max",
      },
      data: {
        providerId: "openai",
        model: "gpt-6-astra",
        reasoningEffort: "low",
      },
    });
    expect(h.telegram.sendMessage).not.toHaveBeenCalled();
    expect(h.sessions.create).not.toHaveBeenCalled();
    expect(h.sessions.acceptTelegramTurn).not.toHaveBeenCalled();
  });
  it("does not save after permission revocation or overwrite concurrent settings", async () => {
    for (const revoked of [true, false]) {
      const h = setup();
      await h.bot.handle(h.callback("models"));
      const confirm = h.telegram.editMessage.mock.calls
        .at(-1)![3]
        .inline_keyboard.flat()
        .find((b: any) => b.text === "Confirm").callback_data;
      if (revoked) h.actor.permissions = [];
      else h.state.model = "concurrent-setting";
      await h.bot.handle(h.callback(confirm, 3));
      expect(h.state.model).toBe(
        revoked ? "claude-fable-5-1" : "concurrent-setting",
      );
      expect(h.sessions.create).not.toHaveBeenCalled();
      expect(h.telegram.sendMessage).not.toHaveBeenCalled();
    }
  });
  it("checks identity and grants again immediately before saving", async () => {
    for (const revoked of [
      null,
      {
        id: "other",
        workspaceId: "workspace",
        roles: [],
        permissions: Object.values(Permissions),
      },
      {
        id: "user",
        workspaceId: "other",
        roles: [],
        permissions: Object.values(Permissions),
      },
      { id: "user", workspaceId: "workspace", roles: [], permissions: [] },
    ]) {
      const h = setup();
      await h.bot.handle(h.callback("models"));
      const confirm = h.telegram.editMessage.mock.calls
        .at(-1)![3]
        .inline_keyboard.flat()
        .find((b: any) => b.text === "Confirm").callback_data;
      h.identities.actor
        .mockResolvedValueOnce(h.actor)
        .mockResolvedValueOnce(h.actor)
        .mockResolvedValueOnce(revoked as never);
      await h.bot.handle(h.callback(confirm, 3));
      expect(h.prisma.telegramConversation.updateMany).not.toHaveBeenCalled();
      expect(h.telegram.editMessage.mock.calls.at(-1)![2]).toContain(
        "Nothing was overwritten",
      );
      expect(h.sessions.create).not.toHaveBeenCalled();
    }
  });
  it("prepares a new session without stopping or starting any work", async () => {
    const h = setup();
    h.state.sessionId = "session";
    await h.bot.handle(h.callback("new"));
    expect(h.state.sessionId).toBeNull();
    expect(h.state.projectId).toBe("project");
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(
      "no task has been sent",
    );
    expect(h.sessions.interrupt).not.toHaveBeenCalled();
    expect(h.sessions.create).not.toHaveBeenCalled();
  });
  it("distinguishes interrupt acknowledgment from stopped state and makes refresh read-only", async () => {
    const h = setup();
    h.state.sessionId = "session";
    await h.bot.handle(h.message("/stop"));
    expect(h.sessions.interrupt).toHaveBeenCalledWith(
      "user",
      "session",
      "latest-turn",
    );
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(
      "does not confirm",
    );
    await h.bot.handle(h.callback("status", 3));
    expect(h.sessions.interrupt).toHaveBeenCalledTimes(1);
    expect(h.sessions.acceptTelegramTurn).not.toHaveBeenCalled();
  });
  it("labels queued acceptance without changing the durable request identity or launching twice", async () => {
    const h = setup();
    await h.bot.handle(h.message("Fix report", 91));
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(
      "Task accepted · QUEUED",
    );
    expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(
      "Acceptance is not completion",
    );
    expect(h.sessions.acceptTelegramTurn.mock.calls[0]?.[4]).toBe(
      telegramTurnRequestId("user", 42n, 91),
    );
    expect(buttons(h).map((b: any) => b.callback_data)).toEqual([
      "status",
      "sessions",
      "home",
    ]);
  });
  it("distinguishes unconfirmed stop, observed local exit and no recorded start without replaying work", async () => {
    const h = setup();
    h.state.sessionId = "session";
    for (const [index, [stopConfirmation, recoveryReason, expected]] of [
      ["STOP_UNCONFIRMED", "OWNER_LOST", "follow-ups are blocked"],
      ["LOCAL_EXIT_OBSERVED", null, "does not prove all descendant"],
      ["NOT_STARTED", null, "no runner start recorded"],
      ["FUTURE_STATE", null, "exit has not been observed"],
    ].entries()) {
      h.sessions.get.mockResolvedValueOnce({
        id: "session",
        status: "INTERRUPTED",
        stopConfirmation,
        recoveryReason,
      } as never);
      await h.bot.handle(h.callback("status", index + 10));
      expect(h.telegram.sendMessage.mock.calls.at(-1)?.[1]).toContain(expected);
    }
    expect(h.sessions.interrupt).not.toHaveBeenCalled();
    expect(h.sessions.acceptTelegramTurn).not.toHaveBeenCalled();
  });
  it("sanitizes server failures and offers reconciliation instead of an automatic retry action", async () => {
    const h = setup();
    h.state.sessionId = "session";
    h.sessions.acceptTelegramTurn.mockRejectedValueOnce(
      new ServiceUnavailableException("private storage path and credentials"),
    );
    await h.bot.handle(h.message("Follow up"));
    const text = h.telegram.sendMessage.mock.calls.at(-1)?.[1];
    expect(text).toContain("may already have been accepted");
    expect(text).not.toContain("private storage");
    expect(buttons(h).map((b: any) => b.callback_data)).toEqual([
      "status",
      "sessions",
      "home",
    ]);
    expect(h.sessions.acceptTelegramTurn).toHaveBeenCalledTimes(1);
  });
});
