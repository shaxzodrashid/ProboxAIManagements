import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { HumanTasksController } from "../src/tasks/human-tasks.controller";
import { HumanTasksService } from "../src/tasks/human-tasks.service";
import { HumanTaskActionsController } from "../src/tasks/human-task-actions.controller";
import { HumanTaskActionsService } from "../src/tasks/human-task-actions.service";
import { TaskBoardsController } from "../src/tasks/task-boards.controller";
import { TaskBoardsService } from "../src/tasks/task-boards.service";
import { TasksController } from "../src/tasks/tasks.controller";
import { TasksService } from "../src/tasks/tasks.service";
import { TaskDeadlinesService } from "../src/tasks/task-deadlines.service";
import { parseTaskDeadline } from "../src/tasks/task-deadline-value";
import { ProjectArchiveService } from "../src/projects/project-archive.service";
import { ProjectsService } from "../src/projects/projects.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { lockWorkspace } from "../src/prisma/workspace-lock";
import {
  Permissions,
  SystemRoleDefinitions,
  ExplicitGrantPermissionKeys,
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
    throw new Error("Requires isolated localhost profile_test");
}
(databaseUrl ? describe : describe.skip)(
  "human collaboration ownership/assignment PostgreSQL HTTP",
  () => {
    let app: INestApplication,
      db: PrismaClient,
      w: string,
      foreignW: string,
      owner: string,
      employee: string,
      peer: string,
      viewer: string,
      outsider: string,
      foreign: string,
      ownerRole: string,
      employeeRole: string,
      dept: string,
      projectId: string,
      taskId: string,
      board: any;
    const grants = [
      Permissions.TASKS_CREATE,
      Permissions.TASK_DEADLINES_MANAGE,
      Permissions.TASK_DETAILS_MANAGE,
      Permissions.TASK_ASSIGNEES_MANAGE,
      Permissions.TASK_CHECKLIST_MANAGE,
      Permissions.TASK_CHECKLIST_COMPLETE,
      Permissions.TASK_COMMENTS_CREATE,
      Permissions.TASK_WORKFLOW_MOVE,
      Permissions.TASK_STATUSES_MANAGE,
      Permissions.PROJECTS_MANAGE_ALL,
      Permissions.PROJECT_MEMBERS_MANAGE,
      Permissions.PROJECTS_ARCHIVE,
    ];
    const actor = (id = owner) => ({
      id,
      workspaceId: w,
      roles: [],
      permissions: [...grants],
    });
    const http = () => request(app.getHttpServer());
    const base = () => `/projects/${projectId}/tasks/${taskId}`;
    const revision = async () =>
      (await db.taskHumanState.findUnique({ where: { taskId } }))?.revision ??
      0;
    async function mutation(
      method: string,
      suffix: string,
      id: string,
      data: object,
      rev?: number,
    ) {
      return http()
        [method](base() + suffix)
        .set("Authorization", "Bearer " + id)
        .set("If-Match", `"${rev ?? (await revision())}"`)
        .send({ requestId: randomUUID(), ...data });
    }
    const read = (id = viewer) =>
      http()
        .get(base())
        .set("Authorization", "Bearer " + id);
    const queryTasks = (params: object = {}, id = viewer) =>
      http()
        .get(`/projects/${projectId}/tasks/query`)
        .set("Authorization", "Bearer " + id)
        .query(params);
    async function queryRow(
      index: number,
      priority: any = null,
      date?: string,
      statusId = board.statuses[0].id,
    ) {
      return db.task.create({
        data: {
          workspaceId: w,
          creatorId: owner,
          managerId: outsider,
          title: "Query row " + index,
          description: "Searchable human description",
          criteria: "PRIVATE EXECUTION",
          createdAt: new Date(Date.UTC(2026, 0, index + 1)),
          humanState: { create: { priority } },
          boardEntry: { create: { boardId: board.id, statusId } },
          assignees: { create: { userId: employee } },
          ...(date
            ? {
                deadline: {
                  create: {
                    value: {
                      kind: "DATE",
                      date,
                      time: null,
                      timeZone: null,
                      utcOffset: null,
                      instant: null,
                    },
                  },
                },
              }
            : {}),
        },
      });
    }
    const assign = (ids = [employee, peer]) =>
      mutation("put", "/assignees", owner, { assigneeIds: ids });
    async function item(assigneeId = employee) {
      const itemId = randomUUID();
      const created = await mutation("post", "/checklist", owner, {
        itemId,
        assigneeId,
        title: "Verify result",
      });
      expect(created.status).toBe(200);
      return itemId;
    }
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      w = (
        await db.workspace.create({
          data: { slug: "human-actions-" + randomUUID() },
        })
      ).id;
      foreignW = (
        await db.workspace.create({
          data: { slug: "human-actions-foreign-" + randomUUID() },
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
      async function user(workspaceId: string, keys: string[]) {
        const key = randomUUID();
        const role = await db.role.create({
          data: {
            workspaceId,
            key,
            name: "ADMIN",
            permissions: {
              create: keys.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        const u = await db.user.create({
          data: {
            workspaceId,
            phoneNumber: key,
            fullName: "Human staff",
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: u.id, roleId: role.id };
      }
      const o = await user(w, grants);
      owner = o.id;
      ownerRole = o.roleId;
      const e = await user(w, grants);
      employee = e.id;
      employeeRole = e.roleId;
      peer = (await user(w, grants)).id;
      viewer = (await user(w, [])).id;
      outsider = (await user(w, grants)).id;
      foreign = (await user(foreignW, grants)).id;
      dept = (
        await db.department.create({
          data: {
            workspaceId: w,
            name: "Human",
            slug: "human",
            homePath: "/opt/human",
          },
        })
      ).id;
      const module = await Test.createTestingModule({
        controllers: [
          HumanTasksController,
          HumanTaskActionsController,
          TaskBoardsController,
          TasksController,
        ],
        providers: [
          HumanTasksService,
          HumanTaskActionsService,
          TaskBoardsService,
          TasksService,
          { provide: PrismaService, useValue: db },
          {
            provide: JwtService,
            useValue: { verify: (id: string) => ({ id, type: "access" }) },
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
        data: [ownerRole, employeeRole].flatMap((roleId) =>
          grants.map((permissionKey) => ({ roleId, permissionKey })),
        ),
        skipDuplicates: true,
      });
      await db.user.updateMany({
        where: { id: { in: [owner, employee, peer] } },
        data: {
          status: "OPEN",
          firstName: null,
          lastName: null,
          username: null,
          fullName: "Human staff",
        },
      });
      projectId = (
        await db.project.create({
          data: {
            workspaceId: w,
            departmentId: dept,
            creatorId: owner,
            name: "Human work",
            directoryName: randomUUID(),
            members: {
              create: [owner, employee, peer, viewer].map((userId) => ({
                userId,
              })),
            },
          },
        })
      ).id;
      board = await db.taskBoard.findUniqueOrThrow({
        where: { projectId },
        include: { statuses: { orderBy: { position: "asc" } } },
      });
      taskId = (
        await db.task.create({
          data: {
            workspaceId: w,
            creatorId: owner,
            managerId: outsider,
            title: "Owned title",
            description: "Owned description",
            criteria: "PRIVATE EXECUTION",
            status: "RUNNING",
          },
        })
      ).id;
      const linked = await mutation(
        "post",
        "/link",
        owner,
        { statusId: board.statuses[0].id },
        0,
      );
      expect(linked.status).toBe(200);
    });
    afterEach(async () => {
      if (!w) return;
      await db.task.deleteMany({
        where: { workspaceId: { in: [w, foreignW] } },
      });
      await db.projectArchiveOperation.deleteMany({
        where: { project: { workspaceId: w } },
      });
      await db.project.deleteMany({ where: { workspaceId: w } });
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
    });
    it.each([
      ["ASCII", "a".repeat(240), "d".repeat(16000)],
      ["astral", "🚀".repeat(240), "🚀".repeat(16000)],
      ["variation selectors", "✈️".repeat(240), "✈️".repeat(16000)],
    ])(
      "round-trips legacy task text limits through human edit/read/replay: %s",
      async (_label, title, description) => {
        // Keep the independent 100 KiB JSON body cap: this description is 96 KiB.
        const criteria =
          _label === "variation selectors" ? "c" : "c".repeat(8000);
        const created = await http()
          .post("/tasks")
          .set("Authorization", "Bearer " + owner)
          .send({ title, description, criteria });
        expect(created.status).toBe(201);
        taskId = created.body.id;
        expect(
          (
            await mutation(
              "post",
              "/link",
              owner,
              { statusId: board.statuses[0].id },
              0,
            )
          ).status,
        ).toBe(200);
        const rev = await revision();
        const data = { requestId: randomUUID(), title, description };
        const saved = await mutation("patch", "/details", owner, data, rev);
        expect(saved.status).toBe(200);
        expect(saved.body.after).toMatchObject({
          title,
          description,
          revision: rev + 1,
        });
        expect((await read()).body).toMatchObject({
          title,
          description,
          revision: rev + 1,
        });
        expect(
          (await mutation("patch", "/details", owner, data, rev)).body,
        ).toEqual(saved.body);
        const stored = await db.task.findUniqueOrThrow({
          where: { id: taskId },
        });
        expect(stored).toMatchObject({
          title,
          description,
          criteria,
          status: "QUEUED",
          managerId: owner,
        });
        expect(await revision()).toBe(rev + 1);
        expect(
          await db.taskHumanAudit.count({
            where: { taskId, requestId: data.requestId },
          }),
        ).toBe(1);
        expect(
          (
            await mutation("patch", "/details", owner, {
              criteria: "Unwritable",
            })
          ).status,
        ).toBe(400);
      },
    );
    it.each([
      ["title", "a".repeat(241)],
      ["description", "d".repeat(16001)],
      ["title", "🚀".repeat(241)],
      ["description", "🚀".repeat(16001)],
    ])(
      "rejects oversized %s before changing task, revision or audit",
      async (field, value) => {
        const before = await db.task.findUniqueOrThrow({
          where: { id: taskId },
        });
        const rev = await revision();
        const count = await db.taskHumanAudit.count({ where: { taskId } });
        expect(
          (await mutation("patch", "/details", owner, { [field]: value }))
            .status,
        ).toBe(400);
        await expect(
          app
            .get(HumanTaskActionsService)
            .mutate(actor(), projectId, taskId, rev, "DETAILS", {
              requestId: randomUUID(),
              [field]: value,
            }),
        ).rejects.toMatchObject({ status: 400 });
        expect(
          await db.task.findUniqueOrThrow({ where: { id: taskId } }),
        ).toEqual(before);
        expect(await revision()).toBe(rev);
        expect(await db.taskHumanAudit.count({ where: { taskId } })).toBe(
          count,
        );
      },
    );
    it("uses the creation validator's Unicode semantics for direct human edits", async () => {
      const title = "✈️".repeat(240),
        description = "🚀".repeat(16000);
      const saved = await app
        .get(HumanTaskActionsService)
        .mutate(actor(), projectId, taskId, await revision(), "DETAILS", {
          requestId: randomUUID(),
          title,
          description,
        });
      expect(saved.after).toMatchObject({ title, description });
      expect(
        (
          await mutation("post", "/checklist", owner, {
            itemId: randomUUID(),
            assigneeId: owner,
            title: "a".repeat(201),
          })
        ).status,
      ).toBe(400);
    });
    it("documents shared task limits while keeping checklist and execution criteria separate", () => {
      const schemas: any = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      ).components!.schemas!;
      for (const name of ["CreateTaskDto", "HumanTaskDetailsDto"]) {
        expect(schemas[name].properties.title.maxLength).toBe(240);
        expect(schemas[name].properties.description.maxLength).toBe(16000);
      }
      expect(schemas.CreateTaskDto.properties.criteria.maxLength).toBe(8000);
      expect(schemas.HumanTaskDetailsDto.properties).not.toHaveProperty(
        "criteria",
      );
      expect(schemas.HumanChecklistCreateDto.properties.title.maxLength).toBe(
        200,
      );
      expect(schemas.HumanChecklistUpdateDto.properties.title.maxLength).toBe(
        200,
      );
    });
    it("returns exact public assignee identities for detail, list and query with shared checklist lookup", async () => {
      await db.user.update({
        where: { id: employee },
        data: {
          firstName: "Nodira",
          lastName: "",
          username: "nodira_staff",
          fullName: "LEGACY MUST NOT REPLACE STRUCTURED NAME",
          bio: "PRIVATE BIO",
        },
      });
      await db.user.update({
        where: { id: peer },
        data: {
          firstName: null,
          lastName: null,
          fullName: "Legacy Name With Several Words",
        },
      });
      await db.profileContact.upsert({
        where: {
          ownerId_contactAccountId: {
            ownerId: viewer,
            contactAccountId: employee,
          },
        },
        create: {
          ownerId: viewer,
          contactAccountId: employee,
          alias: "PRIVATE CONTACT ALIAS",
        },
        update: { alias: "PRIVATE CONTACT ALIAS" },
      });
      const saved = await assign();
      expect(saved.status).toBe(200);
      expect(saved.body.after).not.toHaveProperty("assigneeIdentities");
      const itemId = await item();
      const expected = [
        {
          id: employee,
          displayName: "Nodira",
          firstName: "Nodira",
          lastName: "",
          username: "nodira_staff",
        },
        {
          id: peer,
          displayName: "Legacy Name With Several Words",
          firstName: null,
          lastName: null,
          username: null,
        },
      ].sort((a, b) => a.id.localeCompare(b.id));
      const detail = (await read().expect(200)).body;
      expect(detail.assigneeIdentities).toEqual(expected);
      expect(detail.assigneeIds).toEqual(expected.map((u) => u.id));
      expect(detail.checklist[0]).toMatchObject({
        id: itemId,
        assigneeId: employee,
      });
      expect(Object.keys(detail.checklist[0]).sort()).toEqual([
        "assigneeId",
        "completed",
        "completedAt",
        "completedById",
        "deadline",
        "id",
        "parentId",
        "position",
        "sectionId",
        "title",
      ]);
      expect(
        (
          await http()
            .get(`/projects/${projectId}/tasks`)
            .set("Authorization", "Bearer " + viewer)
            .expect(200)
        ).body[0].assigneeIdentities,
      ).toEqual(expected);
      expect(
        (await queryTasks().expect(200)).body.items[0].assigneeIdentities,
      ).toEqual(expected);
      expect(JSON.stringify(detail)).not.toContain("PRIVATE");
      expect(JSON.stringify(detail)).not.toContain("roleAssignments");
      expect((await read()).headers["cache-control"]).toBe("no-store");
      expect(
        (
          await mutation("patch", "/details", owner, {
            assigneeIdentities: expected,
          })
        ).status,
      ).toBe(400);
    });
    it.each(["PENDING", "BANNED", "DELETED"] as const)(
      "omits %s assignee identities while preserving retained task/checklist IDs",
      async (status) => {
        await assign();
        const itemId = await item();
        await db.user.update({
          where: { id: employee },
          data: { status, fullName: "INACTIVE SECRET" },
        });
        const detail = (await read().expect(200)).body;
        expect(detail.assigneeIds).toContain(employee);
        expect(detail.checklist[0]).toMatchObject({
          id: itemId,
          assigneeId: employee,
        });
        expect(detail.assigneeIdentities.map((u: any) => u.id)).toEqual([peer]);
        expect(JSON.stringify(detail)).not.toContain("INACTIVE SECRET");
        expect(
          (await queryTasks().expect(200)).body.items[0].assigneeIdentities,
        ).toEqual(detail.assigneeIdentities);
      },
    );
    it("omits foreign-workspace assignee identity from legacy inconsistent rows", async () => {
      const before = (await read().expect(200)).body;
      await db.taskAssignee.create({ data: { taskId, userId: foreign } });
      const detail = (await read().expect(200)).body;
      expect(detail.assigneeIds).toEqual(
        [...before.assigneeIds, foreign].sort(),
      );
      expect(detail.assigneeIdentities).toEqual(before.assigneeIdentities);
      expect(
        (await queryTasks().expect(200)).body.items[0].assigneeIdentities,
      ).toEqual(before.assigneeIdentities);
    });
    it("retains public identity for an OPEN former project member without implying action eligibility", async () => {
      await assign([employee]);
      await item();
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: employee } },
      });
      const detail = (await read().expect(200)).body;
      expect(detail.assigneeIdentities).toEqual([
        {
          id: employee,
          displayName: "Human staff",
          firstName: null,
          lastName: null,
          username: null,
        },
      ]);
      expect((await read(employee)).status).toBe(404);
      expect(
        (
          await mutation(
            "put",
            `/checklist/${detail.checklist[0].id}/completion`,
            employee,
            { completed: true },
          )
        ).status,
      ).toBe(404);
    });
    it("refreshes assignee names without rewriting frozen assignment responses or audits", async () => {
      const requestId = randomUUID(),
        rev = await revision(),
        data = { requestId, assigneeIds: [employee] };
      const saved = await mutation("put", "/assignees", owner, data, rev);
      expect(saved.status).toBe(200);
      const before = (await read().expect(200)).body;
      await db.user.update({
        where: { id: employee },
        data: { firstName: "New Public Name", lastName: null },
      });
      const current = (await read().expect(200)).body;
      expect(current.assigneeIdentities[0].displayName).toBe("New Public Name");
      expect(current.revision).toBe(before.revision);
      expect(current.updatedAt).toBe(before.updatedAt);
      expect(
        (await mutation("put", "/assignees", owner, data, rev)).body,
      ).toEqual(saved.body);
      const audit = await db.taskHumanAudit.findUniqueOrThrow({
        where: { taskId_requestId: { taskId, requestId } },
      });
      expect(audit.before).toEqual(saved.body.before);
      expect(audit.after).toEqual(saved.body.after);
      expect(saved.body.before).not.toHaveProperty("assigneeIdentities");
      expect(saved.body.after).not.toHaveProperty("assigneeIdentities");
    });
    it("hydrates current assignee identities on query continuation without changing task generation", async () => {
      await assign([employee]);
      await queryRow(0);
      const first = await queryTasks({ limit: 1 }).expect(200);
      expect(first.body.hasMore).toBe(true);
      await db.user.update({
        where: { id: employee },
        data: { firstName: "Current Page Name", lastName: null },
      });
      const next = await queryTasks({
        limit: 1,
        cursor: first.body.nextCursor,
      }).expect(200);
      expect(next.body.items[0].assigneeIdentities[0].displayName).toBe(
        "Current Page Name",
      );
      expect(next.body.asOf).toBe(first.body.asOf);
      expect(next.body.total).toBe(first.body.total);
      expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
    });
    it("declares public assignee identities only on fresh read DTOs", () => {
      const s: any = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      ).components!.schemas!;
      expect(
        s.HumanTaskReadResponseDto.properties.assigneeIdentities.items.$ref,
      ).toBe("#/components/schemas/PublicIdentityResponseDto");
      expect(s.HumanTaskReadResponseDto.required).toContain(
        "assigneeIdentities",
      );
      expect(
        s.HumanTaskReadResponseDto.properties.assigneeIdentities.maxItems,
      ).toBe(100);
      expect(s.HumanTaskResponseDto.properties).not.toHaveProperty(
        "assigneeIdentities",
      );
      expect(
        Object.keys(s.PublicIdentityResponseDto.properties).sort(),
      ).toEqual(["displayName", "firstName", "id", "lastName", "username"]);
    });
    const editWorkflowStatus = (statusId: string, input: object) =>
      http()
        .patch(`/projects/${projectId}/task-board/statuses/${statusId}`)
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", `"${board.revision}"`)
        .send({ requestId: randomUUID(), ...input });
    const boardEdit = () =>
      http()
        .get(`/projects/${projectId}/task-board/edit`)
        .set("Authorization", "Bearer " + owner);
    it("resolves workflow display metadata consistently for member-only detail, list and query without board grants", async () => {
      const expected = (await boardEdit().expect(200)).body.statuses[0];
      expect(Object.keys(expected).sort()).toEqual([
        "color",
        "id",
        "name",
        "palette",
        "position",
      ]);
      expect((await read().expect(200)).body.workflowStatus).toEqual(expected);
      expect(
        (
          await http()
            .get(`/projects/${projectId}/tasks`)
            .set("Authorization", "Bearer " + viewer)
            .expect(200)
        ).body[0].workflowStatus,
      ).toEqual(expected);
      expect(
        (await queryTasks().expect(200)).body.items[0].workflowStatus,
      ).toEqual(expected);
      await http()
        .get(`/projects/${projectId}/task-board`)
        .set("Authorization", "Bearer " + viewer)
        .expect(403);
      await http()
        .get(`/projects/${projectId}/task-board/edit`)
        .set("Authorization", "Bearer " + viewer)
        .expect(403);
      expect((await read()).headers["cache-control"]).toBe("no-store");
      expect(
        (
          await mutation("patch", "/details", owner, {
            workflowStatus: expected,
          })
        ).status,
      ).toBe(400);
    });
    it.each(["NEUTRAL", "TEAL", "PURPLE", "GREEN"])(
      "refreshes resolved workflow name/%s palette without changing task revision or runner state",
      async (color) => {
        const before = await db.task.findUniqueOrThrow({
          where: { id: taskId },
        });
        const humanRevision = await revision();
        await editWorkflowStatus(board.statuses[0].id, {
          name: "Custom " + color,
          color,
        }).expect(200);
        const expected = (await boardEdit().expect(200)).body.statuses[0];
        expect(expected).toMatchObject({ color, name: "Custom " + color });
        expect((await read().expect(200)).body.workflowStatus).toEqual(
          expected,
        );
        expect(
          (await queryTasks().expect(200)).body.items[0].workflowStatus,
        ).toEqual(expected);
        expect(await revision()).toBe(humanRevision);
        expect(
          await db.task.findUniqueOrThrow({ where: { id: taskId } }),
        ).toEqual(before);
      },
    );
    it("refreshes moved task display while preserving frozen mutation and audit outcomes after a later rename", async () => {
      const previousRevision = await revision();
      const requestId = randomUUID();
      const data = { requestId, statusId: board.statuses[1].id };
      const moved = await mutation(
        "put",
        "/workflow-status",
        owner,
        data,
        previousRevision,
      );
      expect(moved.status).toBe(200);
      expect(moved.body.after.statusId).toBe(board.statuses[1].id);
      expect(moved.body.after).not.toHaveProperty("workflowStatus");
      await editWorkflowStatus(board.statuses[1].id, {
        name: "New current label",
        color: "PURPLE",
      }).expect(200);
      const expected = (await boardEdit().expect(200)).body.statuses[1];
      expect((await read().expect(200)).body.workflowStatus).toEqual(expected);
      const replayed = await mutation(
        "put",
        "/workflow-status",
        owner,
        data,
        previousRevision,
      );
      expect(replayed.status).toBe(200);
      expect(replayed.body).toEqual(moved.body);
      const audit = await db.taskHumanAudit.findUniqueOrThrow({
        where: { taskId_requestId: { taskId, requestId } },
      });
      expect(audit.after).toEqual(moved.body.after);
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("RUNNING");
    });
    it("invalidates query continuation after workflow display metadata changes", async () => {
      await queryRow(0);
      const first = await queryTasks({ limit: 1 });
      expect(first.status).toBe(200);
      expect(first.body.hasMore).toBe(true);
      await editWorkflowStatus(board.statuses[0].id, {
        name: "Updated metadata",
        color: "GREEN",
      }).expect(200);
      expect(
        (await queryTasks({ limit: 1, cursor: first.body.nextCursor })).status,
      ).toBe(409);
      const fresh = await queryTasks({ limit: 1 });
      expect(fresh.status).toBe(200);
      expect(fresh.body.items[0].workflowStatus).toMatchObject({
        name: "Updated metadata",
        color: "GREEN",
      });
      expect(fresh.body.statusCounts).toEqual([
        { statusId: board.statuses[0].id, count: 2 },
      ]);
    });
    it("removes workflow display data after current membership is revoked", async () => {
      expect((await read().expect(200)).body.workflowStatus.id).toBe(
        board.statuses[0].id,
      );
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: viewer } },
      });
      const denied = await read().expect(404);
      expect(denied.body).not.toHaveProperty("workflowStatus");
      expect(denied.body).not.toHaveProperty("assigneeIdentities");
      expect((await queryTasks()).status).toBe(404);
      await http()
        .get(`/projects/${projectId}/tasks`)
        .set("Authorization", "Bearer " + viewer)
        .expect(404);
    });
    it("declares resolved workflow metadata only on fresh read DTOs with the shared board schema", () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const s: any = doc.components!.schemas!;
      expect(
        s.HumanTaskReadResponseDto.properties.workflowStatus.allOf[0].$ref,
      ).toBe("#/components/schemas/BoardStatusResponseDto");
      expect(s.HumanTaskReadResponseDto.required).toContain("workflowStatus");
      expect(s.HumanTaskResponseDto.properties).not.toHaveProperty(
        "workflowStatus",
      );
      expect(s.HumanTaskQueryResponseDto.properties.items.items.$ref).toBe(
        "#/components/schemas/HumanTaskReadResponseDto",
      );
      expect(Object.keys(s.BoardStatusResponseDto.properties).sort()).toEqual([
        "color",
        "id",
        "name",
        "palette",
        "position",
      ]);
    });
    it("round-trips Unicode status create/rename at the database boundary and rejects oversized presentation sequences", async () => {
      const initialName = "😀".repeat(61);
      await editWorkflowStatus(board.statuses[0].id, {
        name: initialName,
      }).expect(200);
      expect((await read().expect(200)).body.workflowStatus.name).toBe(
        initialName,
      );
      const fullName = "🧪".repeat(120);
      const created = await http()
        .post(`/projects/${projectId}/task-board/statuses`)
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"1"')
        .send({ requestId: randomUUID(), name: fullName, color: "TEAL" })
        .expect(201);
      const createdStatus = created.body.after.statuses.at(-1);
      expect(createdStatus.name).toBe(fullName);
      for (const name of ["🧪".repeat(121), "❤️".repeat(61)])
        await http()
          .patch(
            `/projects/${projectId}/task-board/statuses/${createdStatus.id}`,
          )
          .set("Authorization", "Bearer " + owner)
          .set("If-Match", '"2"')
          .send({ requestId: randomUUID(), name })
          .expect(400);
      expect((await boardEdit().expect(200)).body.revision).toBe(2);
      expect(
        (
          await mutation("put", "/workflow-status", owner, {
            statusId: createdStatus.id,
          })
        ).status,
      ).toBe(200);
      expect((await read().expect(200)).body.workflowStatus.name).toBe(
        fullName,
      );
      const renamed = "🚀".repeat(120);
      await http()
        .patch(`/projects/${projectId}/task-board/statuses/${createdStatus.id}`)
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"2"')
        .send({ requestId: randomUUID(), name: renamed })
        .expect(200);
      expect((await read().expect(200)).body.workflowStatus.name).toBe(renamed);
      expect(
        (await queryTasks().expect(200)).body.items[0].workflowStatus.name,
      ).toBe(renamed);
    });
    it("links deliberately with owner assignment while preserving every legacy task scalar", async () => {
      const legacy = await db.task.create({
        data: {
          workspaceId: w,
          creatorId: owner,
          managerId: outsider,
          title: "Legacy",
          description: "Legacy",
          criteria: "private",
          status: "COMPLETED",
        },
      });
      const service = new HumanTaskActionsService(db as any);
      const key = randomUUID();
      const saved = await service.mutate(
        actor(),
        projectId.toUpperCase(),
        legacy.id.toUpperCase(),
        0,
        "LINK",
        { requestId: key.toUpperCase(), statusId: board.statuses[1].id },
      );
      expect(
        await db.task.findUniqueOrThrow({ where: { id: legacy.id } }),
      ).toEqual(legacy);
      expect((saved.after as any).assigneeIds).toEqual([owner]);
      expect(
        await service.mutate(actor(), projectId, legacy.id, 0, "LINK", {
          statusId: board.statuses[1].id,
          requestId: key,
        }),
      ).toEqual(saved);
    });
    it("does not auto-link or assign existing tasks", async () => {
      const legacy = await db.task.create({
        data: {
          workspaceId: w,
          creatorId: owner,
          managerId: owner,
          title: "Legacy",
          description: "No inference",
        },
      });
      expect(
        await db.taskAssignee.count({ where: { taskId: legacy.id } }),
      ).toBe(0);
      expect(
        await db.taskHumanState.findUnique({ where: { taskId: legacy.id } }),
      ).toBeNull();
      expect(
        (
          await http()
            .get(`/projects/${projectId}/tasks`)
            .set("Authorization", "Bearer " + viewer)
            .expect(200)
        ).body.map((t: any) => t.id),
      ).not.toContain(legacy.id);
    });
    it("denies nonowner links, foreign scopes and changing an existing project association", async () => {
      expect(
        (
          await mutation("post", "/link", employee, {
            statusId: board.statuses[0].id,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation("post", "/link", owner, {
            statusId: board.statuses[1].id,
          })
        ).status,
      ).toBe(409);
      const other = await db.project.create({
        data: {
          workspaceId: w,
          departmentId: dept,
          creatorId: owner,
          name: "Other",
          directoryName: randomUUID(),
          members: { create: { userId: owner } },
        },
      });
      const status = await db.taskBoardStatus.findFirstOrThrow({
        where: { board: { projectId: other.id } },
      });
      await http()
        .post(`/projects/${other.id}/tasks/${taskId}/link`)
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), statusId: status.id })
        .expect(404);
    });
    it("supports multiple assignees without changing AI manager or runner state", async () => {
      const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      const response = await assign();
      expect(response.status).toBe(200);
      expect(response.body.after.assigneeIds.sort()).toEqual(
        [employee, peer].sort(),
      );
      expect(
        await db.task.findUniqueOrThrow({ where: { id: taskId } }),
      ).toEqual(before);
      expect((await read().expect(200)).body.assigneeIds.sort()).toEqual(
        [employee, peer].sort(),
      );
    });
    it("only ownership permits title/description edits even when other members have broad grants", async () => {
      await assign();
      expect(
        (await mutation("patch", "/details", employee, { title: "Forbidden" }))
          .status,
      ).toBe(403);
      const result = await mutation("patch", "/details", owner, {
        title: " Edited ",
        description: "Owner only",
      });
      expect(result.status).toBe(200);
      expect(result.body.after.title).toBe("Edited");
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).managerId,
      ).toBe(outsider);
    });
    it("assignment alone permits comments and movement, with no owner/manager/admin bypass", async () => {
      await assign();
      const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(
        (
          await mutation("post", "/comments", owner, {
            body: "Unassigned owner",
          })
        ).status,
      ).toBe(403);
      expect(
        (await mutation("post", "/comments", outsider, { body: "AI manager" }))
          .status,
      ).toBe(404);
      expect(
        (await mutation("post", "/comments", employee, { body: "Progress" }))
          .status,
      ).toBe(200);
      expect(
        (
          await mutation("put", "/workflow-status", peer, {
            statusId: board.statuses[1].id,
          })
        ).status,
      ).toBe(200);
      expect(
        await db.task.findUniqueOrThrow({ where: { id: taskId } }),
      ).toEqual(before);
    });
    it("requires dedicated grants for every action despite current ownership or assignment", async () => {
      await assign();
      await db.rolePermission.deleteMany({
        where: {
          roleId: employeeRole,
          permissionKey: {
            in: [
              Permissions.TASK_COMMENTS_CREATE,
              Permissions.TASK_WORKFLOW_MOVE,
              Permissions.TASK_CHECKLIST_COMPLETE,
            ],
          },
        },
      });
      expect(
        (await mutation("post", "/comments", employee, { body: "Denied" }))
          .status,
      ).toBe(403);
      expect(
        (
          await mutation("put", "/workflow-status", employee, {
            statusId: board.statuses[1].id,
          })
        ).status,
      ).toBe(403);
      const itemId = await item();
      expect(
        (
          await mutation("put", `/checklist/${itemId}/completion`, employee, {
            completed: true,
          })
        ).status,
      ).toBe(403);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_DETAILS_MANAGE,
          },
        },
      });
      expect(
        (await mutation("patch", "/details", owner, { title: "No" })).status,
      ).toBe(403);
      expect(
        SystemRoleDefinitions.every(
          (role) =>
            !role.permissions.some((key) =>
              ExplicitGrantPermissionKeys.includes(key),
            ),
        ),
      ).toBe(true);
    });
    it.each(["foreign", "nonmember", "banned", "duplicates"])(
      "rejects %s assignee sets atomically",
      async (kind) => {
        if (kind === "banned")
          await db.user.update({
            where: { id: employee },
            data: { status: "BANNED" },
          });
        const ids =
          kind === "foreign"
            ? [foreign]
            : kind === "nonmember"
              ? [outsider]
              : kind === "duplicates"
                ? [employee, employee.toUpperCase()]
                : [employee];
        expect((await assign(ids)).status).toBe(
          kind === "duplicates" ? 400 : 404,
        );
        expect((await read().expect(200)).body.assigneeIds).toEqual([owner]);
        expect(await revision()).toBe(1);
      },
    );
    it("an empty assignee set is explicit and grants nobody actions", async () => {
      expect((await assign([])).status).toBe(200);
      expect(
        (await mutation("post", "/comments", owner, { body: "No assignment" }))
          .status,
      ).toBe(403);
      expect(
        (await mutation("patch", "/details", owner, { title: "Still owned" }))
          .status,
      ).toBe(200);
    });
    it("enforces exactly one checklist assignee and owner-controlled definitions", async () => {
      await assign();
      const itemId = await item();
      const task = (await read().expect(200)).body;
      expect(task.checklist[0]).toMatchObject({
        id: itemId,
        assigneeId: employee,
        completed: false,
        completedAt: null,
        completedById: null,
      });
      expect(
        (
          await mutation("post", "/checklist", employee, {
            itemId: randomUUID(),
            title: "Not owner",
            assigneeId: employee,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation("patch", `/checklist/${itemId}`, peer, {
            title: "Not owner",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation("post", "/checklist", owner, {
            itemId: randomUUID(),
            title: "Invalid",
            assigneeIds: [employee, peer],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await mutation("post", "/checklist", owner, {
            itemId: randomUUID(),
            title: "Not task assignee",
            assigneeId: viewer,
          })
        ).status,
      ).toBe(404);
    });
    it("only the checklist's current assignee checks and unchecks, never another task assignee or owner", async () => {
      await assign();
      const itemId = await item();
      expect(
        (
          await mutation("put", `/checklist/${itemId}/completion`, peer, {
            completed: true,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation("put", `/checklist/${itemId}/completion`, owner, {
            completed: true,
          })
        ).status,
      ).toBe(403);
      const checked = await mutation(
        "put",
        `/checklist/${itemId}/completion`,
        employee,
        { completed: true },
      );
      expect(checked.status).toBe(200);
      expect(checked.body.after.checklist[0]).toMatchObject({
        completed: true,
        completedById: employee,
      });
      const unchecked = await mutation(
        "put",
        `/checklist/${itemId}/completion`,
        employee,
        { completed: false },
      );
      expect(unchecked.body.after.checklist[0]).toMatchObject({
        completed: false,
        completedById: null,
        completedAt: null,
      });
    });
    it("reassignment preserves earlier completion attribution and changes who may act next", async () => {
      await assign();
      const itemId = await item();
      await mutation("put", `/checklist/${itemId}/completion`, employee, {
        completed: true,
      });
      const changed = await mutation("patch", `/checklist/${itemId}`, owner, {
        assigneeId: peer,
      });
      expect(changed.status).toBe(200);
      expect(changed.body.after.checklist[0]).toMatchObject({
        assigneeId: peer,
        completed: true,
        completedById: employee,
      });
      expect(
        (
          await mutation("put", `/checklist/${itemId}/completion`, employee, {
            completed: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation("put", `/checklist/${itemId}/completion`, peer, {
            completed: false,
          })
        ).status,
      ).toBe(200);
    });
    it("prevents orphaning checklist assignments and retains removed items in history", async () => {
      await assign();
      const first = await item(),
        second = await item(peer);
      expect((await assign([peer])).status).toBe(409);
      const removed = await mutation(
        "delete",
        `/checklist/${first}`,
        owner,
        {},
      );
      expect(removed.status).toBe(200);
      expect(removed.body.before.checklist.map((i: any) => i.id)).toContain(
        first,
      );
      expect(removed.body.after.checklist).toMatchObject([
        { id: second, position: 0 },
      ]);
      expect((await assign([peer])).status).toBe(200);
      expect(
        (
          await mutation("put", `/checklist/${first}/completion`, employee, {
            completed: true,
          })
        ).status,
      ).toBe(403);
    });
    it.each(["banned", "nonmember"])(
      "permits explicit checklist handoff from an existing %s assignee without deleting the item",
      async (kind) => {
        await assign([employee]);
        const itemId = await item();
        if (kind === "banned")
          await db.user.update({
            where: { id: employee },
            data: { status: "BANNED" },
          });
        else
          await db.projectMember.delete({
            where: { projectId_userId: { projectId, userId: employee } },
          });
        expect((await assign([employee, peer])).status).toBe(200);
        expect(
          (
            await mutation("put", `/checklist/${itemId}/completion`, employee, {
              completed: true,
            })
          ).status,
        ).toBe(kind === "banned" ? 401 : 404);
        expect(
          (
            await mutation("patch", `/checklist/${itemId}`, owner, {
              assigneeId: peer,
            })
          ).status,
        ).toBe(200);
        expect((await assign([peer])).status).toBe(200);
        expect((await read().expect(200)).body.checklist[0]).toMatchObject({
          id: itemId,
          assigneeId: peer,
          completed: false,
        });
      },
    );
    it("scope-checks unknown and other-task checklist identities", async () => {
      await assign();
      expect(
        (
          await mutation("patch", `/checklist/${randomUUID()}`, owner, {
            title: "No",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await mutation(
            "put",
            `/checklist/${randomUUID()}/completion`,
            employee,
            { completed: true },
          )
        ).status,
      ).toBe(404);
      const foreignTask = await db.task.create({
        data: {
          workspaceId: foreignW,
          creatorId: foreign,
          managerId: foreign,
          title: "Foreign",
          description: "Foreign",
          checklist: {
            create: { title: "Private", assigneeId: foreign, position: 0 },
          },
        },
        include: { checklist: true },
      });
      expect(
        (
          await mutation(
            "patch",
            `/checklist/${foreignTask.checklist[0]!.id}`,
            owner,
            { title: "Forbidden" },
          )
        ).status,
      ).toBe(404);
    });
    it("comment and audit readback needs membership alone and never includes execution fields or attachments", async () => {
      await assign();
      const posted = await mutation("post", "/comments", employee, {
        body: " <b>Plain user text</b> ",
      });
      expect(posted.status).toBe(200);
      expect(posted.body.comment.body).toBe("<b>Plain user text</b>");
      const comments = (
        await http()
          .get(base() + "/comments")
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(comments.items[0]).toMatchObject({
        authorId: employee,
        body: "<b>Plain user text</b>",
      });
      const audit = (
        await http()
          .get(base() + "/audit")
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(JSON.stringify(audit)).not.toMatch(
        /PRIVATE EXECUTION|managerId|criteria|sessions|inputHash|workspaceId/,
      );
      expect(
        (
          await mutation("post", "/comments", employee, {
            body: "No import",
            attachments: [{ sessionId: randomUUID() }],
          })
        ).status,
      ).toBe(400);
    });
    it("paginates human history and comments with exclusive revision cursors", async () => {
      await assign();
      await mutation("post", "/comments", employee, { body: "First" });
      await mutation("post", "/comments", peer, { body: "Second" });
      const first = (
        await http()
          .get(base() + "/comments?limit=1")
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(first.hasMore).toBe(true);
      const next = (
        await http()
          .get(
            base() +
              `/comments?limit=1&afterRevision=${first.nextAfterRevision}`,
          )
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(next.items[0].body).toBe("Second");
      expect(next.hasMore).toBe(false);
      await http()
        .get(base() + "/audit?limit=101")
        .set("Authorization", "Bearer " + viewer)
        .expect(400);
      await http()
        .get(base() + "/comments?afterRevision=-1")
        .set("Authorization", "Bearer " + viewer)
        .expect(400);
    });
    it("preserves original request outcomes while rejecting changed input and stale revisions", async () => {
      await assign();
      const rev = await revision(),
        key = randomUUID();
      const first = await mutation(
        "post",
        "/comments",
        employee,
        { body: "Retry", requestId: key },
        rev,
      );
      const retry = await mutation(
        "post",
        "/comments",
        employee,
        { requestId: key.toUpperCase(), body: " Retry " },
        rev,
      );
      expect(retry.body).toEqual(first.body);
      expect(
        (
          await mutation(
            "post",
            "/comments",
            employee,
            { body: "Changed", requestId: key },
            rev,
          )
        ).status,
      ).toBe(409);
      expect(
        (await mutation("post", "/comments", peer, { body: "Stale" }, rev))
          .status,
      ).toBe(409);
      expect(await db.taskComment.count({ where: { taskId } })).toBe(1);
    });
    it("normalizes UUID case and assignee-set order for durable retries", async () => {
      const key = randomUUID(),
        rev = await revision();
      const first = await mutation(
        "put",
        "/assignees",
        owner,
        { assigneeIds: [employee, peer], requestId: key },
        rev,
      );
      const second = await mutation(
        "put",
        "/assignees",
        owner,
        {
          requestId: key.toUpperCase(),
          assigneeIds: [peer.toUpperCase(), employee.toUpperCase()],
        },
        rev,
      );
      expect(second.body).toEqual(first.body);
    });
    it.each([undefined, "0", '"x"'])(
      "rejects missing/malformed revision %s before mutation",
      async (header) => {
        let call = http()
          .patch(base() + "/details")
          .set("Authorization", "Bearer " + owner);
        if (header) call = call.set("If-Match", header);
        await call
          .send({ requestId: randomUUID(), title: "No" })
          .expect(header === undefined ? 428 : 400);
        expect(await revision()).toBe(1);
      },
    );
    it.each([
      { title: null },
      { title: " " },
      { description: null },
      { title: "T", status: "COMPLETED" },
      { title: "T", managerId: "id" },
      { title: "T", creatorId: "id" },
    ])("rejects invalid or mass-assigned details %j", async (body) => {
      expect((await mutation("patch", "/details", owner, body)).status).toBe(
        400,
      );
      expect(await revision()).toBe(1);
    });
    it("serializes competing action revisions so one operation commits", async () => {
      await assign();
      const rev = await revision();
      const results = await Promise.all([
        mutation("post", "/comments", employee, { body: "A" }, rev),
        mutation(
          "put",
          "/workflow-status",
          peer,
          { statusId: board.statuses[1].id },
          rev,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await revision()).toBe(rev + 1);
    });
    it.each(["permission", "assignment", "membership", "itemAssignee"])(
      "rechecks %s after a held workspace lock",
      async (kind) => {
        await assign();
        const itemId = await item();
        const rev = await revision();
        let release!: () => void, ready!: () => void;
        const wait = new Promise<void>((r) => (release = r)),
          locked = new Promise<void>((r) => (ready = r));
        const held = db.$transaction(
          async (tx) => {
            await lockWorkspace(tx, w);
            ready();
            await wait;
            if (kind === "permission")
              await tx.rolePermission.delete({
                where: {
                  roleId_permissionKey: {
                    roleId: employeeRole,
                    permissionKey: Permissions.TASK_CHECKLIST_COMPLETE,
                  },
                },
              });
            if (kind === "assignment")
              await tx.taskAssignee.delete({
                where: { taskId_userId: { taskId, userId: employee } },
              });
            if (kind === "membership")
              await tx.projectMember.delete({
                where: { projectId_userId: { projectId, userId: employee } },
              });
            if (kind === "itemAssignee")
              await tx.taskChecklistItem.update({
                where: { id: itemId },
                data: { assigneeId: peer },
              });
          },
          { timeout: 10000 },
        );
        await locked;
        const pending = mutation(
          "put",
          `/checklist/${itemId}/completion`,
          employee,
          { completed: true },
          rev,
        );
        const response = Promise.resolve(pending);
        await new Promise((r) => setTimeout(r, 80));
        release();
        await held;
        expect((await response).status).toBe(kind === "membership" ? 404 : 403);
        expect(
          (
            await db.taskChecklistItem.findUniqueOrThrow({
              where: { id: itemId },
            })
          ).completed,
        ).toBe(false);
      },
    );
    it("fresh membership is required despite retained assignments, including occupied status-removal movement", async () => {
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: owner } },
      });
      expect(
        (
          await mutation("put", "/workflow-status", owner, {
            statusId: board.statuses[1].id,
          })
        ).status,
      ).toBe(404);
      await http()
        .delete(
          `/projects/${projectId}/task-board/statuses/${board.statuses[0].id}`,
        )
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: board.statuses[1].id,
        })
        .expect(403);
      expect(
        (await db.taskBoardEntry.findUniqueOrThrow({ where: { taskId } }))
          .statusId,
      ).toBe(board.statuses[0].id);
    });
    it("occupied status removal obeys assignment and advances task revisions/history atomically", async () => {
      const rev = await revision();
      await http()
        .delete(
          `/projects/${projectId}/task-board/statuses/${board.statuses[0].id}`,
        )
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: board.statuses[1].id,
        })
        .expect(200);
      expect(await revision()).toBe(rev + 1);
      expect((await read().expect(200)).body.statusId).toBe(
        board.statuses[1].id,
      );
      expect(
        await db.taskHumanAudit.findFirst({
          where: { taskId, action: "STATUS_REMOVED_MOVE" },
        }),
      ).toBeTruthy();
      expect(
        (await mutation("patch", "/details", owner, { title: "Stale" }, rev))
          .status,
      ).toBe(409);
    });
    it("status removal cannot move even one unassigned task or accept a foreign replacement", async () => {
      await assign();
      await http()
        .delete(
          `/projects/${projectId}/task-board/statuses/${board.statuses[0].id}`,
        )
        .set("Authorization", "Bearer " + owner)
        .set("If-Match", '"0"')
        .send({
          requestId: randomUUID(),
          replacementStatusId: board.statuses[1].id,
        })
        .expect(403);
      expect(
        (
          await mutation("put", "/workflow-status", employee, {
            statusId: randomUUID(),
          })
        ).status,
      ).toBe(404);
    });
    it("rolls back comments, revisions and content when human audit persistence fails", async () => {
      const failing = db.$extends({
        query: {
          taskHumanAudit: {
            create: async () => {
              throw new Error("injected audit failure");
            },
          },
        },
      });
      const service = new HumanTaskActionsService(failing as any);
      const rev = await revision();
      await expect(
        service.mutate(actor(), projectId, taskId, rev, "COMMENT", {
          requestId: randomUUID(),
          body: "No commit",
        }),
      ).rejects.toThrow("injected audit failure");
      expect(await db.taskComment.count({ where: { taskId } })).toBe(0);
      expect(await revision()).toBe(rev);
      await expect(
        service.mutate(actor(), projectId, taskId, rev, "DETAILS", {
          requestId: randomUUID(),
          title: "No commit",
        }),
      ).rejects.toThrow("injected audit failure");
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).title,
      ).toBe("Owned title");
    });
    it("archived projects retain human reads/readback but reject every new action", async () => {
      const key = randomUUID(),
        rev = await revision();
      const first = await mutation(
        "post",
        "/comments",
        owner,
        { requestId: key, body: "Before archive" },
        rev,
      );
      await new ProjectArchiveService(db as any).archive(
        actor(),
        projectId,
        randomUUID(),
        0,
      );
      expect((await read().expect(200)).body.projectArchivedAt).toBeTruthy();
      expect(
        (
          await mutation(
            "post",
            "/comments",
            owner,
            { requestId: key, body: "Before archive" },
            rev,
          )
        ).body,
      ).toEqual(first.body);
      for (const [method, suffix, body] of [
        ["patch", "/details", { title: "No" }],
        ["put", "/assignees", { assigneeIds: [owner] }],
        ["put", "/workflow-status", { statusId: board.statuses[1].id }],
        ["post", "/comments", { body: "No" }],
        [
          "post",
          "/checklist",
          { itemId: randomUUID(), title: "No", assigneeId: owner },
        ],
      ] as const)
        expect((await mutation(method, suffix, owner, body)).status).toBe(409);
      const readback = await http()
        .get(base() + "/operations/" + key)
        .set("Authorization", "Bearer " + viewer)
        .expect(200);
      expect(readback.body).toEqual(first.body);
    });
    it("removing assignment prevents mutation replay but does not revoke member readback", async () => {
      await assign();
      const rev = await revision(),
        key = randomUUID();
      const first = await mutation(
        "post",
        "/comments",
        employee,
        { body: "Saved", requestId: key },
        rev,
      );
      await assign([peer]);
      expect(
        (
          await mutation(
            "post",
            "/comments",
            employee,
            { body: "Saved", requestId: key },
            rev,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await http()
            .get(base() + "/operations/" + key)
            .set("Authorization", "Bearer " + employee)
            .expect(200)
        ).body,
      ).toEqual(first.body);
    });
    it("rejects a waiting human action after archive commits under the same admission lock", async () => {
      let release!: () => void, ready!: () => void;
      const wait = new Promise<void>((r) => (release = r)),
        locked = new Promise<void>((r) => (ready = r));
      const delayed = db.$extends({
        query: {
          projectArchiveOperation: {
            create: async ({ args, query }) => {
              ready();
              await wait;
              return query(args);
            },
          },
        },
      });
      const archiving = new ProjectArchiveService(delayed as any).archive(
        actor(),
        projectId,
        randomUUID(),
        0,
      );
      await locked;
      const commenting = mutation(
        "post",
        "/comments",
        owner,
        { body: "Must not commit" },
        1,
      );
      const result = Promise.resolve(commenting);
      await new Promise((r) => setTimeout(r, 80));
      release();
      await archiving;
      expect((await result).status).toBe(409);
      expect(await db.taskComment.count({ where: { taskId } })).toBe(0);
    });
    it("archive preserves a human action that commits first rather than losing its history", async () => {
      let release!: () => void, ready!: () => void;
      const wait = new Promise<void>((r) => (release = r)),
        locked = new Promise<void>((r) => (ready = r));
      const delayed = db.$extends({
        query: {
          taskHumanAudit: {
            create: async ({ args, query }) => {
              ready();
              await wait;
              return query(args);
            },
          },
        },
      });
      const commenting = new HumanTaskActionsService(delayed as any).mutate(
        actor(),
        projectId,
        taskId,
        1,
        "COMMENT",
        { requestId: randomUUID(), body: "Retain committed history" },
      );
      await locked;
      const archiving = new ProjectArchiveService(db as any).archive(
        actor(),
        projectId,
        randomUUID(),
        0,
      );
      await new Promise((r) => setTimeout(r, 80));
      release();
      await commenting;
      await archiving;
      expect(await db.taskComment.count({ where: { taskId } })).toBe(1);
      expect((await read().expect(200)).body.projectArchivedAt).toBeTruthy();
    });
    it("reconciles a lost post-commit acknowledgement without duplicating comments", async () => {
      const acknowledged = db.$transaction.bind(db);
      let lost = true;
      const uncertain = new Proxy(db, {
        get(target, key) {
          if (key === "$transaction")
            return async (work: any, options: any) => {
              const result = await acknowledged(work, options);
              if (lost) {
                lost = false;
                throw new Error("lost human action acknowledgement");
              }
              return result;
            };
          return Reflect.get(target, key);
        },
      });
      const key = randomUUID(),
        service = new HumanTaskActionsService(uncertain as any);
      await expect(
        service.mutate(actor(), projectId, taskId, 1, "COMMENT", {
          requestId: key,
          body: "Accepted once",
        }),
      ).rejects.toThrow("lost human action acknowledgement");
      const saved = (
        await http()
          .get(base() + "/operations/" + key)
          .set("Authorization", "Bearer " + viewer)
          .expect(200)
      ).body;
      expect(
        (
          await mutation(
            "post",
            "/comments",
            owner,
            { requestId: key, body: "Accepted once" },
            1,
          )
        ).body,
      ).toEqual(saved);
      expect(await db.taskComment.count({ where: { taskId } })).toBe(1);
    });
    it("actual membership writes serialize with human action authorization", async () => {
      const projects = new ProjectsService(
        db as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
      );
      await assign();
      await projects.removeMember(actor(), projectId, employee);
      expect(
        (await mutation("post", "/comments", employee, { body: "No" })).status,
      ).toBe(404);
      expect(
        await db.taskAssignee.findUnique({
          where: { taskId_userId: { taskId, userId: employee } },
        }),
      ).toBeTruthy();
    });
    it("legacy deadline writes cannot bypass linked-task ownership and current membership through AI manager identity", async () => {
      await assign();
      const deadlines = new TaskDeadlinesService(db as any);
      await expect(
        deadlines.put(actor(outsider), taskId, 0, {
          requestId: randomUUID(),
          deadline: { date: "2026-12-01" },
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        deadlines.put(actor(employee), taskId, 0, {
          requestId: randomUUID(),
          deadline: { date: "2026-12-01" },
        }),
      ).rejects.toMatchObject({ status: 404 });
      const saved = await deadlines.put(actor(), taskId, 0, {
        requestId: randomUUID(),
        deadline: { date: "2026-12-01" },
      });
      expect(saved.revision).toBe(1);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: owner } },
      });
      await expect(
        deadlines.put(actor(), taskId, 1, {
          requestId: randomUUID(),
          deadline: null,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("round-trips an independent checklist deadline, preserves it on other edits and clears it explicitly", async () => {
      await assign();
      const itemId = randomUUID();
      const saved = await mutation("post", "/checklist", owner, {
        itemId,
        assigneeId: employee,
        title: "Dated item",
        deadline: { date: "2026-12-01" },
      });
      expect(saved.status).toBe(200);
      expect(saved.body.after.checklist[0].deadline).toEqual({
        kind: "DATE",
        date: "2026-12-01",
        time: null,
        timeZone: null,
        utcOffset: null,
        instant: null,
      });
      await mutation("put", `/checklist/${itemId}/completion`, employee, {
        completed: true,
      });
      const completed = (await read()).body.checklist[0];
      const edit = await mutation("patch", `/checklist/${itemId}`, owner, {
        title: "Renamed",
      });
      expect(edit.body.after.checklist[0]).toMatchObject({
        deadline: completed.deadline,
        completedById: employee,
        completedAt: completed.completedAt,
      });
      const cleared = await mutation("patch", `/checklist/${itemId}`, owner, {
        deadline: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.before.checklist[0].deadline).toEqual(
        completed.deadline,
      );
      expect(cleared.body.after.checklist[0].deadline).toBeNull();
      expect(cleared.body.after.deadline).toBeNull();
      expect(cleared.body.after.checklist[0].completedAt).toBe(
        completed.completedAt,
      );
      const stored = await db.taskChecklistItem.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(stored.deadline).toBeNull();
    });
    it("pins timed checklist instants and reconciles normalized retries without another revision", async () => {
      await assign();
      const itemId = await item();
      const rev = await revision(),
        requestId = randomUUID();
      const value = {
        date: "2026-11-01",
        time: "01:30",
        timeZone: "America/New_York",
        utcOffset: "-04:00",
      };
      const saved = await mutation(
        "patch",
        `/checklist/${itemId}`,
        owner,
        { requestId, deadline: value },
        rev,
      );
      expect(saved.status).toBe(200);
      expect(saved.body.after.checklist[0].deadline.instant).toBe(
        "2026-11-01T05:30:00.000Z",
      );
      const retry = await mutation(
        "patch",
        `/checklist/${itemId}`,
        owner,
        {
          requestId,
          deadline: {
            utcOffset: "-04:00",
            timeZone: "America/New_York",
            time: "01:30",
            date: "2026-11-01",
          },
        },
        rev,
      );
      expect(retry.body).toEqual(saved.body);
      expect(await revision()).toBe(rev + 1);
      const changed = await mutation(
        "patch",
        `/checklist/${itemId}`,
        owner,
        { requestId, deadline: { ...value, utcOffset: "-05:00" } },
        rev,
      );
      expect(changed.status).toBe(409);
    });
    it.each([
      { date: "2026-02-30" },
      { date: "2026-12-01", timeZone: "UTC" },
      { date: "2026-12-01", time: "12:00" },
      {
        date: "2026-03-08",
        time: "02:30",
        timeZone: "America/New_York",
        utcOffset: "-05:00",
      },
      { date: "2026-12-01", arbitrary: "hidden" },
      "2026-12-01",
      [],
    ])("rejects invalid checklist deadline %# atomically", async (deadline) => {
      await assign();
      const itemId = await item(),
        rev = await revision();
      const result = await mutation("patch", `/checklist/${itemId}`, owner, {
        title: "Must not change",
        deadline,
      });
      expect(result.status).toBe(400);
      expect(await revision()).toBe(rev);
      expect((await read()).body.checklist[0]).toMatchObject({
        title: "Verify result",
        deadline: null,
      });
    });
    it("reconciles committed item deadlines when runtime timezone support changes", async () => {
      await assign();
      const itemId = await item(),
        rev = await revision(),
        requestId = randomUUID();
      const deadline = {
        date: "2026-12-01",
        time: "12:00",
        timeZone: "UTC",
        utcOffset: "+00:00",
      };
      const saved = await mutation(
        "patch",
        `/checklist/${itemId}`,
        owner,
        { requestId, deadline },
        rev,
      );
      expect(saved.status).toBe(200);
      const formatter = jest
        .spyOn(Intl, "DateTimeFormat")
        .mockImplementation(() => {
          throw new RangeError("Timezone data unavailable");
        });
      try {
        const replay = await mutation(
          "patch",
          `/checklist/${itemId}`,
          owner,
          { requestId, deadline },
          rev,
        );
        expect(replay.body).toEqual(saved.body);
        expect(
          (
            await mutation(
              "patch",
              `/checklist/${itemId}`,
              owner,
              { requestId, deadline: { ...deadline, time: "13:00" } },
              rev,
            )
          ).status,
        ).toBe(409);
        expect(
          (await mutation("patch", `/checklist/${itemId}`, owner, { deadline }))
            .status,
        ).toBe(400);
        expect(
          (
            await mutation("patch", `/checklist/${itemId}`, employee, {
              deadline,
            })
          ).status,
        ).toBe(403);
      } finally {
        formatter.mockRestore();
      }
      expect(await revision()).toBe(rev + 1);
    });
    it("requires current owner, checklist permission and project scope for deadline edits", async () => {
      await assign();
      const itemId = await item();
      expect(
        (
          await mutation("patch", `/checklist/${itemId}`, employee, {
            deadline: null,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation("patch", `/checklist/${itemId}`, outsider, {
            deadline: null,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await mutation("patch", `/checklist/${randomUUID()}`, owner, {
            deadline: null,
          })
        ).status,
      ).toBe(404);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_CHECKLIST_MANAGE,
          },
        },
      });
      expect(
        (
          await mutation("patch", `/checklist/${itemId}`, owner, {
            deadline: null,
          })
        ).status,
      ).toBe(403);
    });
    it("rejects stale and archived deadline edits while member reads and prior outcomes survive", async () => {
      await assign();
      const itemId = await item(),
        rev = await revision(),
        requestId = randomUUID();
      const saved = await mutation(
        "patch",
        `/checklist/${itemId}`,
        owner,
        { requestId, deadline: { date: "2026-12-01" } },
        rev,
      );
      expect(
        (
          await mutation(
            "patch",
            `/checklist/${itemId}`,
            owner,
            { deadline: null },
            rev,
          )
        ).status,
      ).toBe(409);
      await db.project.update({
        where: { id: projectId },
        data: { archivedAt: new Date() },
      });
      expect(
        (
          await mutation("patch", `/checklist/${itemId}`, owner, {
            deadline: null,
          })
        ).status,
      ).toBe(409);
      const replay = await mutation(
        "patch",
        `/checklist/${itemId}`,
        owner,
        { requestId, deadline: { date: "2026-12-01" } },
        rev,
      );
      expect(replay.body).toEqual(saved.body);
      expect((await read()).body.checklist[0].deadline.date).toBe("2026-12-01");
    });
    it("rolls back checklist deadlines when durable audit creation fails", async () => {
      await assign();
      const itemId = await item(),
        rev = await revision();
      const original = db.$transaction.bind(db);
      const transaction = jest
        .spyOn(db, "$transaction")
        .mockImplementationOnce(((fn: any) =>
          original(async (tx) => {
            const create = tx.taskHumanAudit.create;
            tx.taskHumanAudit.create = (() => {
              throw new Error("Injected audit failure");
            }) as any;
            try {
              return await fn(tx);
            } finally {
              tx.taskHumanAudit.create = create;
            }
          })) as any);
      try {
        await expect(
          app
            .get(HumanTaskActionsService)
            .mutate(actor(), projectId, taskId, rev, "CHECKLIST_UPDATE", {
              requestId: randomUUID(),
              itemId,
              deadline: { date: "2026-12-01" },
            }),
        ).rejects.toThrow("Injected audit failure");
      } finally {
        transaction.mockRestore();
      }
      expect(await revision()).toBe(rev);
      expect((await read()).body.checklist[0].deadline).toBeNull();
    });
    it("reorders checklist identities without changing assignees, completion, deadlines or task scalars", async () => {
      await assign();
      const a = await item(),
        b = await item(peer),
        c = await item();
      await mutation("patch", `/checklist/${b}`, owner, {
        deadline: { date: "2026-12-01" },
      });
      await mutation("put", `/checklist/${a}/completion`, employee, {
        completed: true,
      });
      const before = (await read()).body,
        scalar = await db.task.findUnique({ where: { id: taskId } });
      const saved = await mutation("put", "/checklist/order", owner, {
        itemIds: [c, a, b],
      });
      expect(saved.status).toBe(200);
      expect(saved.headers["cache-control"]).toBe("no-store");
      expect(saved.body.action).toBe("CHECKLIST_REORDER");
      const { workflowStatus, assigneeIdentities, ...frozenBefore } = before;
      expect(saved.body.before).toEqual(frozenBefore);
      expect(saved.body.after).not.toHaveProperty("workflowStatus");
      expect(saved.body.after.checklist.map((i: any) => i.id)).toEqual([
        c,
        a,
        b,
      ]);
      for (const [position, id] of [c, a, b].entries())
        expect(saved.body.after.checklist[position]).toEqual({
          ...before.checklist.find((i: any) => i.id === id),
          position,
        });
      expect((await read()).body).toEqual({
        ...saved.body.after,
        workflowStatus,
        assigneeIdentities,
      });
      expect(await db.task.findUnique({ where: { id: taskId } })).toEqual(
        scalar,
      );
      expect(saved.body.after.deadline).toEqual(before.deadline);
    });
    it("replays normalized ordering requests and rejects changed order reuse", async () => {
      await assign();
      const a = await item(),
        b = await item(),
        rev = await revision(),
        requestId = randomUUID();
      const saved = await mutation(
        "put",
        "/checklist/order",
        owner,
        { requestId, itemIds: [b, a] },
        rev,
      );
      expect(saved.status).toBe(200);
      const retry = await mutation(
        "put",
        "/checklist/order",
        owner,
        {
          requestId: requestId.toUpperCase(),
          itemIds: [b.toUpperCase(), a.toUpperCase()],
        },
        rev,
      );
      expect(retry.body).toEqual(saved.body);
      expect(await revision()).toBe(rev + 1);
      expect(
        (
          await mutation(
            "put",
            "/checklist/order",
            owner,
            { requestId, itemIds: [a, b] },
            rev,
          )
        ).status,
      ).toBe(409);
      const history = await http()
        .get(base() + "/audit")
        .set("Authorization", "Bearer " + viewer);
      expect(
        history.body.items.filter((i: any) => i.action === "CHECKLIST_REORDER"),
      ).toHaveLength(1);
    });
    it("rejects omitted or foreign items without changing any position", async () => {
      await assign();
      const a = await item(),
        b = await item(),
        rev = await revision();
      expect(
        (await mutation("put", "/checklist/order", owner, { itemIds: [a] }))
          .status,
      ).toBe(409);
      expect(
        (await mutation("put", "/checklist/order", owner, { itemIds: [] }))
          .status,
      ).toBe(409);
      expect(
        (
          await mutation("put", "/checklist/order", owner, {
            itemIds: [b, randomUUID()],
          })
        ).status,
      ).toBe(404);
      expect(await revision()).toBe(rev);
      expect((await read()).body.checklist.map((i: any) => i.id)).toEqual([
        a,
        b,
      ]);
    });
    it.each([
      {},
      { itemIds: null },
      { itemIds: "wrong" },
      { itemIds: ["wrong"] },
      { itemIds: Array(201).fill("00000000-0000-4000-8000-000000000001") },
      { itemIds: [], completed: true },
    ])("rejects malformed ordering input %#", async (input) => {
      const rev = await revision();
      expect(
        (await mutation("put", "/checklist/order", owner, input)).status,
      ).toBe(400);
      expect(await revision()).toBe(rev);
    });
    it("rejects case-normalized duplicate IDs and allows explicit empty-list ordering", async () => {
      const empty = await mutation("put", "/checklist/order", owner, {
        itemIds: [],
      });
      expect(empty.status).toBe(200);
      expect(empty.body.after.checklist).toEqual([]);
      await assign();
      const a = await item(),
        rev = await revision();
      expect(
        (
          await mutation("put", "/checklist/order", owner, {
            itemIds: [a, a.toUpperCase()],
          })
        ).status,
      ).toBe(400);
      expect(await revision()).toBe(rev);
    });
    it("requires owner, current project membership and dedicated checklist permission to reorder", async () => {
      await assign();
      const a = await item();
      expect(
        (await mutation("put", "/checklist/order", employee, { itemIds: [a] }))
          .status,
      ).toBe(403);
      expect(
        (await mutation("put", "/checklist/order", viewer, { itemIds: [a] }))
          .status,
      ).toBe(403);
      expect(
        (await mutation("put", "/checklist/order", outsider, { itemIds: [a] }))
          .status,
      ).toBe(404);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_CHECKLIST_MANAGE,
          },
        },
      });
      expect(
        (await mutation("put", "/checklist/order", owner, { itemIds: [a] }))
          .status,
      ).toBe(403);
      await db.rolePermission.create({
        data: {
          roleId: ownerRole,
          permissionKey: Permissions.TASK_CHECKLIST_MANAGE,
        },
      });
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: owner } },
      });
      expect(
        (await mutation("put", "/checklist/order", owner, { itemIds: [a] }))
          .status,
      ).toBe(404);
    });
    it("uses one revision boundary for simultaneous completion and ordering", async () => {
      await assign();
      const a = await item(),
        b = await item(),
        rev = await revision();
      const results = await Promise.all([
        mutation("put", "/checklist/order", owner, { itemIds: [b, a] }, rev),
        mutation(
          "put",
          `/checklist/${a}/completion`,
          employee,
          { completed: true },
          rev,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await revision()).toBe(rev + 1);
      const checklist = (await read()).body.checklist;
      expect(checklist.map((i: any) => i.id)).toEqual(
        results[0].status === 200 ? [b, a] : [a, b],
      );
      expect(checklist.find((i: any) => i.id === a).completed).toBe(
        results[1].status === 200,
      );
    });
    it("rejects new archived ordering but replays its saved pre-archive outcome", async () => {
      await assign();
      const a = await item(),
        b = await item(),
        rev = await revision(),
        requestId = randomUUID();
      const saved = await mutation(
        "put",
        "/checklist/order",
        owner,
        { requestId, itemIds: [b, a] },
        rev,
      );
      expect(saved.status).toBe(200);
      await db.project.update({
        where: { id: projectId },
        data: { archivedAt: new Date() },
      });
      expect(
        (await mutation("put", "/checklist/order", owner, { itemIds: [a, b] }))
          .status,
      ).toBe(409);
      const replay = await mutation(
        "put",
        "/checklist/order",
        owner,
        { requestId, itemIds: [b, a] },
        rev,
      );
      expect(replay.body).toEqual(saved.body);
    });
    it("rolls back both ordering phases and human revision if the second item write fails", async () => {
      await assign();
      const a = await item(),
        b = await item(),
        rev = await revision();
      const before = await db.taskChecklistItem.findMany({
        where: { taskId },
        orderBy: { position: "asc" },
      });
      const original = db.$transaction.bind(db);
      const transaction = jest
        .spyOn(db, "$transaction")
        .mockImplementationOnce(((fn: any) =>
          original(async (tx) => {
            const update = tx.taskChecklistItem.update.bind(
              tx.taskChecklistItem,
            );
            let calls = 0;
            tx.taskChecklistItem.update = ((args: any) => {
              if (++calls === 2) throw new Error("Injected ordering failure");
              return update(args);
            }) as any;
            return fn(tx);
          })) as any);
      try {
        await expect(
          app
            .get(HumanTaskActionsService)
            .mutate(actor(), projectId, taskId, rev, "CHECKLIST_REORDER", {
              requestId: randomUUID(),
              itemIds: [b, a],
            }),
        ).rejects.toThrow("Injected ordering failure");
      } finally {
        transaction.mockRestore();
      }
      expect(await revision()).toBe(rev);
      expect(
        await db.taskChecklistItem.findMany({
          where: { taskId },
          orderBy: { position: "asc" },
        }),
      ).toEqual(before);
    });
    it.each(["URGENT", "HIGH", "MEDIUM", "LOW"])(
      "persists approved priority %s without changing execution scalars",
      async (priority) => {
        const before = await db.task.findUnique({ where: { id: taskId } });
        const rev = await revision(),
          requestId = randomUUID();
        const saved = await mutation(
          "patch",
          "/details",
          owner,
          { requestId, priority },
          rev,
        );
        expect(saved.status).toBe(200);
        expect(saved.body.before.priority).toBeNull();
        expect(saved.body.after.priority).toBe(priority);
        expect((await read()).body.priority).toBe(priority);
        expect(await db.task.findUnique({ where: { id: taskId } })).toEqual(
          before,
        );
        expect(
          (
            await mutation(
              "patch",
              "/details",
              owner,
              { requestId, priority },
              rev,
            )
          ).body,
        ).toEqual(saved.body);
        expect(await revision()).toBe(rev + 1);
        expect(
          (
            await mutation(
              "patch",
              "/details",
              owner,
              { requestId, priority: null },
              rev,
            )
          ).status,
        ).toBe(409);
      },
    );
    it("retains omitted priority and clears it with explicit null", async () => {
      await mutation("patch", "/details", owner, { priority: "MEDIUM" });
      const title = await mutation("patch", "/details", owner, {
        title: "Renamed",
      });
      expect(title.body.after.priority).toBe("MEDIUM");
      const cleared = await mutation("patch", "/details", owner, {
        priority: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.before.priority).toBe("MEDIUM");
      expect(cleared.body.after.priority).toBeNull();
    });
    it.each(["NORMAL", "urgent", 1, {}, []])(
      "rejects invalid priority %# without saving other details",
      async (priority) => {
        const rev = await revision();
        expect(
          (
            await mutation("patch", "/details", owner, {
              priority,
              title: "Invalid write",
            })
          ).status,
        ).toBe(400);
        expect(await revision()).toBe(rev);
        expect((await read()).body).toMatchObject({
          title: "Owned title",
          priority: null,
        });
      },
    );
    it("denies assignees, AI manager, inactive owner, former member and owner without detail grant", async () => {
      await assign();
      expect(
        (await mutation("patch", "/details", employee, { priority: "URGENT" }))
          .status,
      ).toBe(403);
      expect(
        (await mutation("patch", "/details", outsider, { priority: "URGENT" }))
          .status,
      ).toBe(404);
      await db.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: ownerRole,
            permissionKey: Permissions.TASK_DETAILS_MANAGE,
          },
        },
      });
      expect(
        (await mutation("patch", "/details", owner, { priority: "URGENT" }))
          .status,
      ).toBe(403);
      await db.rolePermission.create({
        data: {
          roleId: ownerRole,
          permissionKey: Permissions.TASK_DETAILS_MANAGE,
        },
      });
      await db.user.update({
        where: { id: owner },
        data: { status: "BANNED" },
      });
      expect(
        (await mutation("patch", "/details", owner, { priority: "URGENT" }))
          .status,
      ).toBe(401);
      await db.user.update({ where: { id: owner }, data: { status: "OPEN" } });
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: owner } },
      });
      expect(
        (await mutation("patch", "/details", owner, { priority: "URGENT" }))
          .status,
      ).toBe(404);
    });
    it("lists highest priority first then newest creation/id with unset values last", async () => {
      const ids: Record<string, string> = {};
      const at = new Date("2026-01-01T00:00:00Z");
      for (const priority of ["LOW", "MEDIUM", "HIGH", "URGENT", null]) {
        const task = await db.task.create({
          data: {
            workspaceId: w,
            creatorId: owner,
            managerId: outsider,
            title: String(priority),
            description: "Human",
            createdAt: at,
            boardEntry: {
              create: { boardId: board.id, statusId: board.statuses[0].id },
            },
            humanState: { create: { priority: priority as any } },
          },
        });
        ids[String(priority)] = task.id;
      }
      const response = await http()
        .get(`/projects/${projectId}/tasks`)
        .set("Authorization", "Bearer " + viewer);
      expect(response.status).toBe(200);
      expect(response.body.map((t: any) => t.id)).toEqual([
        ids.URGENT,
        ids.HIGH,
        ids.MEDIUM,
        ids.LOW,
        taskId,
        ids.null,
      ]);
      const same = await db.task.create({
        data: {
          workspaceId: w,
          creatorId: owner,
          managerId: outsider,
          title: "Tied high",
          description: "Human",
          createdAt: at,
          boardEntry: {
            create: { boardId: board.id, statusId: board.statuses[0].id },
          },
          humanState: { create: { priority: "HIGH" } },
        },
      });
      const again = await http()
        .get(`/projects/${projectId}/tasks`)
        .set("Authorization", "Bearer " + viewer);
      expect(
        again.body
          .filter((t: any) => t.priority === "HIGH")
          .map((t: any) => t.id),
      ).toEqual([ids.HIGH, same.id].sort().reverse());
    });
    it("rolls priority and title back when saving the durable audit fails", async () => {
      const original = db.$transaction.bind(db),
        rev = await revision();
      const transaction = jest
        .spyOn(db, "$transaction")
        .mockImplementationOnce(((fn: any) =>
          original(async (tx) => {
            tx.taskHumanAudit.create = (() => {
              throw new Error("Injected priority audit failure");
            }) as any;
            return fn(tx);
          })) as any);
      try {
        await expect(
          app
            .get(HumanTaskActionsService)
            .mutate(actor(), projectId, taskId, rev, "DETAILS", {
              requestId: randomUUID(),
              title: "Unsaved",
              priority: "HIGH",
            }),
        ).rejects.toThrow("Injected priority audit failure");
      } finally {
        transaction.mockRestore();
      }
      expect(await revision()).toBe(rev);
      expect((await read()).body).toMatchObject({
        priority: null,
        title: "Owned title",
      });
    });
    it.each(["PENDING", "BANNED", "DELETED"])(
      "rejects newly added membership for %s accounts but retains existing membership",
      async (status) => {
        const projects = new ProjectsService(
          db as any,
          {} as any,
          new WorkspacePathPolicy(),
          {} as any,
        );
        await projects.removeMember(actor(), projectId, employee);
        await db.user.update({
          where: { id: employee },
          data: { status: status as any },
        });
        await expect(
          projects.addMember(actor(), projectId, employee),
        ).rejects.toMatchObject({ status: 404 });
        expect(
          await db.projectMember.findUnique({
            where: { projectId_userId: { projectId, userId: employee } },
          }),
        ).toBeNull();
        await db.projectMember.create({
          data: { projectId, userId: employee },
        });
        const existing = await db.projectMember.findUniqueOrThrow({
          where: { projectId_userId: { projectId, userId: employee } },
        });
        await projects.addMember(actor(), projectId, employee);
        expect(
          await db.projectMember.findUnique({
            where: { projectId_userId: { projectId, userId: employee } },
          }),
        ).toEqual(existing);
        await projects.removeMember(actor(), projectId, employee);
      },
    );
    it("admits new OPEN members and denies newly assigned inactive accounts", async () => {
      const projects = new ProjectsService(
        db as any,
        {} as any,
        new WorkspacePathPolicy(),
        {} as any,
      );
      await projects.removeMember(actor(), projectId, employee);
      await projects.addMember(actor(), projectId, employee);
      for (const status of ["PENDING", "BANNED", "DELETED"] as const) {
        await db.user.update({ where: { id: employee }, data: { status } });
        expect((await assign([employee])).status).toBe(404);
      }
    });
    it("queries one bounded member scope with coherent priority/status counts and narrow rows", async () => {
      await queryRow(0, "URGENT", "2026-12-05");
      await queryRow(1, "HIGH", "2026-12-03", board.statuses[1].id);
      await queryRow(2, null);
      const response = await queryTasks({ q: "Query row", limit: 2 });
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.total).toBe(3);
      expect(response.body.items.map((t: any) => t.priority)).toEqual([
        "URGENT",
        "HIGH",
      ]);
      expect(response.body.priorityCounts).toEqual([
        { priority: "URGENT", count: 1 },
        { priority: "HIGH", count: 1 },
        { priority: "MEDIUM", count: 0 },
        { priority: "LOW", count: 0 },
        { priority: "UNSET", count: 1 },
      ]);
      expect(
        response.body.statusCounts.reduce(
          (n: number, g: any) => n + g.count,
          0,
        ),
      ).toBe(3);
      expect(response.body.hasMore).toBe(true);
      expect(JSON.stringify(response.body)).not.toMatch(
        /criteria|managerId|PRIVATE EXECUTION|sessions|provider|permissions/,
      );
      expect(
        response.body.statusCounts.every(
          (g: any) => Object.keys(g).sort().join() === "count,statusId",
        ),
      ).toBe(true);
      expect(
        Array.isArray(
          (
            await http()
              .get(`/projects/${projectId}/tasks`)
              .set("Authorization", "Bearer " + viewer)
          ).body,
        ),
      ).toBe(true);
    });
    it("filters literal human text, priority, status and assignee before counting", async () => {
      const a = await queryRow(0, "MEDIUM", undefined, board.statuses[1].id);
      await queryRow(1, "LOW");
      await db.task.update({
        where: { id: a.id },
        data: { title: "Literal %_\\ row" },
      });
      const selected = await queryTasks({
        q: "%_\\",
        priorities: "MEDIUM",
        statusIds: board.statuses[1].id,
        assigneeId: employee,
      });
      expect(selected.status).toBe(200);
      expect(selected.body.total).toBe(1);
      expect(selected.body.items[0].id).toBe(a.id);
      expect((await queryTasks({ q: "PRIVATE EXECUTION" })).body.total).toBe(0);
      expect((await queryTasks({ assigneeId: foreign })).body.total).toBe(0);
      expect((await queryTasks({ statusIds: randomUUID() })).body.total).toBe(
        0,
      );
      expect((await queryTasks({ priorities: "UNSET" })).body.total).toBe(1);
    });
    it.each([
      ["-priority", ["URGENT", "HIGH", "LOW", null]],
      ["priority", ["LOW", "HIGH", "URGENT", null]],
    ])("sorts priority %s with unset last", async (sort, expected) => {
      await queryRow(0, "LOW");
      await queryRow(1, "URGENT");
      await queryRow(2, "HIGH");
      await queryRow(3, null);
      const response = await queryTasks({ q: "Query row", sort });
      expect(response.status).toBe(200);
      expect(response.body.items.map((t: any) => t.priority)).toEqual(expected);
    });
    it.each([
      ["deadlineDate", [1, 0, 2]],
      ["-deadlineDate", [0, 1, 2]],
      ["createdAt", [0, 1, 2]],
      ["-createdAt", [2, 1, 0]],
    ])("sorts %s with stable identity ties", async (sort, expected) => {
      const rows = [
        await queryRow(0, null, "2026-12-05"),
        await queryRow(1, null, "2026-12-01"),
        await queryRow(2, null),
      ];
      const response = await queryTasks({ q: "Query row", sort });
      expect(response.status).toBe(200);
      expect(response.body.items.map((t: any) => t.id)).toEqual(
        (expected as number[]).map((i) => rows[i]!.id),
      );
    });
    it("supports multiple ordered sort keys and a deterministic ID tie-breaker", async () => {
      const a = await queryRow(0, "HIGH", "2026-12-01"),
        b = await queryRow(1, "HIGH", "2026-12-01"),
        c = await queryRow(2, "LOW", "2026-12-01");
      await db.task.update({
        where: { id: b.id },
        data: { createdAt: a.createdAt },
      });
      const response = await queryTasks({
        q: "Query row",
        sort: "-priority,deadlineDate,createdAt",
      });
      expect(response.status).toBe(200);
      expect(response.body.items.map((t: any) => t.id)).toEqual([
        ...[a.id, b.id].sort().reverse(),
        c.id,
      ]);
    });
    it("pages without duplication and reconciles repeated cursors in one unchanged generation", async () => {
      const rows = [];
      for (let i = 0; i < 5; i++) rows.push(await queryRow(i, "LOW"));
      const first = await queryTasks({ q: "Query row", limit: 2 });
      const second = await queryTasks({
        q: "Query row",
        limit: 2,
        cursor: first.body.nextCursor,
      });
      const replay = await queryTasks({
        q: "Query row",
        limit: 2,
        cursor: first.body.nextCursor,
      });
      expect(replay.body).toEqual(second.body);
      const third = await queryTasks({
        q: "Query row",
        limit: 3,
        cursor: second.body.nextCursor,
      });
      expect(third.body.asOf).toBe(first.body.asOf);
      expect(third.body.hasMore).toBe(false);
      expect(third.body.nextCursor).toBeNull();
      expect(
        [...first.body.items, ...second.body.items, ...third.body.items].map(
          (t: any) => t.id,
        ),
      ).toEqual(rows.reverse().map((r) => r.id));
    });
    it.each(["priority", "deadline", "add", "delete", "archive"])(
      "rejects cursor after %s changes instead of silently mixing pages",
      async (change) => {
        const a = await queryRow(0, "HIGH"),
          b = await queryRow(1, "LOW");
        const first = await queryTasks({ q: "Query row", limit: 1 });
        if (change === "priority")
          await db.taskHumanState.update({
            where: { taskId: a.id },
            data: { priority: "LOW", revision: { increment: 1 } },
          });
        if (change === "deadline")
          await db.taskDeadline.create({
            data: {
              taskId: a.id,
              value: {
                kind: "DATE",
                date: "2026-12-01",
                time: null,
                timeZone: null,
                utcOffset: null,
                instant: null,
              },
            },
          });
        if (change === "add") await queryRow(2, "LOW");
        if (change === "delete") await db.task.delete({ where: { id: b.id } });
        if (change === "archive")
          await db.project.update({
            where: { id: projectId },
            data: { archivedAt: new Date() },
          });
        const continued = await queryTasks({
          q: "Query row",
          limit: 1,
          cursor: first.body.nextCursor,
        });
        expect(continued.status).toBe(409);
        expect(continued.body.code).toBe("HUMAN_TASK_QUERY_CHANGED");
        expect(continued.body).not.toHaveProperty("total");
      },
    );
    it("binds cursors to actor/filter/sort and rechecks current member access", async () => {
      await queryRow(0, "HIGH");
      await queryRow(1, "HIGH");
      const first = await queryTasks({ q: "Query row", limit: 1 });
      expect(
        (await queryTasks({ q: "Other", cursor: first.body.nextCursor }))
          .status,
      ).toBe(400);
      expect(
        (
          await queryTasks({
            q: "Query row",
            sort: "createdAt",
            cursor: first.body.nextCursor,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await queryTasks(
            { q: "Query row", cursor: first.body.nextCursor },
            employee,
          )
        ).status,
      ).toBe(400);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId, userId: viewer } },
      });
      expect(
        (await queryTasks({ q: "Query row", cursor: first.body.nextCursor }))
          .status,
      ).toBe(404);
      expect((await queryTasks({}, outsider)).status).toBe(404);
      expect((await queryTasks({}, foreign)).status).toBe(404);
    });
    it.each([
      { limit: 0 },
      { limit: 101 },
      { limit: "01" },
      { sort: "priority,-priority" },
      { sort: "title" },
      { priorities: "NORMAL" },
      { q: " " },
      { statusIds: "bad" },
      { cursor: "bad" },
      { includeExecution: true },
    ])("rejects malformed bounded query %#", async (query) => {
      expect((await queryTasks(query)).status).toBe(400);
    });
    it("enforces default50 and maximum100 page sizes while preserving full scoped totals", async () => {
      const ids = Array.from({ length: 105 }, () => randomUUID());
      await db.task.createMany({
        data: ids.map((id) => ({
          id,
          workspaceId: w,
          creatorId: owner,
          managerId: outsider,
          title: "Bulk query",
          description: "Human",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      });
      await db.taskBoardEntry.createMany({
        data: ids.map((taskId) => ({
          taskId,
          boardId: board.id,
          statusId: board.statuses[0].id,
        })),
      });
      const initial = await queryTasks({ q: "Bulk query" });
      expect(initial.status).toBe(200);
      expect(initial.body.items).toHaveLength(50);
      expect(initial.body.total).toBe(105);
      const large = await queryTasks({ q: "Bulk query", limit: 100 });
      expect(large.body.items).toHaveLength(100);
      expect(large.body.total).toBe(105);
      const final = await queryTasks({
        q: "Bulk query",
        limit: 100,
        cursor: large.body.nextCursor,
      });
      expect(final.body.items).toHaveLength(5);
      expect(
        [...large.body.items, ...final.body.items].map((t: any) => t.id),
      ).toEqual(ids.sort().reverse());
    });
    it("rejects forged future and out-of-range cursor bounds", async () => {
      expect(
        (
          await queryTasks({
            statusIds: [
              board.statuses[0].id,
              board.statuses[0].id.toUpperCase(),
            ],
          })
        ).status,
      ).toBe(400);
      await queryRow(0, "HIGH");
      await queryRow(1, "HIGH");
      const initial = await queryTasks({ q: "Query row", limit: 1 });
      const value = JSON.parse(
        Buffer.from(initial.body.nextCursor, "base64url").toString(),
      );
      const encode = (fields: object) =>
        Buffer.from(JSON.stringify({ ...value, ...fields })).toString(
          "base64url",
        );
      expect(
        (
          await queryTasks({
            q: "Query row",
            cursor: encode({ asOf: "9999-01-01T00:00:00.000Z" }),
          })
        ).status,
      ).toBe(400);
      expect(
        (await queryTasks({ q: "Query row", cursor: encode({ after: 99999 }) }))
          .status,
      ).toBe(400);
      expect(
        (await queryTasks({ q: "Query row", cursor: encode({ after: -1 }) }))
          .status,
      ).toBe(400);
    });
    it("bounds fingerprint memory before aggregating oversized legacy content", async () => {
      const oversized = await queryRow(0, "HIGH");
      await db.task.update({
        where: { id: oversized.id },
        data: { description: "x".repeat(9 * 1024 * 1024) },
      });
      const response = await queryTasks({ q: "Query row", limit: 1 });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("HUMAN_TASK_QUERY_SCOPE_LIMIT");
      expect(response.body.message).toContain("refine");
      expect(response.body).not.toHaveProperty("items");
      expect((await queryTasks({ q: "Owned title" })).status).toBe(200);
    });
    it("sanitizes database query failures without launching execution", async () => {
      const original = db.$transaction.bind(db);
      const spy = jest.spyOn(db, "$transaction").mockImplementationOnce(((
        fn: any,
      ) =>
        original(async (tx) => {
          const raw = tx.$queryRaw;
          tx.$queryRaw = (() => {
            throw new Error("PRIVATE database credential");
          }) as any;
          try {
            return await fn(tx);
          } finally {
            tx.$queryRaw = raw;
          }
        })) as any);
      try {
        const response = await queryTasks();
        expect(response.status).toBe(503);
        expect(JSON.stringify(response.body)).not.toContain("credential");
      } finally {
        spy.mockRestore();
      }
    });
    it.each(["deadline", "-deadline"])(
      "sorts %s with timed instants first, then dates, unset last without rewriting records",
      async (sort) => {
        const a = await queryRow(0, "HIGH"),
          b = await queryRow(1, "LOW"),
          midnight = await queryRow(2, "MEDIUM"),
          realMinute = await queryRow(3, "URGENT");
        const oldDate = await queryRow(4, "URGENT", "1999-01-01"),
          currentDate = await queryRow(5, "LOW", "2026-10-14"),
          unset = await queryRow(6, null);
        for (const [taskId, input] of [
          [
            a.id,
            {
              date: "2026-10-14",
              time: "09:00",
              timeZone: "Asia/Tashkent",
              utcOffset: "+05:00",
            },
          ],
          [
            b.id,
            {
              date: "2026-10-13",
              time: "23:30",
              timeZone: "America/New_York",
              utcOffset: "-04:00",
            },
          ],
          [
            midnight.id,
            {
              date: "2026-10-14",
              time: "00:00",
              timeZone: "UTC",
              utcOffset: "+00:00",
            },
          ],
          [
            realMinute.id,
            {
              date: "2026-10-14",
              time: "00:01",
              timeZone: "UTC",
              utcOffset: "+00:00",
            },
          ],
        ] as const)
          await db.taskDeadline.create({
            data: { taskId, value: parseTaskDeadline(input)! as any },
          });
        const before = await db.taskDeadline.findMany({
          where: { task: { workspaceId: w } },
          orderBy: { taskId: "asc" },
        });
        const priorities = await db.taskHumanState.findMany({
          where: { task: { workspaceId: w } },
          orderBy: { taskId: "asc" },
        });
        const response = await queryTasks({ q: "Query row", sort });
        expect(response.status).toBe(200);
        expect(response.body.items.map((t: any) => t.id)).toEqual(
          sort === "deadline"
            ? [
                midnight.id,
                realMinute.id,
                b.id,
                a.id,
                oldDate.id,
                currentDate.id,
                unset.id,
              ]
            : [
                a.id,
                b.id,
                realMinute.id,
                midnight.id,
                currentDate.id,
                oldDate.id,
                unset.id,
              ],
        );
        expect(
          response.body.items.find((t: any) => t.id === realMinute.id).deadline,
        ).toMatchObject({
          kind: "TIMED",
          time: "00:01",
          instant: "2026-10-14T00:01:00.000Z",
        });
        expect(
          response.body.items.find((t: any) => t.id === currentDate.id)
            .deadline,
        ).toMatchObject({
          kind: "DATE",
          time: null,
          timeZone: null,
          instant: null,
        });
        expect(
          await db.taskDeadline.findMany({
            where: { task: { workspaceId: w } },
            orderBy: { taskId: "asc" },
          }),
        ).toEqual(before);
        expect(
          await db.taskHumanState.findMany({
            where: { task: { workspaceId: w } },
            orderBy: { taskId: "asc" },
          }),
        ).toEqual(priorities);
        expect(
          response.body.priorityCounts.reduce(
            (n: number, p: any) => n + p.count,
            0,
          ),
        ).toBe(7);
      },
    );
    it.each(["deadline", "-deadline"])(
      "orders repeated DST times by pinned instant for %s",
      async (sort) => {
        const first = await queryRow(0),
          second = await queryRow(1),
          equivalent = await queryRow(2);
        for (const [taskId, input] of [
          [
            first.id,
            {
              date: "2026-11-01",
              time: "01:30",
              timeZone: "America/New_York",
              utcOffset: "-04:00",
            },
          ],
          [
            second.id,
            {
              date: "2026-11-01",
              time: "01:30",
              timeZone: "America/New_York",
              utcOffset: "-05:00",
            },
          ],
          [
            equivalent.id,
            {
              date: "2026-11-01",
              time: "05:30",
              timeZone: "UTC",
              utcOffset: "+00:00",
            },
          ],
        ] as const)
          await db.taskDeadline.create({
            data: { taskId, value: parseTaskDeadline(input)! as any },
          });
        const response = await queryTasks({ q: "Query row", sort });
        const equal = [first.id, equivalent.id].sort().reverse();
        expect(response.status).toBe(200);
        expect(response.body.items.map((t: any) => t.id)).toEqual(
          sort === "deadline" ? [...equal, second.id] : [second.id, ...equal],
        );
      },
    );
    it("preserves calendar-only deadlineDate ordering and other sort-key precedence", async () => {
      const timed = await queryRow(0, "LOW"),
        date = await queryRow(1, "URGENT", "1999-01-01");
      await db.taskDeadline.create({
        data: {
          taskId: timed.id,
          value: parseTaskDeadline({
            date: "2026-10-14",
            time: "00:01",
            timeZone: "UTC",
            utcOffset: "+00:00",
          })! as any,
        },
      });
      const calendar = await queryTasks({
        q: "Query row",
        sort: "deadlineDate",
      });
      expect(calendar.body.items.map((t: any) => t.id)).toEqual([
        date.id,
        timed.id,
      ]);
      const priority = await queryTasks({
        q: "Query row",
        sort: "-priority,deadline",
      });
      expect(priority.body.items.map((t: any) => t.id)).toEqual([
        date.id,
        timed.id,
      ]);
      const exact = await queryTasks({
        q: "Query row",
        sort: "deadline,-priority",
      });
      expect(exact.body.items.map((t: any) => t.id)).toEqual([
        timed.id,
        date.id,
      ]);
    });
    it("pages exact deadlines and conflicts if a deadline changes type", async () => {
      const a = await queryRow(0),
        b = await queryRow(1, null, "2026-10-14"),
        c = await queryRow(2);
      const timed = parseTaskDeadline({
        date: "2026-10-14",
        time: "00:01",
        timeZone: "UTC",
        utcOffset: "+00:00",
      })!;
      await db.taskDeadline.create({
        data: { taskId: a.id, value: timed as any },
      });
      const first = await queryTasks({
        q: "Query row",
        sort: "deadline",
        limit: 1,
      });
      const next = await queryTasks({
        q: "Query row",
        sort: "deadline",
        limit: 1,
        cursor: first.body.nextCursor,
      });
      const last = await queryTasks({
        q: "Query row",
        sort: "deadline",
        limit: 1,
        cursor: next.body.nextCursor,
      });
      expect([
        first.body.items[0].id,
        next.body.items[0].id,
        last.body.items[0].id,
      ]).toEqual([a.id, b.id, c.id]);
      await db.taskDeadline.update({
        where: { taskId: b.id },
        data: { value: timed as any, revision: { increment: 1 } },
      });
      expect(
        (
          await queryTasks({
            q: "Query row",
            sort: "deadline",
            limit: 1,
            cursor: first.body.nextCursor,
          })
        ).status,
      ).toBe(409);
    });
    it("publishes separate read/action DTOs, revisions and narrow comment contracts", () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/projects/{projectId}/tasks/{taskId}/details"]!.patch!
          .responses["428"],
      ).toBeTruthy();
      const s: any = doc.components!.schemas!;
      expect(
        doc.paths["/projects/{projectId}/tasks/query"]!.get!.responses["409"],
      ).toBeTruthy();
      expect(s.HumanTaskQueryResponseDto.properties.items.maxItems).toBe(100);
      expect(s.HumanTaskDetailsDto.properties.priority.enum).toEqual([
        "URGENT",
        "HIGH",
        "MEDIUM",
        "LOW",
      ]);
      expect(s.HumanTaskDetailsDto.properties.priority.nullable).toBe(true);
      expect(s.HumanTaskResponseDto.properties.priority.nullable).toBe(true);
      const order =
        doc.paths["/projects/{projectId}/tasks/{taskId}/checklist/order"]!.put!;
      expect(order.responses["428"]).toBeTruthy();
      expect(s.HumanChecklistReorderDto.properties.itemIds.maxItems).toBe(200);
      expect(s.HumanChecklistReorderDto.required).toContain("itemIds");
      expect(s.HumanChecklistItemDto.properties.deadline.nullable).toBe(true);
      expect(s.HumanChecklistUpdateDto.properties.deadline.nullable).toBe(true);
      expect(s.HumanChecklistUpdateDto.required ?? []).not.toContain(
        "deadline",
      );
      expect(s.HumanTaskResponseDto!.properties).not.toHaveProperty("criteria");
      expect(Object.keys(s.HumanCommentDto!.properties!).sort()).toEqual(
        ["id", "authorId", "body", "revision", "createdAt"].sort(),
      );
      expect(s.HumanChecklistCreateDto!.properties).not.toHaveProperty(
        "completed",
      );
    });
  },
);
