import { HumanTasksController } from "../../src/tasks/human-tasks.controller";
import { HumanTasksService } from "../../src/tasks/human-tasks.service";
import { HumanTaskActionsController } from "../../src/tasks/human-task-actions.controller";
import { HumanTaskActionsService } from "../../src/tasks/human-task-actions.service";
import { TaskBoardsController } from "../../src/tasks/task-boards.controller";
import { TaskBoardsService } from "../../src/tasks/task-boards.service";
import { SharedTasksController } from "../../src/tasks/shared-tasks.controller";
import { SharedTasksService } from "../../src/tasks/shared-tasks.service";
import { SharedTaskContentController } from "../../src/tasks/shared-task-content.controller";
import { SharedTaskContentService } from "../../src/tasks/shared-task-content.service";
import { TaskDeadlinesController } from "../../src/tasks/task-deadlines.controller";
import { TaskDeadlinesService } from "../../src/tasks/task-deadlines.service";
import { DepartmentsController } from "../../src/departments/departments.controller";
import { DepartmentsService } from "../../src/departments/departments.service";
import { ConfigurationTemplatesController } from "../../src/configuration-templates/configuration-templates.controller";
import { ConfigurationTemplatesService } from "../../src/configuration-templates/configuration-templates.service";
import "reflect-metadata";
import { BrowserAuthController } from "../../src/browser-sessions/browser-auth.controller";
import { ArticlesController } from "../../src/articles/articles.controller";
import { ArticlesService } from "../../src/articles/articles.service";
import { ArticleReviewsController } from "../../src/articles/article-reviews.controller";
import { ArticleReviewsService } from "../../src/articles/article-reviews.service";
import { ArticleProposalsController } from "../../src/articles/article-proposals.controller";
import { ArticleProposalsService } from "../../src/articles/article-proposals.service";
import { ArticleResolutionController } from "../../src/articles/article-resolution.controller";
import { ArticleResolutionService } from "../../src/articles/article-resolution.service";
import { ArticleCanonicalService } from "../../src/articles/article-canonical.service";
import { ArticleCanonicalController } from "../../src/articles/article-canonical.controller";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { AccountsController } from "../../src/accounts/accounts.controller";
import { AccountsService } from "../../src/accounts/accounts.service";
import { AuthorizationController } from "../../src/authorization/authorization.controller";
import { AuthorizationService } from "../../src/authorization/authorization.service";
import { ProjectsController } from "../../src/projects/projects.controller";
import { ProjectsService } from "../../src/projects/projects.service";
import { TasksController } from "../../src/tasks/tasks.controller";
import { TasksService } from "../../src/tasks/tasks.service";
import { SessionsController } from "../../src/sessions/sessions.controller";
import { PersonalModelPreferencesController } from "../../src/sessions/personal-model-preferences.controller";
import { PersonalModelPreferencesService } from "../../src/sessions/personal-model-preferences.service";
import { SessionsService } from "../../src/sessions/sessions.service";
import { SessionEventsService } from "../../src/sessions/session-events.service";
import { ModelCatalogService } from "../../src/sessions/model-catalog.service";
import {
  ProboxAiRunner,
  RunnerEvent,
  RunnerOptions,
} from "../../src/sessions/proboxai-runner.service";
import { WorkspacePathPolicy } from "../../src/storage/workspace-path-policy.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { TelegramService } from "../../src/telegram/telegram.service";
import { TelegramBotService } from "../../src/telegram/telegram-bot.service";
import { BrowserSessionController } from "../../src/browser-sessions/browser-session.controller";
import {
  BrowserSessionService,
  BROWSER_SESSION_CONFIG,
} from "../../src/browser-sessions/browser-session.service";
import { BrowserSessionConfig } from "../../src/browser-sessions/browser-session.config";

export const fixtureDatabaseUrl =
  "postgresql://profile_test@127.0.0.1:55439/profile_test";
export function requireFixtureDatabase(value: string | undefined) {
  if (value !== fixtureDatabaseUrl)
    throw new Error(
      `Set PROFILE_TEST_DATABASE_URL to the isolated fixture URL ${fixtureDatabaseUrl}; DATABASE_URL is never used.`,
    );
  return value;
}

/** A deterministic adapter, not an agent: no child process, provider or network API. */
export class ControlledFrontendRunner {
  private outputHeld = false;
  holdOutput(held: boolean) {
    this.outputHeld = held;
  }
  readonly starts: {
    sessionId: string;
    turnId?: string;
    providerId: string;
    model?: string;
    reasoningEffort?: string;
  }[] = [];
  private readonly active = new Map<
    string,
    {
      turnId?: string;
      interrupted: boolean;
      onEvent: (event: RunnerEvent) => Promise<void>;
    }
  >();
  async emitForTest(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const active = this.active.get(sessionId);
    if (!active) throw new Error("Controlled generation not active");
    await active.onEvent({
      type,
      payload,
      rawLine: JSON.stringify({ type, ...payload }),
    });
  }
  private readonly observations = new Map<
    string,
    "NOT_STARTED" | "STOP_UNCONFIRMED" | "LOCAL_EXIT_OBSERVED"
  >();
  async start(
    options: RunnerOptions,
    onEvent: (event: RunnerEvent) => Promise<void>,
  ) {
    const generation = `${options.sessionId}:${options.turnId}`;
    this.observations.set(generation, "NOT_STARTED");
    if (options.beforeSpawn && !(await options.beforeSpawn())) return -1;
    if (this.active.has(options.sessionId))
      throw new Error("Controlled runner generation already active");
    const state = { turnId: options.turnId, interrupted: false, onEvent };
    this.active.set(options.sessionId, state);
    this.observations.set(generation, "STOP_UNCONFIRMED");
    this.starts.push({
      sessionId: options.sessionId,
      turnId: options.turnId,
      providerId: options.providerId,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });
    const emit = (type: string, payload: Record<string, unknown>) =>
      onEvent({ type, payload, rawLine: JSON.stringify({ type, ...payload }) });
    try {
      await emit("thread.started", {
        thread_id: options.threadId ?? `fixture_${options.sessionId}`,
      });
      await emit("turn.started", {});
      // A short visible running window for the local UI; prompt contents are never executed.
      for (let n = 0; n < 8; n++) {
        await delay(100);
        if (state.interrupted) return 130;
      }
      while (this.outputHeld) {
        await delay(25);
        if (state.interrupted) return 130;
      }
      await emit("item.completed", {
        item: {
          id: `fixture_${options.turnId}`,
          type: "agent_message",
          text: "Controlled local fixture output. No agent, provider or shell was contacted.",
        },
      });
      await emit("turn.completed", {
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      return 0;
    } finally {
      this.active.delete(options.sessionId);
      this.observations.set(generation, "LOCAL_EXIT_OBSERVED");
    }
  }
  interrupt(sessionId: string, turnId?: string) {
    const active = this.active.get(sessionId);
    if (!active || (turnId !== undefined && active.turnId !== turnId))
      return false;
    active.interrupted = true;
    return true;
  }
  stopObservation(sessionId: string, turnId?: string) {
    return this.observations.get(`${sessionId}:${turnId}`) ?? "NOT_STARTED";
  }
  interruptAll() {
    for (const active of this.active.values()) active.interrupted = true;
  }
}

export async function untilFixture(
  check: () => Promise<boolean>,
  timeout = 10000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(
    "Controlled fixture did not reach its expected state within the bounded wait",
  );
}

export async function createFrontendSessionHarness(
  databaseUrl: string,
  port = 0,
  browserOrigin?: string,
) {
  requireFixtureDatabase(databaseUrl);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid fixture port");
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const root = await fs.mkdtemp(
    path.join(tmpdir(), "proboxai-session-handoff-"),
  );
  const previousRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
  process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
  let workspaceId: string | undefined;
  let app: INestApplication | undefined;
  const runner = new ControlledFrontendRunner();
  const browserConfig: BrowserSessionConfig = {
    enabled: true,
    origin: browserOrigin ?? "http://127.0.0.1:0",
    secure: false,
    key: randomBytes(32),
    keyId: `fixture_${randomBytes(8).toString("hex")}`,
    idleMs: 30 * 60_000,
    absoluteMs: 8 * 60 * 60_000,
    anonymousMs: 10 * 60_000,
  };
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    runner.interruptAll();
    try {
      if (app) {
        app.getHttpServer().closeAllConnections?.();
        await app.close();
      }
      if (workspaceId) {
        await prisma.browserSession.deleteMany({
          where: { bundle: { startsWith: browserConfig.keyId + "." } },
        });
        await untilFixture(
          async () =>
            (await prisma.proboxAiSession.count({
              where: { workspaceId, status: { in: ["RUNNING", "QUEUED"] } },
            })) === 0,
        );
        await prisma.task.deleteMany({ where: { workspaceId } });
        await prisma.project.deleteMany({ where: { workspaceId } });
        await prisma.department.deleteMany({ where: { workspaceId } });
        await prisma.user.deleteMany({ where: { workspaceId } });
        await prisma.role.deleteMany({ where: { workspaceId } });
        await prisma.workspace.delete({ where: { id: workspaceId } });
      }
      const resolved = path.resolve(root);
      if (
        !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(resolved).startsWith("proboxai-session-handoff-")
      )
        throw new Error("Unsafe fixture cleanup path");
      await fs.rm(resolved, { recursive: true, force: true });
    } finally {
      await prisma.$disconnect();
      if (previousRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = previousRoots;
    }
  }
  try {
    workspaceId = (
      await prisma.workspace.create({
        data: { slug: `frontend-fixture-${randomUUID()}` },
      })
    ).id;
    const permissions = [
      "projects.read",
      "tasks.create",
      "tasks.read",
      "sessions.create",
      "sessions.read",
      "sessions.manage",
    ];
    await prisma.permission.createMany({
      data: permissions.map((key) => ({
        key,
        name: key,
        description: "Controlled local fixture",
        category: "test",
      })),
      skipDuplicates: true,
    });
    const password = randomBytes(18).toString("base64url"),
      username = `handoff-${randomUUID().slice(0, 16)}`;
    const salt = randomBytes(16);
    const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")}`;
    const user = await prisma.user.create({
      data: {
        workspaceId,
        fullName: "Local fixture",
        firstName: "Local",
        lastName: "fixture",
        phoneNumber: `fixture-${randomUUID()}`,
        username,
        passwordHash,
        status: "OPEN",
        roleAssignments: {
          create: {
            role: {
              create: {
                workspaceId,
                key: `fixture-${randomUUID()}`,
                name: "Local fixture",
                permissions: {
                  create: permissions.map((permissionKey) => ({
                    permissionKey,
                  })),
                },
              },
            },
          },
        },
      },
    });
    const department = await prisma.department.create({
      data: {
        workspaceId,
        name: "Controlled local fixture",
        slug: `fixture-${randomUUID()}`,
        homePath: root,
      },
    });
    const directoryName = "controlled-project";
    await fs.mkdir(path.join(root, directoryName));
    const project = await prisma.project.create({
      data: {
        workspaceId,
        departmentId: department.id,
        creatorId: user.id,
        name: "Controlled local project",
        directoryName,
        status: "READY",
        readAccessEnabled: false,
        members: { create: { userId: user.id } },
      },
    });
    const task = await prisma.task.create({
      data: {
        workspaceId,
        creatorId: user.id,
        managerId: user.id,
        title: "Controlled local task",
        description: "No paid or live agent",
      },
    });
    const jwt = new JwtService({
      secret: randomBytes(32).toString("base64url"),
    });
    const paths = new WorkspacePathPolicy(),
      events = new SessionEventsService(),
      catalog = new ModelCatalogService();
    const sessions = new SessionsService(
      prisma as PrismaService,
      runner as unknown as ProboxAiRunner,
      events,
      catalog,
      paths,
    );
    sessions.onModuleInit = async () => {};
    const telegram = {
      sendText: async () => {
        throw new Error("Telegram forbidden in fixture");
      },
    } as unknown as TelegramService;
    const projects = new ProjectsService(
      prisma as PrismaService,
      {} as never,
      paths,
      {} as never,
      telegram,
      runner as unknown as ProboxAiRunner,
      sessions,
    );
    projects.onModuleInit = () => {};
    const module = await Test.createTestingModule({
      controllers: [
        HumanTasksController,
        HumanTaskActionsController,
        TaskBoardsController,
        SharedTasksController,
        SharedTaskContentController,
        TaskDeadlinesController,
        ArticleReviewsController,
        ArticleProposalsController,
        ArticleResolutionController,
        ArticleCanonicalController,
        ArticlesController,
        BrowserSessionController,
        BrowserAuthController,
        DepartmentsController,
        ConfigurationTemplatesController,
        AuthController,
        AccountsController,
        AuthorizationController,
        ProjectsController,
        TasksController,
        SessionsController,
        PersonalModelPreferencesController,
      ],
      providers: [
        HumanTasksService,
        HumanTaskActionsService,
        TaskBoardsService,
        SharedTasksService,
        SharedTaskContentService,
        TaskDeadlinesService,
        ArticleReviewsService,
        ArticleProposalsService,
        ArticleResolutionService,
        ArticleCanonicalService,
        ArticlesService,
        PersonalModelPreferencesService,
        ModelCatalogService,
        BrowserSessionService,
        {
          provide: DepartmentsService,
          useValue: new DepartmentsService(prisma as PrismaService, paths),
        },
        {
          provide: ConfigurationTemplatesService,
          useValue: new ConfigurationTemplatesService(
            prisma as PrismaService,
            {} as never,
          ),
        },
        { provide: BROWSER_SESSION_CONFIG, useValue: browserConfig },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: TelegramService, useValue: telegram },
        { provide: TelegramBotService, useValue: {} },
        {
          provide: AuthService,
          useValue: new AuthService(prisma as PrismaService, jwt, telegram),
        },
        {
          provide: AccountsService,
          useValue: new AccountsService(
            prisma as PrismaService,
            new AuthorizationService(prisma as PrismaService),
          ),
        },
        {
          provide: AuthorizationService,
          useValue: new AuthorizationService(prisma as PrismaService),
        },
        { provide: ProjectsService, useValue: projects },
        {
          provide: TasksService,
          useValue: new TasksService(prisma as PrismaService),
        },
        { provide: SessionsService, useValue: sessions },
        { provide: SessionEventsService, useValue: events },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    await app.listen(port, "127.0.0.1");
    const address = app.getHttpServer().address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    browserConfig.origin = browserOrigin ?? `http://127.0.0.1:${address.port}`;
    return {
      app,
      prisma,
      runner,
      sessions,
      close,
      manifest: {
        mode: "CONTROLLED_LOCAL_FIXTURE_ONLY",
        baseUrl,
        username,
        password,
        workspaceId,
        userId: user.id,
        projectId: project.id,
        taskId: task.id,
        directory: path.join(root, directoryName),
        browserAuthentication: `Controlled local cookie BFF at ${browserConfig.origin}/api/v1/browser; existing bearer API also available`,
        providerCalls: 0,
      },
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
