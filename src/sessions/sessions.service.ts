import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, SessionStatus, TaskStatus, TurnStatus } from "@prisma/client";
import { ProboxAiRunner, RunnerEvent } from "./proboxai-runner.service";
import { PrismaService } from "../prisma/prisma.service";
import { SessionEventsService } from "./session-events.service";
import { CreateSessionDto, CreateTurnDto } from "./dto";

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ProboxAiRunner,
    private readonly liveEvents: SessionEventsService,
  ) {}

  async create(actorId: string, dto: CreateSessionDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: dto.taskId },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (task.managerId !== actorId)
      throw new ForbiddenException(
        "Only the assigned manager may start a session",
      );
    const session = await this.prisma.proboxAiSession.create({
      data: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        creatorId: actorId,
        cwd: dto.cwd,
        sandbox: dto.sandbox,
        model: dto.model,
        status: SessionStatus.QUEUED,
      },
    });
    await this.prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.RUNNING },
    });
    void this.startTurn(session.id, dto.prompt);
    return session;
  }

  async startTurn(sessionId: string, prompt: string) {
    const session = await this.prisma.proboxAiSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("Session not found");
    if (session.status === SessionStatus.RUNNING)
      throw new ForbiddenException("A session can have one active turn");
    const turn = await this.prisma.proboxAiTurn.create({
      data: { sessionId, prompt, status: TurnStatus.RUNNING },
    });
    await this.prisma.proboxAiSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.RUNNING,
        startedAt: session.startedAt ?? new Date(),
      },
    });
    try {
      const code = await this.runner.start(
        {
          sessionId,
          cwd: session.cwd,
          sandbox: session.sandbox as
            "read-only" | "workspace-write" | "danger-full-access",
          prompt,
          model: session.model ?? undefined,
        },
        (event) => this.recordEvent(sessionId, turn.id, event),
      );
      await this.prisma.proboxAiTurn.update({
        where: { id: turn.id },
        data: {
          status: code === 0 ? TurnStatus.COMPLETED : TurnStatus.FAILED,
          endedAt: new Date(),
        },
      });
      await this.prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: {
          status: code === 0 ? SessionStatus.COMPLETED : SessionStatus.FAILED,
          endedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.proboxAiTurn.update({
        where: { id: turn.id },
        data: { status: TurnStatus.FAILED, endedAt: new Date() },
      });
      await this.prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.FAILED, endedAt: new Date() },
      });
      await this.recordEvent(sessionId, turn.id, {
        type: "runner.error",
        payload: {
          message: error instanceof Error ? error.message : String(error),
        },
        rawLine: "",
      });
    }
  }

  async interrupt(actorId: string, sessionId: string) {
    await this.assertManager(actorId, sessionId);
    if (!this.runner.interrupt(sessionId))
      throw new NotFoundException("No active local session process");
    return { interrupted: true };
  }

  async get(actorId: string, sessionId: string) {
    const session = await this.assertManager(actorId, sessionId);
    return {
      ...session,
      turns: await this.prisma.proboxAiTurn.findMany({
        where: { sessionId },
        orderBy: { startedAt: "asc" },
      }),
    };
  }

  private async recordEvent(
    sessionId: string,
    turnId: string,
    event: RunnerEvent,
  ) {
    const session = await this.prisma.proboxAiSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        lastSequence: true,
        events: {
          orderBy: { sequence: "desc" },
          take: 1,
          select: { payloadHash: true },
        },
      },
    });
    const sequence = session.lastSequence + 1;
    const previousHash = session.events[0]?.payloadHash;
    const payloadHash = ProboxAiRunner.hash(
      event.rawLine || JSON.stringify(event.payload),
      previousHash,
    );
    await this.prisma.$transaction([
      this.prisma.sessionEvent.create({
        data: {
          sessionId,
          turnId,
          sequence,
          type: event.type,
          itemType:
            typeof event.payload.item === "object" && event.payload.item
              ? String(
                  (event.payload.item as Record<string, unknown>).type ?? "",
                )
              : null,
          rawPayload: event.payload as Prisma.InputJsonValue,
          payloadHash,
          previousHash,
        },
      }),
      this.prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: {
          lastSequence: sequence,
          codexThreadId:
            typeof event.payload.thread_id === "string"
              ? event.payload.thread_id
              : undefined,
        },
      }),
    ]);
    if (
      event.type === "turn.completed" &&
      typeof event.payload.usage === "object" &&
      event.payload.usage
    ) {
      const usage = event.payload.usage as Record<string, unknown>;
      await this.prisma.proboxAiTurn.update({
        where: { id: turnId },
        data: {
          inputTokens: numberOrNull(usage.input_tokens),
          cachedTokens: numberOrNull(usage.cached_input_tokens),
          outputTokens: numberOrNull(usage.output_tokens),
          reasoningTokens: numberOrNull(usage.reasoning_output_tokens),
        },
      });
    }
    this.liveEvents.publish(sessionId, {
      id: sequence,
      type: event.type,
      data: event.payload,
    });
  }

  private async assertManager(actorId: string, sessionId: string) {
    const session = await this.prisma.proboxAiSession.findUnique({
      where: { id: sessionId },
      include: { task: true },
    });
    if (!session) throw new NotFoundException("Session not found");
    if (session.task.managerId !== actorId)
      throw new ForbiddenException(
        "Only the assigned manager may access this session",
      );
    return session;
  }
}
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
