import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, SessionStatus, TaskStatus, TurnStatus } from "@prisma/client";
import { ProboxAiRunner, RunnerEvent } from "./proboxai-runner.service";
import { PrismaService } from "../prisma/prisma.service";
import { SessionEventsService } from "./session-events.service";
import { CreateSessionDto } from "./dto";
import { ModelCatalogService } from "./model-catalog.service";

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly interrupted = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ProboxAiRunner,
    private readonly liveEvents: SessionEventsService,
    private readonly modelCatalog: ModelCatalogService,
  ) {}

  async create(actorId: string, dto: CreateSessionDto, start = true) {
    const task = await this.prisma.task.findUnique({
      where: { id: dto.taskId },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (task.managerId !== actorId)
      throw new ForbiddenException(
        "Only the assigned manager may start a session",
      );
    const selection = this.modelCatalog.resolve(
      dto.providerId,
      dto.model,
      dto.reasoningEffort,
    );
    const session = await this.prisma.proboxAiSession.create({
      data: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        creatorId: actorId,
        cwd: dto.cwd,
        sandbox: dto.sandbox,
        model: selection.effectiveModel,
        providerId: selection.providerId,
        requestedModel: selection.requestedModel,
        effectiveModel: selection.effectiveModel,
        requestedReasoningEffort: selection.requestedReasoningEffort,
        effectiveReasoningEffort: selection.effectiveReasoningEffort,
        catalogSnapshot: selection.catalogSnapshot as Prisma.InputJsonValue,
        status: SessionStatus.QUEUED,
      },
    });
    await this.prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.RUNNING },
    });
    if (start) this.launchTurn(session.id, dto.prompt);
    return session;
  }

  launchTurn(sessionId: string, prompt: string) {
    void this.startTurn(sessionId, prompt).catch(() =>
      this.logger.error(`Unable to start turn for session ${sessionId}`),
    );
  }

  async startTurn(sessionId: string, prompt: string) {
    const session = await this.prisma.proboxAiSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("Session not found");
    const claimed = await this.prisma.proboxAiSession.updateMany({
      where: {
        id: sessionId,
        status: {
          in: ["QUEUED", "COMPLETED", "FAILED", "PAUSED", "INTERRUPTED"],
        },
      },
      data: {
        status: SessionStatus.RUNNING,
        endedAt: null,
        startedAt: session.startedAt ?? new Date(),
      },
    });
    if (!claimed.count)
      throw new ForbiddenException("A session can have one active turn");
    let turn: { id: string } | undefined;
    try {
      await this.prisma.task.update({
        where: { id: session.taskId },
        data: { status: TaskStatus.RUNNING },
      });
      turn = await this.prisma.proboxAiTurn.create({
        data: { sessionId, prompt, status: TurnStatus.RUNNING },
      });
      const turnId = turn.id;
      let failed = false;
      const code = await this.runner.start(
        {
          sessionId,
          cwd: session.cwd,
          sandbox: session.sandbox as
            "read-only" | "workspace-write" | "danger-full-access",
          prompt,
          model: session.model ?? undefined,
          providerId: session.providerId,
          reasoningEffort: session.effectiveReasoningEffort ?? undefined,
          threadId: session.codexThreadId ?? undefined,
        },
        (event) => {
          if (["turn.failed", "error"].includes(event.type)) failed = true;
          return this.recordEvent(sessionId, turnId, event);
        },
      );
      await this.prisma.proboxAiTurn.update({
        where: { id: turn.id },
        data: {
          status: this.interrupted.has(sessionId)
            ? TurnStatus.INTERRUPTED
            : code === 0 && !failed
              ? TurnStatus.COMPLETED
              : TurnStatus.FAILED,
          endedAt: new Date(),
        },
      });
      await this.prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: {
          status: this.interrupted.has(sessionId)
            ? SessionStatus.INTERRUPTED
            : code === 0 && !failed
              ? SessionStatus.COMPLETED
              : SessionStatus.FAILED,
          endedAt: new Date(),
        },
      });
      await this.prisma.task.update({
        where: { id: session.taskId },
        data: {
          status: this.interrupted.has(sessionId)
            ? TaskStatus.CANCELLED
            : code === 0 && !failed
              ? TaskStatus.COMPLETED
              : TaskStatus.FAILED,
        },
      });
    } catch (error) {
      if (turn)
        await this.prisma.proboxAiTurn.update({
          where: { id: turn.id },
          data: { status: TurnStatus.FAILED, endedAt: new Date() },
        });
      await this.recordEvent(sessionId, turn?.id ?? null, {
        type: "runner.error",
        payload: {
          message: error instanceof Error ? error.message : String(error),
        },
        rawLine: "",
      }).catch(() =>
        this.logger.error(
          `Unable to record runner failure for session ${sessionId}`,
        ),
      );
      await this.prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.FAILED, endedAt: new Date() },
      });
      await this.prisma.task.update({
        where: { id: session.taskId },
        data: { status: TaskStatus.FAILED },
      });
    } finally {
      this.interrupted.delete(sessionId);
    }
  }

  async interrupt(actorId: string, sessionId: string) {
    await this.assertManager(actorId, sessionId);
    if (!this.runner.interrupt(sessionId))
      throw new NotFoundException("No active local session process");
    this.interrupted.add(sessionId);
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

  listModelCatalog(providerId?: string) {
    return {
      version: this.modelCatalog.version,
      providers: this.modelCatalog.list(providerId),
    };
  }

  private async recordEvent(
    sessionId: string,
    turnId: string | null,
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
      turnId &&
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
