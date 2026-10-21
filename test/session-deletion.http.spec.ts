import { TelegramSessionRelay } from "../src/telegram/telegram-session-relay.service";
import { telegramTurnRequestId } from "../src/telegram/telegram-turn-request";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { listSessions } from "../src/sessions/session-list";
import { request as httpRequest } from "node:http";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { SessionsController } from "../src/sessions/sessions.controller";
import { SessionsService } from "../src/sessions/sessions.service";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test database");
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function until(fn: () => Promise<boolean>) {
  for (let n = 0; n < 150; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Test runner did not settle");
}
(url ? describe : describe.skip)(
  "durable session acceptance and deletion-state HTTP",
  () => {
    let prisma: PrismaClient,
      app: INestApplication,
      sessions: SessionsService,
      projects: ProjectsService;
    let w: string,
      foreignW: string,
      owner: string,
      member: string,
      outsider: string,
      foreign: string,
      denied: string;
    let roleId: string,
      taskId: string,
      sessionId: string,
      projectId: string,
      departmentId: string,
      root: string;
    let pending: Map<
      string,
      { resolve: (code: number) => void; event: (event: any) => Promise<void> }
    >;
    const runner = { start: jest.fn(), interrupt: jest.fn() };
    const telegram = { sendText: jest.fn().mockResolvedValue(undefined) };
    const permissions = [
      "sessions.create",
      "sessions.read",
      "sessions.manage",
      "projects.delete",
    ];
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url } } });
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-acceptance-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
      sessions = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      projects = new ProjectsService(
        prisma as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
        telegram as any,
        runner as any,
        sessions,
      );
      projects.onModuleInit = () => undefined; // Never invoke the application's cleanup worker in this fixture.
      const module = await Test.createTestingModule({
        controllers: [SessionsController, ProjectsController],
        providers: [
          { provide: SessionsService, useValue: sessions },
          { provide: ProjectsService, useValue: projects },
          { provide: PrismaService, useValue: prisma },
          { provide: ProboxAiRunner, useValue: runner },
          {
            provide: SessionEventsService,
            useValue: new SessionEventsService(),
          },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                workspaceId: "stale",
                type: "access",
                exp: Math.floor(Date.now() / 1000) + 60,
              }),
            },
          },
        ],
      }).compile();
      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
      await app.listen(0, "127.0.0.1");
      for (const key of permissions)
        await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key, category: "test", description: "Test" },
        });
    });
    beforeEach(async () => {
      runner.start.mockReset();
      runner.interrupt.mockReset();
      telegram.sendText.mockClear();
      pending = new Map();
      runner.start.mockImplementation(
        async (options, event) =>
          new Promise<number>((resolve) =>
            pending.set(options.sessionId, { resolve, event }),
          ),
      );
      runner.interrupt.mockImplementation((id) => pending.has(id));
      w = (await prisma.workspace.create({ data: { slug: randomUUID() } })).id;
      foreignW = (
        await prisma.workspace.create({ data: { slug: randomUUID() } })
      ).id;
      roleId = (
        await prisma.role.create({
          data: {
            workspaceId: w,
            key: "tester",
            name: "Tester",
            permissions: {
              create: permissions.map((permissionKey) => ({ permissionKey })),
            },
          },
        })
      ).id;
      const user = async (workspaceId: string, grant = true) =>
        (
          await prisma.user.create({
            data: {
              workspaceId,
              fullName: "Fixture",
              phoneNumber: randomUUID(),
              status: "OPEN",
              telegramChatId: BigInt(
                "0x" + randomUUID().replaceAll("-", "").slice(0, 13),
              ),
              ...(grant ? { roleAssignments: { create: { roleId } } } : {}),
            },
          })
        ).id;
      owner = await user(w);
      member = await user(w);
      outsider = await user(w);
      denied = await user(w, false);
      foreign = await user(foreignW, false);
      taskId = (
        await prisma.task.create({
          data: {
            workspaceId: w,
            title: "Fixture",
            description: "Fixture description",
            managerId: owner,
            creatorId: owner,
          },
        })
      ).id;
      sessionId = (
        await prisma.proboxAiSession.create({
          data: {
            workspaceId: w,
            taskId,
            creatorId: owner,
            status: "COMPLETED",
            cwd: root,
            sandbox: "read-only",
            catalogSnapshot: { secret: "internal-catalog" },
          },
        })
      ).id;
      departmentId = (
        await prisma.department.create({
          data: {
            workspaceId: w,
            name: "Test",
            slug: randomUUID(),
            homePath: root,
          },
        })
      ).id;
      const directoryName = randomUUID();
      projectId = (
        await prisma.project.create({
          data: {
            workspaceId: w,
            departmentId,
            name: "Fixture",
            directoryName,
            creatorId: owner,
            members: { create: [{ userId: owner }, { userId: member }] },
          },
        })
      ).id;
      await fs.mkdir(path.join(root, directoryName));
    });
    afterEach(async () => {
      for (const [id, p] of pending) {
        p.resolve(0);
        await until(
          async () =>
            (await prisma.proboxAiSession.findUnique({ where: { id } }))
              ?.status !== "RUNNING",
        );
      }
      await prisma.projectDeletionAudit.deleteMany({
        where: { workspaceId: w },
      });
      await prisma.projectDeletionAudit.deleteMany({
        where: { ownerId: owner },
      });
      await prisma.taskBoardEntry.deleteMany({
        where: { task: { workspaceId: { in: [w, foreignW] } } },
      });
      await prisma.project.deleteMany({
        where: { workspaceId: { in: [w, foreignW] } },
      });
      await prisma.task.deleteMany({
        where: { workspaceId: { in: [w, foreignW] } },
      });
      await prisma.department.deleteMany({ where: { workspaceId: w } });
      await prisma.user.deleteMany({
        where: { workspaceId: { in: [w, foreignW] } },
      });
      await prisma.role.deleteMany({
        where: { workspaceId: { in: [w, foreignW] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [w, foreignW] } },
      });
      jest.restoreAllMocks();
    });
    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
      if (priorRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoots;
      // Only remove our verified mkdtemp directory.
      if (
        !path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(root).startsWith("proboxai-acceptance-")
      )
        throw new Error("Unsafe fixture root");
      await fs.rm(root, { recursive: true, force: true });
    });
    const http = () => request(app.getHttpServer());
    const sessionList = (query = "", actor = owner) =>
      http()
        .get("/sessions" + query)
        .set("Authorization", "Bearer " + actor);
    const addListedSession = (input: any = {}) =>
      prisma.proboxAiSession.create({
        data: {
          workspaceId: w,
          taskId,
          creatorId: owner,
          cwd: "private-cwd",
          sandbox: "read-only",
          catalogSnapshot: { secret: "private-catalog" },
          codexThreadId: "private-thread-" + randomUUID(),
          processId: 123,
          status: "RUNNING",
          ...input,
        },
      });
    const linkListedTask = async (id = taskId, selectedProject = projectId) => {
      const board = await prisma.taskBoard.findUniqueOrThrow({
        where: { projectId: selectedProject },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
      const statusId = board.statuses[0]?.id;
      if (!statusId)
        throw new Error("Fixture project has no default board status");
      return prisma.taskBoardEntry.create({
        data: {
          taskId: id,
          boardId: board.id,
          statusId,
        },
      });
    };
    it("returns narrow project task identity without task-read grants or global metadata expansion", async () => {
      await linkListedTask();
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: { not: "sessions.read" } },
      });
      await prisma.task.update({
        where: { id: taskId },
        data: {
          title: "Task 😀 public title",
          description: "PRIVATE DESCRIPTION",
          criteria: "PRIVATE CRITERIA",
        },
      });
      const result = await sessionList(
        "?projectId=" + projectId.toUpperCase(),
      ).expect(200);
      expect(result.body.items[0].task).toEqual({
        id: taskId,
        title: "Task 😀 public title",
        projectId,
      });
      expect(Object.keys(result.body.items[0].task).sort()).toEqual([
        "id",
        "projectId",
        "title",
      ]);
      expect(JSON.stringify(result.body)).not.toContain("PRIVATE");
      for (const q of ["", "?taskId=" + taskId]) {
        const legacy = await sessionList(q).expect(200);
        expect(Object.keys(legacy.body.items[0]).sort()).toEqual([
          "createdAt",
          "id",
          "status",
          "stopConfirmation",
          "taskId",
          "updatedAt",
        ]);
      }
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("refreshes project task titles between session pages without changing session order or saved execution context", async () => {
      await linkListedTask();
      const older = await addListedSession({
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
      const before = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: older.id },
      });
      const first = (
        await sessionList(`?projectId=${projectId}&limit=1`).expect(200)
      ).body;
      const title = "Renamed after first page";
      await prisma.task.update({ where: { id: taskId }, data: { title } });
      const next = (
        await sessionList(
          `?projectId=${projectId}&limit=1&cursor=${first.nextCursor}`,
        ).expect(200)
      ).body;
      expect(next.items[0].id).toBe(older.id);
      expect(next.items[0].task).toEqual({ id: taskId, title, projectId });
      expect(next.asOf).toBe(first.asOf);
      expect(next.hasMore).toBe(false);
      expect(
        await prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: older.id },
        }),
      ).toEqual(before);
    });
    it("maps each project session to its own task identity and excludes an unassigned task title", async () => {
      await linkListedTask();
      const title = "Second linked task";
      const other = await prisma.task.create({
        data: {
          workspaceId: w,
          creatorId: owner,
          managerId: owner,
          title,
          description: "PRIVATE",
        },
      });
      await linkListedTask(other.id);
      const otherSession = await addListedSession({ taskId: other.id });
      const excluded = await prisma.task.create({
        data: {
          workspaceId: w,
          creatorId: owner,
          managerId: member,
          title: "UNASSIGNED PRIVATE TITLE",
          description: "PRIVATE",
        },
      });
      await linkListedTask(excluded.id);
      await addListedSession({ taskId: excluded.id });
      const result = (await sessionList("?projectId=" + projectId).expect(200))
        .body;
      expect(result.items).toHaveLength(2);
      expect(
        result.items.find((i: any) => i.id === otherSession.id).task,
      ).toEqual({ id: other.id, title, projectId });
      const original = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(result.items.find((i: any) => i.id === sessionId).task).toEqual({
        id: taskId,
        title: original.title,
        projectId,
      });
      expect(JSON.stringify(result)).not.toContain("UNASSIGNED PRIVATE TITLE");
    });
    it.each(["dependency", "missing"])(
      "fails project task hydration safely on %s failure",
      async (failure) => {
        await linkListedTask();
        const client = prisma.$extends({
          query: {
            task: {
              findMany: async () => {
                if (failure === "dependency")
                  throw new Error("PRIVATE DATABASE SECRET");
                return [];
              },
            },
          },
        });
        const response = await listSessions(
          client as any,
          { id: owner, workspaceId: w, roles: [], permissions: [] },
          { projectId, limit: 1 },
        ).catch((error) => error.getResponse());
        expect(response).toEqual({
          code: "SESSION_LIST_UNAVAILABLE",
          message: "Session list unavailable; retry an authorized fresh read",
        });
      },
    );
    it("filters by explicit task-board project without confusing saved execution context or latest sessions", async () => {
      await linkListedTask();
      const older = await addListedSession({
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
      const otherProject = await prisma.project.create({
        data: {
          workspaceId: w,
          departmentId,
          name: "Other project",
          directoryName: randomUUID(),
          creatorId: owner,
          members: { create: { userId: owner } },
        },
      });
      const otherTask = await prisma.task.create({
        data: {
          workspaceId: w,
          title: "Other task",
          description: "Private",
          creatorId: owner,
          managerId: owner,
        },
      });
      await linkListedTask(otherTask.id, otherProject.id);
      await addListedSession({
        taskId: otherTask.id,
        selectedProjectId: projectId,
      });
      const unlinkedTask = await prisma.task.create({
        data: {
          workspaceId: w,
          title: "Unlinked",
          description: "Private",
          creatorId: owner,
          managerId: owner,
        },
      });
      await addListedSession({
        taskId: unlinkedTask.id,
        selectedProjectId: projectId,
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { selectedProjectId: otherProject.id },
      });
      const result = await sessionList("?projectId=" + projectId).expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(new Set(result.body.items.map((s: any) => s.id))).toEqual(
        new Set([sessionId, older.id]),
      );
      for (const item of result.body.items)
        expect(Object.keys(item).sort()).toEqual([
          "createdAt",
          "id",
          "status",
          "stopConfirmation",
          "task",
          "taskId",
          "updatedAt",
        ]);
      expect(
        (
          await sessionList(`?projectId=${projectId}&statuses=RUNNING`).expect(
            200,
          )
        ).body.items.map((s: any) => s.id),
      ).toEqual([older.id]);
      expect(
        (
          await sessionList(
            `?projectId=${projectId}&taskId=${otherTask.id}`,
          ).expect(200)
        ).body.items,
      ).toEqual([]);
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("requires project membership in addition to assignment and sessions.read, with no broad-grant bypass", async () => {
      await linkListedTask();
      const assignedElsewhere = await prisma.task.create({
        data: {
          workspaceId: w,
          title: "Assigned elsewhere",
          description: "Private",
          creatorId: owner,
          managerId: outsider,
        },
      });
      await linkListedTask(assignedElsewhere.id);
      const outsiderSession = await addListedSession({
        taskId: assignedElsewhere.id,
        creatorId: outsider,
      });
      expect(
        (await sessionList("", outsider).expect(200)).body.items.map(
          (s: any) => s.id,
        ),
      ).toContain(outsiderSession.id);
      for (const key of [
        "projects.read-all",
        "projects.manage-all",
        "tasks.read-all",
      ]) {
        await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key, description: "Test", category: "test" },
        });
        await prisma.rolePermission.create({
          data: { roleId, permissionKey: key },
        });
      }
      expect(
        (await sessionList("?projectId=" + projectId, outsider).expect(200))
          .body.items,
      ).toEqual([]);
      expect(
        (await sessionList("?projectId=" + projectId, member).expect(200)).body
          .items,
      ).toEqual([]);
      expect(
        (await sessionList("?projectId=" + randomUUID()).expect(200)).body
          .items,
      ).toEqual([]);
      await sessionList("?projectId=" + projectId, denied).expect(403);
      await http()
        .get("/sessions?projectId=" + projectId)
        .expect(401);
    });
    it.each([
      "membership",
      "assignment",
      "project workspace",
      "task workspace",
      "session workspace",
      "board association",
    ])(
      "rechecks %s on each project-scoped page without exposing stale rows",
      async (change) => {
        await linkListedTask();
        await addListedSession({ createdAt: new Date("2026-10-01T00:00:00Z") });
        const first = (
          await sessionList(`?projectId=${projectId}&limit=1`).expect(200)
        ).body;
        expect(first.hasMore).toBe(true);
        if (change === "membership")
          await prisma.projectMember.delete({
            where: { projectId_userId: { projectId, userId: owner } },
          });
        if (change === "assignment")
          await prisma.task.update({
            where: { id: taskId },
            data: { managerId: member },
          });
        if (change === "project workspace")
          await prisma.project.update({
            where: { id: projectId },
            data: { workspaceId: foreignW },
          });
        if (change === "task workspace")
          await prisma.task.update({
            where: { id: taskId },
            data: { workspaceId: foreignW },
          });
        if (change === "session workspace")
          await prisma.proboxAiSession.updateMany({
            where: { taskId },
            data: { workspaceId: foreignW },
          });
        if (change === "board association")
          await prisma.taskBoardEntry.delete({ where: { taskId } });
        const next = (
          await sessionList(
            `?projectId=${projectId}&limit=1&cursor=${first.nextCursor}`,
          ).expect(200)
        ).body;
        expect(next).toMatchObject({
          items: [],
          hasMore: false,
          nextCursor: null,
        });
        expect(next.asOf).toBe(first.asOf);
      },
    );
    it("binds project cursors to canonical project identity while retaining legacy unfiltered cursor scope", async () => {
      await linkListedTask();
      await addListedSession({ createdAt: new Date("2026-10-01T00:00:00Z") });
      const first = (
        await sessionList(`?projectId=${projectId}&limit=1`).expect(200)
      ).body;
      const upper = (
        await sessionList(
          `?projectId=${projectId.toUpperCase()}&cursor=${first.nextCursor}`,
        ).expect(200)
      ).body;
      expect(upper.items).toHaveLength(1);
      await sessionList("?cursor=" + first.nextCursor).expect(400);
      await sessionList(
        `?projectId=${randomUUID()}&cursor=${first.nextCursor}`,
      ).expect(400);
      await sessionList(
        `?projectId=${projectId}&taskId=${taskId}&cursor=${first.nextCursor}`,
      ).expect(400);
      const global = (await sessionList("?limit=1").expect(200)).body;
      expect(
        JSON.parse(Buffer.from(global.nextCursor, "base64url").toString())
          .scope,
      ).toBe(
        createHash("sha256")
          .update(JSON.stringify([owner, w, null, []]))
          .digest("hex"),
      );
      await sessionList(
        `?projectId=${projectId}&cursor=${global.nextCursor}`,
      ).expect(400);
      await sessionList("?cursor=" + global.nextCursor).expect(200);
    });
    it("keeps archived project session history readable without enabling execution or broadening the projection", async () => {
      await linkListedTask();
      await prisma.project.update({
        where: { id: projectId },
        data: { archivedAt: new Date() },
      });
      const response = await sessionList(
        `?projectId=${projectId}&taskId=${taskId}`,
      ).expect(200);
      expect(response.body.items.map((s: any) => s.id)).toEqual([sessionId]);
      expect(response.body.items[0]).not.toHaveProperty("selectedProjectId");
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("publishes and validates the optional project session filter with bounded task context", async () => {
      for (const query of [
        "?projectId=bad",
        `?projectId=${projectId}&projectId=${projectId}`,
        `?selectedProjectId=${projectId}`,
      ])
        await sessionList(query).expect(400);
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(doc.paths["/sessions"]!.get!.parameters).toContainEqual(
        expect.objectContaining({
          name: "projectId",
          in: "query",
          required: false,
        }),
      );
      expect(
        Object.keys(
          (doc.components!.schemas!.SessionListItemDto as any).properties,
        ).sort(),
      ).toEqual([
        "createdAt",
        "id",
        "status",
        "stopConfirmation",
        "task",
        "taskId",
        "updatedAt",
      ]);
      const itemSchema: any = doc.components!.schemas!.SessionListItemDto;
      expect(itemSchema.required).not.toContain("task");
      expect(itemSchema.properties.task.allOf[0].$ref).toBe(
        "#/components/schemas/SessionListTaskContextDto",
      );
      const taskSchema: any =
        doc.components!.schemas!.SessionListTaskContextDto;
      expect(Object.keys(taskSchema.properties).sort()).toEqual([
        "id",
        "projectId",
        "title",
      ]);
    });
    it("lists every matching assigned session without latest-per-task loss or private details", async () => {
      const older = await addListedSession({
        createdAt: new Date("2026-10-01T00:00:00Z"),
        stopConfirmation: "STOP_UNCONFIRMED",
      });
      await prisma.proboxAiTurn.create({
        data: { sessionId: older.id, prompt: "private prompt" },
      });
      await addListedSession({ status: "FAILED" });
      const response = await sessionList("?statuses=RUNNING").expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.items).toEqual([
        {
          id: older.id,
          taskId,
          status: "RUNNING",
          stopConfirmation: "STOP_UNCONFIRMED",
          createdAt: older.createdAt.toISOString(),
          updatedAt: older.updatedAt.toISOString(),
        },
      ]);
      expect(Object.keys(response.body).sort()).toEqual([
        "asOf",
        "hasMore",
        "items",
        "nextCursor",
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|prompt|cwd|catalog|thread|processId|projectId/,
      );
      expect(runner.start).not.toHaveBeenCalled();
      expect((await sessionList().expect(200)).body.items).toHaveLength(3);
    });
    it("enforces assigned-manager and both workspace scopes despite broad admin grants", async () => {
      const otherTask = await prisma.task.create({
        data: {
          workspaceId: w,
          creatorId: member,
          managerId: member,
          title: "Hidden task",
          description: "Hidden",
        },
      });
      const other = await addListedSession({
        taskId: otherTask.id,
        creatorId: member,
      });
      const foreignTask = await prisma.task.create({
        data: {
          workspaceId: foreignW,
          creatorId: foreign,
          managerId: foreign,
          title: "Foreign",
          description: "Foreign",
        },
      });
      await addListedSession({
        taskId: foreignTask.id,
        workspaceId: foreignW,
        creatorId: foreign,
      });
      await addListedSession({ workspaceId: foreignW });
      await addListedSession({ taskId: foreignTask.id });
      for (const permissionKey of [
        "tasks.read-all",
        "projects.read-all",
        "projects.manage-all",
      ]) {
        await prisma.permission.upsert({
          where: { key: permissionKey },
          update: {},
          create: {
            key: permissionKey,
            name: "test",
            description: "test",
            category: "test",
          },
        });
        await prisma.rolePermission.create({ data: { roleId, permissionKey } });
      }
      expect(
        (await sessionList().expect(200)).body.items.map((s: any) => s.id),
      ).toEqual([sessionId]);
      expect(
        (await sessionList("", member).expect(200)).body.items.map(
          (s: any) => s.id,
        ),
      ).toEqual([other.id]);
      expect(
        (await sessionList("?taskId=" + otherTask.id).expect(200)).body.items,
      ).toEqual([]);
      expect(
        (await sessionList("?taskId=" + randomUUID()).expect(200)).body.items,
      ).toEqual([]);
      await sessionList("", denied).expect(403);
      await http().get("/sessions").expect(401);
    });
    it("paginates timestamp ties across more than 100 rows and excludes later-created sessions", async () => {
      const ids = Array.from({ length: 105 }, () => randomUUID());
      const createdAt = new Date("2026-10-01T00:00:00Z");
      await prisma.proboxAiSession.createMany({
        data: ids.map((id) => ({
          id,
          workspaceId: w,
          taskId,
          creatorId: owner,
          cwd: root,
          sandbox: "read-only",
          createdAt,
          status: "COMPLETED" as const,
        })),
      });
      const first = (await sessionList().expect(200)).body;
      expect(first.items).toHaveLength(100);
      expect(first.hasMore).toBe(true);
      const newer = await addListedSession();
      expect(newer.createdAt > new Date(first.asOf)).toBe(true);
      const next = (
        await sessionList("?cursor=" + first.nextCursor).expect(200)
      ).body;
      expect(next.asOf).toBe(first.asOf);
      expect(next.hasMore).toBe(false);
      expect(next.nextCursor).toBeNull();
      const seen = [...first.items, ...next.items].map((s: any) => s.id);
      expect(seen).toEqual([sessionId, ...ids.sort().reverse()]);
      expect(new Set(seen).size).toBe(106);
      expect(seen).not.toContain(newer.id);
      expect(
        (await sessionList("?cursor=" + first.nextCursor).expect(200)).body,
      ).toEqual(next);
    });
    it("binds cursors to caller and normalized filters and rejects forged/future bounds", async () => {
      await addListedSession({ createdAt: new Date("2026-10-01T00:00:00Z") });
      const first = (
        await sessionList("?limit=1&statuses=RUNNING,COMPLETED").expect(200)
      ).body;
      const cursor = first.nextCursor;
      await sessionList(
        "?limit=1&statuses=COMPLETED,RUNNING&cursor=" + cursor,
      ).expect(200);
      await sessionList("?statuses=RUNNING&cursor=" + cursor).expect(400);
      await sessionList(
        "?taskId=" + taskId + "&statuses=RUNNING,COMPLETED&cursor=" + cursor,
      ).expect(400);
      await sessionList(
        "?statuses=RUNNING,COMPLETED&cursor=" + cursor,
        member,
      ).expect(400);
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
      const encode = (value: any) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      await sessionList(
        "?statuses=RUNNING,COMPLETED&cursor=" +
          encode({ ...decoded, asOf: "2099-01-01T00:00:00.000Z" }),
      ).expect(400);
      await sessionList(
        "?statuses=RUNNING,COMPLETED&cursor=" +
          encode({
            ...decoded,
            after: {
              ...decoded.after,
              createdAt: "+010000-01-01T00:00:00.000Z",
            },
          }),
      ).expect(400);
      await sessionList(
        "?statuses=RUNNING,COMPLETED&cursor=" +
          encode({ ...decoded, secret: "unexpected" }),
      ).expect(400);
      for (const query of [
        "?cursor=",
        "?cursor=bad",
        "?cursor=" + "a".repeat(2049),
        "?statuses=",
        "?statuses=RUNNING,RUNNING",
        "?statuses=unknown",
        "?limit=0",
        "?limit=101",
        "?limit=",
        "?limit=1e2",
        "?taskId=bad",
        "?projectId=bad",
      ])
        await sessionList(query).expect(400);
    });
    it("reevaluates deletion and status shifts without treating the cursor as a retained snapshot", async () => {
      const older = await addListedSession({
        createdAt: new Date("2026-10-01T00:00:00Z"),
        status: "COMPLETED",
      });
      const first = (
        await sessionList("?limit=1&statuses=COMPLETED").expect(200)
      ).body;
      expect(first.items[0].id).toBe(sessionId);
      await prisma.proboxAiSession.delete({ where: { id: sessionId } });
      const next = (
        await sessionList(
          "?limit=1&statuses=COMPLETED&cursor=" + first.nextCursor,
        ).expect(200)
      ).body;
      expect(next.items[0].id).toBe(older.id);
      await prisma.proboxAiSession.update({
        where: { id: older.id },
        data: { status: "FAILED" },
      });
      expect(
        (
          await sessionList(
            "?limit=1&statuses=COMPLETED&cursor=" + first.nextCursor,
          ).expect(200)
        ).body.items,
      ).toEqual([]);
    });
    it.each(["grant", "assignment", "status", "workspace"])(
      "rechecks %s between pages",
      async (change) => {
        await addListedSession({ createdAt: new Date("2026-10-01T00:00:00Z") });
        const first = (await sessionList("?limit=1").expect(200)).body;
        const actor = {
          id: owner,
          workspaceId: w,
          permissions: ["sessions.read"],
          roles: [],
        };
        if (change === "grant")
          await prisma.rolePermission.deleteMany({
            where: { roleId, permissionKey: "sessions.read" },
          });
        if (change === "assignment")
          await prisma.task.update({
            where: { id: taskId },
            data: { managerId: member },
          });
        if (change === "status")
          await prisma.user.update({
            where: { id: owner },
            data: { status: "BANNED" },
          });
        if (change === "workspace") {
          await prisma.userRoleAssignment.deleteMany({
            where: { userId: owner },
          });
          await prisma.user.update({
            where: { id: owner },
            data: { workspaceId: foreignW },
          });
        }
        if (change === "assignment")
          expect(
            (
              await sessionList("?limit=1&cursor=" + first.nextCursor).expect(
                200,
              )
            ).body.items,
          ).toEqual([]);
        else
          await expect(
            sessions.list(actor, { limit: 1, cursor: first.nextCursor }),
          ).rejects.toMatchObject({ status: 403 });
      },
    );
    it("normalizes unknown stop metadata and sanitizes read failures without writes", async () => {
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { stopConfirmation: "private-unknown-flag" },
      });
      const body = (await sessionList().expect(200)).body;
      expect(body.items[0].stopConfirmation).toBe("NOT_OBSERVED");
      expect(JSON.stringify(body)).not.toContain("private");
      const before = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      await sessionList().expect(200);
      expect(
        await prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: sessionId },
        }),
      ).toEqual(before);
      jest
        .spyOn(prisma, "$transaction")
        .mockRejectedValueOnce(new Error("private database credential"));
      const error = await sessions
        .list(
          { id: owner, workspaceId: w, permissions: [], roles: [] },
          { limit: 100 },
        )
        .catch((e) => e);
      expect(error.status).toBe(503);
      expect(error.getResponse().code).toBe("SESSION_LIST_UNAVAILABLE");
      expect(JSON.stringify(error.getResponse())).not.toContain("credential");
    });
    const postTurn = (
      requestId: string = randomUUID(),
      prompt = "Follow up",
      actor = owner,
    ) =>
      http()
        .post(`/sessions/${sessionId}/turns`)
        .set("Authorization", "Bearer " + actor)
        .send({ requestId, prompt });
    const readTurn = (id: string, actor = owner) =>
      http()
        .get(`/sessions/${sessionId}/turns/by-request/${id}`)
        .set("Authorization", "Bearer " + actor);
    const history = (actor = owner, id?: string) =>
      http()
        .get(`/projects/${projectId}/deletion-requests${id ? "/" + id : ""}`)
        .set("Authorization", "Bearer " + actor);
    const requestDeletion = async (actor = member) =>
      (
        await http()
          .post(`/projects/${projectId}/deletion-requests`)
          .set("Authorization", "Bearer " + actor)
          .expect(201)
      ).body;
    const approve = (id: string, actor = owner) =>
      http()
        .post(`/projects/${projectId}/deletion-requests/${id}/approve`)
        .set("Authorization", "Bearer " + actor);
    const finish = async (code = 0) => {
      await until(async () => pending.has(sessionId));
      pending.get(sessionId)!.resolve(code);
      await until(
        async () =>
          (
            await prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: sessionId },
            })
          ).status !== "RUNNING",
      );
    };
    const preflight = (body: any, actor = owner) =>
      http()
        .post("/sessions/directory-preflight")
        .set("Authorization", "Bearer " + actor)
        .send(body);
    const context = (actor = owner, id = projectId, query = "") =>
      http()
        .get(`/sessions/projects/${id}/execution-context${query}`)
        .set("Authorization", "Bearer " + actor);
    it("preflights authorized manual paths without writes and preserves invalid input", async () => {
      const before = await prisma.proboxAiSession.count();
      const valid = await preflight({ taskId, cwd: root }).expect(200);
      expect(valid.body).toEqual({
        project: null,
        requestedPath: root,
        valid: true,
        normalizedPath: await fs.realpath(root),
        reason: null,
        guidance: "ABSOLUTE_ALLOWED_WORKSPACE_DIRECTORY",
        revalidateAtLaunch: true,
      });
      const input = path.join(root, "missing");
      const invalid = await preflight({ taskId, cwd: input }).expect(200);
      expect(invalid.body).toMatchObject({
        valid: false,
        requestedPath: input,
        normalizedPath: null,
        reason: "NOT_FOUND",
      });
      const creation = await http()
        .post("/sessions")
        .set("Authorization", "Bearer " + owner)
        .send({
          taskId,
          cwd: input,
          sandbox: "read-only",
          prompt: "Do not run",
        })
        .expect(400);
      expect(creation.body).toMatchObject({
        code: "SESSION_DIRECTORY_INVALID",
        reason: "NOT_FOUND",
        requestedPath: input,
        sessionId: null,
      });
      expect(await prisma.proboxAiSession.count()).toBe(before);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("QUEUED");
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("enforces task assignment, current grants and workspace before filesystem inspection", async () => {
      const paths = jest.spyOn(
        WorkspacePathPolicy.prototype,
        "executionDirectory",
      );
      await preflight({ taskId, cwd: root }, member).expect(403);
      await preflight({ taskId, cwd: root }, foreign).expect(403);
      await preflight({ taskId, cwd: root }, denied).expect(403);
      await context(outsider).expect(403);
      await context(foreign).expect(403);
      expect(paths).not.toHaveBeenCalled();
      // Give the foreign identity its own workspace grant; resource scope still conceals paths.
      const foreignRole = await prisma.role.create({
        data: {
          workspaceId: foreignW,
          key: "foreign-tester",
          name: "Foreign tester",
          permissions: { create: { permissionKey: "sessions.create" } },
        },
      });
      await prisma.userRoleAssignment.create({
        data: {
          userId: foreign,
          roleId: foreignRole.id,
          workspaceId: foreignW,
        },
      });
      await preflight({ taskId, cwd: root }, foreign).expect(404);
      await context(foreign).expect(404);
      expect(paths).not.toHaveBeenCalled();
    });
    it("returns only selected-project context and accurate task capability", async () => {
      const r = await context().expect(200);
      expect(Object.keys(r.body).sort()).toEqual(
        [
          "capabilities",
          "guidance",
          "normalizedPath",
          "project",
          "reason",
          "requestedPath",
          "revalidateAtLaunch",
          "valid",
        ].sort(),
      );
      expect(r.body.project).toEqual({
        id: projectId,
        name: "Fixture",
        status: "READY",
      });
      expect(r.body.capabilities).toEqual({
        canStartSession: false,
        requiresAssignedTask: true,
      });
      const withTask = await context(
        owner,
        projectId,
        `?taskId=${taskId}`,
      ).expect(200);
      expect(withTask.body.capabilities.canStartSession).toBe(true);
      await context(member, projectId, `?taskId=${taskId}`).expect(403);
      const unrelated = await preflight({
        taskId,
        projectId,
        cwd: root,
      }).expect(200);
      expect(unrelated.body.reason).toBe("OUTSIDE_PROJECT");
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "FAILED" },
      });
      expect((await context().expect(200)).body).toMatchObject({
        valid: false,
        normalizedPath: null,
        reason: "PROJECT_NOT_READY",
      });
    });
    it("persists selected-project identity and canonical directory for creation", async () => {
      const r = await http()
        .post("/sessions")
        .set("Authorization", "Bearer " + owner)
        .send({
          taskId,
          projectId,
          sandbox: "read-only",
          prompt: "Controlled fixture",
        })
        .expect(201);
      expect(r.body.projectId).toBe(projectId);
      const saved = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: r.body.id },
      });
      expect(saved.selectedProjectId).toBe(projectId);
      expect(saved.cwd).toBe((await context().expect(200)).body.normalizedPath);
      await until(async () => pending.has(saved.id));
      expect(runner.start).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: saved.cwd }),
        expect.any(Function),
      );
    });
    it("fails an already-accepted turn before claim after directory removal", async () => {
      const directory = path.join(root, randomUUID());
      await fs.mkdir(directory);
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { cwd: directory },
      });
      jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementation(() => undefined);
      const accepted = await postTurn().expect(202);
      await fs.rmdir(directory);
      await (sessions as any).runAcceptedTurn(sessionId, accepted.body.turnId);
      const saved = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(saved).toMatchObject({
        status: "FAILED",
        stopConfirmation: "NOT_STARTED",
        recoveryReason: "DIRECTORY_INVALID",
      });
      expect(runner.start).not.toHaveBeenCalled();
      const read = await http()
        .get(`/sessions/${sessionId}`)
        .set("Authorization", "Bearer " + owner)
        .expect(200);
      expect(read.body.id).toBe(sessionId);
    });
    it("rechecks project membership before launch and never substitutes an unrelated directory", async () => {
      const resolved = (await context().expect(200)).body.normalizedPath;
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { cwd: resolved, selectedProjectId: projectId },
      });
      jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementation(() => undefined);
      const accepted = await postTurn().expect(202);
      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId, userId: owner } },
      });
      await (sessions as any).runAcceptedTurn(sessionId, accepted.body.turnId);
      expect(
        await prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: sessionId },
        }),
      ).toMatchObject({
        status: "FAILED",
        stopConfirmation: "NOT_STARTED",
        recoveryReason: "AUTHORIZATION_LOST",
      });
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("revalidates filesystem immediately before spawn after a successful claim", async () => {
      const directory = path.join(root, randomUUID());
      await fs.mkdir(directory);
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { cwd: directory },
      });
      runner.start.mockImplementation(async (options) => {
        await fs.rmdir(directory);
        expect(await options.beforeSpawn()).toBe(false);
        return -1;
      });
      const accepted = await postTurn().expect(202);
      await until(
        async () =>
          (
            await prisma.proboxAiTurn.findUniqueOrThrow({
              where: { id: accepted.body.turnId },
            })
          ).status === "FAILED",
      );
      expect(
        await prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: sessionId },
        }),
      ).toMatchObject({
        recoveryReason: "DIRECTORY_INVALID",
        stopConfirmation: "NOT_STARTED",
      });
    });
    it("retains queued selected-project scope when readiness changes before first launch", async () => {
      const created = await sessions.create(
        owner,
        {
          taskId,
          projectId,
          prompt: "Controlled queued fixture",
          sandbox: "read-only",
        },
        false,
      );
      expect(created.projectId).toBe(projectId);
      expect(created.initialTurn).toBeNull();
      jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementation(() => undefined);
      const accepted = await sessions.acceptFollowUp(
        owner,
        created.id,
        "First turn",
        randomUUID(),
      );
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "DELETING" },
      });
      await (sessions as any).runAcceptedTurn(created.id, accepted.turnId);
      expect(
        await prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: created.id },
        }),
      ).toMatchObject({
        selectedProjectId: projectId,
        status: "FAILED",
        stopConfirmation: "NOT_STARTED",
        recoveryReason: "DIRECTORY_INVALID",
      });
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("fails closed on deleted selected project instead of reverting to manual scope", async () => {
      const created = await sessions.create(
        owner,
        {
          taskId,
          projectId,
          prompt: "Controlled queued fixture",
          sandbox: "read-only",
        },
        false,
      );
      jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementation(() => undefined);
      const accepted = await sessions.acceptFollowUp(
        owner,
        created.id,
        "First turn",
        randomUUID(),
      );
      await prisma.project.delete({ where: { id: projectId } });
      await (sessions as any).runAcceptedTurn(created.id, accepted.turnId);
      expect(
        await prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: created.id },
        }),
      ).toMatchObject({
        selectedProjectId: projectId,
        status: "FAILED",
        recoveryReason: "AUTHORIZATION_LOST",
      });
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("publishes explicit preflight and project-context OpenAPI schemas", async () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/sessions/directory-preflight"]!.post!.responses["200"],
      ).toMatchObject({
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/DirectoryPreflightResponseDto",
            },
          },
        },
      });
      expect(
        doc.paths["/sessions/projects/{projectId}/execution-context"]!.get,
      ).toBeDefined();
      expect(doc.components!.schemas!.CreateSessionDto).toMatchObject({
        properties: { projectId: { format: "uuid" }, cwd: { maxLength: 4096 } },
      });
      expect(
        (doc.components!.schemas!.CreateSessionDto as any).required,
      ).not.toContain("cwd");
    });
    it("accepts before runner completion and returns durable identity with no private internals", async () => {
      const key = randomUUID();
      const r = await postTurn(key).expect(202);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).toEqual(
        expect.objectContaining({
          accepted: true,
          requestId: key,
          sessionId,
          turnId: expect.any(String),
        }),
      );
      expect(
        (
          await prisma.proboxAiTurn.findUniqueOrThrow({
            where: { id: r.body.turnId },
          })
        ).prompt,
      ).toBe("Follow up");
      await until(async () => pending.has(sessionId));
      expect((await readTurn(key).expect(200)).body.status).toBe("RUNNING");
      const detail = (
        await http()
          .get(`/sessions/${sessionId}`)
          .set("Authorization", "Bearer " + owner)
          .expect(200)
      ).body;
      expect(detail).not.toHaveProperty("catalogSnapshot");
      expect(detail).not.toHaveProperty("task");
      expect(detail.turns[0]).not.toHaveProperty("requestedById");
      await finish();
      expect((await readTurn(key).expect(200)).body.status).toBe("COMPLETED");
    });
    it("deduplicates concurrent identical requests, rejects conflicts and never reruns a completed retry", async () => {
      const key = randomUUID();
      const rs = await Promise.all([postTurn(key), postTurn(key)]);
      expect(rs.map((r) => r.status)).toEqual([202, 202]);
      expect(rs[0].body.turnId).toBe(rs[1].body.turnId);
      await postTurn(key, "Different").expect(409);
      await postTurn().expect(409);
      await finish();
      await postTurn(key.toUpperCase()).expect(202);
      await tick();
      expect(runner.start).toHaveBeenCalledTimes(1);
    });
    it("reconciles commit-with-lost-acknowledgement without another launch", async () => {
      const key = randomUUID();
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(async (fn: any) => {
          await original(fn);
          throw new Error("lost commit ack");
        });
      await postTurn(key).expect(503);
      spy.mockRestore();
      const accepted = (await readTurn(key).expect(200)).body;
      expect(accepted.status).toBe("QUEUED");
      await postTurn(key).expect(202);
      await tick();
      expect(runner.start).not.toHaveBeenCalled();
      // No automatic replay: this is a durable queued acceptance, SESSION05 owns orphan recovery.
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { status: "FAILED" },
      });
    });
    it("rolls back failed turn persistence so the same request ID can later be accepted", async () => {
      const key = randomUUID();
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce((fn: any) =>
          original(async (tx: any) => {
            jest
              .spyOn(tx.proboxAiTurn, "create")
              .mockRejectedValueOnce(new Error("insert failed"));
            return fn(tx);
          }),
        );
      await postTurn(key).expect(503);
      spy.mockRestore();
      await readTurn(key).expect(404);
      expect(
        (
          await prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).status,
      ).toBe("COMPLETED");
      await postTurn(key).expect(202);
      await finish();
    });
    it("reports nonzero exit and caught spawn errors as failed runs independent of HTTP acceptance", async () => {
      const key = randomUUID();
      await postTurn(key).expect(202);
      await finish(2);
      expect((await readTurn(key).expect(200)).body.status).toBe("FAILED");
      runner.start.mockRejectedValueOnce(new Error("spawn failed"));
      const next = randomUUID();
      await postTurn(next).expect(202);
      await until(async () => (await readTurn(next)).body.status === "FAILED");
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("FAILED");
    });
    it("returns interrupt 200 for a signal and only reports terminal interruption after the runner settles", async () => {
      const key = randomUUID();
      await postTurn(key).expect(202);
      await until(async () => pending.has(sessionId));
      await http()
        .post(`/sessions/${sessionId}/interrupt`)
        .set("Authorization", "Bearer " + owner)
        .send({ turnId: (await readTurn(key)).body.turnId })
        .expect(200)
        .expect((response: any) => {
          expect(response.body).toMatchObject({
            interrupted: true,
            stopConfirmation: "STOP_UNCONFIRMED",
          });
        });
      expect((await readTurn(key).expect(200)).body.status).toBe("RUNNING");
      await finish();
      expect((await readTurn(key).expect(200)).body.status).toBe("INTERRUPTED");
      pending.delete(sessionId);
      await http()
        .post(`/sessions/${sessionId}/interrupt`)
        .set("Authorization", "Bearer " + owner)
        .send({ turnId: (await readTurn(key)).body.turnId })
        .expect(200)
        .expect((response: any) => {
          expect(response.body.stopConfirmation).toBe("LOCAL_EXIT_OBSERVED");
        });
    });
    it("enforces permissions, assignment, scope and request validation; manage-only reconciliation works", async () => {
      await postTurn(randomUUID(), "Work", member).expect(403);
      await postTurn(randomUUID(), "Work", denied).expect(403);
      await postTurn(randomUUID(), "Work", foreign).expect(403);
      await http()
        .post(`/sessions/${sessionId}/turns`)
        .set("Authorization", "Bearer " + owner)
        .send({ prompt: "Work" })
        .expect(400);
      await http()
        .post(`/sessions/${sessionId}/turns`)
        .set("Authorization", "Bearer " + owner)
        .send({ requestId: randomUUID(), prompt: "Work", status: "COMPLETED" })
        .expect(400);
      const key = randomUUID();
      await postTurn(key).expect(202);
      await finish();
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: "sessions.read" },
      });
      await readTurn(key).expect(200);
      await readTurn(key, member).expect(403);
      await prisma.task.update({
        where: { id: taskId },
        data: { managerId: member },
      });
      await readTurn(key).expect(403);
      await postTurn(key, "Follow up", member).expect(409);
    });
    it("rechecks revoked permissions in the service and preserves accepted history across a fresh service", async () => {
      const key = randomUUID();
      await postTurn(key).expect(202);
      await finish();
      const freshRunner = { start: jest.fn(), interrupt: jest.fn() };
      const fresh = new SessionsService(
        prisma as any,
        freshRunner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      expect((await fresh.turnByRequest(owner, sessionId, key)).turnId).toBe(
        (await readTurn(key)).body.turnId,
      );
      await fresh.acceptFollowUp(owner, sessionId, "Follow up", key);
      await tick();
      expect(freshRunner.start).not.toHaveBeenCalled();
      await prisma.rolePermission.deleteMany({
        where: {
          roleId,
          permissionKey: { in: ["sessions.manage", "sessions.create"] },
        },
      });
      await expect(
        fresh.acceptFollowUp(owner, sessionId, "Work", randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        fresh.create(owner, {
          taskId,
          prompt: "Work",
          cwd: root,
          sandbox: "read-only",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("denies grant revocation between the real HTTP guard and acceptance transaction", async () => {
      const original = prisma.$transaction.bind(prisma);
      for (const permissionKey of ["sessions.manage", "sessions.create"]) {
        const spy = jest
          .spyOn(prisma, "$transaction")
          .mockImplementationOnce(async (fn: any) => {
            await prisma.rolePermission.deleteMany({
              where: { roleId, permissionKey },
            });
            return original(fn);
          });
        if (permissionKey === "sessions.manage") await postTurn().expect(403);
        else
          await http()
            .post("/sessions")
            .set("Authorization", "Bearer " + owner)
            .send({ taskId, prompt: "Work", cwd: root, sandbox: "read-only" })
            .expect(403);
        spy.mockRestore();
      }
      expect(runner.start).not.toHaveBeenCalled();
      expect(await prisma.proboxAiTurn.count({ where: { sessionId } })).toBe(0);
      expect(await prisma.proboxAiSession.count({ where: { taskId } })).toBe(1);
    });
    it("creates an initial persisted turn before launch and projects the create response", async () => {
      const r = await http()
        .post("/sessions")
        .set("Authorization", "Bearer " + owner)
        .send({ taskId, prompt: "Initial", cwd: root, sandbox: "read-only" })
        .expect(201);
      expect(r.body.initialTurn.id).toEqual(expect.any(String));
      expect(r.body.initialTurn.prompt).toBe("Initial");
      expect(r.body).not.toHaveProperty("catalogSnapshot");
      await until(async () => pending.has(r.body.id));
      pending.get(r.body.id)!.resolve(0);
      await until(
        async () =>
          (
            await prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: r.body.id },
            })
          ).status === "COMPLETED",
      );
    });
    it("Telegram follow-ups bind update identity and reset delivery atomically without retry relaunch", async () => {
      await prisma.telegramSession.create({
        data: {
          sessionId,
          projectId,
          userId: owner,
          chatId: 42n,
          finished: true,
        },
      });
      const key = telegramTurnRequestId(owner, 42n, 123);
      const accepted = await sessions.acceptTelegramTurn(
        owner,
        42n,
        sessionId,
        "Telegram follow up",
        key,
      );
      expect(
        (
          await prisma.telegramSession.findUniqueOrThrow({
            where: { sessionId },
          })
        ).finished,
      ).toBe(false);
      expect(
        (
          await sessions.acceptTelegramTurn(
            owner,
            42n,
            sessionId,
            "Telegram follow up",
            key,
          )
        ).turnId,
      ).toBe(accepted.turnId);
      await expect(
        sessions.acceptTelegramTurn(
          owner,
          43n,
          sessionId,
          "Telegram follow up",
          key,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await finish(2);
      expect((await sessions.turnByRequest(owner, sessionId, key)).status).toBe(
        "FAILED",
      );
      await prisma.telegramSession.update({
        where: { sessionId },
        data: { finished: true },
      });
      await sessions.acceptTelegramTurn(
        owner,
        42n,
        sessionId,
        "Telegram follow up",
        key,
      );
      await tick();
      expect(runner.start).toHaveBeenCalledTimes(1);
      expect(
        (
          await prisma.telegramSession.findUniqueOrThrow({
            where: { sessionId },
          })
        ).finished,
      ).toBe(true);
    });
    it("Telegram initial acceptance preserves create-only permission and cannot launch a second initial turn", async () => {
      await prisma.telegramSession.create({
        data: {
          sessionId,
          projectId,
          userId: owner,
          chatId: 42n,
          finished: true,
        },
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { status: "QUEUED" },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: "sessions.manage" },
      });
      const key = telegramTurnRequestId(owner, 42n, 124);
      await sessions.acceptTelegramTurn(
        owner,
        42n,
        sessionId,
        "Initial Telegram",
        key,
        true,
      );
      await finish();
      await sessions.acceptTelegramTurn(
        owner,
        42n,
        sessionId,
        "Initial Telegram",
        key,
        true,
      );
      await tick();
      expect(runner.start).toHaveBeenCalledTimes(1);
      await expect(
        sessions.acceptTelegramTurn(
          owner,
          42n,
          sessionId,
          "Second initial",
          telegramTurnRequestId(owner, 42n, 125),
          true,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("existing Telegram restart reconciliation settles QUEUED and RUNNING turns without replay", async () => {
      await prisma.telegramSession.create({
        data: {
          sessionId,
          projectId,
          userId: owner,
          chatId: 42n,
          finished: false,
        },
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { status: "RUNNING" },
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "RUNNING" },
      });
      const queued = await prisma.proboxAiTurn.create({
        data: {
          sessionId,
          prompt: "Queued",
          status: "QUEUED",
          requestId: randomUUID(),
          requestedById: owner,
        },
      });
      const running = await prisma.proboxAiTurn.create({
        data: { sessionId, prompt: "Running", status: "RUNNING" },
      });
      const completed = await prisma.proboxAiTurn.create({
        data: { sessionId, prompt: "Preserve", status: "COMPLETED" },
      });
      const relay = new TelegramSessionRelay(
        prisma as any,
        { configured: true } as any,
        {} as any,
        {} as any,
        sessions,
      );
      try {
        await relay.onModuleInit();
      } finally {
        relay.onModuleDestroy();
      }
      for (const id of [queued.id, running.id])
        expect(
          (await prisma.proboxAiTurn.findUniqueOrThrow({ where: { id } }))
            .status,
        ).toBe("INTERRUPTED");
      expect(
        (
          await prisma.proboxAiTurn.findUniqueOrThrow({
            where: { id: completed.id },
          })
        ).status,
      ).toBe("COMPLETED");
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("CANCELLED");
      const fresh = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      await fresh.acceptTelegramTurn(
        owner,
        42n,
        sessionId,
        "Queued",
        queued.requestId!,
      );
      await tick();
      expect(runner.start).not.toHaveBeenCalled();
    });

    const eventHistory = (actor = owner, query = "") =>
      http()
        .get(`/sessions/${sessionId}/events${query}`)
        .set("Authorization", "Bearer " + actor);
    const startControlled = async () => {
      const accepted = await postTurn().expect(202);
      await until(async () => pending.has(sessionId));
      return accepted.body;
    };
    it("replays bounded ordered output and explicit omissions with snapshot pagination", async () => {
      const accepted = await startControlled();
      await pending.get(sessionId)!.event({
        type: "item.completed",
        payload: {
          item: {
            id: "item_1",
            type: "agent_message",
            text: "Permitted answer",
            secret: "hidden",
          },
        },
        rawLine: "private raw line",
      });
      await pending.get(sessionId)!.event({
        type: "item.completed",
        payload: {
          item: {
            id: "tool_1",
            type: "command_execution",
            command: "pnpm test",
            exit_code: 0,
            aggregated_output: "private output",
            status: "completed",
          },
        },
        rawLine: "private raw line",
      });
      const first = (await eventHistory(owner, "?limit=2").expect(200)).body;
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBe(2);
      const next = (await eventHistory(owner, "?after=2&limit=2").expect(200))
        .body;
      expect(next.events.map((e: any) => e.turnId)).toEqual([
        accepted.turnId,
        accepted.turnId,
      ]);
      expect(next.events[0].data.item.text).toBe("Permitted answer");
      expect(next.events[0].data.textUpdate).toEqual({
        version: 1,
        mode: "SNAPSHOT",
        identity: {
          sessionId,
          turnId: accepted.turnId,
          itemId: "item_1",
          eventId: null,
        },
        revision: 3,
        phase: "ITEM_COMPLETED",
        continuation: "ITEM_COMPLETE",
        runCompletion: "USE_SERVER_STATE",
      });
      expect(
        await prisma.sessionEvent.findFirst({
          where: { sessionId, sequence: 3 },
          select: { projectionVersion: true },
        }),
      ).toEqual({ projectionVersion: 2 });
      expect(next.events[1].data.omissionReason).toBe("TOOL_DETAILS_EXCLUDED");
      expect(next.events[1].data.commandDetails).toMatchObject({
        commandLabel: "pnpm test",
        exitCode: 0,
        outputState: "OMITTED",
        provisional: true,
      });
      const storedCommand = await prisma.sessionEvent.findFirstOrThrow({
        where: { sessionId, sequence: 4 },
      });
      expect(storedCommand.projectionVersion).toBe(3);
      expect(storedCommand.rawPayload).toEqual(next.events[1].data);
      expect(JSON.stringify(storedCommand.rawPayload)).not.toMatch(
        /private output|private raw line|aggregated_output/,
      );
      expect(JSON.stringify(next)).not.toMatch(
        /private command|private output|private raw line|hidden|actor/,
      );
      expect(next.highWaterSequence).toBe(next.session.lastSequence);
      expect(next.hasMore).toBe(false);
      await eventHistory(owner, "?limit=101").expect(400);
      await eventHistory(owner, "?after=-1").expect(400);
      await eventHistory(owner, "?after=999").expect(409);
      await eventHistory(member).expect(403);
      await eventHistory(denied).expect(403);
    });
    it("serializes concurrent event sequences and hash linkage", async () => {
      await startControlled();
      await Promise.all(
        Array.from({ length: 20 }, (_, n) =>
          pending.get(sessionId)!.event({
            type: "item.completed",
            payload: {
              item: {
                id: "i_" + n,
                type: "agent_message",
                text: "Answer " + n,
              },
            },
            rawLine: "raw",
          }),
        ),
      );
      const rows = await prisma.sessionEvent.findMany({
        where: { sessionId },
        orderBy: { sequence: "asc" },
      });
      expect(rows.map((e) => e.sequence)).toEqual(
        Array.from({ length: 22 }, (_, n) => n + 1),
      );
      rows
        .slice(1)
        .forEach((e, n) => expect(e.previousHash).toBe(rows[n]!.payloadHash));
      expect(new Set(rows.map((e) => e.payloadHash)).size).toBe(rows.length);
    });
    it("keeps early runner completion non-authoritative and commits nonzero terminal failure", async () => {
      await startControlled();
      await pending.get(sessionId)!.event({
        type: "turn.completed",
        payload: { usage: { input_tokens: 7 } },
        rawLine: "raw",
      });
      let h = (await eventHistory().expect(200)).body;
      expect(h.session.status).toBe("RUNNING");
      expect(h.events.at(-1).data.authoritative).toBe(false);
      await finish(9);
      h = (await eventHistory().expect(200)).body;
      expect(h.events.at(-1)).toMatchObject({
        type: "session.state",
        source: "SERVER",
        data: {
          authoritative: true,
          sessionStatus: "FAILED",
          turnStatus: "FAILED",
        },
      });
      expect(h.session.status).toBe("FAILED");
    });
    it("projects legacy events without raw tools, paths or invented authorship", async () => {
      await prisma.sessionEvent.create({
        data: {
          sessionId,
          sequence: 1,
          type: "workspace.diff",
          rawPayload: {
            path: "C:/private/archive.diff",
            secret: "legacy secret",
          },
          payloadHash: "old",
          projectionVersion: 0,
        },
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { lastSequence: 1 },
      });
      const h = (await eventHistory().expect(200)).body;
      expect(h.events[0]).toMatchObject({
        sequence: 1,
        type: "runner.omitted",
        legacyProjection: true,
        data: { omitted: true },
      });
      expect(JSON.stringify(h)).not.toMatch(/archive.diff|legacy secret/);
    });
    it("reports unavailable history explicitly rather than looping on a gap", async () => {
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { lastSequence: 1 },
      });
      const r = await eventHistory().expect(409);
      expect(r.body.code).toBe("SESSION_HISTORY_UNAVAILABLE");
    });
    it("commits terminal state and event atomically when event persistence fails", async () => {
      await startControlled();
      const original = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((
        fn: any,
      ) =>
        original(async (tx: any) => {
          const create = tx.sessionEvent.create.bind(tx.sessionEvent);
          tx.sessionEvent.create = async (args: any) => {
            if (args.data.type === "session.state")
              throw Error("Injected state-event failure");
            return create(args);
          };
          return fn(tx);
        })) as any);
      pending.get(sessionId)!.resolve(0);
      await tick();
      await new Promise((r) => setTimeout(r, 50));
      spy.mockRestore();
      expect(
        (
          await prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).status,
      ).toBe("RUNNING");
      expect(
        (await prisma.sessionEvent.findMany({ where: { sessionId } })).length,
      ).toBe(2);
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { runLeaseExpiresAt: new Date(0) },
      });
      await sessions.reconcileExpiredRuns();
      expect((await eventHistory().expect(200)).body.session.status).toBe(
        "INTERRUPTED",
      );
    });
    it("keeps legacy accepted-but-unlaunched work interrupted without replay", async () => {
      const launch = jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementationOnce(() => undefined);
      const key = randomUUID();
      const accepted = (await postTurn(key).expect(202)).body;
      launch.mockRestore();
      // Simulate an existing pre-protocol row: migration defaults do not opt it in.
      await prisma.proboxAiTurn.update({
        where: { id: accepted.turnId },
        data: { durableDispatch: false },
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { runLeaseExpiresAt: new Date(0) },
      });
      const fresh = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      await fresh.reconcileExpiredRuns();
      expect((await readTurn(key).expect(200)).body).toMatchObject({
        turnId: accepted.turnId,
        status: "INTERRUPTED",
      });
      expect((await eventHistory().expect(200)).body.session).toMatchObject({
        recoveryReason: "OWNER_LOST",
        stopConfirmation: "NOT_STARTED",
      });
      await fresh.acceptFollowUp(owner, sessionId, "Follow up", key);
      expect(runner.start).not.toHaveBeenCalled();
      await fresh.acceptFollowUp(
        owner,
        sessionId,
        "Deliberate new work",
        randomUUID(),
      );
      await until(async () => pending.has(sessionId));
      expect(runner.start).toHaveBeenCalledTimes(1);
    });
    it("fences expired running owners and preserves unknown stop evidence", async () => {
      const accepted = await startControlled();
      const event = pending.get(sessionId)!.event;
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { runLeaseExpiresAt: new Date(0) },
      });
      const fresh = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      await fresh.reconcileExpiredRuns();
      const before = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(before).toMatchObject({
        status: "INTERRUPTED",
        stopConfirmation: "STOP_UNCONFIRMED",
        recoveryReason: "OWNER_LOST",
      });
      await expect(
        event({
          type: "item.completed",
          payload: { item: { type: "agent_message", text: "stale output" } },
          rawLine: "raw",
        }),
      ).rejects.toMatchObject({ status: 409 });
      pending.get(sessionId)!.resolve(0);
      await tick();
      await new Promise((r) => setTimeout(r, 30));
      expect(
        (
          await prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).lastSequence,
      ).toBe(before.lastSequence);
      await postTurn().expect(409);
      expect(
        (
          await prisma.proboxAiTurn.findUniqueOrThrow({
            where: { id: accepted.turnId },
          })
        ).prompt,
      ).toBe("Follow up");
    });
    it("does not rewrite another live owner during REST or Telegram startup", async () => {
      await startControlled();
      const before = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const fresh = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      await fresh.reconcileExpiredRuns();
      const relay = new TelegramSessionRelay(
        prisma as any,
        { configured: true } as any,
        {} as any,
        {} as any,
        fresh,
      );
      await relay.onModuleInit();
      relay.onModuleDestroy();
      const after = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(after.runOwner).toBe(before.runOwner);
      expect(after.status).toBe("RUNNING");
    });
    it("cannot renew an already expired lease even when racing recovery", async () => {
      const accepted = await startControlled();
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { runLeaseExpiresAt: new Date(0) },
      });
      await Promise.all([
        (sessions as any).renewLease(sessionId, accepted.turnId),
        sessions.reconcileExpiredRuns(),
      ]);
      expect(
        (
          await prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).status,
      ).toBe("INTERRUPTED");
    });
    it("rechecks authorization before spawn after durable acceptance", async () => {
      const launch = jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementationOnce(() => undefined);
      const accepted = (await postTurn().expect(202)).body;
      launch.mockRestore();
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: "sessions.manage" },
      });
      await (sessions as any).runAcceptedTurn(sessionId, accepted.turnId);
      expect(runner.start).not.toHaveBeenCalled();
      expect((await eventHistory().expect(200)).body.session).toMatchObject({
        status: "FAILED",
        stopConfirmation: "NOT_STARTED",
        recoveryReason: "AUTHORIZATION_LOST",
      });
    });
    it("aggregates task status without overwriting another active or newer session", async () => {
      await startControlled();
      const second = await sessions.create(owner, {
        taskId,
        cwd: root,
        sandbox: "read-only",
        prompt: "Second",
        providerId: "openai",
      } as any);
      await until(async () => pending.has(second.id));
      await finish(1);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("RUNNING");
      pending.get(second.id)!.resolve(0);
      await until(
        async () =>
          (
            await prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: second.id },
            })
          ).status === "COMPLETED",
      );
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("COMPLETED");
    });
    it("persists interruption before signalling, deduplicates retries and rejects old targets", async () => {
      const accepted = await startControlled();
      runner.interrupt.mockImplementation((id) => {
        expect(id).toBe(sessionId);
        return true;
      });
      const first = await sessions.interrupt(owner, sessionId, accepted.turnId);
      const repeat = await sessions.interrupt(
        owner,
        sessionId,
        accepted.turnId,
      );
      expect(repeat.requestedAt).toEqual(first.requestedAt);
      expect(runner.interrupt).toHaveBeenCalledTimes(1);
      await finish();
      pending.delete(sessionId);
      await startControlled();
      await expect(
        sessions.interrupt(owner, sessionId, accepted.turnId),
      ).rejects.toMatchObject({ status: 409 });
      expect(runner.interrupt).toHaveBeenCalledTimes(1);
    });
    it("does not signal when interruption intent rolls back", async () => {
      const accepted = await startControlled();
      const original = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((
        fn: any,
      ) =>
        original(async (tx: any) => {
          tx.sessionEvent.create = async () => {
            throw Error("Injected intent failure");
          };
          return fn(tx);
        })) as any);
      await expect(
        sessions.interrupt(owner, sessionId, accepted.turnId),
      ).rejects.toMatchObject({ status: 503 });
      spy.mockRestore();
      expect(runner.interrupt).not.toHaveBeenCalled();
      expect(
        (
          await prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).interruptRequestedAt,
      ).toBeNull();
    });
    it("cancels queued work before spawn and requires a concrete target", async () => {
      const launch = jest
        .spyOn(sessions as any, "launchAccepted")
        .mockImplementationOnce(() => undefined);
      const accepted = (await postTurn().expect(202)).body;
      launch.mockRestore();
      await http()
        .post(`/sessions/${sessionId}/interrupt`)
        .set("Authorization", "Bearer " + owner)
        .send({})
        .expect(400);
      const r = await sessions.interrupt(owner, sessionId, accepted.turnId);
      expect(r).toMatchObject({
        interrupted: false,
        stopConfirmation: "NOT_STARTED",
      });
      await (sessions as any).runAcceptedTurn(sessionId, accepted.turnId);
      expect(runner.start).not.toHaveBeenCalled();
    });
    it("streams persisted replay and later commits once, then stops on grant loss", async () => {
      await startControlled();
      const events: any[] = [];
      let streamError: any;
      const sub = sessions
        .stream(owner, sessionId, 0, Date.now() + 5000)
        .subscribe({
          next: (e) => events.push(e),
          error: (e) => {
            streamError = e;
          },
        });
      await until(async () => events.length === 2);
      await pending.get(sessionId)!.event({
        type: "item.completed",
        payload: {
          item: {
            id: "command",
            type: "command_execution",
            command: "git diff --check",
            status: "completed",
            exit_code: 0,
            aggregated_output: "private stream output",
          },
        },
        rawLine: "raw",
      });
      await until(async () => events.length === 3);
      expect(events.map((e) => e.id)).toEqual(["1", "2", "3"]);
      expect(events[2].data).not.toHaveProperty("actor");
      expect(events[2].data.data.commandDetails).toMatchObject({
        commandLabel: "git diff --check",
        exitCode: 0,
        outputState: "OMITTED",
      });
      expect(JSON.stringify(events)).not.toContain("private stream output");
      const rest = (await eventHistory(owner, "?after=2").expect(200)).body;
      expect(JSON.parse(JSON.stringify(events[2].data))).toEqual(
        rest.events[0],
      );
      const replay: any[] = [];
      const reconnect = sessions
        .stream(owner, sessionId, 2, Date.now() + 5000)
        .subscribe({ next: (e) => replay.push(e) });
      await until(async () => replay.length === 1);
      expect(JSON.parse(JSON.stringify(replay[0].data))).toEqual(
        rest.events[0],
      );
      reconnect.unsubscribe();
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: "sessions.read" },
      });
      await until(async () => Boolean(streamError));
      expect(streamError.status).toBe(403);
      sub.unsubscribe();
    });
    it("omits unverified live partial text and does not turn item completion into successful run completion", async () => {
      await startControlled();
      const emit = pending.get(sessionId)!.event;
      await emit({
        type: "item.updated",
        payload: {
          item: {
            id: "answer",
            type: "agent_message",
            text: "unverified fragment",
          },
        },
        rawLine: "private",
      });
      await emit({
        type: "item.completed",
        payload: {
          item: {
            id: "answer",
            type: "agent_message",
            text: "a".repeat(20000),
          },
        },
        rawLine: "private",
      });
      await finish(9);
      const h = (await eventHistory().expect(200)).body;
      expect(h.session.status).toBe("FAILED");
      expect(h.events[2]).toMatchObject({
        type: "runner.omitted",
        data: { omissionReason: "UNSUPPORTED_EVENT" },
      });
      expect(h.events[3].data).toMatchObject({
        truncated: true,
        textUpdate: {
          phase: "ITEM_COMPLETED",
          continuation: "TRUNCATED",
          runCompletion: "USE_SERVER_STATE",
        },
      });
      expect(JSON.stringify(h)).not.toContain("unverified fragment");
    });

    it("binds a late old heartbeat to its old turn rather than a replacement runner", async () => {
      const old = await startControlled();
      await finish();
      pending.delete(sessionId);
      const current = await startControlled();
      runner.interrupt.mockClear();
      runner.interrupt.mockImplementation(
        (_id, target) => target === current.turnId,
      );
      await (sessions as any).renewLease(sessionId, old.turnId);
      expect(runner.interrupt).toHaveBeenCalledWith(sessionId, old.turnId);
      expect(runner.interrupt.mock.results[0]!.value).toBe(false);
      const state = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(state.status).toBe("RUNNING");
      expect(state.interruptRequestedAt).toBeNull();
    });
    it("holds a fixed history boundary while later events arrive", async () => {
      await startControlled();
      const first = (await eventHistory(owner, "?limit=1").expect(200)).body;
      await pending.get(sessionId)!.event({
        type: "item.completed",
        payload: { item: { type: "agent_message", text: "Later" } },
        rawLine: "raw",
      });
      const next = (
        await eventHistory(
          owner,
          `?after=1&untilSequence=${first.highWaterSequence}`,
        ).expect(200)
      ).body;
      expect(next.highWaterSequence).toBe(first.highWaterSequence);
      expect(next.events.map((e: any) => e.sequence)).toEqual([2]);
      expect(next.hasMore).toBe(false);
      expect(next.session.lastSequence).toBe(3);
    });
    it("lets the owning executor consume a remote interruption intent", async () => {
      const accepted = await startControlled();
      const remote = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      const outcome = await remote.interrupt(owner, sessionId, accepted.turnId);
      expect(outcome.interrupted).toBe(false);
      expect(runner.interrupt).not.toHaveBeenCalled();
      await (sessions as any).renewLease(sessionId, accepted.turnId);
      expect(runner.interrupt).toHaveBeenCalledWith(sessionId, accepted.turnId);
      expect(
        (
          await prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: sessionId },
          })
        ).interruptSignalAcceptedAt,
      ).not.toBeNull();
      await finish();
      expect((await readTurn(accepted.requestId)).body.status).toBe(
        "INTERRUPTED",
      );
    });
    it("rejects spawn when intent commits after claim but before child registration", async () => {
      let registered: any;
      let release!: () => void;
      const wait = new Promise<void>((r) => (release = r));
      runner.start.mockImplementation(async (options) => {
        registered = options;
        await wait;
        return (await options.beforeSpawn()) ? 0 : -1;
      });
      const accepted = (await postTurn().expect(202)).body;
      await until(async () => Boolean(registered));
      const remote = new SessionsService(
        prisma as any,
        runner as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      await remote.interrupt(owner, sessionId, accepted.turnId);
      expect(await registered.beforeSpawn()).toBe(false);
      release();
      await until(
        async () =>
          (
            await prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: sessionId },
            })
          ).status === "INTERRUPTED",
      );
      expect(runner.interrupt).not.toHaveBeenCalled();
    });
    it("blocks contextual deletion instead of letting project ownership interrupt another manager's work", async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { cwd: path.join(root, project.directoryName) },
      });
      await startControlled();
      await prisma.task.update({
        where: { id: taskId },
        data: { managerId: member },
      });
      await http()
        .post(`/projects/${projectId}/deletion-requests`)
        .set("Authorization", "Bearer " + owner)
        .expect(409);
      expect(
        await prisma.projectDeletionRequest.count({ where: { projectId } }),
      ).toBe(0);
      expect(runner.interrupt).not.toHaveBeenCalled();
      const state = await prisma.proboxAiSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(state.interruptRequestedAt).toBeNull();
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
          .status,
      ).toBe("READY");
      await finish();
    });
    it("validates SSE cursors and reconnects from Last-Event-ID over real HTTP", async () => {
      await startControlled();
      await http()
        .get(`/sessions/${sessionId}/events/stream`)
        .set("Authorization", "Bearer " + owner)
        .set("Last-Event-ID", "invalid")
        .expect(400);
      await http()
        .get(`/sessions/${sessionId}/events/stream?after=1`)
        .set("Authorization", "Bearer " + owner)
        .set("Last-Event-ID", "2")
        .expect(400);
      const port = app.getHttpServer().address().port;
      const frame = await new Promise<string>((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path: `/sessions/${sessionId}/events/stream`,
            headers: { Authorization: "Bearer " + owner, "Last-Event-ID": "1" },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk.toString();
              if (body.includes("data:") && body.includes("\n\n")) {
                req.destroy();
                resolve(body);
              }
            });
            res.on("error", (error) => {
              if (!body) reject(error);
            });
          },
        );
        req.on("error", reject);
        req.setTimeout(3000, () => {
          req.destroy();
          reject(Error("SSE timeout"));
        });
        req.end();
      });
      expect(frame).toContain("id: 2");
      expect(frame).not.toContain("id: 1");
      expect(frame).toContain('"source":"SERVER"');
      expect(frame).not.toContain('"actor"');
    });
    it("closes a stream at token expiry without delivering additional output", async () => {
      await startControlled();
      let complete = false;
      const events: any[] = [];
      const sub = sessions
        .stream(owner, sessionId, 0, Date.now() + 100)
        .subscribe({
          next: (e) => events.push(e),
          complete: () => {
            complete = true;
          },
        });
      await until(async () => complete);
      expect(events.length).toBe(2);
      sub.unsubscribe();
    });
    it("redacts request secrets and supports reload through approval, token expiry and cancel", async () => {
      const r = await requestDeletion();
      expect(r.nextAction).toBe("OWNER_APPROVAL");
      expect(r).not.toHaveProperty("tokenHash");
      expect(r).not.toHaveProperty("tokenAttempts");
      expect((await history(member, r.id).expect(200)).body.request.id).toBe(
        r.id,
      );
      await approve(r.id, member).expect(403);
      const approved = (await approve(r.id).expect(201)).body;
      expect(approved.nextAction).toBe("CONFIRM_TOKEN");
      expect(approved.tokenSent).toBe(true);
      expect(JSON.stringify(approved)).not.toContain("tokenHash");
      await prisma.projectDeletionRequest.update({
        where: { id: r.id },
        data: {
          tokenExpiresAt: new Date(0),
          tokenAttempts: 5,
          failure: root + "/secret",
        },
      });
      const state = (await history(owner, r.id).expect(200)).body;
      expect(state.request.nextAction).toBe("REISSUE_TOKEN");
      expect(JSON.stringify(state)).not.toContain(root);
      const cancelled = (
        await http()
          .post(`/projects/${projectId}/deletion-requests/${r.id}/cancel`)
          .set("Authorization", "Bearer " + member)
          .expect(201)
      ).body;
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled).not.toHaveProperty("tokenHash");
    });
    it("reads legacy active-session decisions without exposing cwd but refuses further contextual deletion actions", async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      await prisma.proboxAiSession.update({
        where: { id: sessionId },
        data: { status: "PAUSED", cwd: path.join(root, project.directoryName) },
      });
      const r = await prisma.projectDeletionRequest.create({
        data: {
          projectId,
          requestedById: owner,
          ownerId: owner,
          status: "AWAITING_ACTIVE_SESSIONS",
        },
      });
      const state = (await history(owner, r.id).expect(200)).body;
      expect(state.request.activeSessions).toEqual([
        { id: sessionId, status: "PAUSED" },
      ]);
      expect(JSON.stringify(state)).not.toContain(root);
      await approve(r.id).expect(409);
      await http()
        .post(
          `/projects/${projectId}/deletion-requests/${r.id}/active-sessions`,
        )
        .set("Authorization", "Bearer " + owner)
        .send({ action: "WAIT" })
        .expect(409);
      expect(
        (
          await prisma.projectDeletionRequest.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).activeSessionAction,
      ).toBeNull();
    });
    it("confirms with the owner token and reads actual PURGED audit after project/request removal", async () => {
      const r = await requestDeletion();
      await approve(r.id).expect(201);
      const token = telegram.sendText.mock.calls.at(-1)![1].split(": ").at(-1)!;
      const confirmed = (
        await http()
          .post(`/projects/${projectId}/deletion-requests/${r.id}/confirm`)
          .set("Authorization", "Bearer " + owner)
          .send({ token })
          .expect(201)
      ).body;
      expect(confirmed.status).toBe("PURGED");
      expect(confirmed.projectRemoved).toBe(true);
      const state = (await history(member, r.id).expect(200)).body;
      expect(state).toEqual(
        expect.objectContaining({
          projectRemoved: true,
          request: null,
          audit: expect.objectContaining({
            status: "PURGED",
            id: confirmed.deletionAuditId,
          }),
        }),
      );
      const fresh = new ProjectsService(
        prisma as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
      );
      expect(
        (
          await fresh.deletionHistory(
            { id: owner, workspaceId: w } as any,
            projectId,
            r.id,
          )
        ).projectRemoved,
      ).toBe(true);
      expect(JSON.stringify(state)).not.toContain("quarantinePath");
      expect(JSON.stringify(state)).not.toContain("snapshot");
    });
    it("reports cleanup failure and preserves durable authorization without raw errors or paths", async () => {
      const r = await requestDeletion();
      await approve(r.id).expect(201);
      const token = telegram.sendText.mock.calls.at(-1)![1].split(": ").at(-1)!;
      const spy = jest
        .spyOn(fs, "rm")
        .mockRejectedValueOnce(new Error(root + "/private-secret"));
      const result = (
        await http()
          .post(`/projects/${projectId}/deletion-requests/${r.id}/confirm`)
          .set("Authorization", "Bearer " + owner)
          .send({ token })
          .expect(201)
      ).body;
      spy.mockRestore();
      expect(result.status).toBe("PURGE_FAILED");
      const state = (await history(owner, r.id).expect(200)).body;
      expect(state.audit.failureCode).toBe("PURGE_FAILED");
      expect(JSON.stringify(state)).not.toContain(root);
      await history(outsider, r.id).expect(404);
      await history(denied, r.id).expect(403);
      await history(foreign, r.id).expect(403);
      await prisma.userRoleAssignment.deleteMany({ where: { userId: owner } });
      await prisma.user.update({
        where: { id: owner },
        data: { workspaceId: foreignW },
      });
      await expect(
        projects.deletionHistory(
          { id: owner, workspaceId: foreignW } as any,
          projectId,
          r.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("does not disclose legacy audits with unknown scope and forbids nonmembers before removal", async () => {
      await history(outsider).expect(403);
      await history(denied).expect(403);
      const audit = await prisma.projectDeletionAudit.create({
        data: {
          projectId,
          projectName: "Fixture",
          directoryName: root,
          departmentId,
          ownerId: owner,
          requestedById: member,
          requestId: randomUUID(),
          status: "PURGE_FAILED",
          snapshot: { secret: "hidden" },
          error: root,
        },
      });
      await prisma.project.delete({ where: { id: projectId } });
      await history(owner, audit.requestId).expect(404);
    });
    it("recovers a quarantine failure through known request readback while the project still exists", async () => {
      const r = await requestDeletion();
      await approve(r.id).expect(201);
      const token = telegram.sendText.mock.calls.at(-1)![1].split(": ").at(-1)!;
      const spy = jest
        .spyOn(fs, "rename")
        .mockRejectedValueOnce(new Error(root + "/private"));
      const error = await http()
        .post(`/projects/${projectId}/deletion-requests/${r.id}/confirm`)
        .set("Authorization", "Bearer " + owner)
        .send({ token })
        .expect(400);
      spy.mockRestore();
      expect(JSON.stringify(error.body)).not.toContain(root);
      const state = (await history(owner, r.id).expect(200)).body;
      expect(state.projectRemoved).toBe(false);
      expect(state.request.status).toBe("DELETING");
      expect(state.request.nextAction).toBe("REVIEW_FAILURE");
      expect(state.audit.nextAction).toBe("REVIEW_FAILURE");
      expect(state.audit.status).toBe("PURGE_FAILED");
      expect(JSON.stringify(state)).not.toContain(root);
    });
    it("reads known older requests independently of the bounded history window", async () => {
      const old = await prisma.projectDeletionRequest.create({
        data: {
          projectId,
          requestedById: member,
          ownerId: owner,
          status: "CANCELLED",
          requestedAt: new Date(0),
        },
      });
      await prisma.projectDeletionRequest.createMany({
        data: Array.from({ length: 101 }, () => ({
          projectId,
          requestedById: member,
          ownerId: owner,
          status: "CANCELLED" as const,
        })),
      });
      const recent = (await history(owner).expect(200)).body;
      expect(recent.requests).toHaveLength(100);
      expect(recent.limit).toBe(100);
      expect(recent.requests.map((r: any) => r.id)).not.toContain(old.id);
      expect((await history(owner, old.id).expect(200)).body.request.id).toBe(
        old.id,
      );
    });
    it("migration backfills resource scope from the department and leaves unprovable scope null", async () => {
      const base = {
        projectId,
        projectName: "Fixture",
        directoryName: "private",
        ownerId: foreign,
        requestedById: member,
        requestId: randomUUID(),
        status: "PURGE_FAILED",
        snapshot: {},
      };
      const known = await prisma.projectDeletionAudit.create({
        data: { ...base, departmentId },
      });
      const unknown = await prisma.projectDeletionAudit.create({
        data: { ...base, departmentId: randomUUID() },
      });
      const migration = await fs.readFile(
        path.join(
          process.cwd(),
          "prisma/migrations/20261011070000_session_acceptance_deletion_scope/migration.sql",
        ),
        "utf8",
      );
      const backfill = migration.slice(
        migration.indexOf('UPDATE "ProjectDeletionAudit"'),
        migration.indexOf('CREATE INDEX "ProjectDeletionAudit_workspaceId'),
      );
      await prisma.$executeRawUnsafe(backfill);
      expect(
        (
          await prisma.projectDeletionAudit.findUniqueOrThrow({
            where: { id: known.id },
          })
        ).workspaceId,
      ).toBe(w);
      expect(
        (
          await prisma.projectDeletionAudit.findUniqueOrThrow({
            where: { id: unknown.id },
          })
        ).workspaceId,
      ).toBeNull();
      await prisma.projectDeletionAudit.deleteMany({
        where: { id: { in: [known.id, unknown.id] } },
      });
    });
    it("preserves owner-only token confirmation and validates route IDs", async () => {
      const r = await requestDeletion();
      await approve(r.id).expect(201);
      await http()
        .post(`/projects/${projectId}/deletion-requests/${r.id}/confirm`)
        .set("Authorization", "Bearer " + member)
        .send({ token: "wrong" })
        .expect(403);
      await http()
        .post(`/projects/${projectId}/deletion-requests/${r.id}/confirm`)
        .set("Authorization", "Bearer " + owner)
        .send({ token: "wrong" })
        .expect(403);
      expect(
        (
          await prisma.projectDeletionRequest.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).tokenAttempts,
      ).toBe(1);
      await http()
        .get("/projects/invalid/deletion-requests")
        .set("Authorization", "Bearer " + owner)
        .expect(400);
      await history(owner, randomUUID()).expect(404);
    });
    it("documents actual status codes and strict allowlisted response shapes", async () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/sessions/{id}/turns"]?.post?.responses?.["202"],
      ).toBeDefined();
      expect(
        doc.paths["/sessions/{id}/interrupt"]?.post?.responses?.["200"],
      ).toBeDefined();
      const schemas: any = doc.components!.schemas;
      expect(doc.paths["/sessions"]?.get?.responses["200"]).toBeDefined();
      expect(
        schemas.SessionListResponseDto.properties.items.items.$ref,
      ).toContain("SessionListItemDto");
      expect(Object.keys(schemas.SessionListItemDto.properties).sort()).toEqual(
        [
          "createdAt",
          "id",
          "status",
          "stopConfirmation",
          "task",
          "taskId",
          "updatedAt",
        ],
      );
      expect(schemas.SessionListItemDto.required).not.toContain("task");
      expect(schemas.RequestInterruptDto.required).toContain("turnId");
      expect(schemas.PersistedSessionEventDto.properties).toHaveProperty(
        "sequence",
      );
      expect(schemas.PersistedSessionEventDto.properties.source.enum).toEqual([
        "SERVER",
        "RUNNER",
      ]);
      expect(schemas.AssistantTextUpdateDto.properties.mode.enum).toEqual([
        "SNAPSHOT",
        "UNVERIFIED_FRAME",
      ]);
      expect(schemas.CommandDisclosureDto.properties.policy.enum).toEqual([
        "STRICT_ALLOWLIST_V1",
      ]);
      expect(schemas.CommandDisclosureDto.properties.provisional.enum).toEqual([
        true,
      ]);
      expect(schemas.CommandDisclosureDto.properties.outputState.enum).toEqual([
        "OMITTED",
      ]);
      expect(
        schemas.PersistedSessionEventDto.properties.data.properties
          .commandDetails.allOf[0].$ref,
      ).toContain("CommandDisclosureDto");
      expect(
        schemas.AssistantTextUpdateDto.properties.runCompletion.enum,
      ).toEqual(["USE_SERVER_STATE"]);
      expect(
        schemas.PersistedSessionEventDto.properties.data.properties.textUpdate
          .allOf[0].$ref,
      ).toContain("AssistantTextUpdateDto");
      expect(
        schemas.SessionHistoryResponseDto.properties.events.items.$ref,
      ).toContain("PersistedSessionEventDto");
      expect(
        doc.paths["/sessions/{id}/events"]?.get?.parameters?.map(
          (p: any) => p.name,
        ),
      ).toEqual(expect.arrayContaining(["after", "limit", "untilSequence"]));
      expect(schemas.TurnAcceptanceResponseDto.required).toContain("requestId");
      expect(
        schemas.ProjectDeletionRequestResponseDto.properties,
      ).not.toHaveProperty("tokenHash");
      expect(
        schemas.ProjectDeletionAuditResponseDto.properties,
      ).not.toHaveProperty("quarantinePath");
      expect(
        schemas.ProjectDeletionAuditResponseDto.properties,
      ).not.toHaveProperty("error");
      expect(schemas.CreatedSessionResponseDto.properties).not.toHaveProperty(
        "catalogSnapshot",
      );
    });
  },
);
