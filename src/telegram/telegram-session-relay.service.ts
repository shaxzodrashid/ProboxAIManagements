import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma, SessionEvent } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { basename } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { SessionsService } from "../sessions/sessions.service";
import { TelegramService } from "./telegram.service";
import {
  TelegramIdentityService,
  requirePermissions,
} from "./telegram-identity.service";
import { Permissions as P } from "../authorization/permission.catalog";
import { AuthenticatedUser } from "../auth/auth.types";
import { escapeMarkdownV2, markdownV2Messages } from "./telegram-markdown";
import { sessionWidgetHtml } from "./telegram-session-widget";
import {
  fileReferences,
  record,
  ToolState,
  toolSummary,
  trackTool,
} from "./telegram-rendering";

// Only transient tool messages are ever deleted. Assistant messages and final
// tool summaries are permanent, including when the next turn starts.
export class TelegramSessionPresenter {
  constructor(
    private readonly telegram: TelegramService,
    readonly chatId: bigint,
    readonly label: string,
    public tools: ToolState = {},
    public toolMessageId: number | null = null,
  ) {}

  async flushTools(permanent: boolean) {
    if (!Object.keys(this.tools).length) return;
    if (this.toolMessageId !== null) {
      try {
        await this.telegram.deleteMessage(this.chatId, this.toolMessageId);
      } catch (error) {
        // Old or manually deleted tool messages must not block the final reply.
        if (record(error).error_code !== 400) throw error;
      }
      this.toolMessageId = null;
    }
    const sent = await this.telegram.sendMessage(
      this.chatId,
      `${this.label}\n${toolSummary(this.tools)}`,
    );
    if (permanent) this.tools = {};
    else this.toolMessageId = sent.message_id;
  }

  async assistant(
    text: string,
    keyboards: InlineKeyboard[] = [],
    replyTo?: number,
  ) {
    await this.flushTools(true);
    const chunks = markdownV2Messages(text);
    for (const [index, chunk] of chunks.entries())
      await this.telegram.sendMessage(
        this.chatId,
        `${this.label}\n${chunk.plain}`,
        index === chunks.length - 1 ? keyboards[0] : undefined,
        {
          markdown: `*${escapeMarkdownV2(this.label)}*\n${chunk.markdown}`,
          replyTo,
        },
      );
    for (const keyboard of keyboards.slice(1))
      await this.telegram.sendMessage(
        this.chatId,
        "Referenced files",
        keyboard,
      );
  }
}

type RelayBinding = Prisma.TelegramSessionGetPayload<{
  include: { session: { include: { task: true } } };
}>;

@Injectable()
export class TelegramSessionRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramSessionRelay.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly identities: TelegramIdentityService,
    private readonly projects: ProjectsService,
    private readonly sessions: SessionsService,
  ) {}

  async onModuleInit() {
    if (!this.telegram.configured) return;
    // Central lease reconciliation preserves another live owner and never replays prompts.
    await this.sessions.reconcileExpiredRuns();
    this.timer = setInterval(() => void this.tick(), 1500);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const bindings = await this.prisma.telegramSession.findMany({
        where: { finished: false },
        include: { session: { include: { task: true } } },
        orderBy: { createdAt: "asc" },
      });
      for (const binding of bindings) {
        if (this.stopped) break;
        try {
          await this.deliver(binding);
        } catch {
          this.logger.warn(
            `Telegram delivery pending for session ${binding.sessionId}`,
          );
        }
      }
    } catch {
      this.logger.warn("Telegram session polling failed; will retry");
    } finally {
      this.busy = false;
    }
  }

  private async deliver(binding: RelayBinding) {
    const actor = await this.identities.actor(binding.chatId);
    try {
      if (!actor || actor.id !== binding.userId)
        throw new ForbiddenException("Account unavailable");
      requirePermissions(actor, P.SESSIONS_READ, P.PROJECTS_READ);
      await this.sessions.get(actor.id, binding.sessionId);
      await this.projects.get(actor, binding.projectId);
    } catch (error) {
      if (
        !(error instanceof ForbiddenException) &&
        !(error instanceof NotFoundException)
      )
        throw error;
      await this.prisma.telegramSession.update({
        where: { sessionId: binding.sessionId },
        data: { finished: true },
      });
      return;
    }
    const events = await this.prisma.sessionEvent.findMany({
      where: {
        sessionId: binding.sessionId,
        sequence: { gt: binding.lastSequence },
      },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    let tracker = binding.trackerMessageId;
    const first = events[0];
    const queued =
      first?.type === "session.state" && !first.turnId ? events[1] : first;
    // Existing relay history keeps its original delivery behavior. Adopt a
    // tracker when this binding reaches a fresh turn's queued state.
    if (
      !tracker &&
      this.telegram.widgetsEnabled &&
      queued?.type === "session.state" &&
      queued.turnId &&
      record(queued.rawPayload).turnStatus === "QUEUED"
    ) {
      const sent = await this.telegram.sendWidget(
        binding.chatId,
        sessionWidgetHtml,
        `Session #${binding.sessionId.slice(0, 8)} · Live tracker\nThe final result arrives separately in this chat. /status shows the saved state.`,
        new InlineKeyboard()
          .text("View session", `s:${binding.sessionId}`)
          .text("Menu", "home"),
        binding.sessionId,
      );
      if (sent) {
        tracker = sent.message_id;
        await this.prisma.telegramSession.update({
          where: { sessionId: binding.sessionId },
          data: { trackerMessageId: tracker },
        });
      }
    }
    if (tracker) {
      await this.deliverTracked(binding, actor, events, tracker);
      return;
    }
    const presenter = new TelegramSessionPresenter(
      this.telegram,
      binding.chatId,
      `Session ${binding.sessionId.slice(0, 8)}`,
      binding.toolState as ToolState,
      binding.toolMessageId,
    );
    let sequence = binding.lastSequence;
    let toolsChanged = false;
    const save = () =>
      this.prisma.telegramSession.update({
        where: { sessionId: binding.sessionId },
        data: {
          lastSequence: sequence,
          toolMessageId: presenter.toolMessageId,
          toolState: presenter.tools as Prisma.InputJsonValue,
        },
      });
    for (const event of events) {
      if (trackTool(presenter.tools, event.type, event.rawPayload))
        toolsChanged = true;
      else {
        const payload = record(event.rawPayload);
        const item = record(payload.item);
        if (
          event.type === "item.completed" &&
          item.type === "agent_message" &&
          typeof item.text === "string"
        ) {
          const keyboards = await this.fileKeyboards(
            actor,
            binding,
            event.id,
            item.text,
          );
          await presenter.assistant(item.text, keyboards);
          toolsChanged = false;
        } else if (
          ["turn.completed", "turn.failed", "runner.error", "error"].includes(
            event.type,
          )
        ) {
          await presenter.flushTools(true);
          toolsChanged = false;
          if (event.type !== "turn.completed")
            await this.telegram.sendMessage(
              binding.chatId,
              `Session ${binding.sessionId.slice(0, 8)}: the turn reported an error. Check /status. Details are saved in the session event log.`,
            );
        }
      }
      sequence = event.sequence;
      // A tool batch is acknowledged only after its progress/summary reaches
      // Telegram, so a failed send is retried even if no further events arrive.
      if (!toolsChanged) await save();
    }
    if (toolsChanged) {
      await presenter.flushTools(false);
      await save();
    }
    // Read fresh status after draining events, so a final diff or event arriving
    // during this batch cannot cause premature completion.
    const session = await this.prisma.proboxAiSession.findUniqueOrThrow({
      where: { id: binding.sessionId },
    });
    if (
      !["QUEUED", "RUNNING"].includes(session.status) &&
      sequence >= session.lastSequence
    ) {
      await presenter.flushTools(true);
      await save();
      await this.telegram.sendMessage(
        binding.chatId,
        `Session ${session.id.slice(0, 8)}: ${session.status.toLowerCase()}.\nView the session and check Status before a follow-up. /new prepares a fresh task; it does not reopen this run.`,
        new InlineKeyboard()
          .text("View session", `s:${session.id}`)
          .row()
          .text("Menu", "home"),
      );
      await this.finish(session.id, sequence);
    }
  }

  private async deliverTracked(
    binding: RelayBinding,
    actor: AuthenticatedUser,
    events: SessionEvent[],
    tracker: number,
  ) {
    let sequence = binding.lastSequence;
    const save = () =>
      this.prisma.telegramSession.update({
        where: { sessionId: binding.sessionId },
        data: { lastSequence: sequence },
      });
    for (const event of events) {
      const state = record(event.rawPayload);
      if (
        event.type !== "session.state" ||
        state.authoritative !== true ||
        !event.turnId ||
        !["COMPLETED", "FAILED", "INTERRUPTED"].includes(
          String(state.turnStatus),
        )
      ) {
        continue;
      }
      const label = `Session #${binding.sessionId.slice(0, 8)}`;
      const answer =
        state.turnStatus === "COMPLETED"
          ? await this.prisma.sessionEvent.findFirst({
              where: {
                sessionId: binding.sessionId,
                turnId: event.turnId,
                sequence: { lt: event.sequence },
                type: "item.completed",
                rawPayload: { path: ["item", "type"], equals: "agent_message" },
              },
              orderBy: { sequence: "desc" },
              select: { id: true, rawPayload: true },
            })
          : null;
      const item = record(record(answer?.rawPayload).item);
      if (answer && typeof item.text === "string" && item.text.trim()) {
        const presenter = new TelegramSessionPresenter(
          this.telegram,
          binding.chatId,
          `Answer · #${binding.sessionId.slice(0, 8)}`,
        );
        await presenter.assistant(
          item.text,
          await this.fileKeyboards(actor, binding, answer.id, item.text),
          tracker,
        );
      } else {
        const result =
          state.turnStatus === "COMPLETED"
            ? "Completed without a text answer."
            : state.stopConfirmation === "STOP_UNCONFIRMED"
              ? "Runner exit is unconfirmed. Follow-ups are blocked."
              : state.turnStatus === "INTERRUPTED"
                ? "The turn was interrupted."
                : "The turn failed.";
        await this.telegram.sendMessage(
          binding.chatId,
          `${label}\n${result}`,
          undefined,
          {
            markdown: `*${escapeMarkdownV2(label)}*\n${escapeMarkdownV2(result)}`,
            replyTo: tracker,
          },
        );
      }
      sequence = event.sequence;
      await save();
    }
    const last = events.at(-1)?.sequence ?? sequence;
    if (last > sequence) {
      sequence = last;
      await save();
    }
    await this.finish(binding.sessionId, sequence);
  }

  private async finish(sessionId: string, sequence: number) {
    await this.prisma.telegramSession.updateMany({
      where: {
        sessionId,
        session: {
          status: { notIn: ["QUEUED", "RUNNING"] },
          lastSequence: sequence,
        },
      },
      data: { finished: true },
    });
  }

  private async fileKeyboards(
    actor: AuthenticatedUser,
    binding: RelayBinding,
    eventId: string,
    text: string,
  ) {
    const keyboards: InlineKeyboard[] = [];
    if (!actor.permissions.includes(P.PROJECT_FILES_READ)) return keyboards;
    const references = fileReferences(text, binding.session.cwd);
    let count = 0;
    for (const [index, relative] of references.entries()) {
      try {
        await this.projects.downloadFile(actor, binding.projectId, relative);
      } catch {
        continue;
      }
      if (count % 20 === 0) keyboards.push(new InlineKeyboard());
      keyboards
        .at(-1)!
        .text(`📎 ${basename(relative)}`.slice(0, 60), `f:${eventId}:${index}`)
        .row();
      count++;
    }
    return keyboards;
  }
}
