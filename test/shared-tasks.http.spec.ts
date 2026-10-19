import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  humanTaskSelection,
  humanTaskSnapshot,
  humanJson,
} from "../src/tasks/human-task-state";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { SharedTasksController } from "../src/tasks/shared-tasks.controller";
import { SharedTasksService } from "../src/tasks/shared-tasks.service";
import { HumanTasksController } from "../src/tasks/human-tasks.controller";
import { HumanTasksService } from "../src/tasks/human-tasks.service";
import { TaskBoardsController } from "../src/tasks/task-boards.controller";
import { TaskBoardsService } from "../src/tasks/task-boards.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { Permissions } from "../src/authorization/permission.catalog";
const request = require("supertest"),
  url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test");
}
(url ? describe : describe.skip)(
  "explicit owned task board sharing foundations",
  () => {
    let app: INestApplication,
      db: PrismaClient,
      w: string,
      fw: string,
      owner: string,
      assignee: string,
      viewer: string,
      foreign: string,
      ownerRole: string,
      departments: string[],
      source: string,
      target: string,
      another: string,
      foreignProject: string,
      taskId: string;
    let sourceBoard: any, targetBoard: any, anotherBoard: any;
    const grants = [
      Permissions.TASKS_CREATE,
      Permissions.TASK_DETAILS_MANAGE,
      Permissions.TASK_WORKFLOW_MOVE,
      Permissions.TASK_STATUSES_MANAGE,
      Permissions.PROJECTS_MANAGE_ALL,
    ];
    const http = () => request(app.getHttpServer());
    const base = (p = source) => `/projects/${p}/tasks/${taskId}`;
    const revision = async () =>
      (await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }))
        .revision;
    const change = async (
      action = "share",
      id = owner,
      p = target,
      body: object = {},
      rev?: number,
      requestId = randomUUID(),
    ) => {
      const route =
        action === "move"
          ? base(p) + "/shared-workflow-status"
          : base() + "/shares/" + p;
      const response = await http()
        [action === "unshare" ? "delete" : "put"](route)
        .set("Authorization", "Bearer " + id)
        .set("If-Match", `"${rev ?? (await revision())}"`)
        .send({
          requestId,
          ...(action !== "unshare"
            ? { statusId: targetBoard.statuses[0].id }
            : {}),
          ...body,
        });
      // Revision lookup is asynchronous; assert the completed HTTP response here.
      return Object.assign(response, {
        expect: (status: number) => {
          expect(response.status).toBe(status);
          return response;
        },
      });
    };
    const confirm = async (
      id = owner,
      body: object = {},
      rev?: number,
      requestId = randomUUID(),
      p = source,
    ) => {
      const response = await http()
        .post(base(p) + "/completion/confirm")
        .set("Authorization", "Bearer " + id)
        .set("If-Match", `"${rev ?? (await revision())}"`)
        .send({ requestId, ...body });
      return Object.assign(response, {
        expect: (status: number) => {
          expect(response.status).toBe(status);
          return response;
        },
      });
    };
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      fw = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      await db.permission.createMany({
        data: grants.map((key) => ({
          key,
          name: key,
          description: key,
          category: "test",
        })),
        skipDuplicates: true,
      });
      const user = async (workspaceId: string, keys: string[]) => {
        const role = await db.role.create({
          data: {
            workspaceId,
            key: randomUUID(),
            name: "ADMIN",
            permissions: {
              create: keys.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        const u = await db.user.create({
          data: {
            workspaceId,
            phoneNumber: randomUUID(),
            fullName: "Staff",
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: u.id, roleId: role.id };
      };
      const o = await user(w, grants);
      owner = o.id;
      ownerRole = o.roleId;
      assignee = (await user(w, grants)).id;
      viewer = (await user(w, [])).id;
      foreign = (await user(fw, grants)).id;
      departments = [];
      for (const workspaceId of [w, fw])
        departments.push(
          (
            await db.department.create({
              data: {
                workspaceId,
                slug: randomUUID(),
                name: "Tasks",
                homePath: "/opt/shared-task-tests",
              },
            })
          ).id,
        );
      const project = async (
        workspaceId: string,
        departmentId: string,
        creatorId: string,
        ids: string[],
      ) =>
        db.project.create({
          data: {
            workspaceId,
            departmentId,
            creatorId,
            name: "Private project",
            directoryName: randomUUID(),
            members: { create: ids.map((userId) => ({ userId })) },
          },
        });
      source = (await project(w, departments[0]!, owner, [owner, assignee])).id;
      target = (
        await project(w, departments[0]!, owner, [owner, assignee, viewer])
      ).id;
      another = (await project(w, departments[0]!, owner, [owner, assignee]))
        .id;
      foreignProject = (await project(fw, departments[1]!, foreign, [foreign]))
        .id;
      sourceBoard = await db.taskBoard.findUniqueOrThrow({
        where: { projectId: source },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
      targetBoard = await db.taskBoard.findUniqueOrThrow({
        where: { projectId: target },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
      anotherBoard = await db.taskBoard.findUniqueOrThrow({
        where: { projectId: another },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
      const module = await Test.createTestingModule({
        controllers: [
          SharedTasksController,
          HumanTasksController,
          TaskBoardsController,
        ],
        providers: [
          SharedTasksService,
          HumanTasksService,
          TaskBoardsService,
          { provide: PrismaService, useValue: db },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                type: id === "linked-agent-token" ? "agent" : "access",
                exp: Math.floor(Date.now() / 1000) + 3600,
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
      jest.restoreAllMocks();
      await db.task.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
      await db.user.update({ where: { id: owner }, data: { status: "OPEN" } });
      await db.rolePermission.createMany({
        data: grants.map((permissionKey) => ({
          roleId: ownerRole,
          permissionKey,
        })),
        skipDuplicates: true,
      });
      for (const projectId of [source, target, another]) {
        await db.project.update({
          where: { id: projectId },
          data: { archivedAt: null, status: "READY" },
        });
        await db.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: owner } },
          create: { projectId, userId: owner },
          update: {},
        });
      }
      taskId = (
        await db.task.create({
          data: {
            workspaceId: w,
            creatorId: owner,
            managerId: assignee,
            title: "Canonical task",
            description: "Private human content",
            criteria: "PRIVATE RUNNER",
            status: "COMPLETED",
            humanState: { create: {} },
            boardEntry: {
              create: {
                boardId: sourceBoard.id,
                statusId: sourceBoard.statuses[1].id,
              },
            },
            assignees: { create: { userId: assignee } },
          },
        })
      ).id;
    });
    afterAll(async () => {
      await app?.close();
      if (db) {
        await db.task.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.project.deleteMany({
          where: { workspaceId: { in: [w, fw] } },
        });
        await db.department.deleteMany({ where: { id: { in: departments } } });
        await db.user.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.role.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
        await db.$disconnect();
      }
    });
    it("shares one identity without changing original workflow, assignees or runner completion", async () => {
      const before = await db.task.findUniqueOrThrow({
        where: { id: taskId },
        include: { boardEntry: true, assignees: true },
      });
      await (await change()).expect(200);
      const current = await db.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          boardEntry: true,
          assignees: true,
          sharedEntries: true,
          humanState: true,
        },
      });
      expect(current.boardEntry).toEqual(before.boardEntry);
      expect(current.assignees).toEqual(before.assignees);
      expect(current.status).toBe("COMPLETED");
      expect(current.humanState?.completed).toBeNull();
      expect(current.sharedEntries).toHaveLength(1);
      expect(current.sharedEntries[0]).toMatchObject({
        taskId,
        boardId: targetBoard.id,
        statusId: targetBoard.statuses[0].id,
        createdById: owner,
      });
    });
    it("denies non-owner, missing permission, foreign and nonmember destinations", async () => {
      await (await change("share", assignee)).expect(403);
      await (await change("share", viewer)).expect(403);
      await (await change("share", owner, foreignProject)).expect(404);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: target, userId: owner } },
      });
      await (await change()).expect(404);
      await db.projectMember.create({
        data: { projectId: target, userId: owner },
      });
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASKS_CREATE,
          },
        },
      });
      await (await change()).expect(403);
      expect(await db.taskSharedBoardEntry.count({ where: { taskId } })).toBe(
        0,
      );
    });
    it("rejects wrong-board columns, original-board duplication and forged fields", async () => {
      await (
        await change("share", owner, target, {
          statusId: sourceBoard.statuses[0].id,
        })
      ).expect(404);
      await (
        await change("share", owner, source, {
          statusId: sourceBoard.statuses[0].id,
        })
      ).expect(400);
      for (const body of [
        { completed: true },
        { ownerId: viewer },
        { workspaceId: fw },
      ])
        await (await change("share", owner, target, body)).expect(400);
    });
    it("replays sharing receipts without resurrecting an explicitly removed association", async () => {
      const r = randomUUID(),
        rev = await revision();
      const receipt = (
        await (await change("share", owner, target, {}, rev, r)).expect(200)
      ).body;
      expect(
        (await (await change("share", owner, target, {}, rev, r)).expect(200))
          .body,
      ).toEqual(receipt);
      await (await change("unshare")).expect(200);
      expect(
        (await (await change("share", owner, target, {}, rev, r)).expect(200))
          .body,
      ).toEqual(receipt);
      expect(await db.taskSharedBoardEntry.count({ where: { taskId } })).toBe(
        0,
      );
      await (
        await change(
          "share",
          owner,
          target,
          { statusId: targetBoard.statuses[1].id },
          rev,
          r,
        )
      ).expect(409);
      expect(
        (
          await http()
            .get(base() + "/sharing-operations/" + r)
            .set("Authorization", "Bearer " + owner)
            .expect(200)
        ).body,
      ).toEqual(receipt);
    });
    it("rejects stale concurrent sharing drafts and commits one complete winner", async () => {
      const rev = await revision();
      const results = await Promise.all([
        change("share", owner, target, {}, rev),
        change(
          "share",
          owner,
          another,
          { statusId: anotherBoard.statuses[0].id },
          rev,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await db.taskSharedBoardEntry.count({ where: { taskId } })).toBe(
        1,
      );
      expect(await db.taskSharingOperation.count({ where: { taskId } })).toBe(
        1,
      );
    });
    it("moves a local column without updating other boards or canonical completion", async () => {
      await (await change()).expect(200);
      await (
        await change("share", owner, another, {
          statusId: anotherBoard.statuses[0].id,
        })
      ).expect(200);
      await (
        await change("move", owner, target, {
          statusId: targetBoard.statuses[2].id,
        })
      ).expect(403);
      await (
        await change("move", assignee, target, {
          statusId: targetBoard.statuses[2].id,
        })
      ).expect(200);
      expect(
        (
          await db.taskSharedBoardEntry.findUniqueOrThrow({
            where: { taskId_boardId: { taskId, boardId: anotherBoard.id } },
          })
        ).statusId,
      ).toBe(anotherBoard.statuses[0].id);
      expect(
        (await db.taskBoardEntry.findUniqueOrThrow({ where: { taskId } }))
          .statusId,
      ).toBe(sourceBoard.statuses[1].id);
      expect(
        (await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }))
          .completed,
      ).toBeNull();
    });
    it("preserves the single canonical completion record across sharing, local movement and unsharing", async () => {
      const completedAt = new Date("2026-01-01T00:00:00.000Z");
      await db.taskHumanState.update({
        where: { taskId },
        data: { completed: true, completedById: owner, completedAt },
      });
      await (await change()).expect(200);
      await (
        await change("share", owner, another, {
          statusId: anotherBoard.statuses[0].id,
        })
      ).expect(200);
      await (
        await change("move", assignee, target, {
          statusId: targetBoard.statuses[3].id,
        })
      ).expect(200);
      await (await change("unshare")).expect(200);
      expect(
        await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }),
      ).toMatchObject({ completed: true, completedById: owner, completedAt });
      expect(await db.taskHumanState.count({ where: { taskId } })).toBe(1);
      for (const p of [source, another]) {
        const view = (
          await http()
            .get(base(p) + "/shared-state")
            .set("Authorization", "Bearer " + owner)
            .expect(200)
        ).body;
        expect(view).toMatchObject({ taskId, projectId: p, completed: true });
      }
      await http()
        .get(base(target) + "/shared-state")
        .set("Authorization", "Bearer " + viewer)
        .expect(404);
      expect(
        (
          await db.taskSharedBoardEntry.findUniqueOrThrow({
            where: { taskId_boardId: { taskId, boardId: anotherBoard.id } },
          })
        ).taskId,
      ).toBe(taskId);
    });
    it("reads only one canonical state and local column without content or other project metadata", async () => {
      await http()
        .get(base(target) + "/shared-state")
        .set("Authorization", "Bearer " + viewer)
        .expect(404);
      await (await change()).expect(200);
      const shared = (
        await http()
          .get(base(target) + "/shared-state")
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(shared).toEqual({
        taskId,
        projectId: target,
        statusId: targetBoard.statuses[0].id,
        revision: await revision(),
        completed: null,
      });
      expect(JSON.stringify(shared)).not.toMatch(
        new RegExp(
          `${source}|Private human content|PRIVATE RUNNER|Canonical task`,
        ),
      );
      await db.taskHumanState.update({
        where: { taskId },
        data: {
          completed: true,
          completedById: owner,
          completedAt: new Date(),
        },
      });
      const original = (
        await http()
          .get(base() + "/shared-state")
          .set("Authorization", "Bearer " + owner)
          .expect(200)
      ).body;
      const destination = (
        await http()
          .get(base(target) + "/shared-state")
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(original.completed).toBe(true);
      expect(destination.completed).toBe(true);
      expect(original.statusId).toBe(sourceBoard.statuses[1].id);
      expect(destination.statusId).toBe(targetBoard.statuses[0].id);
      await http()
        .get(base(target) + "/shared-state?viewerId=" + owner)
        .set("Authorization", "Bearer " + viewer)
        .expect(400);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: target, userId: viewer } },
      });
      await http()
        .get(base(target) + "/shared-state")
        .set("Authorization", "Bearer " + viewer)
        .expect(404);
      await db.projectMember.create({
        data: { projectId: target, userId: viewer },
      });
    });
    it("keeps hidden destinations out of owner snapshots after membership revocation", async () => {
      await (await change()).expect(200);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: target, userId: owner } },
      });
      const r = (
        await http()
          .get(base() + "/sharing")
          .set("Authorization", "Bearer " + owner)
          .expect(200)
      ).body;
      expect(r.shares).toEqual([]);
      expect(JSON.stringify(r)).not.toContain(target);
      await (await change("unshare")).expect(404);
    });
    it("does not expose source content or history through destination membership", async () => {
      await (await change()).expect(200);
      const targetRead = await http()
        .get(base(target))
        .set("Authorization", "Bearer " + viewer)
        .expect(404);
      expect(JSON.stringify(targetRead.body)).not.toMatch(
        /Private human content|PRIVATE RUNNER|Canonical task/,
      );
      await http()
        .get(base() + "/sharing")
        .set("Authorization", "Bearer " + viewer)
        .expect(404);
    });
    it("retains immutable receipts and rolls back association when receipt persistence fails", async () => {
      await db.$executeRawUnsafe(
        `CREATE FUNCTION test_sharing_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER test_sharing_receipt_failure BEFORE INSERT ON "TaskSharingOperation" FOR EACH ROW EXECUTE FUNCTION test_sharing_receipt_failure()`,
      );
      try {
        await (await change()).expect(500);
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER test_sharing_receipt_failure ON "TaskSharingOperation"`,
        );
        await db.$executeRawUnsafe(
          `DROP FUNCTION test_sharing_receipt_failure()`,
        );
      }
      expect(await db.taskSharedBoardEntry.count({ where: { taskId } })).toBe(
        0,
      );
      expect(await revision()).toBe(0);
    });
    it("denies new writes in archived contexts while allowing prior authorized receipt replay", async () => {
      const r = randomUUID(),
        rev = await revision();
      await (await change("share", owner, target, {}, rev, r)).expect(200);
      await db.project.update({
        where: { id: target },
        data: { archivedAt: new Date() },
      });
      await (await change("share", owner, target, {}, rev, r)).expect(200);
      await (await change("unshare")).expect(409);
    });
    it("guards cross-workspace and cross-board writes in PostgreSQL", async () => {
      const f = await db.taskBoard.findUniqueOrThrow({
        where: { projectId: foreignProject },
        include: { statuses: true },
      });
      await expect(
        db.taskSharedBoardEntry.create({
          data: {
            taskId,
            boardId: f.id,
            statusId: f.statuses[0]!.id,
            createdById: owner,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.taskSharedBoardEntry.create({
          data: {
            taskId,
            boardId: sourceBoard.id,
            statusId: sourceBoard.statuses[0].id,
            createdById: owner,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.taskSharedBoardEntry.create({
          data: {
            taskId,
            boardId: targetBoard.id,
            statusId: sourceBoard.statuses[0].id,
            createdById: owner,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.taskHumanState.update({
          where: { taskId },
          data: { completed: true },
        }),
      ).rejects.toThrow();
    });
    it("refuses status removal until occupied shared tasks are moved explicitly", async () => {
      await (await change()).expect(200);
      const board = await db.taskBoard.findUniqueOrThrow({
        where: { id: targetBoard.id },
      });
      await http()
        .delete(
          `/projects/${target}/task-board/statuses/${targetBoard.statuses[0].id}`,
        )
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", `"${board.revision}"`)
        .send({
          requestId: randomUUID(),
          replacementStatusId: targetBoard.statuses[1].id,
        })
        .expect(409);
      expect(
        (
          await db.taskSharedBoardEntry.findUniqueOrThrow({
            where: { taskId_boardId: { taskId, boardId: targetBoard.id } },
          })
        ).statusId,
      ).toBe(targetBoard.statuses[0].id);
    });
    it("lets only the creator confirm canonical completion without changing board or runner state", async () => {
      await (await change()).expect(200);
      await db.task.update({
        where: { id: taskId },
        data: { status: "RUNNING" },
      });
      const r = (await (await confirm()).expect(200)).body;
      expect(r).toMatchObject({
        actorId: owner,
        action: "CONFIRM_COMPLETION",
        completed: true,
        statusId: null,
        targetProjectId: null,
      });
      const state = await db.taskHumanState.findUniqueOrThrow({
        where: { taskId },
      });
      expect(state).toMatchObject({ completed: true, completedById: owner });
      expect(state.completedAt?.toISOString()).toBe(r.createdAt);
      for (const p of [source, target]) {
        const value = (
          await http()
            .get(base(p) + "/shared-state")
            .set("Authorization", "Bearer " + owner)
            .expect(200)
        ).body;
        expect(value.completed).toBe(true);
      }
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("RUNNING");
      expect(
        (await db.taskBoardEntry.findUniqueOrThrow({ where: { taskId } }))
          .statusId,
      ).toBe(sourceBoard.statuses[1].id);
      expect(
        (
          await db.taskSharedBoardEntry.findUniqueOrThrow({
            where: { taskId_boardId: { taskId, boardId: targetBoard.id } },
          })
        ).statusId,
      ).toBe(targetBoard.statuses[0].id);
    });
    it("lets the represented employee creator confirm while preserving a preexisting linked-agent creation audit", async () => {
      const agentId = randomUUID();
      await db.taskHumanState.update({
        where: { taskId },
        data: { revision: 1 },
      });
      const task = await db.task.findUniqueOrThrow({
        where: { id: taskId },
        select: humanTaskSelection,
      });
      // Trusted origin fixture only: no live agent task-creation adapter or credentials.
      const origin = await db.taskHumanAudit.create({
        data: {
          taskId,
          requestId: randomUUID(),
          inputHash: "a".repeat(64),
          actorId: agentId,
          action: "CREATED_BY_OWNER_LINKED_AGENT",
          revision: 1,
          before: Prisma.JsonNull,
          after: humanJson(humanTaskSnapshot(task)),
        },
      });
      const receipt = (await (await confirm()).expect(200)).body;
      expect(receipt.actorId).toBe(owner);
      expect(
        (await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }))
          .completedById,
      ).toBe(owner);
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).creatorId,
      ).toBe(owner);
      expect(
        await db.taskHumanAudit.findUniqueOrThrow({ where: { id: origin.id } }),
      ).toEqual(origin);
      expect(origin.actorId).toBe(agentId);
      expect((origin.after as any).ownerId).toBe(owner);
    });
    it("rejects an agent principal attempting autonomous final confirmation", async () => {
      await (await confirm("linked-agent-token")).expect(401);
      const svc = app.get(SharedTasksService);
      await expect(
        svc.mutate(
          { id: owner, workspaceId: w, roles: [], permissions: grants },
          source,
          taskId,
          null,
          await revision(),
          "CONFIRM_COMPLETION",
          { requestId: randomUUID() },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        svc.mutate(
          {
            id: owner,
            workspaceId: w,
            type: "agent",
            roles: [],
            permissions: grants,
          } as any,
          source,
          taskId,
          null,
          await revision(),
          "CONFIRM_COMPLETION",
          { requestId: randomUUID() },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }))
          .completed,
      ).toBeNull();
    });
    it("denies assignee, role-label and missing owner-edit authority for final completion", async () => {
      await (await confirm(assignee)).expect(403);
      await (await confirm(viewer)).expect(403);
      await (await confirm(foreign)).expect(404);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_DETAILS_MANAGE,
          },
        },
      });
      await (await confirm()).expect(403);
      expect(
        (await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }))
          .completed,
      ).toBeNull();
    });
    it("uses owner-edit authority rather than requiring sharing permission for confirmation", async () => {
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASKS_CREATE,
          },
        },
      });
      await (await confirm()).expect(200);
    });
    it("rejects reopening, ownership and query selectors on the one-way confirmation route", async () => {
      for (const body of [
        { completed: false },
        { completed: true },
        { ownerId: assignee },
        { workspaceId: fw },
      ])
        await (await confirm(owner, body)).expect(400);
      await http()
        .post(base() + "/completion/confirm?viewerId=" + owner)
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", `"${await revision()}"`)
        .send({ requestId: randomUUID() })
        .expect(400);
      await http()
        .post(base() + "/completion/confirm")
        .send({ requestId: randomUUID() })
        .expect(401);
    });
    it("replays the original completion receipt without replacing attribution or accepting another confirmation", async () => {
      const rev = await revision(),
        r = randomUUID();
      const receipt = (await (await confirm(owner, {}, rev, r)).expect(200))
        .body;
      const before = await db.taskHumanState.findUniqueOrThrow({
        where: { taskId },
      });
      expect(
        (await (await confirm(owner, {}, rev, r)).expect(200)).body,
      ).toEqual(receipt);
      expect(
        (
          await http()
            .get(base() + "/sharing-operations/" + r)
            .set("Authorization", "Bearer " + owner)
            .expect(200)
        ).body,
      ).toEqual(receipt);
      await (await confirm()).expect(409);
      expect(
        await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }),
      ).toEqual(before);
      expect(
        await db.taskSharingOperation.count({
          where: { taskId, action: "CONFIRM_COMPLETION" },
        }),
      ).toBe(1);
    });
    it("serializes concurrent creator confirmations into one durable winner", async () => {
      const rev = await revision();
      const results = await Promise.all([
        confirm(owner, {}, rev),
        confirm(owner, {}, rev),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await db.taskSharingOperation.count({
          where: { taskId, action: "CONFIRM_COMPLETION" },
        }),
      ).toBe(1);
    });
    it("keeps assignee workflow moves independent after confirmation and never implicitly reopens", async () => {
      await (await change()).expect(200);
      await (await confirm()).expect(200);
      const before = await db.taskHumanState.findUniqueOrThrow({
        where: { taskId },
      });
      await (
        await change("move", assignee, target, {
          statusId: targetBoard.statuses[2].id,
        })
      ).expect(200);
      await (
        await change("move", assignee, target, {
          statusId: targetBoard.statuses[0].id,
        })
      ).expect(200);
      expect(
        await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }),
      ).toMatchObject({
        completed: true,
        completedById: owner,
        completedAt: before.completedAt,
      });
    });
    it("retains original-project membership and rejects confirmation through a destination alias", async () => {
      await (await change()).expect(200);
      await (
        await confirm(owner, {}, undefined, randomUUID(), target)
      ).expect(404);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: source, userId: owner } },
      });
      await (await confirm()).expect(404);
    });
    it("rolls completion, attribution and revision back when the receipt cannot be stored", async () => {
      await db.$executeRawUnsafe(
        `CREATE FUNCTION test_confirm_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected confirmation receipt failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER test_confirm_receipt_failure BEFORE INSERT ON "TaskSharingOperation" FOR EACH ROW EXECUTE FUNCTION test_confirm_receipt_failure()`,
      );
      try {
        await (await confirm()).expect(500);
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER test_confirm_receipt_failure ON "TaskSharingOperation"`,
        );
        await db.$executeRawUnsafe(
          `DROP FUNCTION test_confirm_receipt_failure()`,
        );
      }
      expect(
        await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }),
      ).toMatchObject({
        completed: null,
        completedById: null,
        completedAt: null,
        revision: 0,
      });
    });
    it("rechecks owner edit permission after authentication and on committed replay", async () => {
      const rev = await revision(),
        r = randomUUID();
      await (await confirm(owner, {}, rev, r)).expect(200);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_DETAILS_MANAGE,
          },
        },
      });
      await (await confirm(owner, {}, rev, r)).expect(403);
    });
    it("documents narrow sharing operations without adding role grants", () => {
      const spec: any = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        spec.paths[
          "/projects/{projectId}/tasks/{taskId}/shares/{targetProjectId}"
        ].put,
      ).toBeDefined();
      expect(spec.components.schemas.ShareTaskDto.required).toEqual(
        expect.arrayContaining(["requestId", "statusId"]),
      );
    });
  },
);
