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
import { SharedTaskContentController } from "../src/tasks/shared-task-content.controller";
import { SharedTaskContentService } from "../src/tasks/shared-task-content.service";
import { HumanTasksController } from "../src/tasks/human-tasks.controller";
import { HumanTasksService } from "../src/tasks/human-tasks.service";
import { HumanTaskActionsController } from "../src/tasks/human-task-actions.controller";
import { HumanTaskActionsService } from "../src/tasks/human-task-actions.service";
import { TaskDeadlinesService } from "../src/tasks/task-deadlines.service";
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
      Permissions.TASK_CHECKLIST_MANAGE,
      Permissions.TASK_CHECKLIST_COMPLETE,
      Permissions.TASK_COMMENTS_CREATE,
      Permissions.TASK_DEADLINES_MANAGE,
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
          SharedTaskContentController,
          SharedTasksController,
          HumanTasksController,
          TaskBoardsController,
          HumanTaskActionsController,
        ],
        providers: [
          SharedTaskContentService,
          SharedTasksService,
          HumanTasksService,
          TaskBoardsService,
          HumanTaskActionsService,
          TaskDeadlinesService,
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
    const mutateHuman = async (
      method: "post" | "patch" | "put" | "delete",
      path: string,
      body: object = {},
      id = owner,
      rev?: number,
      requestId = randomUUID(),
      projectId = source,
    ) =>
      http()
        [method](base(projectId) + path)
        .set("Authorization", "Bearer " + id)
        .set("If-Match", `"${rev ?? (await revision())}"`)
        .send({ requestId, ...body });
    const sharedContent = (p = target, id = viewer) =>
      http()
        .get(base(p) + "/shared-content")
        .set("Authorization", "Bearer " + id);
    const addItem = (
      body: object = {},
      rev?: number,
      requestId = randomUUID(),
    ) =>
      mutateHuman(
        "post",
        "/checklist",
        { itemId: randomUUID(), title: "Item", assigneeId: assignee, ...body },
        owner,
        rev,
        requestId,
      );
    const items = async () =>
      db.taskChecklistItem.findMany({
        where: { taskId },
        orderBy: { position: "asc" },
      });

    it("preserves legacy flat rows and exposes stable original and empty side sections without source identities", async () => {
      const legacy = await db.taskChecklistItem.create({
        data: {
          taskId,
          assigneeId: assignee,
          title: "Legacy",
          position: 0,
          completed: true,
          completedById: assignee,
          completedAt: new Date(),
          deadline: {
            kind: "DATE",
            date: "2026-12-01",
            time: null,
            timeZone: null,
            utcOffset: null,
            instant: null,
          },
        },
      });
      await (await change()).expect(200);
      await (
        await change("share", owner, another, {
          statusId: anotherBoard.statuses[0].id,
        })
      ).expect(200);
      const read = await sharedContent().expect(200);
      expect(read.body.checklistSections).toHaveLength(3);
      expect(
        read.body.checklistSections.filter((s: any) => s.currentSide),
      ).toHaveLength(1);
      expect(
        read.body.checklistSections.find((s: any) => s.original).items[0],
      ).toMatchObject({
        id: legacy.id,
        parentId: null,
        completed: true,
        assigneeId: assignee,
        children: [],
        deadline: legacy.deadline,
      });
      expect(await items()).toEqual([legacy]);
      const other = await sharedContent(another, assignee).expect(200);
      expect(other.body.checklistSections.map((s: any) => s.id).sort()).toEqual(
        read.body.checklistSections.map((s: any) => s.id).sort(),
      );
      expect(JSON.stringify(read.body)).not.toContain(sourceBoard.id);
      expect(JSON.stringify(read.body)).not.toContain(source);
      expect(JSON.stringify(read.body)).not.toContain(another);
    });
    it("inserts siblings, reparents subtrees and reorders without changing identity, deadline or completion", async () => {
      await (await change()).expect(200);
      const root = randomUUID(),
        child = randomUUID(),
        sibling = randomUUID(),
        secondRoot = randomUUID();
      await addItem({ itemId: root, deadline: { date: "2026-12-01" } }).then(
        (r) => expect(r.status).toBe(200),
      );
      expect((await addItem({ itemId: child, parentId: root })).status).toBe(
        200,
      );
      expect(
        (
          await addItem({
            itemId: sibling,
            parentId: root,
            beforeItemId: child,
          })
        ).status,
      ).toBe(200);
      expect((await addItem({ itemId: secondRoot })).status).toBe(200);
      await mutateHuman(
        "put",
        `/checklist/${child}/completion`,
        { completed: true },
        assignee,
      ).then((r) => expect(r.status).toBe(200));
      const preserved = (await items()).find((i) => i.id === child)!;
      expect(
        (
          await mutateHuman("patch", `/checklist/${child}`, {
            parentId: secondRoot,
          })
        ).status,
      ).toBe(200);
      const ids = (await items()).map((i) => i.id).reverse();
      expect(
        (await mutateHuman("put", "/checklist/order", { itemIds: ids })).status,
      ).toBe(200);
      const after = (await items()).find((i) => i.id === child)!;
      expect(after).toMatchObject({
        id: preserved.id,
        deadline: preserved.deadline,
        completed: true,
        completedAt: preserved.completedAt,
        completedById: assignee,
        parentId: secondRoot,
        createdAt: preserved.createdAt,
      });
      const read = await sharedContent().expect(200);
      const roots = read.body.checklistSections.find(
        (s: any) => s.original,
      ).items;
      expect(roots.find((i: any) => i.id === secondRoot).children[0].id).toBe(
        child,
      );
      expect(roots.find((i: any) => i.id === root).children[0].id).toBe(
        sibling,
      );
      expect(read.body.completed).toBeNull();
    });
    it("rejects self/descendant cycles, missing parents, cross-section parents and parent removal", async () => {
      await (await change()).expect(200);
      const root = randomUUID(),
        child = randomUUID();
      expect((await addItem({ itemId: root })).status).toBe(200);
      expect((await addItem({ itemId: child, parentId: root })).status).toBe(
        200,
      );
      const before = await items(),
        rev = await revision();
      for (const parentId of [root, child])
        expect(
          (await mutateHuman("patch", `/checklist/${root}`, { parentId }))
            .status,
        ).toBe(409);
      expect((await addItem({ parentId: randomUUID() })).status).toBe(404);
      const sectionId = (await sharedContent()).body.checklistSections.find(
        (s: any) => s.currentSide,
      ).id;
      expect((await addItem({ sectionId, parentId: root })).status).toBe(409);
      expect((await mutateHuman("delete", `/checklist/${root}`)).status).toBe(
        409,
      );
      expect(await items()).toEqual(before);
      expect(await revision()).toBe(rev);
    });
    it("rejects depth overflow introduced by either insertion or subtree reparenting", async () => {
      let parentId: string | null = null;
      const chain: string[] = [];
      for (let i = 0; i < 8; i++) {
        const id = randomUUID();
        expect((await addItem({ itemId: id, parentId })).status).toBe(200);
        parentId = id;
        chain.push(id);
      }
      expect((await addItem({ parentId })).status).toBe(409);
      const root = randomUUID(),
        child = randomUUID();
      expect((await addItem({ itemId: root })).status).toBe(200);
      expect((await addItem({ itemId: child, parentId: root })).status).toBe(
        200,
      );
      expect(
        (
          await mutateHuman("patch", `/checklist/${root}`, {
            parentId: chain[6],
          })
        ).status,
      ).toBe(409);
    });
    it("keeps section management under current creator authority and both memberships", async () => {
      await (await change()).expect(200);
      const sectionId = (await sharedContent()).body.checklistSections.find(
        (s: any) => s.currentSide,
      ).id;
      expect((await addItem({ sectionId })).status).toBe(200);
      const item = (await items())[0]!;
      expect(
        (
          await mutateHuman(
            "patch",
            `/checklist/${item.id}`,
            { title: "Unauthorized" },
            assignee,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await mutateHuman(
            "patch",
            `/checklist/${item.id}`,
            { title: "Unauthorized" },
            owner,
            undefined,
            randomUUID(),
            target,
          )
        ).status,
      ).toBe(404);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: target, userId: owner } },
      });
      expect(
        (
          await mutateHuman("patch", `/checklist/${item.id}`, {
            title: "Revoked",
          })
        ).status,
      ).toBe(404);
      expect((await addItem({ sectionId })).status).toBe(404);
      // Source section edits continue under their independent original authority.
      expect((await addItem()).status).toBe(200);
    });
    it("retains removed-side trees but denies side edits and restores the same section identity on reshare", async () => {
      await (await change()).expect(200);
      const sectionId = (await sharedContent()).body.checklistSections.find(
        (s: any) => s.currentSide,
      ).id;
      expect((await addItem({ sectionId })).status).toBe(200);
      const id = (await items())[0]!.id;
      await (await change("unshare")).expect(200);
      await sharedContent().expect(404);
      expect(
        (
          await mutateHuman("patch", `/checklist/${id}`, {
            title: "No stale authority",
          })
        ).status,
      ).toBe(404);
      await (
        await change("share", owner, another, {
          statusId: anotherBoard.statuses[0].id,
        })
      ).expect(200);
      const retained = await sharedContent(another, assignee).expect(200);
      expect(
        retained.body.checklistSections.find((s: any) => s.id === sectionId),
      ).toMatchObject({
        active: false,
        items: [expect.objectContaining({ id })],
      });
      await (await change()).expect(200);
      expect(
        (await sharedContent()).body.checklistSections.find(
          (s: any) => s.currentSide,
        ).id,
      ).toBe(sectionId);
    });
    it("serializes concurrent tree edits and rejects stale drafts while preserving exact retry outcomes", async () => {
      const a = randomUUID(),
        b = randomUUID();
      expect((await addItem({ itemId: a })).status).toBe(200);
      expect((await addItem({ itemId: b })).status).toBe(200);
      const rev = await revision();
      const race = await Promise.all([
        mutateHuman("patch", `/checklist/${a}`, { parentId: b }, owner, rev),
        mutateHuman("patch", `/checklist/${b}`, { parentId: a }, owner, rev),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      const requestId = randomUUID(),
        current = await revision();
      const first = await mutateHuman(
        "patch",
        `/checklist/${a}`,
        { title: "Canonical" },
        owner,
        current,
        requestId,
      );
      expect(first.status).toBe(200);
      const retry = await mutateHuman(
        "patch",
        `/checklist/${a}`,
        { title: "Canonical" },
        owner,
        current,
        requestId,
      );
      expect(retry.body).toEqual(first.body);
      expect(
        (
          await mutateHuman(
            "patch",
            `/checklist/${a}`,
            { title: "Different" },
            owner,
            current,
            requestId,
          )
        ).status,
      ).toBe(409);
      expect(await revision()).toBe(current + 1);
    });
    it("rolls back insertion, reparent/order and lifecycle if final audit persistence fails", async () => {
      const root = randomUUID();
      expect((await addItem({ itemId: root })).status).toBe(200);
      const originalTransaction = db.$transaction.bind(db);
      const spy = jest.spyOn(db, "$transaction").mockImplementation(((
        fn: any,
        options: any,
      ) =>
        originalTransaction(async (tx: any) => {
          tx.taskHumanAudit.create = async () => {
            throw new Error("synthetic audit failure");
          };
          return fn(tx);
        }, options)) as any);
      const before = await items(),
        rev = await revision();
      expect(
        (await addItem({ parentId: root, beforeItemId: null })).status,
      ).toBe(500);
      expect(
        (
          await mutateHuman("patch", `/checklist/${root}`, {
            parentId: null,
            beforeItemId: null,
          })
        ).status,
      ).toBe(500);
      expect((await mutateHuman("post", "/archive")).status).toBe(500);
      spy.mockRestore();
      expect(await items()).toEqual(before);
      expect(await revision()).toBe(rev);
      expect(
        (await db.taskHumanState.findUniqueOrThrow({ where: { taskId } }))
          .archivedAt,
      ).toBeNull();
    });
    it("propagates canonical source edits, archive and soft deletion to every side while retaining comments/history", async () => {
      await (await change()).expect(200);
      await (
        await change("share", owner, another, {
          statusId: anotherBoard.statuses[0].id,
        })
      ).expect(200);
      expect(
        (
          await mutateHuman(
            "post",
            "/comments",
            { body: "Shared history" },
            assignee,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await mutateHuman("patch", "/details", {
            title: "Updated everywhere",
          })
        ).status,
      ).toBe(200);
      const requestId = randomUUID(),
        rev = await revision();
      const archive = await mutateHuman(
        "post",
        "/archive",
        {},
        owner,
        rev,
        requestId,
      );
      expect(archive.status).toBe(200);
      for (const [p, id] of [
        [target, viewer],
        [another, assignee],
      ]) {
        const read = await sharedContent(p, id).expect(200);
        expect(read.body).toMatchObject({
          title: "Updated everywhere",
          lifecycle: { state: "ARCHIVED" },
        });
      }
      expect((await addItem()).status).toBe(409);
      expect((await confirm()).status).toBe(409);
      const archivedRetry = await mutateHuman(
        "post",
        "/archive",
        {},
        owner,
        rev,
        requestId,
      );
      expect(archivedRetry.body).toEqual(archive.body);
      expect((await mutateHuman("delete", "/content")).status).toBe(200);
      expect((await sharedContent()).body.lifecycle.state).toBe("DELETED");
      const listing = await http()
        .get(`/projects/${target}/shared-tasks`)
        .set("Authorization", "Bearer " + viewer)
        .expect(200);
      expect(
        listing.body.items.find((i: any) => i.id === taskId).lifecycle.state,
      ).toBe("DELETED");
      const comments = await http()
        .get(base(target) + "/shared-comments")
        .set("Authorization", "Bearer " + viewer)
        .expect(200);
      expect(comments.body.items[0].body).toBe("Shared history");
      const history = await http()
        .get(base(target) + "/shared-history")
        .set("Authorization", "Bearer " + viewer)
        .expect(200);
      expect(history.body.items.map((i: any) => i.action)).toEqual(
        expect.arrayContaining(["ARCHIVE", "DELETE"]),
      );
      expect(await db.taskSharedBoardEntry.count({ where: { taskId } })).toBe(
        2,
      );
      expect(await db.task.count({ where: { id: taskId } })).toBe(1);
    });
    it("exposes source project archival canonically while keeping local board state independent", async () => {
      await (await change()).expect(200);
      const original = (await sharedContent()).body.statusId;
      await db.project.update({
        where: { id: source },
        data: { archivedAt: new Date() },
      });
      const read = await sharedContent().expect(200);
      expect(read.body.lifecycle.state).toBe("ARCHIVED");
      expect(read.body.statusId).toBe(original);
      expect(read.body.projectArchivedAt).toBeNull();
      expect(read.body.lifecycle.sourceProjectArchivedAt).toBeTruthy();
    });
    it("requires fresh source authority for deletion and denies retry/read after revocation", async () => {
      await (await change()).expect(200);
      expect(
        (await mutateHuman("delete", "/content", {}, assignee)).status,
      ).toBe(403);
      expect(
        (
          await mutateHuman(
            "delete",
            "/content",
            {},
            owner,
            undefined,
            randomUUID(),
            target,
          )
        ).status,
      ).toBe(404);
      const requestId = randomUUID(),
        rev = await revision();
      expect(
        (await mutateHuman("delete", "/content", {}, owner, rev, requestId))
          .status,
      ).toBe(200);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_DETAILS_MANAGE,
          },
        },
      });
      expect(
        (await mutateHuman("delete", "/content", {}, owner, rev, requestId))
          .status,
      ).toBe(403);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: target, userId: viewer } },
      });
      await sharedContent().expect(404);
      await db.projectMember.create({
        data: { projectId: target, userId: viewer },
      });
    });
    it("does not recycle a retired checklist identity retained in canonical history", async () => {
      const itemId = randomUUID();
      expect((await addItem({ itemId })).status).toBe(200);
      const requestId = randomUUID(),
        rev = await revision();
      const first = await mutateHuman(
        "delete",
        `/checklist/${itemId}`,
        {},
        owner,
        rev,
        requestId,
      );
      expect(first.status).toBe(200);
      const retry = await mutateHuman(
        "delete",
        `/checklist/${itemId}`,
        {},
        owner,
        rev,
        requestId,
      );
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
      expect((await addItem({ itemId })).status).toBe(409);
      expect(await items()).toEqual([]);
      expect(await db.taskHumanAudit.count({ where: { taskId } })).toBe(2);
    });
    it("rechecks checklist permission after authentication before admitting a write or retry", async () => {
      const transaction = db.$transaction.bind(db);
      let revoke = true;
      const spy = jest.spyOn(db, "$transaction").mockImplementation(((
        fn: any,
        options: any,
      ) => {
        const run = async () => {
          if (revoke) {
            revoke = false;
            await db.rolePermission.delete({
              where: {
                roleId_permissionKey: {
                  roleId: ownerRole,
                  permissionKey: Permissions.TASK_CHECKLIST_MANAGE,
                },
              },
            });
          }
          return transaction(fn, options);
        };
        return run();
      }) as any);
      expect((await addItem()).status).toBe(403);
      spy.mockRestore();
      expect(await items()).toEqual([]);
      expect(await revision()).toBe(0);
    });
    it("conflicts lifecycle and tree drafts on their common revision across separate requests", async () => {
      const rev = await revision();
      const results = await Promise.all([
        addItem({}, rev),
        mutateHuman("delete", "/content", {}, owner, rev),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await revision()).toBe(rev + 1);
      expect(await db.taskHumanAudit.count({ where: { taskId } })).toBe(1);
    });
    it("preserves individual destination-item completion authority and denies revoked side admission", async () => {
      await (await change()).expect(200);
      const sectionId = (await sharedContent()).body.checklistSections.find(
        (s: any) => s.currentSide,
      ).id;
      const itemId = randomUUID();
      expect((await addItem({ itemId, sectionId })).status).toBe(200);
      expect(
        (
          await mutateHuman(
            "put",
            `/checklist/${itemId}/completion`,
            { completed: true },
            owner,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await mutateHuman(
            "put",
            `/checklist/${itemId}/completion`,
            { completed: true },
            assignee,
          )
        ).status,
      ).toBe(200);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: target, userId: assignee } },
      });
      try {
        expect(
          (
            await mutateHuman(
              "put",
              `/checklist/${itemId}/completion`,
              { completed: false },
              assignee,
            )
          ).status,
        ).toBe(404);
        expect((await items())[0]!.completed).toBe(true);
      } finally {
        await db.projectMember.create({
          data: { projectId: target, userId: assignee },
        });
      }
    });
    it.each(["parentId", "beforeItemId", "sectionId"])(
      "rejects malformed %s and unsupported scope selectors",
      async (field) => {
        expect((await addItem({ [field]: "not-an-id" })).status).toBe(400);
        expect((await addItem({ projectId: target })).status).toBe(400);
        expect(await items()).toEqual([]);
      },
    );
    it("preserves deleted task bytes and canonical records when the deletion audit rolls back", async () => {
      await (await change()).expect(200);
      expect((await addItem()).status).toBe(200);
      const transaction = db.$transaction.bind(db);
      const spy = jest.spyOn(db, "$transaction").mockImplementation(((
        fn: any,
        options: any,
      ) =>
        transaction(async (tx: any) => {
          tx.taskHumanAudit.create = async () => {
            throw new Error("synthetic deletion audit failure");
          };
          return fn(tx);
        }, options)) as any);
      const rev = await revision(),
        before = await items();
      expect((await mutateHuman("delete", "/content")).status).toBe(500);
      spy.mockRestore();
      expect(await items()).toEqual(before);
      expect(await revision()).toBe(rev);
      expect((await sharedContent()).body.lifecycle.state).toBe("ACTIVE");
    });
    it("reconciles exact section retries after side archival but blocks new edits", async () => {
      await (await change()).expect(200);
      const sectionId = (await sharedContent()).body.checklistSections.find(
        (s: any) => s.currentSide,
      ).id;
      const itemId = randomUUID(),
        requestId = randomUUID(),
        rev = await revision();
      const first = await addItem({ itemId, sectionId }, rev, requestId);
      expect(first.status).toBe(200);
      await db.project.update({
        where: { id: target },
        data: { archivedAt: new Date() },
      });
      const retry = await addItem({ itemId, sectionId }, rev, requestId);
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
      expect((await addItem({ sectionId })).status).toBe(409);
    });
    it("reauthorizes the retained section on removal retry without resurrecting the item", async () => {
      await (await change()).expect(200);
      const sectionId = (await sharedContent()).body.checklistSections.find(
        (s: any) => s.currentSide,
      ).id;
      const itemId = randomUUID();
      expect((await addItem({ itemId, sectionId })).status).toBe(200);
      const requestId = randomUUID(),
        rev = await revision();
      const first = await mutateHuman(
        "delete",
        `/checklist/${itemId}`,
        {},
        owner,
        rev,
        requestId,
      );
      expect(first.status).toBe(200);
      expect(
        (
          await mutateHuman(
            "delete",
            `/checklist/${itemId}`,
            {},
            owner,
            rev,
            requestId,
          )
        ).body,
      ).toEqual(first.body);
      await (await change("unshare")).expect(200);
      expect(
        (
          await mutateHuman(
            "delete",
            `/checklist/${itemId}`,
            {},
            owner,
            rev,
            requestId,
          )
        ).status,
      ).toBe(404);
      expect(await items()).toEqual([]);
    });
    it.each(["archive", "delete"])(
      "blocks task-level deadline edits after canonical %s while retaining its separate revision",
      async (action) => {
        const deadlines = app.get(TaskDeadlinesService);
        const actor = {
          id: owner,
          workspaceId: w,
          roles: [],
          permissions: grants,
          type: "access" as const,
        };
        const deadlineRequest = {
          requestId: randomUUID(),
          deadline: { date: "2026-12-01" },
        };
        const first = await deadlines.put(actor, taskId, 0, deadlineRequest);
        const changed = await mutateHuman(
          action === "archive" ? "post" : "delete",
          action === "archive" ? "/archive" : "/content",
        );
        expect(changed.status).toBe(200);
        await expect(
          deadlines.put(actor, taskId, 1, {
            ...deadlineRequest,
            requestId: randomUUID(),
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(await deadlines.put(actor, taskId, 0, deadlineRequest)).toEqual(
          first,
        );
      },
    );
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
        lifecycle: {
          state: "ACTIVE",
          archivedAt: null,
          deletedAt: null,
          sourceProjectArchivedAt: null,
        },
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
    const sharedRead = (suffix: string, actor = viewer, p = target) =>
      http()
        .get(base(p) + "/shared-" + suffix)
        .set("Authorization", "Bearer " + actor);
    it("exposes approved shared fields/checklists only with current membership and explicit share", async () => {
      await sharedRead("content").expect(404);
      await (await change()).expect(200);
      const row = (await sharedRead("content").expect(200)).body;
      expect(row).toMatchObject({
        id: taskId,
        title: "Canonical task",
        description: "Private human content",
        projectId: target,
        statusId: targetBoard.statuses[0].id,
        completed: null,
        workflowStatus: { id: targetBoard.statuses[0].id },
      });
      expect(row.checklist).toEqual([]);
      expect(JSON.stringify(row)).not.toContain(source);
      expect(JSON.stringify(row)).not.toMatch(
        /PRIVATE RUNNER|managerId|sessions|password/,
      );
      await sharedRead("content", foreign).expect(404);
      await sharedRead("content", viewer, another).expect(404);
      await sharedRead("content", viewer, foreignProject).expect(404);
      const list = await http()
        .get(`/projects/${target}/shared-tasks?limit=1`)
        .set("Authorization", "Bearer " + viewer)
        .expect(200);
      expect(list.body).toEqual({
        items: [row],
        hasMore: false,
        nextAfterTaskId: null,
      });
      const next = await http()
        .get(`/projects/${target}/shared-tasks?afterTaskId=${taskId}`)
        .set("Authorization", "Bearer " + viewer)
        .expect(200);
      expect(next.body.items).toEqual([]);
    });
    it("shares existing canonical comments and task-only history with allowlisted frozen snapshots", async () => {
      const task = await db.task.findUniqueOrThrow({
        where: { id: taskId },
        select: humanTaskSelection,
      });
      const snap = humanTaskSnapshot(task);
      for (let rev = 1; rev <= 2; rev++) {
        const comment = await db.taskComment.create({
          data: {
            taskId,
            authorId: owner,
            body: `Prior comment ${rev}`,
            revision: rev,
          },
        });
        await db.taskHumanAudit.create({
          data: {
            taskId,
            requestId: randomUUID(),
            inputHash: "fixture",
            actorId: owner,
            action: "COMMENT",
            revision: rev,
            before: humanJson({ ...snap, credentials: "DO NOT DISCLOSE" }),
            after: humanJson(snap),
            comment: humanJson(comment),
          },
        });
      }
      await db.taskHumanState.update({
        where: { taskId },
        data: { revision: 2 },
      });
      await (await change()).expect(200);
      const comments = (await sharedRead("comments?limit=1").expect(200)).body;
      expect(comments.items[0]).toMatchObject({
        body: "Prior comment 1",
        revision: 1,
      });
      expect(comments).toMatchObject({ hasMore: true, nextAfterRevision: 1 });
      expect(
        (await sharedRead("comments?afterRevision=1&limit=1").expect(200)).body
          .items[0].body,
      ).toBe("Prior comment 2");
      const history = (await sharedRead("history?limit=1").expect(200)).body;
      expect(history.items[0]).toMatchObject({
        taskId,
        actorId: owner,
        action: "COMMENT",
        before: { title: snap.title },
        after: { title: snap.title },
      });
      expect(JSON.stringify(history)).not.toMatch(
        /DO NOT DISCLOSE|projectId|statusId|projectArchivedAt|PRIVATE RUNNER/,
      );
      expect(JSON.stringify(history)).not.toContain(source);
      expect(
        (await sharedRead("history?afterRevision=1&limit=1").expect(200)).body
          .items,
      ).toHaveLength(1);
      expect(
        (await sharedRead("history?afterRevision=2").expect(200)).body.items,
      ).toEqual([]);
    });
    it.each(["content", "comments", "history"])(
      "revokes shared %s after unsharing, membership loss and lifecycle change",
      async (suffix) => {
        await (await change()).expect(200);
        await sharedRead(suffix).expect(200);
        await db.projectMember.delete({
          where: { projectId_userId: { projectId: target, userId: viewer } },
        });
        await sharedRead(suffix).expect(404);
        await db.projectMember.create({
          data: { projectId: target, userId: viewer },
        });
        await db.user.update({
          where: { id: viewer },
          data: { status: "BANNED" },
        });
        try {
          await sharedRead(suffix).expect(401);
        } finally {
          await db.user.update({
            where: { id: viewer },
            data: { status: "OPEN" },
          });
        }
        await (await change("unshare")).expect(200);
        await sharedRead(suffix).expect(404);
      },
    );
    it("rejects unknown selectors and publishes explicit bounded shared read schemas", async () => {
      await (await change()).expect(200);
      await sharedRead("content?workspaceId=other").expect(400);
      await sharedRead("history?limit=101").expect(400);
      await sharedRead("comments?afterRevision=-1").expect(400);
      await http()
        .get(`/projects/${target}/shared-tasks?afterTaskId=bad`)
        .set("Authorization", "Bearer " + viewer)
        .expect(400);
      const spec = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      for (const path of [
        "/projects/{projectId}/shared-tasks",
        "/projects/{projectId}/tasks/{taskId}/shared-content",
        "/projects/{projectId}/tasks/{taskId}/shared-comments",
        "/projects/{projectId}/tasks/{taskId}/shared-history",
      ])
        expect(spec.paths[path]?.get?.responses["200"]).toBeDefined();
      expect(
        spec.components?.schemas?.SharedTaskHistorySnapshotDto,
      ).toBeDefined();
    });
  },
);
