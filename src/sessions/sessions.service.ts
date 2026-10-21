import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import { Observable } from "rxjs";
import {
  safeRunnerEvent,
  eventResponse,
  publicSessionEventSelect,
} from "./safe-session-event";
import { appendSessionEvent } from "./durable-session-events";
import { Prisma, SessionStatus, TaskStatus, TurnStatus } from "@prisma/client";
import { ProboxAiRunner, RunnerEvent } from "./proboxai-runner.service";
import { PrismaService } from "../prisma/prisma.service";
import { SessionEventsService } from "./session-events.service";
import {
  sessionResponse,
  turnResponse,
  acceptanceResponse,
} from "./session-projections";
import { CreateSessionDto } from "./dto";
import { ModelCatalogService } from "./model-catalog.service";
import { personalSessionSelection } from "./personal-model-preferences.service";
import { KeyedCreateSessionDto } from "./session-creation.dto";
import {
  archiveRunnerEvent,
  archiveHash,
  historyJson,
  historyText,
  protectSessionPrompt,
  sessionExecutionPrompt,
  sessionRuntimeProvenance,
  SESSION_ARCHIVE_POLICY_VERSION,
} from "./session-history";
import * as path from "node:path";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";
import { readDependency } from "../prisma/read-dependency";
import { archiveEventResponse } from "./session-history";
import { sessionDetailPage } from "./session-detail";
import { AuthenticatedUser } from "../auth/auth.types";
import { SessionListQueryDto } from "./session-list.dto";
import { listSessions } from "./session-list";

@Injectable()
export class SessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionsService.name);
  private readonly owner = randomUUID();
  private recoveryTimer?: NodeJS.Timeout;
  private recoveryBusy = false;
  private creationDispatchBusy = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ProboxAiRunner,
    private readonly liveEvents: SessionEventsService,
    private readonly modelCatalog: ModelCatalogService,
    private readonly paths: WorkspacePathPolicy = new WorkspacePathPolicy(),
  ) {}

  list(actor: AuthenticatedUser, query: SessionListQueryDto) {
    return listSessions(this.prisma, actor, query);
  }

  private async executionScope(
    tx: Prisma.TransactionClient,
    actorId: string,
    taskId: string | undefined,
    projectId: string | undefined,
    permission = "sessions.create",
  ) {
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: {
        workspaceId: true,
        status: true,
        roleAssignments: {
          select: {
            role: {
              select: { permissions: { select: { permissionKey: true } } },
            },
          },
        },
      },
    });
    if (!actor || actor.status !== "OPEN")
      throw new ForbiddenException("Session execution is unavailable");
    const grants = new Set(
      actor.roleAssignments.flatMap((a) =>
        a.role.permissions.map((p) => p.permissionKey),
      ),
    );
    if (!grants.has(permission))
      throw new ForbiddenException("Session execution is unavailable");
    if (taskId) {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task || task.workspaceId !== actor.workspaceId)
        throw new NotFoundException("Task not found");
      if (task.managerId !== actorId)
        throw new ForbiddenException(
          "Only the assigned manager may start a session",
        );
    }
    if (!projectId) return null;
    const project = await tx.project.findFirst({
      where: { id: projectId, workspaceId: actor.workspaceId },
      include: { members: { select: { userId: true } }, department: true },
    });
    if (!project || project.department.workspaceId !== actor.workspaceId)
      throw new NotFoundException("Project not found");
    if (project.archivedAt)
      throw new ConflictException("Archived projects cannot accept execution");
    if (
      !grants.has("projects.manage-all") &&
      !project.members.some((m) => m.userId === actorId)
    )
      throw new ForbiddenException(
        "Only project members and administrators may perform this action",
      );
    const safeName =
      project.directoryName &&
      ![".", ".."].includes(project.directoryName) &&
      !/[\\/\0:]/.test(project.directoryName);
    const root =
      safeName && path.isAbsolute(project.department.homePath)
        ? path.join(project.department.homePath, project.directoryName)
        : null;
    return {
      project: { id: project.id, name: project.name, status: project.status },
      root,
      ready:
        project.status === "READY" &&
        project.department.status === "ACTIVE" &&
        !!root,
    };
  }

  private async executionValidation(
    tx: Prisma.TransactionClient,
    actorId: string,
    taskId: string | undefined,
    projectId: string | undefined,
    cwd: string | undefined,
    sandbox: string,
    permission = "sessions.create",
  ) {
    const scope = await this.executionScope(
      tx,
      actorId,
      taskId,
      projectId,
      permission,
    );
    const requestedPath = cwd ?? scope?.root ?? "";
    await this.assertNotArchivedExecution(
      tx,
      actorId,
      requestedPath,
      projectId,
    );
    const directory =
      scope && !scope.ready
        ? { valid: false, normalizedPath: null, reason: "PROJECT_NOT_READY" }
        : await this.paths.executionDirectory(
            requestedPath,
            sandbox !== "read-only",
            scope?.root ?? undefined,
          );
    return {
      project: scope?.project ?? null,
      requestedPath,
      ...directory,
      guidance: scope
        ? "SELECTED_PROJECT_DIRECTORY"
        : "ABSOLUTE_ALLOWED_WORKSPACE_DIRECTORY",
      revalidateAtLaunch: true as const,
    };
  }

  async preflight(
    actorId: string,
    dto: { taskId: string; projectId?: string; cwd?: string; sandbox: string },
  ) {
    return this.prisma.$transaction((tx) =>
      this.executionValidation(
        tx,
        actorId,
        dto.taskId,
        dto.projectId,
        dto.cwd,
        dto.sandbox,
      ),
    );
  }

  async projectExecutionContext(
    actorId: string,
    projectId: string,
    taskId?: string,
    sandbox = "read-only",
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.executionValidation(
        tx,
        actorId,
        taskId,
        projectId,
        undefined,
        sandbox,
      );
      return {
        ...result,
        capabilities: {
          canStartSession: !!taskId && result.valid,
          requiresAssignedTask: !taskId,
        },
      };
    });
  }

  private requireValidDirectory(result: {
    valid: boolean;
    normalizedPath: string | null;
    requestedPath: string;
    reason: string | null;
  }) {
    if (!result.valid || !result.normalizedPath)
      throw new BadRequestException({
        code: "SESSION_DIRECTORY_INVALID",
        message:
          "Working directory is unavailable; correct the path or project setup",
        reason: result.reason,
        requestedPath: result.requestedPath,
        sessionId: null,
      });
    return result.normalizedPath;
  }

  private async launchDirectory(
    tx: Prisma.TransactionClient,
    actorId: string,
    taskId: string,
    projectId: string | undefined,
    cwd: string,
    sandbox: string,
    permission: string,
  ) {
    try {
      return await this.executionValidation(
        tx,
        actorId,
        taskId,
        projectId,
        cwd,
        sandbox,
        permission,
      );
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        return {
          valid: false,
          normalizedPath: null,
          reason: "AUTHORIZATION_LOST",
        };
      throw error;
    }
  }

  async create(actorId: string, dto: CreateSessionDto, start = true) {
    const { creationReceipt: _creationReceipt, ...result } =
      await this.acceptCreation(actorId, dto, start);
    return result;
  }
  async submitCreation(actor: AuthenticatedUser, dto: KeyedCreateSessionDto) {
    if (actor.type !== undefined && actor.type !== "access")
      throw new ForbiddenException("Human session creation required");
    if (
      [
        dto.projectId,
        dto.cwd,
        dto.providerId,
        dto.model,
        dto.reasoningEffort,
      ].some((value) => value === null)
    )
      throw new BadRequestException(
        "Omit optional session fields instead of null",
      );
    const requestId = dto.requestId.toLowerCase();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        requestId,
      )
    )
      throw new BadRequestException("UUIDv4 creation intent required");
    const normalized = {
      taskId: dto.taskId.toLowerCase(),
      prompt: dto.prompt,
      sandbox: dto.sandbox,
      ...(dto.projectId === undefined
        ? {}
        : { projectId: dto.projectId.toLowerCase() }),
      ...(dto.cwd === undefined ? {} : { cwd: dto.cwd }),
      ...(dto.providerId === undefined ? {} : { providerId: dto.providerId }),
      ...(dto.model === undefined ? {} : { model: dto.model }),
      ...(dto.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: dto.reasoningEffort }),
    };
    const inputHash = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
    const result = await this.acceptCreation(actor.id, normalized, true, {
      requestId,
      inputHash,
      workspaceId: actor.workspaceId,
    });
    return result.creationReceipt!;
  }
  private creationReceipt(session: {
    id: string;
    creationRequestId: string | null;
    creationInitialTurnId: string | null;
    creationAcceptedAt: Date | null;
  }) {
    if (
      !session.creationRequestId ||
      !session.creationInitialTurnId ||
      !session.creationAcceptedAt
    )
      throw new ServiceUnavailableException(
        "Session creation receipt is unavailable",
      );
    return {
      accepted: true as const,
      requestId: session.creationRequestId,
      sessionId: session.id,
      initialTurnId: session.creationInitialTurnId,
      acceptedAt: session.creationAcceptedAt,
    };
  }
  async creationOutcome(actor: AuthenticatedUser, requestId: string) {
    return readDependency("readSessionCreation", () =>
      this.prisma.$transaction(
        async (tx) => {
          const session = await tx.proboxAiSession.findUnique({
            where: {
              creatorId_creationRequestId: {
                creatorId: actor.id,
                creationRequestId: requestId.toLowerCase(),
              },
            },
          });
          if (!session || session.workspaceId !== actor.workspaceId)
            throw new NotFoundException("Session creation not found");
          await this.assertManager(actor.id, session.id, "sessions.create", tx);
          return this.creationReceipt(session);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }
  private async acceptCreation(
    actorId: string,
    dto: CreateSessionDto,
    start: boolean,
    creation?: { requestId: string; inputHash: string; workspaceId: string },
  ) {
    const explicitSelection =
      [dto.providerId, dto.model, dto.reasoningEffort].some(
        (value) => value !== undefined,
      ) && !creation
        ? this.modelCatalog.resolve(
            dto.providerId,
            dto.model,
            dto.reasoningEffort,
          )
        : null;
    const accepted = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT w.id FROM "Workspace" w JOIN "Task" t ON t."workspaceId" = w.id WHERE t.id = ${dto.taskId} FOR UPDATE OF w`;
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${dto.taskId} FOR UPDATE`;
      const now = await this.databaseNow(tx);
      const task = await tx.task.findUnique({ where: { id: dto.taskId } });
      if (!task) throw new NotFoundException("Task not found");
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: {
          workspaceId: true,
          status: true,
          roleAssignments: {
            select: {
              role: {
                select: { permissions: { select: { permissionKey: true } } },
              },
            },
          },
        },
      });
      if (
        !actor ||
        actor.status !== "OPEN" ||
        actor.workspaceId !== task.workspaceId ||
        (creation && actor.workspaceId !== creation.workspaceId)
      )
        throw new NotFoundException("Task not found");
      if (task.managerId !== actorId)
        throw new ForbiddenException(
          "Only the assigned manager may start a session",
        );
      if (
        !actor.roleAssignments.some((a) =>
          a.role.permissions.some((p) => p.permissionKey === "sessions.create"),
        )
      )
        throw new ForbiddenException("Session creation is no longer available");
      if (creation) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"session-create:" + actorId + ":" + creation.requestId}, 0))`;
        const prior = await tx.proboxAiSession.findUnique({
          where: {
            creatorId_creationRequestId: {
              creatorId: actorId,
              creationRequestId: creation.requestId,
            },
          },
        });
        if (prior) {
          if (
            prior.creationInputHash !== creation.inputHash ||
            prior.workspaceId !== actor.workspaceId ||
            prior.taskId !== task.id
          )
            throw new ConflictException(
              "Creation intent already has different input",
            );
          return { session: prior, turn: null, created: false };
        }
      }
      const selection =
        explicitSelection ??
        ([dto.providerId, dto.model, dto.reasoningEffort].some(
          (value) => value !== undefined,
        )
          ? this.modelCatalog.resolve(
              dto.providerId,
              dto.model,
              dto.reasoningEffort,
            )
          : await personalSessionSelection(tx, this.modelCatalog, actorId));
      const cwd = this.requireValidDirectory(
        await this.executionValidation(
          tx,
          actorId,
          dto.taskId,
          dto.projectId,
          dto.cwd,
          dto.sandbox,
        ),
      );
      const sessionId = randomUUID(),
        initialTurnId = start ? randomUUID() : null;
      const protectedInput = start
        ? protectSessionPrompt(
            dto.prompt,
            sessionId,
            initialTurnId!,
            !!creation,
          )
        : null;
      const session = await tx.proboxAiSession.create({
        data: {
          id: sessionId,
          ...(creation
            ? {
                creationRequestId: creation.requestId,
                creationInputHash: creation.inputHash,
                creationInitialTurnId: initialTurnId,
                creationAcceptedAt: now,
              }
            : {}),
          runtimeProvenance: await sessionRuntimeProvenance(tx),
          workspaceId: task.workspaceId,
          taskId: task.id,
          creatorId: actorId,
          cwd,
          selectedProjectId: dto.projectId ?? null,
          sandbox: dto.sandbox,
          model: selection.effectiveModel,
          providerId: selection.providerId,
          requestedModel: selection.requestedModel,
          effectiveModel: selection.effectiveModel,
          requestedReasoningEffort: selection.requestedReasoningEffort,
          effectiveReasoningEffort: selection.effectiveReasoningEffort,
          catalogSnapshot: selection.catalogSnapshot as Prisma.InputJsonValue,
          status:
            start && !creation ? SessionStatus.RUNNING : SessionStatus.QUEUED,
          startedAt: start && !creation ? now : null,
          runOwner: start && !creation ? this.owner : null,
          runLeaseExpiresAt:
            start && !creation ? new Date(now.getTime() + 60000) : null,
          stopConfirmation: "NOT_STARTED",
        },
      });
      const turn = start
        ? await tx.proboxAiTurn.create({
            data: {
              id: initialTurnId!,
              sessionId: session.id,
              ...protectedInput!,
              status: TurnStatus.QUEUED,
              requestedById: actorId,
              executionPermission: "sessions.create",
            },
          })
        : null;
      await tx.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.RUNNING },
      });
      await this.stateEvent(tx, session.id, turn?.id ?? null);
      return {
        session: await tx.proboxAiSession.findUniqueOrThrow({
          where: { id: session.id },
        }),
        turn,
        created: true,
      };
    }, creation?.requestId);
    if (creation && accepted.created) this.scheduleCreationDispatch();
    else if (!creation && accepted.turn)
      this.launchAccepted(accepted.session.id, accepted.turn.id);
    return {
      ...sessionResponse(accepted.session),
      initialTurn: accepted.turn ? turnResponse(accepted.turn) : null,
      creationReceipt: creation ? this.creationReceipt(accepted.session) : null,
    };
  }

  private scheduleCreationDispatch() {
    setImmediate(() => {
      void this.dispatchPendingCreations().catch(() =>
        this.logger.error("Durable session dispatch unavailable"),
      );
    });
  }
  async dispatchPendingCreations() {
    // Also dispatches explicitly opted-in REST follow-ups after safe lease
    // recovery. Keep the existing method name for internal callers.
    if (this.creationDispatchBusy) return;
    this.creationDispatchBusy = true;
    try {
      const rows = await this.prisma.proboxAiSession.findMany({
        where: {
          OR: [
            {
              creationRequestId: { not: null },
              creationInitialTurnId: { not: null },
            },
            {
              turns: {
                some: {
                  durableDispatch: true,
                  status: "QUEUED",
                  executionStartedAt: null,
                },
              },
            },
          ],
          status: "QUEUED",
          stopConfirmation: "NOT_STARTED",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
        select: { id: true },
      });
      for (const row of rows) {
        const claim = await this.prisma.$transaction(async (tx) => {
          await this.lockRun(tx, row.id);
          const now = await this.databaseNow(tx);
          const session = await tx.proboxAiSession.findUnique({
            where: { id: row.id },
          });
          if (
            !session ||
            session.status !== "QUEUED" ||
            session.stopConfirmation !== "NOT_STARTED" ||
            (session.runLeaseExpiresAt && session.runLeaseExpiresAt > now)
          )
            return null;
          const turn = await tx.proboxAiTurn.findFirst({
            where: {
              sessionId: session.id,
              status: "QUEUED",
              executionStartedAt: null,
              OR: [
                { durableDispatch: true },
                ...(session.creationRequestId && session.creationInitialTurnId
                  ? [{ id: session.creationInitialTurnId }]
                  : []),
              ],
            },
          });
          if (!turn) return null;
          await tx.proboxAiSession.update({
            where: { id: session.id },
            data: {
              status: "RUNNING",
              runOwner: this.owner,
              runLeaseExpiresAt: new Date(now.getTime() + 60000),
              startedAt: session.startedAt ?? now,
              dispatchAttempts: { increment: 1 },
              lastDispatchAt: now,
            },
          });
          await this.stateEvent(tx, session.id, turn.id);
          return { sessionId: session.id, turnId: turn.id };
        });
        if (claim) this.launchAccepted(claim.sessionId, claim.turnId);
      }
    } finally {
      this.creationDispatchBusy = false;
    }
  }

  private launchAccepted(sessionId: string, turnId: string) {
    // The DB acceptance commits first. A duplicate request never enters this path.
    setImmediate(() => {
      void this.runAcceptedTurn(sessionId, turnId).catch(() =>
        this.logger.error(`Unable to finish accepted turn ${turnId}`),
      );
    });
  }

  async acceptFollowUp(
    actorId: string,
    sessionId: string,
    prompt: string,
    requestId: string,
  ) {
    const accepted = await this.acceptTurn(
      sessionId,
      prompt,
      actorId,
      requestId,
    );
    if (accepted.created) this.launchAccepted(sessionId, accepted.turn.id);
    return acceptanceResponse(accepted.turn);
  }

  async acceptTelegramTurn(
    actorId: string,
    chatId: bigint,
    sessionId: string,
    prompt: string,
    requestId: string,
    initial = false,
  ) {
    const accepted = await this.acceptTurn(
      sessionId,
      prompt,
      actorId,
      requestId,
      { chatId, initial },
    );
    if (accepted.created) this.launchAccepted(sessionId, accepted.turn.id);
    return acceptanceResponse(accepted.turn);
  }

  async turnByRequest(actorId: string, sessionId: string, requestId: string) {
    return readDependency("readSessionTurnReceipt", async () => {
      await this.assertManager(actorId, sessionId, "sessions.manage");
      const turn = await this.prisma.proboxAiTurn.findUnique({
        where: {
          sessionId_requestId: {
            sessionId,
            requestId: requestId.toLowerCase(),
          },
        },
      });
      if (!turn || turn.requestedById !== actorId)
        throw new NotFoundException("Turn request not found");
      return acceptanceResponse(turn);
    });
  }

  private async acceptTurn(
    sessionId: string,
    prompt: string,
    actorId: string,
    requestId: string,
    telegram?: { chatId: bigint; initial: boolean },
  ) {
    if (
      !actorId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        requestId,
      )
    )
      throw new BadRequestException(
        "A current actor and UUIDv4 request ID are required",
      );
    requestId = requestId.toLowerCase();
    return this.transaction(async (tx) => {
      await this.lockRun(tx, sessionId);
      const now = await this.databaseNow(tx);
      const session = await tx.proboxAiSession.findUnique({
        where: { id: sessionId },
        include: { task: true },
      });
      if (!session) throw new NotFoundException("Session not found");
      if (actorId) {
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: {
            workspaceId: true,
            status: true,
            roleAssignments: {
              select: {
                role: {
                  select: { permissions: { select: { permissionKey: true } } },
                },
              },
            },
          },
        });
        if (
          !actor ||
          actor.status !== "OPEN" ||
          actor.workspaceId !== session.workspaceId ||
          session.task.workspaceId !== actor.workspaceId
        )
          throw new NotFoundException("Session not found");
        if (session.task.managerId !== actorId)
          throw new ForbiddenException(
            "Only the assigned manager may access this session",
          );
        if (
          !actor.roleAssignments.some((a) =>
            a.role.permissions.some(
              (p) =>
                p.permissionKey ===
                (telegram?.initial ? "sessions.create" : "sessions.manage"),
            ),
          )
        )
          throw new ForbiddenException(
            "Session management is no longer available",
          );
      }
      if (telegram) {
        const binding = await tx.telegramSession.findFirst({
          where: { sessionId, userId: actorId, chatId: telegram.chatId },
        });
        if (!binding) throw new NotFoundException("Telegram session not found");
      }
      if (requestId) {
        const prior = await tx.proboxAiTurn.findUnique({
          where: { sessionId_requestId: { sessionId, requestId } },
        });
        if (prior) {
          if (
            (prior.inputHash
              ? prior.inputHash !==
                createHash("sha256").update(prompt).digest("hex")
              : prior.prompt !== prompt) ||
            prior.requestedById !== actorId
          )
            throw new ConflictException(
              "Request ID is already bound to another submission",
            );
          return { turn: prior, created: false };
        }
      }
      await this.assertNotArchivedExecution(
        tx,
        actorId,
        session.cwd,
        session.selectedProjectId ?? undefined,
      );
      if (session.stopConfirmation === "STOP_UNCONFIRMED")
        throw new ConflictException(
          "Previous process stop is unconfirmed; new work is blocked pending trusted reconciliation",
        );
      if (
        telegram?.initial &&
        (session.status !== "QUEUED" ||
          (await tx.proboxAiTurn.count({ where: { sessionId } })))
      )
        throw new ConflictException("Initial turn has already been accepted");
      if (
        !["QUEUED", "COMPLETED", "FAILED", "PAUSED", "INTERRUPTED"].includes(
          session.status,
        )
      )
        throw new ConflictException("A session can have one active turn");
      await tx.proboxAiSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.RUNNING,
          endedAt: null,
          startedAt: session.startedAt ?? now,
          runOwner: this.owner,
          runLeaseExpiresAt: new Date(now.getTime() + 60000),
          stopConfirmation: "NOT_STARTED",
          recoveryReason: null,
          interruptRequestedAt: null,
          interruptTurnId: null,
          interruptSignalAcceptedAt: null,
          runnerExitedAt: null,
        },
      });
      const turnId = randomUUID();
      const turn = await tx.proboxAiTurn.create({
        data: {
          id: turnId,
          sessionId,
          ...protectSessionPrompt(prompt, sessionId, turnId),
          requestId,
          requestedById: actorId,
          executionPermission: telegram?.initial
            ? "sessions.create"
            : "sessions.manage",
          status: TurnStatus.QUEUED,
          durableDispatch: !telegram,
        },
      });
      await tx.task.update({
        where: { id: session.taskId },
        data: { status: TaskStatus.RUNNING },
      });
      if (telegram)
        await tx.telegramSession.update({
          where: { sessionId },
          data: { finished: false },
        });
      await this.stateEvent(tx, sessionId, turn.id);
      return { turn, created: true };
    }, requestId);
  }

  private async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    requestId?: string,
  ) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Commit acknowledgement can be lost: never suggest a fresh submission ID.
      throw new ServiceUnavailableException(
        requestId
          ? "Submission outcome could not be confirmed; reconcile or retry the same request ID"
          : "Operation outcome could not be confirmed; do not automatically submit new work",
      );
    }
  }

  private async runAcceptedTurn(sessionId: string, turnId: string) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      await this.lockRun(tx, sessionId);
      const now = await this.databaseNow(tx);
      const session = await tx.proboxAiSession.findUnique({
        where: { id: sessionId },
      });
      const turn = await tx.proboxAiTurn.findUnique({ where: { id: turnId } });
      if (
        !session ||
        !turn ||
        turn.sessionId !== sessionId ||
        turn.status !== "QUEUED" ||
        session.runOwner !== this.owner ||
        !session.runLeaseExpiresAt ||
        session.runLeaseExpiresAt <= now ||
        session.interruptRequestedAt
      )
        return null;
      try {
        await this.assertManager(
          turn.requestedById ?? "",
          sessionId,
          turn.executionPermission ?? "sessions.manage",
          tx,
        );
      } catch (error) {
        if (
          !(error instanceof ForbiddenException) &&
          !(error instanceof NotFoundException)
        )
          throw error;
        await this.terminal(
          tx,
          session,
          turnId,
          "FAILED",
          "NOT_STARTED",
          "AUTHORIZATION_LOST",
          now,
        );
        return null;
      }
      const directory = await this.launchDirectory(
        tx,
        turn.requestedById ?? "",
        session.taskId,
        session.selectedProjectId ?? undefined,
        session.cwd,
        session.sandbox,
        turn.executionPermission ?? "sessions.manage",
      );
      if (!directory.valid || directory.normalizedPath !== session.cwd) {
        await this.terminal(
          tx,
          session,
          turnId,
          "FAILED",
          "NOT_STARTED",
          directory.reason === "AUTHORIZATION_LOST"
            ? "AUTHORIZATION_LOST"
            : "DIRECTORY_INVALID",
          now,
        );
        return null;
      }
      let executionPrompt: string;
      try {
        executionPrompt = sessionExecutionPrompt(turn);
      } catch {
        await this.terminal(
          tx,
          session,
          turnId,
          "FAILED",
          "NOT_STARTED",
          "INPUT_UNAVAILABLE",
          now,
        );
        return null;
      }
      await tx.proboxAiTurn.update({
        where: { id: turnId },
        data: { status: "RUNNING", executionStartedAt: now },
      });
      await tx.proboxAiSession.update({
        where: { id: sessionId },
        data: { stopConfirmation: "STOP_UNCONFIRMED" },
      });
      await this.stateEvent(tx, sessionId, turnId);
      return { session, turn, executionPrompt };
    });
    if (!claimed) return;
    const { session, executionPrompt } = claimed;
    let failed = false;
    let code = -1;
    const heartbeat = setInterval(() => {
      void this.renewLease(sessionId, turnId).catch(() => {
        this.runner.interrupt(sessionId, turnId);
      });
    }, 10000);
    heartbeat.unref();
    try {
      code = await this.runner.start(
        {
          sessionId,
          turnId,
          beforeSpawn: () => this.maySpawn(sessionId, turnId),
          cwd: session.cwd,
          sandbox: session.sandbox as
            "read-only" | "workspace-write" | "danger-full-access",
          prompt: executionPrompt,
          archiveToDatabase: !!session.creationRequestId,
          model: session.model ?? undefined,
          providerId: session.providerId,
          reasoningEffort: session.effectiveReasoningEffort ?? undefined,
          threadId: session.codexThreadId ?? undefined,
        },
        async (event) => {
          if (["turn.failed", "error", "runner.error"].includes(event.type))
            failed = true;
          await this.recordEvent(sessionId, turnId, event);
        },
      );
    } catch {
      failed = true;
      await this.recordEvent(sessionId, turnId, {
        type: "runner.error",
        payload: {},
        rawLine: "",
      }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockRun(tx, sessionId);
      const now = await this.databaseNow(tx);
      const current = await tx.proboxAiSession.findUnique({
        where: { id: sessionId },
      });
      const active = await tx.proboxAiTurn.findUnique({
        where: { id: turnId },
      });
      if (
        !current ||
        !active ||
        active.status !== "RUNNING" ||
        current.runOwner !== this.owner ||
        !current.runLeaseExpiresAt ||
        current.runLeaseExpiresAt <= now
      )
        return;
      const observation =
        this.runner.stopObservation?.(sessionId, turnId) ??
        (code >= 0 ? "LOCAL_EXIT_OBSERVED" : "STOP_UNCONFIRMED");
      await this.terminal(
        tx,
        current,
        turnId,
        current.interruptRequestedAt
          ? "INTERRUPTED"
          : code === 0 && !failed
            ? "COMPLETED"
            : "FAILED",
        observation,
        null,
        now,
      );
    });
  }

  private async terminal(
    tx: Prisma.TransactionClient,
    session: { id: string; taskId: string },
    turnId: string | null,
    status: "COMPLETED" | "FAILED" | "INTERRUPTED",
    stopConfirmation: string,
    recoveryReason: string | null,
    now: Date,
  ) {
    if (turnId)
      await tx.proboxAiTurn.update({
        where: { id: turnId },
        data: { status, endedAt: now },
      });
    else
      await tx.proboxAiTurn.updateMany({
        where: { sessionId: session.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status, endedAt: now },
      });
    await tx.proboxAiSession.update({
      where: { id: session.id },
      data: {
        status,
        endedAt: now,
        runOwner: null,
        runLeaseExpiresAt: null,
        stopConfirmation,
        recoveryReason,
        runnerExitedAt: stopConfirmation === "LOCAL_EXIT_OBSERVED" ? now : null,
      },
    });
    await this.aggregateTask(tx, session.taskId);
    await this.stateEvent(tx, session.id, turnId);
  }

  async interrupt(actorId: string, sessionId: string, turnId: string) {
    return this.interruptScoped(sessionId, turnId, async (tx) => {
      await this.assertManager(actorId, sessionId, "sessions.manage", tx);
    });
  }
  async interruptScoped(
    sessionId: string,
    turnId: string,
    authorize: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const intent = await this.transaction(async (tx) => {
      await this.lockRun(tx, sessionId);
      await authorize(tx);
      const session = await tx.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const turn = await tx.proboxAiTurn.findUnique({ where: { id: turnId } });
      if (!turn || turn.sessionId !== sessionId)
        throw new NotFoundException("Turn not found");
      if (session.interruptRequestedAt && session.interruptTurnId === turnId)
        return { created: false, session };
      if (
        !["QUEUED", "RUNNING"].includes(session.status) ||
        !["QUEUED", "RUNNING"].includes(turn.status)
      )
        throw new ConflictException("Target turn is no longer active");
      const now = await this.databaseNow(tx);
      const updated = await tx.proboxAiSession.update({
        where: { id: sessionId },
        data: { interruptRequestedAt: now, interruptTurnId: turnId },
      });
      await appendSessionEvent(tx, sessionId, turnId, "session.interruption", {
        projectionVersion: 1,
        authoritative: true,
        requested: true,
        signalAccepted: false,
      });
      if (turn.status === "QUEUED")
        await this.terminal(
          tx,
          session,
          turnId,
          "INTERRUPTED",
          "NOT_STARTED",
          null,
          now,
        );
      return { created: true, session: updated };
    });
    if (intent.created)
      await this.transaction(async (tx) => {
        await this.lockRun(tx, sessionId);
        await authorize(tx);
        const session = await tx.proboxAiSession.findUniqueOrThrow({
          where: { id: sessionId },
        });
        const turn = await tx.proboxAiTurn.findUnique({
          where: { id: turnId },
        });
        const now = await this.databaseNow(tx);
        if (
          session.interruptTurnId !== turnId ||
          turn?.status !== "RUNNING" ||
          session.runOwner !== this.owner ||
          !session.runLeaseExpiresAt ||
          session.runLeaseExpiresAt <= now
        )
          return;
        const signalled = this.runner.interrupt(sessionId, turnId);
        if (signalled) {
          await tx.proboxAiSession.update({
            where: { id: sessionId },
            data: { interruptSignalAcceptedAt: now },
          });
          await appendSessionEvent(
            tx,
            sessionId,
            turnId,
            "session.interruption",
            {
              projectionVersion: 1,
              authoritative: true,
              requested: true,
              signalAccepted: true,
            },
          );
        }
      });
    const session = await this.prisma.$transaction(async (tx) => {
      await authorize(tx);
      return tx.proboxAiSession.findUniqueOrThrow({ where: { id: sessionId } });
    });
    if (session.interruptTurnId !== turnId)
      throw new ConflictException(
        "Target turn changed; reconcile persisted history",
      );
    return {
      interrupted: Boolean(session.interruptSignalAcceptedAt),
      stopConfirmation: session.stopConfirmation,
      turnId,
      requestedAt: session.interruptRequestedAt,
      signalAcceptedAt: session.interruptSignalAcceptedAt,
    };
  }

  private async assertNotArchivedExecution(
    tx: Prisma.TransactionClient,
    actorId: string,
    cwd: string,
    selectedProjectId?: string,
  ) {
    const projects = await tx.$queryRaw<
      Array<{ id: string; directoryName: string; homePath: string }>
    >`SELECT p.id, p."directoryName", d."homePath" FROM "Project" p JOIN "Department" d ON d.id = p."departmentId" JOIN "User" u ON u."workspaceId" = p."workspaceId" WHERE u.id = ${actorId} AND p."archivedAt" IS NOT NULL`;
    for (const project of projects) {
      if (selectedProjectId && project.id === selectedProjectId)
        throw new ConflictException(
          "Archived projects cannot accept execution",
        );
      if (
        typeof project.homePath !== "string" ||
        typeof project.directoryName !== "string"
      )
        continue;
      const relative = path.relative(
        path.join(project.homePath, project.directoryName),
        cwd,
      );
      if (
        relative === "" ||
        (!path.isAbsolute(relative) &&
          relative !== ".." &&
          !relative.startsWith(".." + path.sep))
      )
        throw new ConflictException(
          "Archived project directories cannot accept execution",
        );
    }
  }

  private async lockRun(tx: Prisma.TransactionClient, sessionId: string) {
    await tx.$queryRaw`SELECT w.id FROM "Workspace" w JOIN "ProboxAiSession" s ON s."workspaceId" = w.id WHERE s.id = ${sessionId} FOR UPDATE OF w`;
    const ref = await tx.proboxAiSession.findUnique({
      where: { id: sessionId },
      select: { taskId: true },
    });
    if (ref)
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${ref.taskId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProboxAiSession" WHERE id = ${sessionId} FOR UPDATE`;
  }
  private async databaseNow(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    if (!rows[0]) throw new Error("Database clock unavailable");
    return rows[0].now;
  }
  private async stateEvent(
    tx: Prisma.TransactionClient,
    sessionId: string,
    turnId: string | null,
  ) {
    const s = await tx.proboxAiSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const t = turnId
      ? await tx.proboxAiTurn.findUnique({ where: { id: turnId } })
      : null;
    await appendSessionEvent(tx, sessionId, turnId, "session.state", {
      projectionVersion: 1,
      authoritative: true,
      sessionStatus: s.status,
      turnStatus: t?.status ?? null,
      stopConfirmation: s.stopConfirmation,
      recoveryReason: s.recoveryReason,
    });
  }
  private async aggregateTask(tx: Prisma.TransactionClient, taskId: string) {
    const sessions = await tx.proboxAiSession.findMany({
      where: { taskId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true },
    });
    const status = sessions.some((s) =>
      ["QUEUED", "RUNNING"].includes(s.status),
    )
      ? TaskStatus.RUNNING
      : sessions[0]?.status === "COMPLETED"
        ? TaskStatus.COMPLETED
        : sessions[0]?.status === "FAILED"
          ? TaskStatus.FAILED
          : TaskStatus.CANCELLED;
    await tx.task.update({ where: { id: taskId }, data: { status } });
  }
  private async maySpawn(sessionId: string, turnId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockRun(tx, sessionId);
      const now = await this.databaseNow(tx);
      const s = await tx.proboxAiSession.findUnique({
        where: { id: sessionId },
      });
      const t = await tx.proboxAiTurn.findUnique({ where: { id: turnId } });
      if (
        !s ||
        !t ||
        t.sessionId !== sessionId ||
        t.status !== "RUNNING" ||
        s.runOwner !== this.owner ||
        !s.runLeaseExpiresAt ||
        s.runLeaseExpiresAt <= now ||
        s.interruptRequestedAt
      )
        return false;
      try {
        await this.assertManager(
          t.requestedById ?? "",
          sessionId,
          t.executionPermission ?? "sessions.manage",
          tx,
        );
        const directory = await this.executionValidation(
          tx,
          t.requestedById ?? "",
          s.taskId,
          s.selectedProjectId ?? undefined,
          s.cwd,
          s.sandbox,
          t.executionPermission ?? "sessions.manage",
        );
        if (!directory.valid || directory.normalizedPath !== s.cwd) {
          await this.terminal(
            tx,
            s,
            turnId,
            "FAILED",
            "NOT_STARTED",
            "DIRECTORY_INVALID",
            now,
          );
          return false;
        }
        return true;
      } catch (error) {
        if (
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        ) {
          await this.terminal(
            tx,
            s,
            turnId,
            "FAILED",
            "NOT_STARTED",
            "AUTHORIZATION_LOST",
            now,
          );
          return false;
        }
        throw error;
      }
    });
  }
  private async renewLease(sessionId: string, turnId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockRun(tx, sessionId);
      const now = await this.databaseNow(tx);
      const s = await tx.proboxAiSession.findUnique({
        where: { id: sessionId },
      });
      const t = await tx.proboxAiTurn.findUnique({ where: { id: turnId } });
      if (
        !s ||
        s.runOwner !== this.owner ||
        !s.runLeaseExpiresAt ||
        s.runLeaseExpiresAt <= now ||
        t?.status !== "RUNNING"
      ) {
        this.runner.interrupt(sessionId, turnId);
        return;
      }
      if (
        s.interruptRequestedAt &&
        !s.interruptSignalAcceptedAt &&
        this.runner.interrupt(sessionId, turnId)
      ) {
        await tx.proboxAiSession.update({
          where: { id: sessionId },
          data: { interruptSignalAcceptedAt: now },
        });
        await appendSessionEvent(
          tx,
          sessionId,
          turnId,
          "session.interruption",
          {
            projectionVersion: 1,
            authoritative: true,
            requested: true,
            signalAccepted: true,
          },
        );
      }
      await tx.proboxAiSession.update({
        where: { id: sessionId },
        data: { runLeaseExpiresAt: new Date(now.getTime() + 60000) },
      });
    });
  }
  async onModuleInit() {
    await this.reconcileExpiredRuns().catch(() =>
      this.logger.error("Session recovery unavailable"),
    );
    this.recoveryTimer = setInterval(() => {
      void this.reconcileExpiredRuns().catch(() =>
        this.logger.error("Session recovery unavailable"),
      );
    }, 10000);
    this.recoveryTimer.unref();
  }
  onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }
  async reconcileExpiredRuns() {
    if (this.recoveryBusy) return;
    this.recoveryBusy = true;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string }>
      >`SELECT s.id FROM "ProboxAiSession" s WHERE s.status IN ('QUEUED','RUNNING') AND (s."runLeaseExpiresAt" IS NULL OR s."runLeaseExpiresAt" <= clock_timestamp()) AND (s.status = 'RUNNING' OR EXISTS (SELECT 1 FROM "ProboxAiTurn" t WHERE t."sessionId" = s.id AND t.status IN ('QUEUED','RUNNING'))) LIMIT 100`;
      for (const row of rows)
        await this.prisma.$transaction(async (tx) => {
          await this.lockRun(tx, row.id);
          const now = await this.databaseNow(tx);
          const s = await tx.proboxAiSession.findUnique({
            where: { id: row.id },
          });
          if (
            !s ||
            !["QUEUED", "RUNNING"].includes(s.status) ||
            (s.runLeaseExpiresAt && s.runLeaseExpiresAt > now)
          )
            return;
          const active = await tx.proboxAiTurn.findMany({
            where: { sessionId: s.id, status: { in: ["QUEUED", "RUNNING"] } },
          });
          const safe =
            s.stopConfirmation === "NOT_STARTED" &&
            active.length > 0 &&
            active.every(
              (turn) => turn.status === "QUEUED" && !turn.executionStartedAt,
            );
          if (
            safe &&
            active.length === 1 &&
            (active[0]!.durableDispatch ||
              (s.creationRequestId &&
                active[0]!.id === s.creationInitialTurnId))
          ) {
            await tx.proboxAiSession.update({
              where: { id: s.id },
              data: {
                status: "QUEUED",
                runOwner: null,
                runLeaseExpiresAt: null,
                startedAt: null,
                recoveryReason: null,
              },
            });
            if (s.status !== "QUEUED")
              await this.stateEvent(tx, s.id, active[0]!.id);
            return;
          }
          await this.terminal(
            tx,
            s,
            null,
            "INTERRUPTED",
            safe ? "NOT_STARTED" : "STOP_UNCONFIRMED",
            "OWNER_LOST",
            now,
          );
          for (const turn of active) await this.stateEvent(tx, s.id, turn.id);
          await tx.telegramSession.updateMany({
            where: { sessionId: s.id },
            data: { finished: false },
          });
        });
      await this.dispatchPendingCreations();
    } finally {
      this.recoveryBusy = false;
    }
  }

  async get(actorId: string, sessionId: string) {
    return readDependency("readSession", () =>
      this.prisma.$transaction(
        async (tx) => {
          const session = await this.assertManager(
            actorId,
            sessionId,
            "sessions.read",
            tx,
          );
          return {
            ...sessionResponse(session),
            turns: (
              await tx.proboxAiTurn.findMany({
                where: { sessionId },
                orderBy: [{ startedAt: "asc" }, { id: "asc" }],
              })
            ).map(turnResponse),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
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
    const projected = safeRunnerEvent(event);
    await this.prisma.$transaction(async (tx) => {
      // Admission/interruption take workspace and task before session. Runner
      // writes must share that order rather than hold session ahead of them.
      await this.lockRun(tx, sessionId);
      const now = await this.databaseNow(tx);
      const s = await tx.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const t = turnId
        ? await tx.proboxAiTurn.findUnique({ where: { id: turnId } })
        : null;
      if (
        s.runOwner !== this.owner ||
        !s.runLeaseExpiresAt ||
        s.runLeaseExpiresAt <= now ||
        t?.status !== "RUNNING"
      )
        throw new ConflictException("Run ownership was lost");
      const archived = archiveRunnerEvent(event);
      const recorded = await appendSessionEvent(
        tx,
        sessionId,
        turnId,
        projected.type,
        projected.payload,
        {
          payload: archived,
          hash: archiveHash(archived),
          policyVersion: SESSION_ARCHIVE_POLICY_VERSION,
        },
      );
      if (
        event.type === "thread.started" &&
        typeof event.payload.thread_id === "string" &&
        historyText(event.payload.thread_id) === event.payload.thread_id &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(event.payload.thread_id)
      )
        await tx.proboxAiSession.update({
          where: { id: sessionId },
          data: { codexThreadId: event.payload.thread_id },
        });
      if (turnId && event.type === "turn.completed") {
        const usage =
          event.payload.usage && typeof event.payload.usage === "object"
            ? (event.payload.usage as Record<string, unknown>)
            : {};
        await tx.proboxAiTurn.update({
          where: { id: turnId },
          data: {
            inputTokens: numberOrNull(usage.input_tokens),
            cachedTokens: numberOrNull(usage.cached_input_tokens),
            outputTokens: numberOrNull(usage.output_tokens),
            reasoningTokens: numberOrNull(usage.reasoning_output_tokens),
            usageProvenance: {
              source: "RUNNER_TURN_COMPLETED",
              eventSequence: recorded.sequence,
              providerId: s.providerId,
              model: s.effectiveModel ?? s.model,
              observedAt: now.toISOString(),
              reportedUsage: historyJson(usage),
              normalizedCost: null,
              costNormalization: "NOT_AVAILABLE_NO_PRICING_ASSUMPTION",
            },
          },
        });
      }
    });
  }

  async eventDetail(
    actorId: string,
    sessionId: string,
    eventId: string,
    offset?: number,
    limit?: number,
    revision?: string,
  ) {
    return readDependency("readSessionEventDetail", () =>
      this.prisma.$transaction(
        async (tx) => {
          await this.assertManager(actorId, sessionId, "sessions.read", tx);
          const event = await tx.sessionEvent.findFirst({
            where: { id: eventId, sessionId },
          });
          if (!event) throw new NotFoundException("Session event not found");
          return sessionDetailPage(event, offset, limit, revision);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }

  async history(
    actorId: string,
    sessionId: string,
    after = 0,
    limit = 100,
    untilSequence?: number,
    includeArchive = false,
  ) {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > 2147483647 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException("Invalid event cursor or page size");
    return readDependency(
      includeArchive ? "readRetainedSessionArchive" : "readSessionHistory",
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const session = await this.assertManager(
              actorId,
              sessionId,
              "sessions.read",
              tx,
            );
            if (
              untilSequence !== undefined &&
              (!Number.isSafeInteger(untilSequence) ||
                untilSequence < after ||
                untilSequence > session.lastSequence)
            )
              throw new ConflictException("Invalid fixed history boundary");
            const highWaterSequence = untilSequence ?? session.lastSequence;
            if (after > highWaterSequence)
              throw new ConflictException(
                "Event cursor is ahead of persisted history",
              );
            const events = await tx.sessionEvent.findMany({
              select: publicSessionEventSelect,
              where: {
                sessionId,
                sequence: { gt: after, lte: highWaterSequence },
              },
              orderBy: { sequence: "asc" },
              take: limit,
            });
            const nextCursor = events.at(-1)?.sequence ?? after;
            if (
              events.some(
                (event, index) => event.sequence !== after + index + 1,
              ) ||
              (!events.length && after < highWaterSequence)
            )
              throw new ConflictException({
                code: "SESSION_HISTORY_UNAVAILABLE",
                message:
                  "Persisted history has unavailable sequences; reconcile the session snapshot",
                highWaterSequence,
              });
            return {
              session: sessionResponse(session),
              events: events.map(eventResponse),
              after,
              nextCursor,
              highWaterSequence,
              hasMore: nextCursor < highWaterSequence,
              historyAvailability: "RETAINED_WITH_EXPLICIT_OMISSIONS",
              ...(includeArchive
                ? {
                    record: {
                      retentionPolicy: "RETAIN_UNTIL_AUTHORIZED_DELETION",
                      catalogSnapshot: historyJson(session.catalogSnapshot),
                      runtimeProvenance: historyJson(session.runtimeProvenance),
                      dispatchAttempts: session.dispatchAttempts,
                      lastDispatchAt: session.lastDispatchAt,
                    },
                    archiveEvents: (
                      await tx.sessionEvent.findMany({
                        where: {
                          sessionId,
                          id: { in: events.map((event) => event.id) },
                        },
                        orderBy: { sequence: "asc" },
                      })
                    ).map(archiveEventResponse),
                  }
                : {}),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        ),
    );
  }
  async retainedTurns(
    actor: AuthenticatedUser,
    sessionId: string,
    cursor?: string,
  ) {
    return readDependency("readRetainedSessionTurns", () =>
      this.prisma.$transaction(
        async (tx) => {
          await this.assertManager(actor.id, sessionId, "sessions.read", tx);
          let asOf = await this.databaseNow(tx),
            after: { startedAt: Date; id: string } | null = null;
          if (cursor) {
            try {
              if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new Error();
              const value = JSON.parse(
                Buffer.from(cursor, "base64url").toString("utf8"),
              ) as Record<string, unknown>;
              if (
                value.version !== 1 ||
                value.actorId !== actor.id ||
                value.workspaceId !== actor.workspaceId ||
                value.sessionId !== sessionId ||
                typeof value.asOf !== "string" ||
                typeof value.startedAt !== "string" ||
                typeof value.id !== "string" ||
                !/^[0-9a-f-]{36}$/i.test(value.id)
              )
                throw new Error();
              asOf = new Date(value.asOf);
              after = { startedAt: new Date(value.startedAt), id: value.id };
              if (
                !Number.isFinite(asOf.getTime()) ||
                !Number.isFinite(after.startedAt.getTime()) ||
                after.startedAt > asOf
              )
                throw new Error();
            } catch {
              throw new BadRequestException("Invalid retained-turn cursor");
            }
          }
          const rows = await tx.proboxAiTurn.findMany({
            where: {
              sessionId,
              startedAt: { lte: asOf },
              ...(after
                ? {
                    OR: [
                      { startedAt: { gt: after.startedAt } },
                      { startedAt: after.startedAt, id: { gt: after.id } },
                    ],
                  }
                : {}),
            },
            orderBy: [{ startedAt: "asc" }, { id: "asc" }],
            take: 51,
          });
          const page = rows.slice(0, 50),
            last = page.at(-1);
          return {
            items: page.map((row) => ({
              ...turnResponse(row),
              usageProvenance: historyJson(row.usageProvenance),
            })),
            hasMore: rows.length > 50,
            nextCursor:
              rows.length > 50 && last
                ? Buffer.from(
                    JSON.stringify({
                      version: 1,
                      actorId: actor.id,
                      workspaceId: actor.workspaceId,
                      sessionId,
                      asOf: asOf.toISOString(),
                      startedAt: last.startedAt.toISOString(),
                      id: last.id,
                    }),
                  ).toString("base64url")
                : null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }
  stream(actorId: string, sessionId: string, after: number, expiresAt: number) {
    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;
      let cursor = after;
      let timer: NodeJS.Timeout | undefined;
      const poll = async () => {
        try {
          if (Date.now() >= expiresAt) {
            subscriber.complete();
            return;
          }
          const batch = await this.history(actorId, sessionId, cursor, 100);
          if (stopped || Date.now() >= expiresAt) return subscriber.complete();
          for (const event of batch.events) {
            subscriber.next({
              id: String(event.sequence),
              type: event.type,
              data: event,
            } as unknown as MessageEvent);
            cursor = event.sequence;
          }
          if (!stopped)
            timer = setTimeout(
              () => {
                void poll();
              },
              batch.hasMore ? 0 : 500,
            );
        } catch (error) {
          if (!stopped)
            subscriber.error(
              error instanceof HttpException
                ? error
                : new ServiceUnavailableException(
                    "Session event delivery unavailable; reconcile persisted history",
                  ),
            );
        }
      };
      void poll();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    });
  }

  private async assertManager(
    actorId: string,
    sessionId: string,
    permission = "sessions.read",
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const session = await tx.proboxAiSession.findUnique({
      where: { id: sessionId },
      include: { task: true },
    });
    if (!session) throw new NotFoundException("Session not found");
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: {
        workspaceId: true,
        status: true,
        roleAssignments: {
          select: {
            role: {
              select: { permissions: { select: { permissionKey: true } } },
            },
          },
        },
      },
    });
    if (
      !actor ||
      actor.status !== "OPEN" ||
      actor.workspaceId !== session.workspaceId ||
      actor.workspaceId !== session.task.workspaceId
    )
      throw new NotFoundException("Session not found");
    if (session.task.managerId !== actorId)
      throw new ForbiddenException(
        "Only the assigned manager may access this session",
      );
    if (
      !actor.roleAssignments.some((a) =>
        a.role.permissions.some((p) => p.permissionKey === permission),
      )
    )
      throw new ForbiddenException("Session access is no longer available");
    return session;
  }
}
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2147483647
    ? value
    : null;
}
