import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
import {
  fileReferences,
  record,
  splitMessage,
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

  async assistant(text: string, keyboards: InlineKeyboard[] = []) {
    await this.flushTools(true);
    const chunks = splitMessage(text, 3900);
    for (let i = 0; i < chunks.length; i++)
      await this.telegram.sendMessage(
        this.chatId,
        `${this.label}\n${chunks[i]!}`,
        i === chunks.length - 1 ? keyboards[0] : undefined,
      );
    for (const keyboard of keyboards.slice(1))
      await this.telegram.sendMessage(
        this.chatId,
        "Referenced files",
        keyboard,
      );
  }
}

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
    // The managed runner is process-local. Never automatically replay prompts
    // after a server restart; report interrupted work and allow explicit resume.
    const orphaned = await this.prisma.telegramSession.findMany({
      where: { session: { status: { in: ["QUEUED", "RUNNING"] } } },
      select: { sessionId: true },
    });
    const ids = orphaned.map((row) => row.sessionId);
    if (ids.length)
      await this.prisma.$transaction([
        this.prisma.proboxAiSession.updateMany({
          where: { id: { in: ids } },
          data: { status: "INTERRUPTED", endedAt: new Date() },
        }),
        this.prisma.proboxAiTurn.updateMany({
          where: { sessionId: { in: ids }, status: "RUNNING" },
          data: { status: "INTERRUPTED", endedAt: new Date() },
        }),
        this.prisma.telegramSession.updateMany({
          where: { sessionId: { in: ids } },
          data: { finished: false },
        }),
        this.prisma.task.updateMany({
          where: { status: "RUNNING", sessions: { some: { id: { in: ids } } } },
          data: { status: "CANCELLED" },
        }),
      ]);
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

  private async deliver(
    binding: Prisma.TelegramSessionGetPayload<{
      include: { session: { include: { task: true } } };
    }>,
  ) {
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
    const presenter = new TelegramSessionPresenter(
      this.telegram,
      binding.chatId,
      `Session ${binding.sessionId.slice(0, 8)}`,
      binding.toolState as ToolState,
      binding.toolMessageId,
    );
    const events = await this.prisma.sessionEvent.findMany({
      where: {
        sessionId: binding.sessionId,
        sequence: { gt: binding.lastSequence },
      },
      orderBy: { sequence: "asc" },
      take: 100,
    });
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
          const keyboards: InlineKeyboard[] = [];
          if (actor.permissions.includes(P.PROJECT_FILES_READ)) {
            const references = fileReferences(item.text, binding.session.cwd);
            let count = 0;
            for (let i = 0; i < references.length; i++) {
              const relative = references[i]!;
              try {
                await this.projects.downloadFile(
                  actor,
                  binding.projectId,
                  relative,
                );
              } catch {
                continue;
              }
              if (count % 20 === 0) keyboards.push(new InlineKeyboard());
              keyboards
                .at(-1)!
                .text(
                  `📎 ${basename(relative)}`.slice(0, 60),
                  `f:${event.id}:${i}`,
                )
                .row();
              count++;
            }
          }
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
        `Session ${session.id.slice(0, 8)}: ${session.status.toLowerCase()}.\nSelect this session to continue, or /new for a fresh task.`,
        new InlineKeyboard().text("Continue this session", `s:${session.id}`),
      );
      await this.prisma.telegramSession.updateMany({
        where: {
          sessionId: session.id,
          session: {
            status: { notIn: ["QUEUED", "RUNNING"] },
            lastSequence: sequence,
          },
        },
        data: { finished: true },
      });
    }
  }
}
