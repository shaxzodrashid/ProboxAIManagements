import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID, createHash } from "node:crypto";
import { ProjectsService } from "../src/projects/projects.service";
import { applyBootstrapRolePermissions } from "../prisma/bootstrap-role-permissions";
import { TaskBoardsController } from "../src/tasks/task-boards.controller";
import { TaskBoardsService } from "../src/tasks/task-boards.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { lockWorkspace } from "../src/prisma/workspace-lock";
import {
  Permissions,
  SystemRoleDefinitions,
  TaskManagerPermissionKeys,
} from "../src/authorization/permission.catalog";
const request = require("supertest");
const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const u = new URL(databaseUrl);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
(databaseUrl ? describe : describe.skip)(
  "task boards authorization/lifecycle with PostgreSQL",
  () => {
    let app: INestApplication,
      prisma: PrismaClient,
      workspaceId: string,
      foreignWorkspace: string,
      owner: string,
      reader: string,
      outsider: string,
      managerRole: string,
      projectId: string,
      departmentId: string,
      foreignDepartment: string;
    let board: any;
    const granted = [
      Permissions.TASK_BOARDS_READ,
      Permissions.TASK_STATUSES_MANAGE,
      Permissions.TASK_WORKFLOW_MOVE,
      Permissions.PROJECTS_READ,
      Permissions.PROJECTS_UPDATE,
      Permissions.PROJECTS_READ_ALL,
    ];
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      workspaceId = (
        await prisma.workspace.create({ data: { slug: "task-boards-http" } })
      ).id;
      foreignWorkspace = (
        await prisma.workspace.create({
          data: { slug: "task-boards-http-foreign" },
        })
      ).id;
      await prisma.permission.createMany({
        data: granted.map((key) => ({
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
        const role = await prisma.role.create({
          data: {
            workspaceId,
            key: phoneNumber,
            name: "ADMIN",
            permissions: {
              create: keys.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        const user = await prisma.user.create({
          data: {
            workspaceId,
            phoneNumber,
            fullName: "Board test staff",
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: user.id, roleId: role.id };
      }
      const manager = await user(workspaceId, "+998908100001", granted);
      owner = manager.id;
      managerRole = manager.roleId;
      reader = (
        await user(workspaceId, "+998908100002", [
          Permissions.PROJECTS_READ,
          Permissions.PROJECTS_UPDATE,
          Permissions.PROJECTS_READ_ALL,
        ])
      ).id;
      outsider = (await user(foreignWorkspace, "+998908100003", granted)).id;
      departmentId = (
        await prisma.department.create({
          data: {
            workspaceId,
            name: "Boards",
            slug: "boards",
            homePath: "/opt/boards",
          },
        })
      ).id;
      foreignDepartment = (
        await prisma.department.create({
          data: {
            workspaceId: foreignWorkspace,
            name: "Foreign boards",
            slug: "foreign",
            homePath: "/opt/foreign-boards",
          },
        })
      ).id;
      const module = await Test.createTestingModule({
        controllers: [TaskBoardsController],
        providers: [
          TaskBoardsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                type: "access",
                workspaceId: "stale",
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
    });
    beforeEach(async () => {
      projectId = (
        await prisma.project.create({
          data: {
            workspaceId,
            departmentId,
            creatorId: owner,
            name: "Workflow project",
            directoryName: randomUUID(),
            members: { create: { userId: owner } },
          },
        })
      ).id;
      board = await prisma.taskBoard.findUniqueOrThrow({
        where: { projectId },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
    });
    afterEach(async () => {
      await prisma.task.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspace] } },
      });
      await prisma.project.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspace] } },
      });
    });
    afterAll(async () => {
      await app?.close();
      await prisma.department.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspace] } },
      });
      await prisma.user.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspace] } },
      });
      await prisma.role.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspace] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, foreignWorkspace] } },
      });
      await prisma.$disconnect();
    });
    const call = () => request(app.getHttpServer());
    const base = () => `/projects/${projectId}/task-board`;
    const actor = () => ({
      id: owner,
      workspaceId,
      roles: [],
      permissions: granted,
    });
    const update = (statusId: string, revision: number, body: any) =>
      call()
        .patch(`${base()}/statuses/${statusId}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", `"${revision}"`)
        .send(body);
    it("initializes exactly one board with four customizable statuses for each new project", async () => {
      const response = await call()
        .get(base())
        .set("Authorization", `Bearer ${owner}`)
        .expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(response.body).sort()).toEqual([
        "id",
        "projectId",
        "revision",
        "statuses",
      ]);
      expect(
        response.body.statuses.map((s: any) => [s.name, s.color, s.position]),
      ).toEqual([
        ["To do", "NEUTRAL", 0],
        ["In progress", "TEAL", 1],
        ["Review", "PURPLE", 2],
        ["Done", "GREEN", 3],
      ]);
      expect(response.body.statuses[0].palette).toEqual({
        foreground: "#4d5c6c",
        background: "#e8edf2",
      });
      await expect(
        prisma.taskBoard.create({ data: { projectId } }),
      ).rejects.toBeDefined();
      expect(await prisma.taskBoard.count({ where: { projectId } })).toBe(1);
    });
    it("does not grant new permissions to any built-in role defaults", () => {
      for (const role of SystemRoleDefinitions)
        for (const key of TaskManagerPermissionKeys)
          expect(role.permissions).not.toContain(key);
    });
    it("preserves explicit board grants when bootstrap resets legacy built-in defaults", async () => {
      const before = await prisma.rolePermission.findMany({
        where: { roleId: managerRole },
      });
      try {
        await prisma.$transaction((tx) =>
          applyBootstrapRolePermissions(tx, managerRole, [
            Permissions.PROJECTS_READ,
          ]),
        );
        expect(
          (
            await prisma.rolePermission.findMany({
              where: { roleId: managerRole },
            })
          )
            .map((r) => r.permissionKey)
            .sort(),
        ).toEqual(
          [
            Permissions.PROJECTS_READ,
            ...TaskManagerPermissionKeys.filter((key) =>
              before.some((row) => row.permissionKey === key),
            ),
          ].sort(),
        );
      } finally {
        await prisma.rolePermission.createMany({
          data: before.map(({ roleId, permissionKey }) => ({
            roleId,
            permissionKey,
          })),
          skipDuplicates: true,
        });
      }
    });
    it("requires dedicated permissions even when project editing/read-all or Admin labels exist", async () => {
      await call()
        .get(base())
        .set("Authorization", `Bearer ${reader}`)
        .expect(403);
      await call()
        .get(`${base()}/edit`)
        .set("Authorization", `Bearer ${reader}`)
        .expect(403);
      await call().get(base()).expect(401);
      expect(
        await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
      ).toBe(0);
    });
    it("isolates foreign workspace boards and operations", async () => {
      await call()
        .get(base())
        .set("Authorization", `Bearer ${outsider}`)
        .expect(404);
      await call()
        .get(`${base()}/operations/${randomUUID()}`)
        .set("Authorization", `Bearer ${outsider}`)
        .expect(404);
      await call()
        .post(`${base()}/statuses`)
        .set("Authorization", `Bearer ${outsider}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), name: "Foreign", color: "GREEN" })
        .expect(404);
    });
    it("does not let dedicated status management bypass actual project membership", async () => {
      await prisma.projectMember.deleteMany({ where: { projectId } });
      await call()
        .get(base())
        .set("Authorization", `Bearer ${owner}`)
        .expect(200); // read-all is read scope only
      await call()
        .get(`${base()}/edit`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(403);
      await update(board.statuses[0].id, 0, {
        requestId: randomUUID(),
        name: "Forbidden",
      }).expect(403);
    });
    it("supports manage-only metadata snapshots without granting task or board reads", async () => {
      await prisma.rolePermission.deleteMany({
        where: {
          roleId: managerRole,
          permissionKey: {
            in: [Permissions.TASK_BOARDS_READ, Permissions.PROJECTS_READ],
          },
        },
      });
      try {
        await call()
          .get(base())
          .set("Authorization", `Bearer ${owner}`)
          .expect(403);
        await call()
          .get(`${base()}/edit`)
          .set("Authorization", `Bearer ${owner}`)
          .expect(200);
        await update(board.statuses[0].id, 0, {
          requestId: randomUUID(),
          color: "TEAL",
        }).expect(200);
      } finally {
        await prisma.rolePermission.createMany({
          data: [Permissions.TASK_BOARDS_READ, Permissions.PROJECTS_READ].map(
            (permissionKey) => ({ roleId: managerRole, permissionKey }),
          ),
          skipDuplicates: true,
        });
      }
    });
    it("creates, renames, recolors and reorders stable statuses with audited outcomes", async () => {
      const added = await call()
        .post(`${base()}/statuses`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), name: "  Waiting  ", color: "PURPLE" })
        .expect(201);
      expect(added.body.after.statuses.at(-1).name).toBe("Waiting");
      const edited = await update(board.statuses[0].id, 1, {
        requestId: randomUUID(),
        name: "Backlog",
        color: "GREEN",
      }).expect(200);
      expect(edited.body.after.statuses[0]).toMatchObject({
        id: board.statuses[0].id,
        name: "Backlog",
        color: "GREEN",
      });
      const ids = edited.body.after.statuses.map((s: any) => s.id).reverse();
      const reordered = await call()
        .put(`${base()}/statuses/order`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"2"')
        .send({ requestId: randomUUID(), statusIds: ids })
        .expect(200);
      expect(reordered.body.after.statuses.map((s: any) => s.id)).toEqual(ids);
      expect(reordered.body.after.statuses.map((s: any) => s.position)).toEqual(
        [0, 1, 2, 3, 4],
      );
      expect(
        await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
      ).toBe(3);
      expect(JSON.stringify(reordered.body)).not.toMatch(
        /inputHash|workspaceId|phone|role|password|cwd/,
      );
    });
    it.each([undefined, "0", '"00"', '"-1"'])(
      "rejects missing or malformed If-Match %s",
      async (header) => {
        const req = call()
          .post(`${base()}/statuses`)
          .set("Authorization", `Bearer ${owner}`)
          .send({ requestId: randomUUID(), name: "New", color: "TEAL" });
        if (header !== undefined) req.set("If-Match", header);
        await req.expect(header === undefined ? 428 : 400);
        expect(
          await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
        ).toBe(0);
      },
    );
    it.each([
      { name: "", color: "GREEN" },
      { name: "  ", color: "GREEN" },
      { name: "x", color: "#fff" },
      { name: null, color: "GREEN" },
      { name: "x", color: "GREEN", role: "ADMIN" },
    ])("rejects invalid status create input %#", async (fields) => {
      await call()
        .post(`${base()}/statuses`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), ...fields })
        .expect(400);
      expect(
        await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
      ).toBe(0);
    });
    it("reconciles duplicate retries/readback without duplicate mutations and rejects changed request input", async () => {
      const requestId = randomUUID(),
        body = { requestId, name: "Once", color: "TEAL" };
      const first = await update(board.statuses[0].id, 0, body).expect(200);
      const second = await update(board.statuses[0].id, 0, {
        color: "TEAL",
        name: "Once",
        requestId,
      }).expect(200);
      expect(second.body).toEqual(first.body);
      expect(
        (
          await call()
            .get(`${base()}/operations/${requestId}`)
            .set("Authorization", `Bearer ${owner}`)
            .expect(200)
        ).body,
      ).toEqual(first.body);
      await update(board.statuses[0].id, 0, {
        ...body,
        name: "Changed",
      }).expect(409);
      expect(
        await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
      ).toBe(1);
    });
    it("canonicalizes request/project/status UUIDs for retry and readback, including service callers", async () => {
      const service = app.get(TaskBoardsService),
        requestId = randomUUID();
      const first = await service.update(
        actor(),
        projectId,
        board.statuses[0].id,
        0,
        { requestId, name: "Canonical" },
      );
      const retry = await service.update(
        actor(),
        projectId.toUpperCase(),
        board.statuses[0].id.toUpperCase(),
        0,
        { requestId: requestId.toUpperCase(), name: "Canonical" },
      );
      expect(retry).toEqual(first);
      const readback = await call()
        .get(
          `/projects/${projectId.toUpperCase()}/task-board/operations/${requestId.toUpperCase()}`,
        )
        .set("Authorization", `Bearer ${owner}`)
        .expect(200);
      expect(readback.body.requestId).toBe(requestId);
      expect(
        await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
      ).toBe(1);
    });
    it("serializes competing revisions so only one update commits", async () => {
      const service = app.get(TaskBoardsService);
      const results = await Promise.allSettled([
        service.update(actor(), projectId, board.statuses[0].id, 0, {
          requestId: randomUUID(),
          name: "A",
        }),
        service.update(actor(), projectId, board.statuses[1].id, 0, {
          requestId: randomUUID(),
          name: "B",
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          results.find((r) => r.status === "rejected") as PromiseRejectedResult
        ).reason.getStatus(),
      ).toBe(409);
      expect(
        await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
      ).toBe(1);
    });
    it("rechecks grants after waiting for the shared mutation lock", async () => {
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const blocker = prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, workspaceId);
          await tx.rolePermission.deleteMany({
            where: {
              roleId: managerRole,
              permissionKey: Permissions.TASK_STATUSES_MANAGE,
            },
          });
          locked();
          await gate;
        },
        { timeout: 30000 },
      );
      await ready;
      const denied = expect(
        app
          .get(TaskBoardsService)
          .update(actor(), projectId, board.statuses[0].id, 0, {
            requestId: randomUUID(),
            name: "Stale",
          }),
      ).rejects.toMatchObject({ status: 403 });
      release();
      await blocker;
      try {
        await denied;
        expect(
          await prisma.taskBoardAudit.count({ where: { boardId: board.id } }),
        ).toBe(0);
      } finally {
        await prisma.rolePermission.create({
          data: {
            roleId: managerRole,
            permissionKey: Permissions.TASK_STATUSES_MANAGE,
          },
        });
      }
    });
    async function linkedTask(
      statusId = board.statuses[0].id,
      workspace = workspaceId,
      creator = owner,
    ) {
      return prisma.task.create({
        data: {
          workspaceId: workspace,
          creatorId: creator,
          managerId: creator,
          title: "Human task",
          description: "Existing execution status",
          status: "RUNNING",
          assignees: { create: { userId: creator } },
          boardEntry: { create: { boardId: board.id, statusId } },
        },
      });
    }
    it("requires an explicit replacement for used statuses and leaves all data unchanged on refusal", async () => {
      const task = await linkedTask();
      await call()
        .delete(`${base()}/statuses/${board.statuses[0].id}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID() })
        .expect(409);
      expect(
        (
          await prisma.taskBoardEntry.findUniqueOrThrow({
            where: { taskId: task.id },
          })
        ).statusId,
      ).toBe(board.statuses[0].id);
      expect(
        (await prisma.taskBoard.findUniqueOrThrow({ where: { id: board.id } }))
          .revision,
      ).toBe(0);
    });
    it("moves all used tasks atomically before status removal without changing runner state", async () => {
      const tasks = await Promise.all([linkedTask(), linkedTask()]);
      const response = await call()
        .delete(`${base()}/statuses/${board.statuses[0].id}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: board.statuses[1].id,
        })
        .expect(200);
      expect(response.body.affectedTasks).toBe(2);
      expect(response.body.after.statuses.map((s: any) => s.position)).toEqual([
        0, 1, 2,
      ]);
      expect(
        await prisma.taskBoardStatus.findUnique({
          where: { id: board.statuses[0].id },
        }),
      ).toBeNull();
      for (const task of tasks) {
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
            .status,
        ).toBe("RUNNING");
        expect(
          (
            await prisma.taskBoardEntry.findUniqueOrThrow({
              where: { taskId: task.id },
            })
          ).statusId,
        ).toBe(board.statuses[1].id);
      }
    });
    it("rolls back task moves and column deletion if audit persistence fails", async () => {
      const task = await linkedTask();
      const extended = prisma.$extends({
        query: {
          taskBoardAudit: {
            create() {
              throw new Error("Injected private audit failure");
            },
          },
        },
      });
      const service = new TaskBoardsService(
        extended as unknown as PrismaService,
      );
      await expect(
        service.remove(actor(), projectId, board.statuses[0].id, 0, {
          requestId: randomUUID(),
          replacementStatusId: board.statuses[1].id,
        }),
      ).rejects.toThrow("Injected private audit failure");
      expect(
        (
          await prisma.taskBoardEntry.findUniqueOrThrow({
            where: { taskId: task.id },
          })
        ).statusId,
      ).toBe(board.statuses[0].id);
      expect(
        await prisma.taskBoardStatus.count({ where: { boardId: board.id } }),
      ).toBe(4);
      expect(
        (await prisma.taskBoard.findUniqueOrThrow({ where: { id: board.id } }))
          .revision,
      ).toBe(0);
    });
    it("blocks linked-task project purge before quarantine or lifecycle mutation", async () => {
      await linkedTask();
      const token = "isolated-test-purge-token";
      const deletion = await prisma.projectDeletionRequest.create({
        data: {
          projectId,
          requestedById: owner,
          ownerId: owner,
          status: "AWAITING_TOKEN",
          tokenHash: createHash("sha256").update(token).digest("hex"),
          tokenExpiresAt: new Date(Date.now() + 60000),
        },
      });
      const service = new ProjectsService(
        prisma as unknown as PrismaService,
        {} as any,
        { validateDepartmentHome: (value: string) => value } as any,
        {} as any,
      );
      const directory = jest
        .spyOn(service as any, "projectDirectoryForDepartment")
        .mockRejectedValue(new Error("Filesystem must not be reached"));
      try {
        await expect(
          service.confirmProjectDeletion(
            actor(),
            projectId,
            deletion.id,
            token,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(directory).not.toHaveBeenCalled();
        expect(
          (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
            .status,
        ).toBe("READY");
        expect(
          (
            await prisma.projectDeletionRequest.findUniqueOrThrow({
              where: { id: deletion.id },
            })
          ).status,
        ).toBe("AWAITING_TOKEN");
        expect(
          await prisma.projectDeletionAudit.count({ where: { projectId } }),
        ).toBe(0);
      } finally {
        directory.mockRestore();
      }
    });
    it("rejects foreign task associations during status removal without moving data", async () => {
      const task = await linkedTask(
        board.statuses[0].id,
        foreignWorkspace,
        outsider,
      );
      await call()
        .delete(`${base()}/statuses/${board.statuses[0].id}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: board.statuses[1].id,
        })
        .expect(409);
      expect(
        (
          await prisma.taskBoardEntry.findUniqueOrThrow({
            where: { taskId: task.id },
          })
        ).statusId,
      ).toBe(board.statuses[0].id);
    });
    it("rejects incomplete reorder and same/foreign replacement statuses", async () => {
      const foreignProject = await prisma.project.create({
        data: {
          workspaceId: foreignWorkspace,
          departmentId: foreignDepartment,
          creatorId: outsider,
          name: "Foreign workflow",
          directoryName: randomUUID(),
        },
      });
      const foreignStatus = await prisma.taskBoardStatus.findFirstOrThrow({
        where: { board: { projectId: foreignProject.id } },
      });
      await call()
        .put(`${base()}/statuses/order`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), statusIds: [board.statuses[0].id] })
        .expect(400);
      await call()
        .delete(`${base()}/statuses/${board.statuses[0].id}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: board.statuses[0].id,
        })
        .expect(400);
      await call()
        .delete(`${base()}/statuses/${board.statuses[0].id}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: foreignStatus.id,
        })
        .expect(404);
    });
    it("retains a last status and rejects writes when project deletion has begun", async () => {
      for (let revision = 0; revision < 3; revision++)
        await call()
          .delete(`${base()}/statuses/${board.statuses[revision].id}`)
          .set("Authorization", `Bearer ${owner}`)
          .set("If-Match", `"${revision}"`)
          .send({ requestId: randomUUID() })
          .expect(200);
      await call()
        .delete(`${base()}/statuses/${board.statuses[3].id}`)
        .set("Authorization", `Bearer ${owner}`)
        .set("If-Match", '"3"')
        .send({ requestId: randomUUID() })
        .expect(409);
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "DELETING" },
      });
      await update(board.statuses[3].id, 3, {
        requestId: randomUUID(),
        name: "Blocked",
      }).expect(409);
    });
    it("pages the management audit without exposing task identities or hashes", async () => {
      for (let revision = 0; revision < 3; revision++)
        await update(board.statuses[0].id, revision, {
          requestId: randomUUID(),
          name: `Status ${revision}`,
        }).expect(200);
      const page = await call()
        .get(`${base()}/audit?limit=2`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(200);
      expect(page.body.items.map((row: any) => row.revision)).toEqual([1, 2]);
      expect(page.body).toMatchObject({ hasMore: true, nextAfterRevision: 2 });
      const next = await call()
        .get(`${base()}/audit?afterRevision=2&limit=2`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(200);
      expect(next.body.items.map((row: any) => row.revision)).toEqual([3]);
      expect(next.body.hasMore).toBe(false);
    });
    it("rejects invalid paths/query/body and publishes exact workflow contracts", async () => {
      await call()
        .get("/projects/invalid/task-board")
        .set("Authorization", `Bearer ${owner}`)
        .expect(400);
      await call()
        .get(`${base()}/audit?limit=0`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(400);
      await call()
        .get(`${base()}/audit?workspaceId=${foreignWorkspace}`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(400);
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const mutation =
        doc.paths["/projects/{projectId}/task-board/statuses"]!.post!;
      expect(mutation.responses).toHaveProperty("428");
      expect(mutation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "If-Match", required: true }),
        ]),
      );
      const schemas: any = doc.components!.schemas;
      expect(schemas.TaskBoardResponseDto.required).toEqual(
        expect.arrayContaining(["id", "projectId", "revision", "statuses"]),
      );
      expect(schemas.BoardStatusResponseDto.properties.color.enum).toEqual([
        "NEUTRAL",
        "TEAL",
        "PURPLE",
        "GREEN",
      ]);
    });
  },
);
