import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { AuthorizationController } from "../src/authorization/authorization.controller";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { DepartmentsService } from "../src/departments/departments.service";
import { TasksController } from "../src/tasks/tasks.controller";
import { TasksService } from "../src/tasks/tasks.service";
import { SessionsController } from "../src/sessions/sessions.controller";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
const request = require("supertest");

const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated loopback profile_test database");
}

(databaseUrl ? describe : describe.skip)(
  "real login through existing session setup (no execution)",
  () => {
    let app: INestApplication, prisma: PrismaClient, root: string;
    let workspace: string,
      foreignWorkspace: string,
      manager: string,
      peer: string,
      foreign: string;
    let role: string,
      project: string,
      publicProject: string,
      foreignProject: string;
    let task: string, peerTask: string, foreignTask: string, directory: string;
    let token: string,
      peerToken: string,
      foreignToken: string,
      username: string;
    let createSession: jest.SpyInstance;
    const jwt = new JwtService({
      secret: "isolated-login-setup-test-signing-key",
    });
    const password = "Synthetic-Fixture-42!";
    const salt = Buffer.from("login-setup-test-salt");
    const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")}`;
    const grants = ["projects.read", "tasks.read", "sessions.create"];
    const runner = {
      start: jest.fn(() => {
        throw new Error("Runner forbidden in setup suite");
      }),
      interrupt: jest.fn(),
    };
    const telegram = { sendMessage: jest.fn(), sendOtp: jest.fn() };
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    const api = () => request(app.getHttpServer());
    const get = (route: string, access = token) =>
      api().get(`/api/v1${route}`).set("Authorization", `Bearer ${access}`);
    const preflight = (body: object, access = token) =>
      api()
        .post("/api/v1/sessions/directory-preflight")
        .set("Authorization", `Bearer ${access}`)
        .send(body);
    const context = (projectId = project, taskId = task, access = token) =>
      get(`/sessions/projects/${projectId}/execution-context`, access).query({
        taskId,
        sandbox: "read-only",
      });
    async function login(name = username) {
      const result = await api()
        .post("/api/v1/auth/login")
        .send({ username: name, password })
        .expect(200);
      return result.body as { accessToken: string; refreshToken: string };
    }
    const protectedReads = () => [
      "/users/me",
      "/authorization/me",
      "/projects",
      "/tasks",
      "/sessions/model-catalog",
      `/sessions/projects/${project}/execution-context?taskId=${task}`,
    ];

    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-login-setup-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
      workspace = (
        await prisma.workspace.create({
          data: { slug: `setup-${randomUUID()}` },
        })
      ).id;
      foreignWorkspace = (
        await prisma.workspace.create({
          data: { slug: `setup-foreign-${randomUUID()}` },
        })
      ).id;
      await prisma.permission.createMany({
        data: grants.map((key) => ({
          key,
          name: key,
          description: "setup test",
          category: "test",
        })),
        skipDuplicates: true,
      });
      async function user(workspaceId: string) {
        const name = `setup-${randomUUID().slice(0, 16)}`;
        const record = await prisma.user.create({
          data: {
            workspaceId,
            username: name,
            phoneNumber: `fixture-${randomUUID()}`,
            fullName: "Synthetic setup user",
            firstName: "Synthetic",
            passwordHash,
            status: "OPEN",
            roleAssignments: {
              create: {
                role: {
                  create: {
                    workspaceId,
                    key: name,
                    name: "Setup fixture",
                    permissions: {
                      create: grants.map((permissionKey) => ({
                        permissionKey,
                      })),
                    },
                  },
                },
              },
            },
          },
          include: { roleAssignments: true },
        });
        return {
          id: record.id,
          name,
          roleId: record.roleAssignments[0]!.roleId,
        };
      }
      const caller = await user(workspace);
      manager = caller.id;
      username = caller.name;
      role = caller.roleId;
      const other = await user(workspace);
      peer = other.id;
      const outside = await user(foreignWorkspace);
      foreign = outside.id;
      async function makeProject(
        workspaceId: string,
        owner: string,
        member: boolean,
        isPublic = false,
      ) {
        const home = path.join(root, workspaceId);
        await fs.mkdir(home, { recursive: true });
        const department = await prisma.department.create({
          data: {
            workspaceId,
            name: "Setup fixture",
            slug: `dept-${randomUUID()}`,
            homePath: home,
          },
        });
        const dir = `project-${randomUUID()}`;
        await fs.mkdir(path.join(home, dir));
        return prisma.project.create({
          data: {
            workspaceId,
            departmentId: department.id,
            creatorId: owner,
            name: "Setup project",
            directoryName: dir,
            status: "READY",
            readAccessEnabled: isPublic,
            ...(member ? { members: { create: { userId: owner } } } : {}),
          },
        });
      }
      const own = await makeProject(workspace, manager, true);
      project = own.id;
      directory = path.join(root, workspace, own.directoryName);
      publicProject = (await makeProject(workspace, peer, true, true)).id;
      foreignProject = (await makeProject(foreignWorkspace, foreign, true)).id;
      async function makeTask(workspaceId: string, owner: string) {
        return (
          await prisma.task.create({
            data: {
              workspaceId,
              creatorId: owner,
              managerId: owner,
              title: "Synthetic setup task",
              description: "Never execute",
            },
          })
        ).id;
      }
      task = await makeTask(workspace, manager);
      peerTask = await makeTask(workspace, peer);
      foreignTask = await makeTask(foreignWorkspace, foreign);
      const module = await Test.createTestingModule({
        controllers: [
          AuthController,
          AccountsController,
          AuthorizationController,
          ProjectsController,
          TasksController,
          SessionsController,
        ],
        providers: [
          AuthService,
          AccountsService,
          AuthorizationService,
          ProjectsService,
          TasksService,
          SessionsService,
          SessionEventsService,
          ModelCatalogService,
          WorkspacePathPolicy,
          { provide: PrismaService, useValue: prisma },
          { provide: JwtService, useValue: jwt },
          { provide: DepartmentsService, useValue: {} },
          { provide: ProjectInitializationService, useValue: {} },
          { provide: ProboxAiRunner, useValue: runner },
          { provide: TelegramService, useValue: telegram },
          { provide: TelegramBotService, useValue: {} },
        ],
      }).compile();
      // Disable background maintenance only, never auth, guards or setup operations.
      jest
        .spyOn(module.get(ProjectsService), "onModuleInit")
        .mockImplementation(() => {});
      jest
        .spyOn(module.get(SessionsService), "onModuleInit")
        .mockResolvedValue(undefined);
      createSession = jest.spyOn(module.get(SessionsService), "create");
      app = module.createNestApplication();
      app.setGlobalPrefix("api/v1");
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
      token = (await login()).accessToken;
      peerToken = (await login(other.name)).accessToken;
      foreignToken = (await login(outside.name)).accessToken;
    }, 30000);

    beforeEach(async () => {
      await prisma.user.update({
        where: { id: manager },
        data: { status: "OPEN" },
      });
      await prisma.rolePermission.createMany({
        data: grants.map((permissionKey) => ({ roleId: role, permissionKey })),
        skipDuplicates: true,
      });
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project, userId: manager } },
        create: { projectId: project, userId: manager },
        update: {},
      });
      await prisma.project.update({
        where: { id: project },
        data: { status: "READY", archivedAt: null },
      });
      await prisma.task.update({
        where: { id: task },
        data: { managerId: manager },
      });
    });
    afterEach(async () => {
      expect(createSession).not.toHaveBeenCalled();
      expect(runner.start).not.toHaveBeenCalled();
      expect(runner.interrupt).not.toHaveBeenCalled();
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(telegram.sendOtp).not.toHaveBeenCalled();
      expect(
        await prisma.proboxAiSession.count({
          where: { workspaceId: { in: [workspace, foreignWorkspace] } },
        }),
      ).toBe(0);
      expect(
        await prisma.proboxAiTurn.count({
          where: {
            session: { workspaceId: { in: [workspace, foreignWorkspace] } },
          },
        }),
      ).toBe(0);
    });
    afterAll(async () => {
      await app?.close();
      jest.restoreAllMocks();
      const workspaces = [workspace, foreignWorkspace].filter(Boolean);
      if (prisma && workspaces.length) {
        await prisma.project.deleteMany({
          where: { workspaceId: { in: workspaces } },
        });
        await prisma.task.deleteMany({
          where: { workspaceId: { in: workspaces } },
        });
        await prisma.department.deleteMany({
          where: { workspaceId: { in: workspaces } },
        });
        await prisma.user.deleteMany({
          where: { workspaceId: { in: workspaces } },
        });
        await prisma.role.deleteMany({
          where: { workspaceId: { in: workspaces } },
        });
        await prisma.workspace.deleteMany({
          where: { id: { in: workspaces } },
        });
      }
      await prisma?.$disconnect();
      if (priorRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoots;
      if (root) {
        const resolved = path.resolve(root);
        if (
          !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
          !path.basename(resolved).startsWith("proboxai-login-setup-")
        )
          throw new Error("Unsafe fixture cleanup");
        await fs.rm(resolved, { recursive: true, force: true });
      }
    });

    it("uses real password verification and JWT issuance; refresh values persist only as hashes", async () => {
      await api()
        .post("/api/v1/auth/login")
        .send({ username, password: "wrong" })
        .expect(401);
      const auth = await login();
      expect(jwt.verify(auth.accessToken)).toMatchObject({
        id: manager,
        workspaceId: workspace,
        type: "access",
      });
      const record = await prisma.sessionToken.findUniqueOrThrow({
        where: {
          tokenHash: createHash("sha256")
            .update(auth.refreshToken)
            .digest("hex"),
        },
      });
      expect(record).toMatchObject({
        userId: manager,
        purpose: "REFRESH",
        revokedAt: null,
      });
      expect(JSON.stringify(record)).not.toContain(auth.refreshToken);
    });
    it("connects login to authoritative self/grants, scoped discovery, actual catalog and valid preflight", async () => {
      const self = await get("/users/me").expect(200);
      expect(self.body).toMatchObject({
        id: manager,
        workspaceId: workspace,
        displayName: "Synthetic",
      });
      const me = await get("/authorization/me").expect(200);
      expect(me.body).toMatchObject({
        id: manager,
        workspaceId: workspace,
        permissions: [...grants].sort(),
      });
      expect(self.headers["cache-control"]).toBe("no-store");
      expect(me.headers["cache-control"]).toBe("no-store");
      const projects = await get("/projects").expect(200);
      expect(projects.body.map((p: any) => p.id).sort()).toEqual(
        [project, publicProject].sort(),
      );
      expect(projects.body.find((p: any) => p.id === project).isMember).toBe(
        true,
      );
      const tasks = await get("/tasks").expect(200);
      expect(tasks.body.map((t: any) => t.id)).toEqual([task]);
      expect(tasks.body[0].sessions).toEqual([]);
      await get(`/tasks/${task}`).expect(200);
      const catalog = await get("/sessions/model-catalog").expect(200);
      expect(catalog.body.providers).toEqual(new ModelCatalogService().list());
      for (const provider of catalog.body.providers)
        for (const model of provider.models)
          expect(model.supportedReasoningEfforts).toContain(
            model.defaultReasoningEffort,
          );
      const execution = await context().expect(200);
      expect(execution.body).toMatchObject({
        valid: true,
        normalizedPath: await fs.realpath(directory),
        reason: null,
        revalidateAtLaunch: true,
        capabilities: { canStartSession: true, requiresAssignedTask: false },
      });
      expect(execution.headers["cache-control"]).toBe("no-store");
      const ready = await preflight({
        taskId: task,
        projectId: project,
        sandbox: "read-only",
      }).expect(200);
      expect(ready.body).toMatchObject({
        valid: true,
        normalizedPath: execution.body.normalizedPath,
        revalidateAtLaunch: true,
      });
      expect(ready.headers["cache-control"]).toBe("no-store");
    });
    it("requires real, unexpired access credentials for every setup endpoint", async () => {
      const expired = jwt.sign(
        { id: manager, workspaceId: workspace, type: "access" },
        { expiresIn: -1 },
      );
      for (const route of protectedReads()) {
        await api().get(`/api/v1${route}`).expect(401);
        await get(route, expired).expect(401);
        await get(route, "forged").expect(401);
      }
      await api()
        .post("/api/v1/sessions/directory-preflight")
        .send({ taskId: task, projectId: project })
        .expect(401);
    });
    it("rereads revoked grants without revoking self identity or requiring a new login", async () => {
      await prisma.rolePermission.deleteMany({ where: { roleId: role } });
      await get("/users/me").expect(200);
      const me = await get("/authorization/me").expect(200);
      expect(me.body.permissions).toEqual([]);
      for (const route of protectedReads().slice(2))
        await get(route).expect(403);
      await preflight({ taskId: task, projectId: project }).expect(403);
    });
    it("rejects a closed account's already-issued token and password login", async () => {
      await prisma.user.update({
        where: { id: manager },
        data: { status: "BANNED" },
      });
      for (const route of protectedReads()) await get(route).expect(401);
      await preflight({ taskId: task, projectId: project }).expect(401);
      await api()
        .post("/api/v1/auth/login")
        .send({ username, password })
        .expect(401);
    });
    it("isolates foreign workspace and other-manager tasks across discovery and setup", async () => {
      const projects = await get("/projects", foreignToken).expect(200);
      expect(projects.body.map((p: any) => p.id)).toEqual([foreignProject]);
      const tasks = await get("/tasks", foreignToken).expect(200);
      expect(tasks.body.map((t: any) => t.id)).toEqual([foreignTask]);
      for (const id of [peerTask, foreignTask])
        await get(`/tasks/${id}`).expect(404);
      await get(`/projects/${foreignProject}`).expect(404);
      await context(foreignProject).expect(404);
      await context(project, foreignTask).expect(404);
      await preflight({ taskId: foreignTask, projectId: project }).expect(404);
      await preflight({ taskId: task, projectId: foreignProject }).expect(404);
      await context(project, task, peerToken).expect(403);
    });
    it("does not infer execution rights from a visible public project or a stale membership", async () => {
      const projects = await get("/projects").expect(200);
      expect(
        projects.body.find((p: any) => p.id === publicProject).isMember,
      ).toBe(false);
      await context(publicProject).expect(403);
      await preflight({ taskId: task, projectId: publicProject }).expect(403);
      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId: project, userId: manager } },
      });
      await context().expect(403);
      await preflight({ taskId: task, projectId: project }).expect(403);
      await prisma.task.update({
        where: { id: task },
        data: { managerId: peer },
      });
      await get(`/tasks/${task}`).expect(404);
      await preflight({ taskId: task, projectId: publicProject }).expect(403);
    });
    it("reports project/directory observations without provisioning or implying execution", async () => {
      await prisma.project.update({
        where: { id: project },
        data: { status: "INITIALIZING" },
      });
      const pending = await context().expect(200);
      expect(pending.body).toMatchObject({
        valid: false,
        reason: "PROJECT_NOT_READY",
        capabilities: { canStartSession: false },
      });
      await prisma.project.update({
        where: { id: project },
        data: { status: "READY" },
      });
      const missing = path.join(directory, "missing");
      const result = await preflight({
        taskId: task,
        projectId: project,
        cwd: missing,
      }).expect(200);
      expect(result.body).toMatchObject({
        valid: false,
        reason: "NOT_FOUND",
        normalizedPath: null,
      });
      await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
      await preflight({ taskId: task, projectId: project, cwd: root })
        .expect(200)
        .expect((r: any) => expect(r.body.reason).toBe("OUTSIDE_PROJECT"));
      await prisma.project.update({
        where: { id: project },
        data: { archivedAt: new Date() },
      });
      await context().expect(409);
    });
    it("rejects identity selectors and unsupported setup input under the production validation pipe", async () => {
      await get("/users/me").query({ userId: peer }).expect(400);
      await get("/authorization/me")
        .query({ workspaceId: foreignWorkspace })
        .expect(400);
      await get("/sessions/model-catalog")
        .query({ providerId: "unknown-provider" })
        .expect(400);
      await preflight({
        taskId: task,
        projectId: project,
        sandbox: "invented",
        userId: peer,
      }).expect(400);
    });
    it("returns sanitized 503 when persisted authentication cannot be checked, then recovers with the same token", async () => {
      const unavailable = jest.spyOn(prisma.user, "findFirst");
      try {
        for (const route of protectedReads()) {
          unavailable.mockRejectedValueOnce(
            new Error("private authentication database endpoint"),
          );
          const result = await get(route).expect(503);
          expect(result.body.message).toBe(
            "Authentication is temporarily unavailable",
          );
          expect(JSON.stringify(result.body)).not.toContain("private");
        }
        unavailable.mockRejectedValueOnce(
          new Error("private authentication database endpoint"),
        );
        await preflight({ taskId: task, projectId: project }).expect(503);
      } finally {
        unavailable.mockRestore();
      }
      await get("/authorization/me").expect(200);
      await context().expect(200);
    });
    it("represents filesystem dependency denial as an invalid preflight without leaking the error", async () => {
      const access = jest.spyOn(fs, "access").mockRejectedValueOnce(
        Object.assign(new Error("private filesystem endpoint"), {
          code: "EACCES",
        }),
      );
      try {
        const result = await preflight({
          taskId: task,
          projectId: project,
        }).expect(200);
        expect(result.body).toMatchObject({
          valid: false,
          reason: "ACCESS_DENIED",
          normalizedPath: null,
        });
        expect(JSON.stringify(result.body)).not.toContain("private filesystem");
      } finally {
        access.mockRestore();
      }
      await context().expect(200);
    });
    it("does not return credentials or sign access after a lost database write acknowledgment", async () => {
      const insert = prisma.sessionToken.create.bind(prisma.sessionToken);
      const before = await prisma.sessionToken.count({
        where: { userId: manager },
      });
      const sign = jest.spyOn(jwt, "sign");
      const loseAcknowledgment = async (
        args: Prisma.SessionTokenCreateArgs,
      ) => {
        await insert(args);
        throw new Prisma.PrismaClientKnownRequestError(
          "lost database acknowledgment",
          { code: "P1017", clientVersion: "6.19.3" },
        );
      };
      // Login only awaits this delegate; its fluent relation API is unused.
      const persistence = jest
        .spyOn(prisma.sessionToken, "create")
        .mockImplementationOnce(loseAcknowledgment as never);
      try {
        const result = await api()
          .post("/api/v1/auth/login")
          .send({ username, password })
          .expect(503);
        expect(result.body).toEqual({
          statusCode: 503,
          message: "Authentication is temporarily unavailable",
          error: "Service Unavailable",
        });
        expect(sign).not.toHaveBeenCalled();
      } finally {
        persistence.mockRestore();
        sign.mockRestore();
      }
      expect(
        await prisma.sessionToken.count({ where: { userId: manager } }),
      ).toBe(before + 1);
    });
    it("sanitizes known login lookup and persistence outages without issuing credentials", async () => {
      const unavailable = {
        statusCode: 503,
        message: "Authentication is temporarily unavailable",
        error: "Service Unavailable",
      };
      const failure = () =>
        new Prisma.PrismaClientKnownRequestError(
          "private database connection",
          { code: "P1017", clientVersion: "6.19.3" },
        );
      const sign = jest.spyOn(jwt, "sign");
      const lookup = jest
        .spyOn(prisma.user, "findUnique")
        .mockRejectedValueOnce(failure());
      try {
        const result = await api()
          .post("/api/v1/auth/login")
          .send({ username, password })
          .expect(503);
        expect(result.body).toEqual(unavailable);
      } finally {
        lookup.mockRestore();
      }
      const before = await prisma.sessionToken.count({
        where: { userId: manager },
      });
      const persistence = jest
        .spyOn(prisma.sessionToken, "create")
        .mockRejectedValueOnce(failure());
      try {
        await api()
          .post("/api/v1/auth/login")
          .send({ username, password })
          .expect(503);
      } finally {
        persistence.mockRestore();
      }
      expect(
        await prisma.sessionToken.count({ where: { userId: manager } }),
      ).toBe(before);
      expect(sign).not.toHaveBeenCalled();
      sign.mockRestore();
      await login();
    });
  },
);
