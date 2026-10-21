import { telegramTurnRequestId } from "./telegram-turn-request";
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
import { TelegramModelPanel } from "./telegram-model-panel";
import { lockWorkspace } from "../prisma/workspace-lock";

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  // Serialize one user's commands, but never hold the webhook open for a Codex turn.
  private readonly queues = new Map<string, Promise<void>>();
  private readonly modelPanels: TelegramModelPanel;
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly sessions: SessionsService,
    private readonly catalog: ModelCatalogService,
    private readonly telegram: TelegramService,
    private readonly identities: TelegramIdentityService,
  ) {
    this.modelPanels = new TelegramModelPanel(
      catalog,
      telegram,
      async (actor, chatId, base, selection, telegramUserId) =>
        this.prisma.$transaction(async (tx) => {
          if (telegramUserId === undefined) return 0;
          // Serialize the final authority read and save with participating grant/lifecycle writers.
          await lockWorkspace(tx, actor.workspaceId);
          // Identity writers also include the contact-registration path; protect
          // this account row even when such a writer has no workspace fence.
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
          const fresh = await this.identities.actor(chatId, telegramUserId, tx);
          if (
            !fresh ||
            fresh.id !== actor.id ||
            fresh.workspaceId !== actor.workspaceId ||
            !fresh.permissions.includes(P.SESSIONS_CREATE)
          )
            return 0;
          const result = await tx.telegramConversation.updateMany({
            where: { userId: actor.id, ...base },
            data: {
              providerId: selection.providerId,
              model: selection.effectiveModel,
              reasoningEffort: selection.effectiveReasoningEffort,
            },
          });
          return result.count;
        }),
    );
  }

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
    if (callback) {
      if (callback.data?.startsWith("mp:"))
        await this.telegram.answerCallback(
          callback.id,
          this.modelPanels.feedback(
            actor,
            chatId,
            message.message_id,
            callback.data,
            BigInt(from.id),
          ),
        );
      else await this.telegram.answerCallback(callback.id);
    }
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
          await this.dispatch(
            fresh,
            chatId,
            text,
            update.update_id,
            BigInt(from.id),
            callback?.data,
            callback ? message.message_id : undefined,
          );
        } catch (error) {
          this.logger.warn(`Telegram action failed for user ${actor.id}`);
          if (callback && /^(mp:|models$|[vme]:)/.test(callback.data ?? "")) {
            await this.telegram.editMessage(
              chatId,
              message.message_id,
              error instanceof HttpException && error.getStatus() < 500
                ? error.message
                : "The model panel could not be updated. Use /model to read saved settings. No task was started.",
              new InlineKeyboard()
                .text("Models", "models")
                .text("Menu", "home"),
            );
            return;
          }
          await this.telegram.sendMessage(
            chatId,
            error instanceof HttpException && error.getStatus() < 500
              ? error.message
              : "The result could not be confirmed. Check Status or Recent sessions before sending the task again. Your request may already have been accepted.",
            this.recoveryKeyboard(),
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
    updateId: number,
    telegramUserId: bigint,
    callback?: string,
    callbackMessageId?: number,
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
        `Project selected: ${project.name}\nSend a task to request a new session, or choose its model first. Existing sessions are not stopped.`,
        new InlineKeyboard()
          .text("Choose model", "models")
          .row()
          .text("Back to projects", "projects")
          .text("Menu", "home"),
      );
      return;
    }
    if (command === "/model" || action === "models") {
      requirePermissions(actor, P.SESSIONS_CREATE);
      await this.modelPanels.open(
        actor,
        chatId,
        state,
        callbackMessageId,
        telegramUserId,
      );
      return;
    }
    if (action === "mp") {
      requirePermissions(actor, P.SESSIONS_CREATE);
      if (callbackMessageId !== undefined)
        await this.modelPanels.handle(
          actor,
          chatId,
          callbackMessageId,
          callback!,
          telegramUserId,
        );
      return;
    }
    if (["v", "m", "e"].includes(action ?? "")) {
      requirePermissions(actor, P.SESSIONS_CREATE);
      if (callbackMessageId !== undefined)
        await this.telegram.editMessage(
          chatId,
          callbackMessageId,
          "These model buttons are outdated. Nothing was saved. Open Models to choose and confirm.",
          new InlineKeyboard().text("Models", "models").text("Menu", "home"),
        );
      return;
    }
    if (command === "/cancel" && (await this.modelPanels.cancel(actor, chatId)))
      return;
    if (command === "/projects" || action === "projects") {
      requirePermissions(actor, P.PROJECTS_READ);
      const projects = await this.projects.list(actor);
      // Page through all projects without exceeding Telegram's keyboard size.
      const ready = projects.filter((p) => p.status === "READY");
      const requested = Number(parts[0]);
      const page = Math.min(
        Math.max(0, Math.ceil(ready.length / 20) - 1),
        Number.isSafeInteger(requested) && requested >= 0 ? requested : 0,
      );
      const keyboard = new InlineKeyboard();
      for (const project of ready.slice(page * 20, (page + 1) * 20))
        keyboard.text(project.name.slice(0, 60), `p:${project.id}`).row();
      if (page > 0) keyboard.text("Previous", `projects:${page - 1}`);
      if (ready.length > (page + 1) * 20)
        keyboard.text("Next", `projects:${page + 1}`);
      keyboard.row().text("Menu", "home");
      await this.telegram.sendMessage(
        chatId,
        ready.length
          ? `Choose a ready project · page ${page + 1}/${Math.ceil(ready.length / 20)}.\nStarting work still checks your current permissions and project access.`
          : "No ready projects are available to choose. A project may still be initializing; check it in the app, then reopen Projects.",
        keyboard,
      );
      return;
    }
    if (command === "/sessions" || action === "sessions") {
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
      keyboard.text("Projects", "projects").text("Menu", "home");
      await this.telegram.sendMessage(
        chatId,
        bindings.length
          ? "Select one of your 20 most recent Telegram sessions. Selecting it does not send a task or resume work."
          : "No Telegram sessions yet. Choose a project, then send a task to request your first session.",
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
        `Session selected: ${binding.sessionId}\nCheck Status before sending a follow-up. Selection alone does not resume work.`,
        this.recoveryKeyboard(),
      );
      return;
    }
    if (command === "/new" || action === "new") {
      await this.prisma.telegramConversation.update({
        where: { userId: actor.id },
        data: { sessionId: null },
      });
      await this.telegram.sendMessage(
        chatId,
        state.projectId
          ? "New session prepared for the selected project. Send a task when ready. Existing work continues; no task has been sent yet."
          : "Choose a project first. No task has been sent.",
        new InlineKeyboard()
          .text("Projects", "projects")
          .text("Models", "models")
          .row()
          .text("Menu", "home"),
      );
      return;
    }
    if (command === "/status" || action === "status" || command === "/stop") {
      requirePermissions(
        actor,
        command === "/stop" ? P.SESSIONS_MANAGE : P.SESSIONS_READ,
      );
      if (!state.sessionId) {
        await this.telegram.sendMessage(
          chatId,
          "No session selected. Choose Recent sessions to inspect existing work, or Projects for a new task.",
          this.recoveryKeyboard(),
        );
        return;
      }
      await this.binding(actor.id, chatId, state.sessionId);
      const session = await this.sessions.get(actor.id, state.sessionId);
      if (command === "/stop")
        await this.sessions.interrupt(
          actor.id,
          session.id,
          session.turns.at(-1)?.id ?? "",
        );
      await this.telegram.sendMessage(
        chatId,
        command === "/stop"
          ? "Interruption requested. This does not confirm the process has stopped. Check Status for the latest saved state."
          : `Session: ${session.id}\nState: ${session.status}\n${session.providerId} · ${session.model} · ${session.effectiveReasoningEffort}\n${this.stopEvidence(session.stopConfirmation, session.recoveryReason)}`,
        this.recoveryKeyboard(),
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
        (command === "/cancel"
          ? "Back to menu. Selections are unchanged; running work continues.\n\n"
          : "") +
          "ProboxAI\nChoose a project, optionally choose a model, then send a task. Later messages continue the selected session.\n\n/projects · /sessions · /model · /status\n/new prepares a fresh session; it does not stop existing work.\n/stop requests interruption. /cancel returns to this menu.\nFile buttons download referenced project files.",
        this.menuKeyboard(),
      );
      return;
    }
    if (!text.trim()) return;
    if (text.length > 8000)
      throw new BadRequestException("Tasks must be at most 8000 characters.");
    if (!state.projectId) {
      await this.telegram.sendMessage(
        chatId,
        "Choose a project before sending a task. Your message was not submitted.",
        this.menuKeyboard(),
      );
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
      const accepted = await this.sessions.acceptTelegramTurn(
        actor.id,
        chatId,
        session.id,
        text,
        telegramTurnRequestId(actor.id, chatId, updateId),
      );
      await this.telegram.sendMessage(
        chatId,
        `Follow-up accepted · ${accepted.status}\nProject: ${project.name}\nSession: ${session.id}\nTurn: ${accepted.turnId}\nAcceptance is not completion. Updates will arrive here; check Status if delivery is delayed.`,
        this.recoveryKeyboard(),
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
          projectId: project.id,
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
      const accepted = await this.sessions.acceptTelegramTurn(
        actor.id,
        chatId,
        session.id,
        text,
        telegramTurnRequestId(actor.id, chatId, updateId),
        true,
      );
      await this.telegram.sendMessage(
        chatId,
        `Task accepted · ${accepted.status}\nProject: ${project.name}\n${selection.effectiveModel} · ${selection.effectiveReasoningEffort}\nSession: ${session.id}\nTurn: ${accepted.turnId}\nAcceptance is not completion. Updates will arrive here; check Status before resending.`,
        this.recoveryKeyboard(),
      );
    }
  }

  private menuKeyboard() {
    return new InlineKeyboard()
      .text("Projects", "projects")
      .text("Recent sessions", "sessions")
      .row()
      .text("Models", "models")
      .text("Status", "status")
      .row()
      .text("New session", "new");
  }

  private stopEvidence(confirmation: string, recoveryReason: string | null) {
    if (confirmation === "STOP_UNCONFIRMED")
      return (
        "Stop unconfirmed. Do not assume work stopped; follow-ups are blocked. Check the app for recovery state." +
        (recoveryReason === "OWNER_LOST" ? " The run owner was lost." : "")
      );
    if (confirmation === "LOCAL_EXIT_OBSERVED")
      return "Runner exit observed locally. This does not prove all descendant processes stopped.";
    if (confirmation === "NOT_STARTED")
      return "Stop evidence: no runner start recorded in this state.";
    return "Stop evidence: exit has not been observed.";
  }

  private recoveryKeyboard() {
    return new InlineKeyboard()
      .text("Check status", "status")
      .text("Recent sessions", "sessions")
      .row()
      .text("Menu", "home");
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
