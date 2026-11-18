import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Permissions as P } from "../authorization/permission.catalog";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { SessionsService } from "../sessions/sessions.service";
import {
  TelegramIdentityService,
  requirePermissions,
} from "./telegram-identity.service";
import { record, toolActivityLabel } from "./telegram-rendering";
import { TelegramService } from "./telegram.service";

const pageSize = 3;
const descriptions: Record<string, string> = {
  QUEUED: "Waiting for a runner",
  RUNNING: "Runner active",
  PAUSED: "Session paused",
  COMPLETED: "Work completed",
  FAILED: "Run failed",
  INTERRUPTED: "Interruption recorded",
  ARCHIVED: "Session archived",
};

function shortText(text: string, bytes: number) {
  let display = "";
  for (const character of text.trim()) {
    const code = character.charCodeAt(0);
    const char = code < 32 || code === 127 ? " " : character;
    if (Buffer.byteLength(JSON.stringify(display + char)) > bytes - 3)
      return display + "…";
    display += char;
  }
  return display;
}

function seconds(date: Date | null) {
  return date ? Math.floor(date.getTime() / 1000) : null;
}

const unavailable = (error: unknown) =>
  error instanceof ForbiddenException || error instanceof NotFoundException;

export class TelegramWidgetQueries {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identities: TelegramIdentityService,
    private readonly sessions: SessionsService,
    private readonly projects: ProjectsService,
    private readonly telegram: TelegramService,
  ) {}

  async handle(value: unknown) {
    const query = record(value);
    if (typeof query.id !== "string" || !/^\d{1,32}$/.test(query.id)) return;
    let result: object = { error: "unavailable" };
    try {
      const from = record(query.from);
      const chat = record(query.chat);
      if (
        this.telegram.widgetsEnabled &&
        chat.type === "private" &&
        typeof chat.id === "number" &&
        Number.isSafeInteger(chat.id) &&
        chat.id > 0 &&
        chat.id === from.id &&
        Number.isSafeInteger(query.message_id) &&
        !query.inline_message_id &&
        !query.widget_id &&
        (!query.type || record(query.type).type === "data") &&
        typeof query.data === "string" &&
        query.data.length <= 64
      ) {
        const chatId = BigInt(chat.id);
        const actor = await this.identities.actor(chatId, chatId);
        if (actor) {
          requirePermissions(actor, P.SESSIONS_READ, P.PROJECTS_READ);
          const match =
            /^session:([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.exec(
              query.data,
            );
          if (match) result = await this.detail(actor, chatId, match[1]!);
          else if (/^recent:[0-6]$/.test(query.data))
            result = await this.recent(
              actor,
              chatId,
              Number(query.data.slice(7)),
            );
        }
      }
    } catch (error) {
      if (!unavailable(error)) result = { error: "retry" };
    }
    const data = JSON.stringify(result);
    await this.telegram.answerWidgetQuery(
      query.id,
      Buffer.byteLength(data) <= 1024 ? data : '{"error":"retry"}',
    );
  }

  private async recent(actor: AuthenticatedUser, chatId: bigint, page: number) {
    const bindings = await this.prisma.telegramSession.findMany({
      where: { userId: actor.id, chatId },
      include: { session: { select: { task: { select: { title: true } } } } },
      orderBy: [{ createdAt: "desc" }, { sessionId: "desc" }],
      skip: page * pageSize,
      take: page < 6 ? pageSize + 1 : 2,
    });
    const rows = await Promise.all(
      bindings.slice(0, pageSize).map(async (binding) => {
        try {
          const [session, project] = await Promise.all([
            this.sessions.get(actor.id, binding.sessionId),
            this.projects.get(actor, binding.projectId),
          ]);
          return [
            binding.sessionId,
            shortText(binding.session.task.title, 90),
            shortText(project.name, 45),
            session.status,
            seconds(session.updatedAt),
            session.stopConfirmation === "STOP_UNCONFIRMED",
          ];
        } catch (error) {
          if (!unavailable(error)) throw error;
          return null;
        }
      }),
    );
    return {
      rows: rows.filter((row) => row !== null),
      more: bindings.length > pageSize,
    };
  }

  private async detail(
    actor: AuthenticatedUser,
    chatId: bigint,
    sessionId: string,
  ) {
    const binding = await this.prisma.telegramSession.findFirst({
      where: { sessionId, userId: actor.id, chatId },
      include: { session: { select: { task: { select: { title: true } } } } },
    });
    if (!binding) throw new NotFoundException();
    const [session, project] = await Promise.all([
      this.sessions.get(actor.id, sessionId),
      this.projects.get(actor, binding.projectId),
    ]);
    const turn = session.turns.at(-1);
    const events = turn
      ? await this.prisma.sessionEvent.findMany({
          where: {
            sessionId,
            turnId: turn.id,
            sequence: { lte: session.lastSequence },
            type: { in: ["item.started", "item.completed", "turn.started"] },
          },
          orderBy: { sequence: "desc" },
          take: 30,
          select: { type: true, rawPayload: true, createdAt: true },
        })
      : [];
    const activity: [string, number][] = [];
    const items = new Set<string>();
    for (const event of events) {
      const item = record(record(event.rawPayload).item);
      const label = toolActivityLabel(event.type, item);
      if (!label) continue;
      const id = typeof item.id === "string" ? item.id : label;
      if (items.has(id)) continue;
      items.add(id);
      if (activity.at(-1)?.[0] === label) continue;
      activity.push([label, seconds(event.createdAt)!]);
      if (activity.length === 4) break;
    }
    const unconfirmed = session.stopConfirmation === "STOP_UNCONFIRMED";
    return {
      title: shortText(binding.session.task.title, 120),
      project: shortText(project.name, 70),
      status: session.status,
      summary: descriptions[session.status],
      unconfirmed,
      begin: seconds(turn?.executionStartedAt ?? null),
      end: seconds(turn?.endedAt ?? null),
      note: unconfirmed
        ? "Runner exit is unconfirmed. Follow-ups are blocked."
        : session.status === "COMPLETED"
          ? "Look for the separate result in this chat."
          : null,
      activity,
    };
  }
}
