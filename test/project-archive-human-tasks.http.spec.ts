import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectArchiveController } from "../src/projects/project-archive.controller";
import { ProjectArchiveService } from "../src/projects/project-archive.service";
import { HumanTasksController } from "../src/tasks/human-tasks.controller";
import { HumanTasksService } from "../src/tasks/human-tasks.service";
import { TaskBoardsService } from "../src/tasks/task-boards.service";
import { TaskDeadlinesService } from "../src/tasks/task-deadlines.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import {
  fencedProjectFilesystem,
  lockProjectLifecycle,
} from "../src/projects/project-lifecycle-lock";
import { SystemRoleDefinitions } from "../src/authorization/permission.catalog";
import { applyBootstrapRolePermissions } from "../prisma/bootstrap-role-permissions";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
const request = require("supertest");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test");
}
(url ? describe : describe.skip)(
  "project archival and member human-task prerequisites",
  () => {
    const priorRoot = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT;
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    let app: INestApplication,
      db: PrismaClient,
      root: string,
      w: string,
      foreignW: string,
      owner: string,
      member: string,
      stranger: string,
      outsider: string,
      roleId: string,
      dept: string,
      projectId: string,
      taskId: string;
    const grants = [
      "projects.read",
      "projects.archive",
      "projects.delete",
      "projects.update",
      "projects.files.write",
      "projects.read-all",
      "projects.manage-all",
      "tasks.statuses.manage",
      "tasks.deadlines.manage",
      "tasks.read",
      "tasks.read-all",
      "sessions.create",
      "sessions.manage",
    ];
    const actor = (id = owner) => ({
      id,
      workspaceId: w,
      roles: [],
      permissions: grants,
    });
    const http = () => request(app.getHttpServer());
    const archive = (
      id = owner,
      revision = 0,
      requestId: string = randomUUID(),
    ) =>
      http()
        .post(`/projects/${projectId}/archive`)
        .set("Authorization", "Bearer " + id)
        .set("If-Match", `"${revision}"`)
        .send({ requestId });
    const human = (id = member, task = false) =>
      http()
        .get(`/projects/${projectId}/tasks${task ? "/" + taskId : ""}`)
        .set("Authorization", "Bearer " + id);
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      root = await fs.mkdtemp(path.join(os.tmpdir(), "proboxai-archive-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT = root;
      delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      w = (
        await db.workspace.create({
          data: { slug: "archive-human-http-" + randomUUID() },
        })
      ).id;
      foreignW = (
        await db.workspace.create({
          data: { slug: "archive-human-foreign-" + randomUUID() },
        })
      ).id;
      await db.permission.createMany({
        data: grants.map((key) => ({
          key,
          name: key,
          description: key,
          category: "test",
        })),
        skipDuplicates: true,
      });
      async function user(
        workspaceId: string,
        phoneNumber: string,
        keys: string[],
      ) {
        phoneNumber += randomUUID().slice(0, 8);
        const role = await db.role.create({
          data: {
            workspaceId,
            key: phoneNumber,
            name: "ADMIN",
            permissions: {
              create: keys.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        const u = await db.user.create({
          data: {
            workspaceId,
            phoneNumber,
            fullName: "Archive staff",
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: u.id, roleId: role.id };
      }
      const o = await user(w, "+998909910001", grants);
      owner = o.id;
      roleId = o.roleId;
      member = (await user(w, "+998909910002", [])).id;
      stranger = (await user(w, "+998909910003", grants)).id;
      outsider = (await user(foreignW, "+998909910004", grants)).id;
      dept = (
        await db.department.create({
          data: {
            workspaceId: w,
            name: "Archive",
            slug: "archive",
            homePath: root,
          },
        })
      ).id;
      const projects = new ProjectsService(
        db as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
      );
      const module = await Test.createTestingModule({
        controllers: [
          ProjectsController,
          ProjectArchiveController,
          HumanTasksController,
        ],
        providers: [
          { provide: ProjectsService, useValue: projects },
          ProjectArchiveService,
          HumanTasksService,
          { provide: PrismaService, useValue: db },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({ id, type: "access" }),
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
    });
    beforeEach(async () => {
      await db.rolePermission.createMany({
        data: grants.map((permissionKey) => ({ roleId, permissionKey })),
        skipDuplicates: true,
      });
      await db.user.update({ where: { id: owner }, data: { status: "OPEN" } });
      const project = await db.project.create({
        data: {
          workspaceId: w,
          departmentId: dept,
          creatorId: owner,
          name: "Context",
          directoryName: randomUUID(),
          members: { create: [{ userId: owner }, { userId: member }] },
        },
      });
      projectId = project.id;
      await fs.mkdir(path.join(root, project.directoryName));
      const board = await db.taskBoard.findUniqueOrThrow({
        where: { projectId },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
      taskId = (
        await db.task.create({
          data: {
            workspaceId: w,
            creatorId: owner,
            managerId: stranger,
            title: "Human title",
            description: "Human description",
            criteria: "PRIVATE EXECUTION",
            boardEntry: {
              create: { boardId: board.id, statusId: board.statuses[0]!.id },
            },
          },
        })
      ).id;
    });
    afterEach(async () => {
      if (!w) return;
      await db.proboxAiSession.deleteMany({ where: { workspaceId: w } });
      await db.task.deleteMany({ where: { workspaceId: w } });
      await db.projectArchiveOperation.deleteMany({
        where: { project: { workspaceId: w } },
      });
      await db.project.deleteMany({ where: { workspaceId: w } });
      await db.projectDeletionAudit.deleteMany({ where: { workspaceId: w } });
    });
    afterAll(async () => {
      await app?.close();
      if (w) {
        await db.department.deleteMany({ where: { workspaceId: w } });
        await db.user.deleteMany({
          where: { workspaceId: { in: [w, foreignW] } },
        });
        await db.role.deleteMany({
          where: { workspaceId: { in: [w, foreignW] } },
        });
        await db.workspace.deleteMany({ where: { id: { in: [w, foreignW] } } });
      }
      await db.$disconnect();
      if (priorRoot === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT = priorRoot;
      if (priorRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoots;
      if (
        !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(root).startsWith("proboxai-archive-")
      )
        throw new Error("Unexpected archive test cleanup path");
      await fs.rm(root, { recursive: true, force: true });
    });
    it("membership suffices without task permissions or assignment and exposes only human fields", async () => {
      const list = (await human().expect(200)).body;
      const detail = (await human(member, true).expect(200)).body;
      expect(list).toEqual([detail]);
      expect(detail).toMatchObject({
        id: taskId,
        ownerId: owner,
        title: "Human title",
        completed: null,
        position: 0,
        projectArchivedAt: null,
      });
      expect(Object.keys(detail).sort()).toEqual(
        [
          "id",
          "projectId",
          "title",
          "description",
          "ownerId",
          "statusId",
          "workflowStatus",
          "revision",
          "priority",
          "assigneeIds",
          "assigneeIdentities",
          "checklist",
          "checklistSections",
          "completed",
          "position",
          "lifecycle",
          "deadline",
          "projectArchivedAt",
          "createdAt",
          "updatedAt",
        ].sort(),
      );
      expect(JSON.stringify(detail)).not.toMatch(
        /PRIVATE EXECUTION|managerId|criteria|sessions|credentials/,
      );
    });
    it("public access and execution read-all or admin labels never replace membership", async () => {
      await db.project.update({
        where: { id: projectId },
        data: { readAccessEnabled: true },
      });
      await human(stranger).expect(404);
      await human(outsider).expect(404);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: owner } },
      });
      await human(owner).expect(404);
    });
    it("rechecks membership and open account status on every read", async () => {
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: member } },
      });
      await human().expect(404);
      await db.user.update({
        where: { id: owner },
        data: { status: "BANNED" },
      });
      await human(owner).expect(401);
    });
    it("does not infer historical links and keeps wrong-project, foreign-task and missing detail hidden", async () => {
      await db.taskBoardEntry.delete({ where: { taskId } });
      expect((await human().expect(200)).body).toEqual([]);
      await human(member, true).expect(404);
      await http()
        .get(`/projects/${projectId}/tasks/${randomUUID()}`)
        .set("Authorization", "Bearer " + member)
        .expect(404);
    });
    it("archives context without changing task rows, statuses, membership or directory bytes", async () => {
      const p = await db.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      const file = path.join(root, p.directoryName, "history.txt");
      await fs.writeFile(file, "retain");
      const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      await archive().expect(200);
      expect(
        await db.task.findUniqueOrThrow({ where: { id: taskId } }),
      ).toEqual(before);
      expect(await fs.readFile(file, "utf8")).toBe("retain");
      expect(await db.projectMember.count({ where: { projectId } })).toBe(2);
      expect(
        (await human().expect(200)).body[0].projectArchivedAt,
      ).toBeTruthy();
    });
    it("normal lists hide archives; explicit archived filter returns only archives with unchanged scope", async () => {
      await archive().expect(200);
      expect(
        (
          await http()
            .get("/projects")
            .set("Authorization", "Bearer " + owner)
            .expect(200)
        ).body,
      ).toEqual([]);
      const archived = (
        await http()
          .get("/projects?lifecycle=archived")
          .set("Authorization", "Bearer " + owner)
          .expect(200)
      ).body;
      expect(archived.map((p: any) => p.id)).toEqual([projectId]);
      await http()
        .get("/projects?lifecycle=all")
        .set("Authorization", "Bearer " + owner)
        .expect(400);
      expect(
        (
          await http()
            .get(`/projects/${projectId}`)
            .set("Authorization", "Bearer " + owner)
            .expect(200)
        ).body.archivedAt,
      ).toBeTruthy();
    });
    it("requires dedicated permission and creator ownership, with no read-all/manage-all bypass", async () => {
      await archive(stranger).expect(403);
      await archive(member).expect(403);
      await archive(outsider).expect(404);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "projects.archive" },
        },
      });
      await archive().expect(403);
      expect(
        SystemRoleDefinitions.every(
          (r) =>
            !(r.permissions as readonly string[]).includes("projects.archive"),
        ),
      ).toBe(true);
    });
    it("bootstrap preserves an explicitly assigned archive grant without adding it to defaults", async () => {
      await db.$transaction((tx) =>
        applyBootstrapRolePermissions(
          tx,
          roleId,
          SystemRoleDefinitions[0]!.permissions,
        ),
      );
      expect(
        await db.rolePermission.count({
          where: { roleId, permissionKey: "projects.archive" },
        }),
      ).toBe(1);
      expect(
        (SystemRoleDefinitions[0]!.permissions as readonly string[]).includes(
          "projects.archive",
        ),
      ).toBe(false);
    });
    it("identical replay survives archival while a new identity, original revision change and mass assignment reject", async () => {
      const key = randomUUID();
      const first = (await archive(owner, 0, key).expect(200)).body;
      expect(
        (await archive(owner, 0, key.toUpperCase()).expect(200)).body,
      ).toEqual(first);
      await archive(owner, 1, key).expect(409);
      await archive(owner, 1).expect(409);
      await http()
        .post(`/projects/${projectId}/archive`)
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), archivedAt: null })
        .expect(400);
      expect(
        await db.projectArchiveOperation.count({ where: { projectId } }),
      ).toBe(1);
    });
    it("serializes racing archive identities and commits exactly one audit", async () => {
      const results = await Promise.all([archive(), archive()]);
      expect(results.map((r: any) => r.status).sort()).toEqual([200, 409]);
      expect(
        await db.projectArchiveOperation.count({ where: { projectId } }),
      ).toBe(1);
    });
    it("rechecks permission after a held lifecycle lock", async () => {
      let release!: () => void, locked!: () => void;
      const ready = new Promise<void>((r) => (locked = r));
      const wait = new Promise<void>((r) => (release = r));
      const holder = db.$transaction(
        async (tx) => {
          await lockProjectLifecycle(tx, projectId);
          locked();
          await wait;
        },
        { timeout: 10000 },
      );
      await ready;
      const pending = archive().then((r: any) => r);
      await new Promise((r) => setTimeout(r, 80));
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "projects.archive" },
        },
      });
      release();
      await holder;
      expect((await pending).status).toBe(403);
      expect(
        (await db.project.findUniqueOrThrow({ where: { id: projectId } }))
          .archivedAt,
      ).toBeNull();
    });
    it("blocks new project metadata/files/workflow/deadline mutations after archival", async () => {
      const deadline = new TaskDeadlinesService(db as any);
      const manager = actor(owner);
      const key = randomUUID();
      await deadline.put(manager, taskId, 0, {
        requestId: key,
        deadline: { date: "2026-12-01" },
      });
      await archive().expect(200);
      await http()
        .put(`/projects/${projectId}`)
        .set("Authorization", "Bearer " + owner)
        .send({ description: "changed" })
        .expect(409);
      await http()
        .post(`/projects/${projectId}/folders`)
        .set("Authorization", "Bearer " + owner)
        .send({ path: "late" })
        .expect(409);
      const boards = new TaskBoardsService(db as any);
      await expect(
        boards.create(actor(), projectId, 0, {
          requestId: randomUUID(),
          name: "Late",
          color: "GREEN",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        deadline.put(manager, taskId, 1, {
          requestId: randomUUID(),
          deadline: null,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await deadline.put(manager, taskId, 0, {
            requestId: key,
            deadline: { date: "2026-12-01" },
          })
        ).revision,
      ).toBe(1);
    });
    it("durable unfinished filesystem fences block archive without expiry-based clearance", async () => {
      await db.projectLifecycleExecution.create({
        data: { projectId, startedAt: new Date("2000-01-01") },
      });
      await archive().expect(409);
      expect(
        (await db.project.findUniqueOrThrow({ where: { id: projectId } }))
          .archivedAt,
      ).toBeNull();
    });
    it("does not clear an unknown callback outcome just because its caller received an error", async () => {
      await expect(
        fencedProjectFilesystem(db as any, projectId, async () => {
          throw new Error("dependency outcome unknown");
        }),
      ).rejects.toThrow("dependency outcome unknown");
      expect(
        await db.projectLifecycleExecution.count({
          where: { projectId, finishedAt: null },
        }),
      ).toBe(1);
      await archive().expect(409);
    });
    it("rolls back archive state if durable outcome persistence fails", async () => {
      const failing = db.$extends({
        query: {
          projectArchiveOperation: {
            create: async () => {
              throw new Error("injected archive audit failure");
            },
          },
        },
      });
      await expect(
        new ProjectArchiveService(failing as any).archive(
          actor(),
          projectId,
          randomUUID(),
          0,
        ),
      ).rejects.toThrow("injected archive audit failure");
      expect(
        await db.projectArchiveOperation.count({ where: { projectId } }),
      ).toBe(0);
      expect(
        await db.project.findUniqueOrThrow({ where: { id: projectId } }),
      ).toMatchObject({ archivedAt: null, archiveRevision: 0 });
    });
    it("rejects selected and manual execution in archived directories without granting task-session access to members", async () => {
      await archive().expect(200);
      const project = await db.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      const sessions = new SessionsService(
        db as any,
        {} as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      await expect(
        sessions.create(
          stranger,
          { taskId, projectId, prompt: "blocked", sandbox: "read-only" },
          false,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        sessions.create(
          stranger,
          {
            taskId,
            cwd: path.join(root, project.directoryName),
            prompt: "blocked",
            sandbox: "read-only",
          },
          false,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        sessions.preflight(member, { taskId, projectId, sandbox: "read-only" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db.proboxAiSession.count({ where: { workspaceId: w } }),
      ).toBe(0);
    });
    it("serializes execution admission with archival so exactly one can proceed", async () => {
      const sessions = new SessionsService(
        db as any,
        {} as any,
        new SessionEventsService(),
        new ModelCatalogService(),
      );
      const archives = new ProjectArchiveService(db as any);
      const results = await Promise.allSettled([
        archives.archive(actor(), projectId, randomUUID(), 0),
        sessions.create(
          stranger,
          { taskId, projectId, prompt: "race", sandbox: "read-only" },
          false,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const p = await db.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      expect(Boolean(p.archivedAt)).toBe(
        (await db.proboxAiSession.count({ where: { workspaceId: w } })) === 0,
      );
    });
    it("does not treat unconfirmed execution stop as safe merely because its database status is terminal", async () => {
      await db.proboxAiSession.create({
        data: {
          workspaceId: w,
          taskId,
          creatorId: stranger,
          cwd: root,
          sandbox: "read-only",
          status: "FAILED",
          stopConfirmation: "STOP_UNCONFIRMED",
        },
      });
      await archive().expect(409);
    });
    it("fences callbacks even after their surrounding advisory lock is gone", async () => {
      let release!: () => void, issued!: () => void;
      const ready = new Promise<void>((r) => (issued = r));
      const wait = new Promise<void>((r) => (release = r));
      const work = fencedProjectFilesystem(db as any, projectId, async () => {
        issued();
        await wait;
        return "settled";
      });
      await ready;
      await archive().expect(409);
      release();
      expect(await work).toBe("settled");
      await archive().expect(200);
      await expect(
        fencedProjectFilesystem(
          db as any,
          projectId,
          async () => "must not run",
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("keeps delayed metadata callbacks fenced without holding a surrounding transaction", async () => {
      let release!: () => void, issued!: () => void;
      const ready = new Promise<void>((r) => (issued = r));
      const wait = new Promise<void>((r) => (release = r));
      const delayed = db.$extends({
        query: {
          project: {
            update: async ({ args, query }) => {
              issued();
              await wait;
              return query(args);
            },
          },
        },
      });
      const projects = new ProjectsService(
        delayed as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
      );
      const work = projects
        .update(actor(), projectId, { description: "Settled before archive" })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await ready;
      await new Promise((r) => setTimeout(r, 350));
      await archive().expect(409);
      release();
      await work;
      expect(
        (await db.project.findUniqueOrThrow({ where: { id: projectId } }))
          .description,
      ).toBe("Settled before archive");
      expect(
        await db.projectLifecycleExecution.count({
          where: { projectId, finishedAt: null },
        }),
      ).toBe(0);
      await archive().expect(200);
    });
    it("blocks deletion of contextual projects before tokens, lifecycle changes or filesystem movement", async () => {
      await http()
        .post(`/projects/${projectId}/deletion-requests`)
        .set("Authorization", "Bearer " + owner)
        .expect(409);
      expect(
        await db.projectDeletionRequest.count({ where: { projectId } }),
      ).toBe(0);
      expect(
        (await db.project.findUniqueOrThrow({ where: { id: projectId } }))
          .status,
      ).toBe("READY");
      expect(
        await db.projectDeletionAudit.count({ where: { projectId } }),
      ).toBe(0);
    });
    it("blocks files and unknown directories after all task links are removed", async () => {
      await db.taskBoardEntry.delete({ where: { taskId } });
      const p = await db.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      const file = path.join(root, p.directoryName, "context.txt");
      await fs.writeFile(file, "safe");
      await http()
        .post(`/projects/${projectId}/deletion-requests`)
        .set("Authorization", "Bearer " + owner)
        .expect(409);
      expect(await fs.readFile(file, "utf8")).toBe("safe");
      await fs.rm(file);
      await fs.rmdir(path.join(root, p.directoryName));
      await http()
        .post(`/projects/${projectId}/deletion-requests`)
        .set("Authorization", "Bearer " + owner)
        .expect(409);
    });
    it("retains legacy pending deletion quarantine whose emptiness was never verified", async () => {
      const p = await db.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      const quarantine = path.join(root, "legacy-" + randomUUID());
      await fs.mkdir(quarantine);
      await fs.writeFile(
        path.join(quarantine, "context.txt"),
        "retain legacy history",
      );
      const audit = await db.projectDeletionAudit.create({
        data: {
          workspaceId: w,
          projectId,
          projectName: p.name,
          directoryName: p.directoryName,
          departmentId: dept,
          ownerId: owner,
          requestedById: owner,
          requestId: randomUUID(),
          status: "PURGE_PENDING",
          quarantinePath: quarantine,
          snapshot: {},
        },
      });
      const projects = new ProjectsService(
        db as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
      );
      await projects.cleanupExpiredTrash();
      expect(
        await fs.readFile(path.join(quarantine, "context.txt"), "utf8"),
      ).toBe("retain legacy history");
      expect(
        (
          await db.projectDeletionAudit.findUniqueOrThrow({
            where: { id: audit.id },
          })
        ).status,
      ).toBe("PURGE_PENDING");
    });
    it("publishes archive revision, explicit filter and human projection without execution models", () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/projects/{projectId}/archive"]!.post!.responses["428"],
      ).toBeTruthy();
      expect(doc.paths["/projects"]!.get!.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "lifecycle" }),
        ]),
      );
      expect(doc.components!.schemas!.HumanTaskReadResponseDto).toBeDefined();
      expect(
        doc.components!.schemas!.HumanTaskReadResponseDto,
      ).not.toHaveProperty("properties.criteria");
    });
  },
);
