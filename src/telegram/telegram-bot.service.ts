import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { Update } from "grammy/types";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { SessionsService } from "../sessions/sessions.service";
import { ModelCatalogService } from "../sessions/model-catalog.service";
import { TelegramService } from "./telegram.service";
import {
  TelegramIdentityService,
  requirePermissions,
} from "./telegram-identity.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { Permissions as P } from "../authorization/permission.catalog";
import { fileReferences, record } from "./telegram-rendering";

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  // Serialize one user's commands, but never hold the webhook open for a Codex turn.
  private readonly queues = new Map<string, Promise<void>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly sessions: SessionsService,
    private readonly catalog: ModelCatalogService,
    private readonly telegram: TelegramService,
    private readonly identities: TelegramIdentityService,
  ) {}

  async handle(update: Update): Promise<boolean> {
    const callback =
      "callback_query" in update ? update.callback_query : undefined;
    const message = "message" in update ? update.message : callback?.message;
    const from = callback?.from ?? message?.from;
    if (
      !message ||
      message.chat?.type !== "private" ||
      !from ||
      !Number.isSafeInteger(from.id) ||
      !Number.isSafeInteger(message.chat.id)
    )
      return true;
    const chatId = BigInt(message.chat.id);
    const actor = await this.identities.actor(chatId, BigInt(from.id));
    if (!actor) {
      if (callback) await this.telegram.answerCallback(callback.id);
      return false; // Existing account/contact registration flow.
    }
    if (callback) await this.telegram.answerCallback(callback.id);
    if (!Number.isSafeInteger(update.update_id)) return true;
    try {
      await this.prisma.telegramUpdate.create({
        data: { updateId: BigInt(update.update_id) },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return true;
      throw error;
    }
    const previous = this.queues.get(actor.id) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        try {
          // Refresh roles after waiting for an earlier update.
          const fresh = await this.identities.actor(chatId, BigInt(from.id));
          if (!fresh) return;
          const text =
            "text" in message && typeof message.text === "string"
              ? message.text
              : "";
          await this.dispatch(fresh, chatId, text, callback?.data);
        } catch (error) {
          this.logger.warn(`Telegram action failed for user ${actor.id}`);
          await this.telegram.sendMessage(
            chatId,
            error instanceof HttpException
              ? error.message
              : "Unable to complete this action. Use /status to check before retrying.",
          );
        }
      })
      .catch(() =>
        this.logger.warn(`Telegram reply failed for user ${actor.id}`),
      );
    this.queues.set(actor.id, next);
    await next;
    if (this.queues.get(actor.id) === next) this.queues.delete(actor.id);
    return true;
  }

  private async dispatch(
    actor: AuthenticatedUser,
    chatId: bigint,
    text: string,
    callback?: string,
  ) {
    const state = await this.prisma.telegramConversation.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id },
      update: {},
    });
    const [action, ...parts] = callback?.split(":") ?? [];
    const command = text.split(/\s/)[0]?.split("@")[0];
    if (action === "f") {
      requirePermissions(actor, P.SESSIONS_READ, P.PROJECT_FILES_READ);
      return this.download(actor, chatId, parts[0] ?? "", Number(parts[1]));
    }
    if (action === "p") {
      requirePermissions(
        actor,
        P.PROJECTS_READ,
        P.SESSIONS_CREATE,
        P.PROJECT_FILES_WRITE,
      );
      const { project } = await this.projects.taskDirectory(
        actor,
        parts[0] ?? "",
      );
      await this.prisma.telegramConversation.update({
        where: { userId: actor.id },
        data: { projectId: project.id, sessionId: null },
      });
      await this.telegram.sendMessage(
        chatId,
        `Project: ${project.name}\nSend your task, or choose /model first.`,
        new InlineKeyboard().text("Choose model", "models"),
      );
      return;
    }
    if (command === "/model" || action === "models") {
      requirePermissions(actor, P.SESSIONS_CREATE);
      const keyboard = new InlineKeyboard();
      for (const provider of this.catalog.list())
        keyboard.text(provider.displayName, `v:${provider.id}`).row();
      await this.telegram.sendMessage(
        chatId,
        "Choose a provider for your next session:",
        keyboard,
      );
      return;
    }
    if (action === "v") {
      requirePermissions(actor, P.SESSIONS_CREATE);
      const provider = this.catalog.list(parts[0])[0]!;
      const keyboard = new InlineKeyboard();
      for (const model of provider.models)
        keyboard.text(model.displayName, `m:${provider.id}:${model.id}`).row();
      await this.telegram.sendMessage(
        chatId,
        `${provider.displayName} models:`,
        keyboard,
      );
      return;
    }
    if (action === "m") {
      requirePermissions(actor, P.SESSIONS_CREATE);
      const selection = this.catalog.resolve(parts[0], parts[1]);
      await this.prisma.telegramConversation.update({
        where: { userId: actor.id },
        data: {
          providerId: selection.providerId,
          model: selection.effectiveModel,
          reasoningEffort: selection.effectiveReasoningEffort,
        },
      });
      const model = this.catalog
        .list(selection.providerId)[0]!
        .models.find((m) => m.id === selection.effectiveModel)!;
      const keyboard = new InlineKeyboard();
      for (const effort of model.supportedReasoningEfforts)
        keyboard
          .text(effort, `e:${selection.providerId}:${model.id}:${effort}`)
          .row();
      await this.telegram.sendMessage(
        chatId,
        `${model.displayName} selected. Choose reasoning effort (default: ${model.defaultReasoningEffort}). Applies to new sessions; use /new to start one.`,
        keyboard,
      );
      return;
    }
    if (action === "e") {
      requirePermissions(actor, P.SESSIONS_CREATE);
      const selection = this.catalog.resolve(parts[0], parts[1], parts[2]);
      await this.prisma.telegramConversation.update({
        where: { userId: actor.id },
        data: {
          providerId: selection.providerId,
          model: selection.effectiveModel,
          reasoningEffort: selection.effectiveReasoningEffort,
        },
      });
      await this.telegram.sendMessage(
        chatId,
        `${selection.effectiveModel} · ${selection.effectiveReasoningEffort}\nReady for your next session. Use /new, then send a task.`,
      );
      return;
    }
    if (command === "/projects" || action === "projects") {
      requirePermissions(actor, P.PROJECTS_READ);
      const projects = await this.projects.list(actor);
      // Page through all projects without exceeding Telegram's keyboard size.
      const page = Math.max(0, Number(parts[0]) || 0);
      const ready = projects.filter((p) => p.status === "READY");
      const keyboard = new InlineKeyboard();
      for (const project of ready.slice(page * 20, (page + 1) * 20))
        keyboard.text(project.name.slice(0, 60), `p:${project.id}`).row();
      if (page > 0) keyboard.text("Previous", `projects:${page - 1}`);
      if (ready.length > (page + 1) * 20)
        keyboard.text("Next", `projects:${page + 1}`);
      await this.telegram.sendMessage(
        chatId,
        ready.length
          ? "Choose a project. Running tasks requires project membership or management access."
          : "No ready projects are available.",
        keyboard,
      );
      return;
    }
    if (command === "/sessions") {
      requirePermissions(actor, P.SESSIONS_READ);
      const bindings = await this.prisma.telegramSession.findMany({
        where: { userId: actor.id, chatId },
        include: { session: { include: { task: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const keyboard = new InlineKeyboard();
      for (const binding of bindings)
        keyboard
          .text(
            `${binding.session.status}: ${binding.session.task.title}`.slice(
              0,
              60,
            ),
            `s:${binding.sessionId}`,
          )
          .row();
      await this.telegram.sendMessage(
        chatId,
        bindings.length
          ? "Select a recent session to continue:"
          : "No Telegram sessions yet. Use /projects.",
        keyboard,
      );
      return;
    }
    if (action === "s") {
      requirePermissions(actor, P.SESSIONS_READ);
      const binding = await this.binding(actor.id, chatId, parts[0] ?? "");
      await this.sessions.get(actor.id, binding.sessionId);
      await this.projects.get(actor, binding.projectId);
      await this.prisma.telegramConversation.update({
        where: { userId: actor.id },
        data: { sessionId: binding.sessionId, projectId: binding.projectId },
      });
      await this.telegram.sendMessage(
        chatId,
        `Session selected: ${binding.sessionId}\nUse /status or send a follow-up.`,
      );
      return;
    }
    if (command === "/new") {
      await this.prisma.telegramConversation.update({
        where: { userId: actor.id },
        data: { sessionId: null },
      });
      await this.telegram.sendMessage(
        chatId,
        state.projectId
          ? "Send a task to start a new session in the selected project."
          : "Choose /projects first.",
      );
      return;
    }
    if (command === "/status" || command === "/stop") {
      requirePermissions(
        actor,
        command === "/stop" ? P.SESSIONS_MANAGE : P.SESSIONS_READ,
      );
      if (!state.sessionId) {
        await this.telegram.sendMessage(
          chatId,
          "No session selected. Use /sessions or /projects.",
        );
        return;
      }
      await this.binding(actor.id, chatId, state.sessionId);
      const session = await this.sessions.get(actor.id, state.sessionId);
      if (command === "/stop")
        await this.sessions.interrupt(actor.id, session.id);
      await this.telegram.sendMessage(
        chatId,
        command === "/stop"
          ? "Interruption requested."
          : `Session: ${session.id}\n${session.status}\n${session.providerId} · ${session.model} · ${session.effectiveReasoningEffort}`,
      );
      return;
    }
    if (
      command === "/start" ||
      command === "/help" ||
      text.startsWith("/") ||
      callback
    ) {
      await this.telegram.sendMessage(
        chatId,
        "ProboxAI\n/projects — choose an existing project\n/model — provider, model and reasoning for new sessions\n/new — start a fresh session with your next message\n/sessions — select a recent session\n/status — current session\n/stop — interrupt\n\nSend a task after choosing a project. Further messages continue that session. File buttons download referenced project files.",
        new InlineKeyboard()
          .text("Projects", "projects")
          .text("Models", "models"),
      );
      return;
    }
    if (!text.trim()) return;
    if (text.length > 8000)
      throw new BadRequestException("Tasks must be at most 8000 characters.");
    if (!state.projectId) {
      await this.telegram.sendMessage(chatId, "Choose /projects first.");
      return;
    }
    requirePermissions(
      actor,
      P.PROJECTS_READ,
      P.PROJECT_FILES_WRITE,
      P.SESSIONS_READ,
    );
    const { directory, project } = await this.projects.taskDirectory(
      actor,
      state.projectId,
    );
    if (state.sessionId) {
      requirePermissions(actor, P.SESSIONS_MANAGE);
      const binding = await this.binding(actor.id, chatId, state.sessionId);
      const session = await this.sessions.get(actor.id, state.sessionId);
      if (binding.projectId !== project.id || session.cwd !== directory)
        throw new BadRequestException(
          "The project directory changed. Start a /new session.",
        );
      if (!session.codexThreadId)
        throw new BadRequestException(
          "This session cannot be resumed yet. Check /status or use /new.",
        );
      const claimed = await this.prisma.proboxAiSession.updateMany({
        where: {
          id: session.id,
          status: { in: ["COMPLETED", "FAILED", "INTERRUPTED", "PAUSED"] },
        },
        data: { status: "QUEUED", endedAt: null },
      });
      if (!claimed.count)
        throw new BadRequestException(
          "This session is still running. Wait for completion or use /stop.",
        );
      await this.prisma.telegramSession.update({
        where: { sessionId: session.id },
        data: { finished: false },
      });
      this.sessions.launchTurn(session.id, text);
      await this.telegram.sendMessage(
        chatId,
        `Continuing ${project.name}\nSession: ${session.id}`,
      );
    } else {
      requirePermissions(actor, P.TASKS_CREATE, P.SESSIONS_CREATE);
      const selection = this.catalog.resolve(
        state.providerId,
        state.model ?? undefined,
        state.reasoningEffort ?? undefined,
      );
      const task = await this.prisma.task.create({
        data: {
          workspaceId: actor.workspaceId,
          creatorId: actor.id,
          managerId: actor.id,
          title: text.slice(0, 100),
          description: text,
        },
      });
      const session = await this.sessions.create(
        actor.id,
        {
          taskId: task.id,
          cwd: directory,
          prompt: text,
          sandbox: "workspace-write",
          providerId: selection.providerId,
          model: selection.effectiveModel,
          reasoningEffort: selection.effectiveReasoningEffort,
        },
        false,
      );
      await this.prisma.$transaction([
        this.prisma.telegramSession.create({
          data: {
            sessionId: session.id,
            userId: actor.id,
            chatId,
            projectId: project.id,
          },
        }),
        this.prisma.telegramConversation.update({
          where: { userId: actor.id },
          data: { sessionId: session.id },
        }),
      ]);
      this.sessions.launchTurn(session.id, text);
      await this.telegram.sendMessage(
        chatId,
        `Started in ${project.name}\n${selection.effectiveModel} · ${selection.effectiveReasoningEffort}\nSession: ${session.id}`,
      );
    }
  }

  private async binding(userId: string, chatId: bigint, sessionId: string) {
    const binding = await this.prisma.telegramSession.findFirst({
      where: { sessionId, userId, chatId },
    });
    if (!binding) throw new NotFoundException("Session not found.");
    return binding;
  }

  private async download(
    actor: AuthenticatedUser,
    chatId: bigint,
    eventId: string,
    index: number,
  ) {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new NotFoundException("File not found.");
    const event = await this.prisma.sessionEvent.findUnique({
      where: { id: eventId },
      include: { session: true },
    });
    if (!event || event.type !== "item.completed")
      throw new NotFoundException("File not found.");
    const binding = await this.binding(actor.id, chatId, event.sessionId);
    await this.sessions.get(actor.id, event.sessionId);
    const item = record(record(event.rawPayload).item);
    if (item.type !== "agent_message" || typeof item.text !== "string")
      throw new NotFoundException("File not found.");
    const relative = fileReferences(item.text, event.session.cwd)[index];
    if (!relative) throw new NotFoundException("File not found.");
    const file = await this.projects.downloadFile(
      actor,
      binding.projectId,
      relative,
    );
    // Open once and send bytes: don't hand Telegram a path it can reopen after validation.
    const handle = await open(
      file.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 49_000_000)
        throw new BadRequestException(
          "This file exceeds the bot's 49 MB download limit or is not a regular file.",
        );
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
      }
      await this.telegram.sendDocument(
        chatId,
        bytes.subarray(0, offset),
        file.name,
      );
    } finally {
      await handle.close();
    }
  }
}
