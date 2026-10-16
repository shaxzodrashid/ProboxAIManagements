import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  ProjectStatus,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { TasksController } from "../src/tasks/tasks.controller";
import { TasksService } from "../src/tasks/tasks.service";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { SessionsController } from "../src/sessions/sessions.controller";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { DepartmentsService } from "../src/departments/departments.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { TelegramService } from "../src/telegram/telegram.service";
const request = require("supertest");

const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
(databaseUrl ? describe : describe.skip)(
  "task/project HTTP projection and authorization with PostgreSQL",
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let managerId: string;
    let readerId: string;
    let outsiderId: string;
    let emptyId: string;
    let assignedOnlyId: string;
    let taskId: string;
    let latestId: string;
    let projectId: string;
    const grants = [
      "tasks.create",
      "tasks.read",
      "tasks.read-all",
      "sessions.read",
      "projects.read",
      "projects.update",
      "projects.members.manage",
    ];
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      workspaceId = (
        await prisma.workspace.create({ data: { slug: "task-project-http" } })
      ).id;
      otherWorkspaceId = (
        await prisma.workspace.create({
          data: { slug: "task-project-http-other" },
        })
      ).id;
      await prisma.permission.createMany({
        data: grants.map((key) => ({
          key,
          name: key,
          description: key,
          category: "test",
        })),
        skipDuplicates: true,
      });
      async function user(
        workspace: string,
        phone: string,
        permissions: string[],
      ) {
        const role = await prisma.role.create({
          data: {
            workspaceId: workspace,
            key: phone,
            name: "HTTP test role",
            permissions: {
              create: permissions.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        return (
          await prisma.user.create({
            data: {
              workspaceId: workspace,
              phoneNumber: phone,
              fullName: "HTTP test user",
              status: "OPEN",
              roleAssignments: {
                create: { roleId: role.id },
              },
            },
          })
        ).id;
      }
      managerId = await user(workspaceId, "+998907000001", grants);
      readerId = await user(
        workspaceId,
        "+998907000002",
        grants.filter((key) => key !== "tasks.create"),
      );
      outsiderId = await user(otherWorkspaceId, "+998907000003", grants);
      emptyId = await user(workspaceId, "+998907000004", []);
      assignedOnlyId = await user(workspaceId, "+998907000005", [
        "tasks.read",
        "sessions.read",
      ]);
      taskId = (
        await prisma.task.create({
          data: {
            workspaceId,
            creatorId: managerId,
            managerId,
            title: "Managed task",
            description: "Task",
          },
        })
      ).id;
      await prisma.proboxAiSession.create({
        data: {
          workspaceId,
          taskId,
          creatorId: managerId,
          cwd: "private-old-path",
          sandbox: "workspace-write",
          status: "RUNNING",
          createdAt: new Date("2026-10-01T00:00:00Z"),
        },
      });
      latestId = (
        await prisma.proboxAiSession.create({
          data: {
            workspaceId,
            taskId,
            creatorId: managerId,
            cwd: "private-latest-path",
            sandbox: "workspace-write",
            codexThreadId: "private-thread",
            processId: 42,
            catalogSnapshot: { private: true },
            status: "ARCHIVED",
            createdAt: new Date("2026-10-02T00:00:00Z"),
          },
        })
      ).id;
      const department = await prisma.department.create({
        data: {
          workspaceId,
          name: "HTTP test",
          slug: "http-test",
          homePath: "/opt/http-test",
        },
      });
      projectId = (
        await prisma.project.create({
          data: {
            workspaceId,
            departmentId: department.id,
            creatorId: managerId,
            name: "HTTP project",
            directoryName: "HTTP project",
            readAccessEnabled: true,
            status: "DELETING",
            members: { create: { userId: managerId } },
          },
        })
      ).id;
      const module = await Test.createTestingModule({
        controllers: [TasksController, ProjectsController, SessionsController],
        providers: [
          TasksService,
          ProjectsService,
          SessionsService,
          SessionEventsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                workspaceId: "stale-workspace",
                type: "access",
              }),
            },
          },
          { provide: DepartmentsService, useValue: {} },
          { provide: WorkspacePathPolicy, useValue: {} },
          { provide: ProjectInitializationService, useValue: {} },
          { provide: ProboxAiRunner, useValue: {} },
          { provide: ModelCatalogService, useValue: {} },
          { provide: TelegramService, useValue: {} },
        ],
      }).compile();
      jest
        .spyOn(module.get(ProjectsService), "onModuleInit")
        .mockImplementation(() => {});
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
    afterAll(async () => {
      await app?.close();
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.configurationTemplate.deleteMany({ where: { workspaceId } });
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.department.deleteMany({ where: { workspaceId } });
      await prisma.user.deleteMany({
        where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.role.deleteMany({
        where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.$disconnect();
    });
    const call = () => request(app.getHttpServer());
    async function membershipProject(readAccessEnabled = true) {
      const base = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      return prisma.project.create({
        data: {
          workspaceId,
          departmentId: base.departmentId,
          creatorId: managerId,
          name: "Membership contract",
          directoryName: `membership-${Date.now()}-${Math.random()}`,
          readAccessEnabled,
          members: { create: { userId: managerId } },
        },
      });
    }
    it("reports actual membership on list/detail and preserves public roster omission", async () => {
      const project = await membershipProject();
      for (const [userId, isMember] of [
        [managerId, true],
        [readerId, false],
      ] as const) {
        const list = await call()
          .get("/projects")
          .set("Authorization", `Bearer ${userId}`)
          .expect(200);
        expect(list.headers["cache-control"]).toBe("no-store");
        const item = list.body.find((row: any) => row.id === project.id);
        expect(item.isMember).toBe(isMember);
        expect(item).not.toHaveProperty("members");
        const detail = await call()
          .get(`/projects/${project.id}`)
          .set("Authorization", `Bearer ${userId}`)
          .expect(200);
        expect(detail.headers["cache-control"]).toBe("no-store");
        expect(detail.body.isMember).toBe(isMember);
        expect(Object.hasOwn(detail.body, "members")).toBe(isMember);
      }
    });
    it("does not infer membership from creator identity and observes add/remove on the next read", async () => {
      const project = await membershipProject();
      await prisma.projectMember.deleteMany({
        where: { projectId: project.id },
      });
      const absent = await call()
        .get(`/projects/${project.id}`)
        .set("Authorization", `Bearer ${managerId}`)
        .expect(200);
      expect(absent.body).toMatchObject({
        creatorId: managerId,
        isMember: false,
      });
      expect(absent.body).not.toHaveProperty("members");
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: readerId },
      });
      expect(
        (
          await call()
            .get(`/projects/${project.id}`)
            .set("Authorization", `Bearer ${readerId}`)
            .expect(200)
        ).body.isMember,
      ).toBe(true);
      await prisma.projectMember.deleteMany({
        where: { projectId: project.id, userId: readerId },
      });
      expect(
        (
          await call()
            .get("/projects")
            .set("Authorization", `Bearer ${readerId}`)
            .expect(200)
        ).body.find((row: any) => row.id === project.id).isMember,
      ).toBe(false);
    });
    it("removes private visibility after membership removal and isolates foreign workspaces", async () => {
      const project = await membershipProject(false);
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: readerId },
      });
      await call()
        .get(`/projects/${project.id}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      await prisma.projectMember.deleteMany({
        where: { projectId: project.id, userId: readerId },
      });
      await call()
        .get(`/projects/${project.id}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(403);
      expect(
        (
          await call()
            .get("/projects")
            .set("Authorization", `Bearer ${readerId}`)
            .expect(200)
        ).body.some((row: any) => row.id === project.id),
      ).toBe(false);
      await call()
        .get(`/projects/${project.id}`)
        .set("Authorization", `Bearer ${outsiderId}`)
        .expect(404);
      expect(
        (
          await call()
            .get("/projects")
            .set("Authorization", `Bearer ${outsiderId}`)
            .expect(200)
        ).body.some((row: any) => row.id === project.id),
      ).toBe(false);
    });
    it("keeps read-all roster access factual and rejects stale read-all grants", async () => {
      const project = await membershipProject(false);
      const assignment = await prisma.userRoleAssignment.findFirstOrThrow({
        where: { userId: readerId },
      });
      await prisma.permission.upsert({
        where: { key: "projects.read-all" },
        update: {},
        create: {
          key: "projects.read-all",
          name: "Read all",
          description: "test",
          category: "test",
        },
      });
      await prisma.rolePermission.create({
        data: { roleId: assignment.roleId, permissionKey: "projects.read-all" },
      });
      try {
        const detail = await call()
          .get(`/projects/${project.id}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(detail.body.isMember).toBe(false);
        expect(detail.body.members).toHaveLength(1);
        expect(
          (
            await call()
              .get("/projects")
              .set("Authorization", `Bearer ${readerId}`)
              .expect(200)
          ).body.find((row: any) => row.id === project.id).isMember,
        ).toBe(false);
      } finally {
        await prisma.rolePermission.deleteMany({
          where: {
            roleId: assignment.roleId,
            permissionKey: "projects.read-all",
          },
        });
      }
      const actor = {
        id: readerId,
        workspaceId,
        roles: [],
        permissions: ["projects.read", "projects.read-all"],
      };
      await expect(
        app.get(ProjectsService).get(actor, project.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await app.get(ProjectsService).list(actor)).some(
          (row) => row.id === project.id,
        ),
      ).toBe(false);
    });
    it("does not treat management authority as membership or read-all authority", async () => {
      const privateProject = await membershipProject(false);
      const publicProject = await membershipProject();
      const assignment = await prisma.userRoleAssignment.findFirstOrThrow({
        where: { userId: readerId },
      });
      await prisma.permission.upsert({
        where: { key: "projects.manage-all" },
        update: {},
        create: {
          key: "projects.manage-all",
          name: "Manage all",
          description: "test",
          category: "test",
        },
      });
      await prisma.rolePermission.create({
        data: {
          roleId: assignment.roleId,
          permissionKey: "projects.manage-all",
        },
      });
      try {
        await call()
          .get(`/projects/${privateProject.id}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(403);
        const list = await call()
          .get("/projects")
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(list.body.some((row: any) => row.id === privateProject.id)).toBe(
          false,
        );
        const detail = await call()
          .get(`/projects/${publicProject.id}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(detail.body.isMember).toBe(false);
        expect(detail.body).not.toHaveProperty("members");
      } finally {
        await prisma.rolePermission.deleteMany({
          where: {
            roleId: assignment.roleId,
            permissionKey: "projects.manage-all",
          },
        });
      }
    });
    it.each(["list", "detail"])(
      "keeps %s visibility and membership in one snapshot during concurrent removal",
      async (operation) => {
        const project = await membershipProject(false);
        const actor = {
          id: managerId,
          workspaceId,
          roles: [],
          permissions: ["projects.read"],
        };
        const service = app.get(ProjectsService);
        // Pause after the real authorization read establishes the RR snapshot.
        // Commit the removal on another connection before the real project query.
        const reader = (service as any).currentProjectReader.bind(service);
        const barrier = jest
          .spyOn(service as any, "currentProjectReader")
          .mockImplementationOnce(async (...args: unknown[]) => {
            const current = await reader(...args);
            await prisma.projectMember.deleteMany({
              where: { projectId: project.id, userId: managerId },
            });
            return current;
          });
        try {
          const result =
            operation === "list"
              ? (await service.list(actor)).find((row) => row.id === project.id)
              : await service.get(actor, project.id);
          expect(result?.isMember).toBe(true);
        } finally {
          barrier.mockRestore();
        }
        expect(
          (await service.list(actor)).some((row) => row.id === project.id),
        ).toBe(false);
        await expect(service.get(actor, project.id)).rejects.toMatchObject({
          status: 403,
        });
      },
    );
    it("rechecks projects.read and OPEN state even for a captured service actor", async () => {
      const assignment = await prisma.userRoleAssignment.findFirstOrThrow({
        where: { userId: readerId },
      });
      const actor = {
        id: readerId,
        workspaceId,
        roles: [],
        permissions: ["projects.read"],
      };
      await prisma.rolePermission.deleteMany({
        where: { roleId: assignment.roleId, permissionKey: "projects.read" },
      });
      try {
        await expect(
          app.get(ProjectsService).list(actor),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          app.get(ProjectsService).get(actor, projectId),
        ).rejects.toMatchObject({ status: 403 });
        await call()
          .get("/projects")
          .set("Authorization", `Bearer ${readerId}`)
          .expect(403);
      } finally {
        await prisma.rolePermission.create({
          data: { roleId: assignment.roleId, permissionKey: "projects.read" },
        });
      }
      await prisma.user.update({
        where: { id: readerId },
        data: { status: "BANNED" },
      });
      try {
        await expect(
          app.get(ProjectsService).list(actor),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          app.get(ProjectsService).get(actor, projectId),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await prisma.user.update({
          where: { id: readerId },
          data: { status: "OPEN" },
        });
      }
      await expect(
        app
          .get(ProjectsService)
          .list({ ...actor, workspaceId: otherWorkspaceId }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("does not accept the derived membership marker as an update", async () => {
      await call()
        .put(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${managerId}`)
        .send({ isMember: false })
        .expect(400);
      expect(
        await prisma.projectMember.count({
          where: { projectId, userId: managerId },
        }),
      ).toBe(1);
    });
    it("reads an assigned task by ID with only existing fields and no-store", async () => {
      const response = await call()
        .get(`/tasks/${taskId}`)
        .set("Authorization", `Bearer ${managerId}`)
        .expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(response.body).sort()).toEqual([
        "createdAt",
        "creatorId",
        "criteria",
        "description",
        "id",
        "manager",
        "managerId",
        "sessions",
        "status",
        "title",
        "updatedAt",
        "workspaceId",
      ]);
      expect(response.body).toMatchObject({
        id: taskId,
        managerId,
        creatorId: managerId,
        workspaceId,
        criteria: null,
        manager: { fullName: "HTTP test user" },
      });
      expect(response.body.sessions).toEqual([
        {
          id: latestId,
          status: "ARCHIVED",
          createdAt: "2026-10-02T00:00:00.000Z",
        },
      ]);
    });
    it("allows read-all detail while preserving assigned-only session detail access", async () => {
      const detail = await call()
        .get(`/tasks/${taskId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      const list = await call()
        .get("/tasks")
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      expect(detail.body).toEqual(
        list.body.find((row: any) => row.id === taskId),
      );
      await call()
        .get(`/sessions/${latestId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(403);
    });
    it("returns the same missing response for absent, unassigned and foreign tasks", async () => {
      const missing = await call()
        .get(`/tasks/${randomUUID()}`)
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(404);
      const unassigned = await call()
        .get(`/tasks/${taskId}`)
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(404);
      const foreign = await call()
        .get(`/tasks/${taskId}`)
        .set("Authorization", `Bearer ${outsiderId}`)
        .expect(404);
      expect(unassigned.body).toEqual(missing.body);
      expect(foreign.body).toEqual(missing.body);
    });
    it("does not infer assignment from task creation and exposes empty latest-session summaries", async () => {
      const task = await prisma.task.create({
        data: {
          workspaceId,
          creatorId: assignedOnlyId,
          managerId,
          title: "Creator without assignment",
          description: "Existing fields",
        },
      });
      await call()
        .get(`/tasks/${task.id}`)
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(404);
      const response = await call()
        .get(`/tasks/${task.id}`)
        .set("Authorization", `Bearer ${managerId}`)
        .expect(200);
      expect(response.body.sessions).toEqual([]);
    });
    it("observes current assignment on each detail request without adding a reassignment API", async () => {
      const task = await prisma.task.create({
        data: {
          workspaceId,
          creatorId: assignedOnlyId,
          managerId: assignedOnlyId,
          title: "Assignment scope",
          description: "Existing fields",
        },
      });
      await call()
        .get(`/tasks/${task.id}`)
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(200);
      await prisma.task.update({ where: { id: task.id }, data: { managerId } });
      await call()
        .get(`/tasks/${task.id}`)
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(404);
    });
    it("does not project a foreign-workspace session linked to an otherwise visible task", async () => {
      const session = await prisma.proboxAiSession.create({
        data: {
          workspaceId: otherWorkspaceId,
          taskId,
          creatorId: outsiderId,
          cwd: "foreign-private-path",
          sandbox: "workspace-write",
          createdAt: new Date("2030-01-01T00:00:00Z"),
        },
      });
      try {
        const response = await call()
          .get(`/tasks/${taskId}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(response.body.sessions.map((row: any) => row.id)).toEqual([
          latestId,
        ]);
        expect(JSON.stringify(response.body)).not.toContain(session.id);
        const list = await call()
          .get("/tasks")
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(list.body.find((row: any) => row.id === taskId)).toEqual(
          response.body,
        );
      } finally {
        await prisma.proboxAiSession.delete({ where: { id: session.id } });
      }
    });
    it("requires task read permission and authentication before detail", async () => {
      await call().get(`/tasks/${taskId}`).expect(401);
      await call()
        .get(`/tasks/${taskId}`)
        .set("Authorization", `Bearer ${emptyId}`)
        .expect(403);
    });
    it.each(["not-a-uuid", "00000000-0000-1000-8000-000000000000"])(
      "rejects invalid task identity %s",
      async (id) => {
        await call()
          .get(`/tasks/${id}`)
          .set("Authorization", `Bearer ${managerId}`)
          .expect(400);
      },
    );
    it("rechecks task read/read-all permissions rather than captured service grants", async () => {
      const role = await prisma.userRoleAssignment.findFirstOrThrow({
        where: { userId: readerId },
      });
      const actor = {
        id: readerId,
        workspaceId,
        roles: [{ id: role.roleId, key: "ADMIN", name: "Admin" }],
        permissions: ["tasks.read", "tasks.read-all"],
      };
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.roleId, permissionKey: "tasks.read-all" },
      });
      try {
        await expect(
          app.get(TasksService).get(actor, taskId),
        ).rejects.toMatchObject({ status: 404 });
        await call()
          .get(`/tasks/${taskId}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(404);
        await prisma.rolePermission.deleteMany({
          where: { roleId: role.roleId, permissionKey: "tasks.read" },
        });
        await expect(
          app.get(TasksService).get(actor, taskId),
        ).rejects.toMatchObject({ status: 403 });
        await call()
          .get(`/tasks/${taskId}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(403);
      } finally {
        await prisma.rolePermission.createMany({
          data: ["tasks.read", "tasks.read-all"].map((permissionKey) => ({
            roleId: role.roleId,
            permissionKey,
          })),
          skipDuplicates: true,
        });
      }
    });
    it("rejects non-OPEN or mismatched-workspace actors and keeps task data unchanged", async () => {
      const actor = {
        id: readerId,
        workspaceId,
        roles: [],
        permissions: ["tasks.read", "tasks.read-all"],
      };
      const before = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      await prisma.user.update({
        where: { id: readerId },
        data: { status: "BANNED" },
      });
      try {
        await call()
          .get(`/tasks/${taskId}`)
          .set("Authorization", `Bearer ${readerId}`)
          .expect(401);
        await expect(
          app.get(TasksService).get(actor, taskId),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await prisma.user.update({
          where: { id: readerId },
          data: { status: "OPEN" },
        });
      }
      await expect(
        app
          .get(TasksService)
          .get({ ...actor, workspaceId: otherWorkspaceId }, taskId),
      ).rejects.toMatchObject({ status: 403 });
      await call()
        .get(`/tasks/${taskId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      expect(
        await prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
      ).toEqual(before);
    });
    it("creates task scalars only with nullable criteria and correct assignment", async () => {
      const response = await call()
        .post("/tasks")
        .set("Authorization", `Bearer ${managerId}`)
        .send({ title: "Created task", description: "Description" })
        .expect(201);
      expect(response.body).toMatchObject({
        criteria: null,
        status: "QUEUED",
        creatorId: managerId,
        managerId,
        workspaceId,
      });
      expect(Object.keys(response.body).sort()).toEqual([
        "createdAt",
        "creatorId",
        "criteria",
        "description",
        "id",
        "managerId",
        "status",
        "title",
        "updatedAt",
        "workspaceId",
      ]);
    });
    it("returns only the latest summary to workspace task readers without session-detail rights", async () => {
      const response = await call()
        .get("/tasks")
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      const task = response.body.find((item: any) => item.id === taskId);
      expect(task.sessions).toEqual([
        {
          id: latestId,
          status: "ARCHIVED",
          createdAt: "2026-10-02T00:00:00.000Z",
        },
      ]);
      expect(task.manager).toEqual({ fullName: "HTTP test user" });
      const created = response.body.find(
        (item: any) => item.title === "Created task",
      );
      expect(created.sessions).toEqual([]);
      await call()
        .get(`/sessions/${latestId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(403);
      await call()
        .get(`/sessions/${latestId}`)
        .set("Authorization", `Bearer ${managerId}`)
        .expect(200);
      await call()
        .get("/tasks")
        .set("Authorization", `Bearer ${outsiderId}`)
        .expect(200)
        .expect([]);
    });
    it.each(Object.values(SessionStatus))(
      "returns full session lifecycle %s in summaries",
      async (status) => {
        await prisma.proboxAiSession.update({
          where: { id: latestId },
          data: { status },
        });
        const response = await call()
          .get("/tasks")
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(
          response.body.find((item: any) => item.id === taskId).sessions[0]
            .status,
        ).toBe(status);
      },
    );
    it.each(Object.values(TaskStatus))(
      "returns full task lifecycle %s",
      async (status) => {
        await prisma.task.update({ where: { id: taskId }, data: { status } });
        const response = await call()
          .get("/tasks")
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(
          response.body.find((item: any) => item.id === taskId).status,
        ).toBe(status);
      },
    );
    it("preserves project members omission and denies sensitive/cross-workspace requests", async () => {
      const reader = await call()
        .get(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      expect(reader.body.status).toBe("DELETING");
      expect(reader.body).not.toHaveProperty("members");
      expect(reader.body.initializations).toEqual([]);
      const member = await call()
        .get(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${managerId}`)
        .expect(200);
      expect(member.body.members[0].user).toMatchObject({
        id: managerId,
        fullName: "HTTP test user",
        role: null,
      });
      await call()
        .put(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .send({ description: "Forbidden" })
        .expect(403);
      await call()
        .delete(`/projects/${projectId}/members/${managerId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(403);
      await call()
        .get(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${outsiderId}`)
        .expect(404);
      await call()
        .put(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${outsiderId}`)
        .send({ description: "Forbidden" })
        .expect(404);
    });
    it.each(Object.values(ProjectStatus))(
      "returns full project lifecycle %s and refuses mutation while deleting",
      async (status) => {
        await prisma.project.update({
          where: { id: projectId },
          data: { status },
        });
        const response = await call()
          .get("/projects")
          .set("Authorization", `Bearer ${readerId}`)
          .expect(200);
        expect(response.body[0]).toMatchObject({
          status,
          _count: { members: 1 },
          initializations: [],
        });
        expect(response.body[0]).not.toHaveProperty("members");
        await call()
          .get(`/projects/${projectId}`)
          .set("Authorization", `Bearer ${managerId}`)
          .expect(200)
          .expect(({ body }: any) => expect(body.status).toBe(status));
        const updated = await call()
          .put(`/projects/${projectId}`)
          .set("Authorization", `Bearer ${managerId}`)
          .send({ description: "Updated" })
          .expect(status === "DELETING" ? 409 : 200);
        if (status === "DELETING") {
          await prisma.project.update({
            where: { id: projectId },
            data: { status: "READY" },
          });
          return;
        }
        expect(updated.body.status).toBe(status);
        expect(updated.body).not.toHaveProperty("creator");
        expect(updated.body).not.toHaveProperty("members");
        expect(updated.body).not.toHaveProperty("initializations");
      },
    );
    it("returns nested identity from add-member and only membership scalars from removal", async () => {
      const added = await call()
        .post(`/projects/${projectId}/members`)
        .set("Authorization", `Bearer ${managerId}`)
        .send({ userId: readerId })
        .expect(201);
      expect(added.body.user.id).toBe(readerId);
      const removed = await call()
        .delete(`/projects/${projectId}/members/${readerId}`)
        .set("Authorization", `Bearer ${managerId}`)
        .expect(200);
      expect(Object.keys(removed.body).sort()).toEqual([
        "createdAt",
        "projectId",
        "userId",
      ]);
      expect(removed.body).toMatchObject({ projectId, userId: readerId });
    });
    it("retains route permission gates and authentication", async () => {
      await call().get("/tasks").expect(401);
      await call().get("/projects").expect(401);
      await call()
        .get("/tasks")
        .set("Authorization", `Bearer ${emptyId}`)
        .expect(403);
      await call()
        .get("/projects")
        .set("Authorization", `Bearer ${emptyId}`)
        .expect(403);
      await call()
        .post("/tasks")
        .set("Authorization", `Bearer ${readerId}`)
        .send({ title: "Denied", description: "Denied" })
        .expect(403);
    });

    it("keeps assigned-only readers scoped to their own tasks", async () => {
      await call()
        .get("/tasks")
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(200)
        .expect([]);
      await call()
        .get(`/sessions/${latestId}`)
        .set("Authorization", `Bearer ${assignedOnlyId}`)
        .expect(403);
    });

    it("returns only the latest safe initialization summary to ordinary public-read nonmembers", async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      const template = await prisma.configurationTemplate.create({
        data: {
          workspaceId,
          departmentId: project.departmentId,
          creatorId: managerId,
          name: "HTTP template",
          slug: "http-template",
          versions: {
            create: { creatorId: managerId, version: 1, status: "PUBLISHED" },
          },
        },
        include: { versions: true },
      });
      await prisma.projectInitialization.create({
        data: {
          projectId,
          templateVersionId: template.versions[0]!.id,
          attempt: 1,
        },
      });
      const latest = await prisma.projectInitialization.create({
        data: {
          projectId,
          templateVersionId: template.versions[0]!.id,
          attempt: 2,
          status: "FAILED",
          error: "PRIVATE database credential error",
          stagingPath: "/PRIVATE/staging",
          quarantinePath: "/PRIVATE/quarantine",
          leaseOwner: "PRIVATE worker identity",
          leaseExpiresAt: new Date(),
        },
      });
      const response = await call()
        .get(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      expect(response.body.initializations).toHaveLength(1);
      expect(response.body.initializations[0]).toMatchObject({
        id: latest.id,
        attempt: 2,
        status: "FAILED",
        startedAt: null,
        endedAt: null,
      });
      expect(Object.keys(response.body.initializations[0]).sort()).toEqual(
        [
          "id",
          "projectId",
          "templateVersionId",
          "attempt",
          "status",
          "lastSequence",
          "startedAt",
          "endedAt",
          "createdAt",
          "updatedAt",
        ].sort(),
      );
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE");
      const list = await call()
        .get("/projects")
        .set("Authorization", `Bearer ${readerId}`)
        .expect(200);
      expect(
        list.body.find((row: any) => row.id === projectId).initializations,
      ).toEqual(response.body.initializations);
      expect(JSON.stringify(list.body)).not.toContain("PRIVATE");
      expect(response.body).not.toHaveProperty("members");
    });
  },
);
