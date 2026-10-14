import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { TaskDeadlinesController } from "../src/tasks/task-deadlines.controller";
import { TaskDeadlinesService } from "../src/tasks/task-deadlines.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { lockWorkspace } from "../src/prisma/workspace-lock";
import { Permissions as P } from "../src/authorization/permission.catalog";
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
  "task deadline HTTP persistence and ownership",
  () => {
    let app: INestApplication,
      prisma: PrismaClient,
      workspaceId: string,
      foreignWorkspace: string,
      manager: string,
      reader: string,
      noManage: string,
      assignedOnly: string,
      outsider: string,
      roleId: string,
      taskId: string;
    const keys = [P.TASKS_READ, P.TASKS_READ_ALL, P.TASK_DEADLINES_MANAGE];
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      workspaceId = (
        await prisma.workspace.create({ data: { slug: "task-deadlines-http" } })
      ).id;
      foreignWorkspace = (
        await prisma.workspace.create({
          data: { slug: "task-deadlines-http-foreign" },
        })
      ).id;
      await prisma.permission.createMany({
        data: keys.map((key) => ({
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
            fullName: "Deadline staff",
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: user.id, roleId: role.id };
      }
      const owner = await user(workspaceId, "+998908200001", keys);
      manager = owner.id;
      roleId = owner.roleId;
      reader = (await user(workspaceId, "+998908200002", keys)).id;
      noManage = (
        await user(workspaceId, "+998908200003", [
          P.TASKS_READ,
          P.TASKS_READ_ALL,
        ])
      ).id;
      assignedOnly = (await user(workspaceId, "+998908200004", [P.TASKS_READ]))
        .id;
      outsider = (await user(foreignWorkspace, "+998908200005", keys)).id;
      const module = await Test.createTestingModule({
        controllers: [TaskDeadlinesController],
        providers: [
          TaskDeadlinesService,
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
      taskId = (
        await prisma.task.create({
          data: {
            workspaceId,
            creatorId: manager,
            managerId: manager,
            title: "Deadline task",
            description: "Existing task",
            status: "RUNNING",
          },
        })
      ).id;
    });
    afterEach(async () => {
      await prisma.task.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspace] } },
      });
    });
    afterAll(async () => {
      await app?.close();
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
    const call = () => request(app.getHttpServer()),
      base = () => `/tasks/${taskId}/deadline`;
    const actor = () => ({
      id: manager,
      workspaceId,
      roles: [],
      permissions: keys,
    });
    const put = (
      deadline: any,
      revision = 0,
      id = randomUUID(),
      as = manager,
    ) =>
      call()
        .put(base())
        .set("Authorization", `Bearer ${as}`)
        .set("If-Match", `"${revision}"`)
        .send({ requestId: id, deadline });
    it("reads an unset deadline without creating records", async () => {
      const result = await call()
        .get(base())
        .set("Authorization", `Bearer ${manager}`)
        .expect(200);
      expect(result.body).toEqual({ taskId, revision: 0, deadline: null });
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(await prisma.taskDeadline.count({ where: { taskId } })).toBe(0);
    });
    it("preserves date-only semantics and does not mutate runner/task data", async () => {
      const before = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      const saved = await put({ date: "2026-10-13" }).expect(200);
      expect(saved.body.after).toEqual({
        taskId,
        revision: 1,
        deadline: {
          kind: "DATE",
          date: "2026-10-13",
          time: null,
          timeZone: null,
          utcOffset: null,
          instant: null,
        },
      });
      expect(
        (
          await call()
            .get(base())
            .set("Authorization", `Bearer ${reader}`)
            .expect(200)
        ).body,
      ).toEqual(saved.body.after);
      expect(
        await prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
      ).toEqual(before);
      expect(JSON.stringify(saved.body)).not.toMatch(
        /inputHash|password|phone|workspaceId|cwd|role/,
      );
    });
    it("stores a timed instant and allows date-only replacement and clearing with audit", async () => {
      const result = await put({
        date: "2026-10-13",
        time: "17:30",
        timeZone: "Asia/Tashkent",
        utcOffset: "+05:00",
      }).expect(200);
      expect(result.body.after.deadline.instant).toBe(
        "2026-10-13T12:30:00.000Z",
      );
      const date = await put({ date: "2026-10-14" }, 1).expect(200);
      expect(date.body.after.deadline.kind).toBe("DATE");
      const cleared = await put(null, 2).expect(200);
      expect(cleared.body.after.deadline).toBeNull();
      expect(cleared.body.before.deadline.date).toBe("2026-10-14");
      expect(await prisma.taskDeadlineAudit.count({ where: { taskId } })).toBe(
        3,
      );
    });
    it("preserves two explicitly selected repeated-hour instants through HTTP", async () => {
      const input = {
        date: "2026-11-01",
        time: "01:30",
        timeZone: "America/New_York",
      };
      const first = await put({ ...input, utcOffset: "-04:00" }).expect(200);
      const second = await put({ ...input, utcOffset: "-05:00" }, 1).expect(
        200,
      );
      expect(first.body.after.deadline.instant).toBe(
        "2026-11-01T05:30:00.000Z",
      );
      expect(second.body.after.deadline.instant).toBe(
        "2026-11-01T06:30:00.000Z",
      );
    });
    it.each([
      { date: "2026-02-29" },
      {
        date: "2026-03-08",
        time: "02:30",
        timeZone: "America/New_York",
        utcOffset: "-05:00",
      },
      { date: "2026-10-13", time: "17:30", timeZone: "UTC" },
      {
        date: "2026-10-13",
        time: "17:30",
        timeZone: "UTC",
        utcOffset: "+01:00",
      },
      { date: "2026-10-13", instant: "2026-10-13T00:00:00Z" },
      { date: "2026-10-13", workspaceId: "forged" },
    ])(
      "rejects invalid/mass-assigned deadline %# without writes",
      async (value) => {
        await put(value).expect(400);
        expect(await prisma.taskDeadline.count({ where: { taskId } })).toBe(0);
      },
    );
    it("requires a deadline field and refuses broad body edits", async () => {
      await call()
        .put(base())
        .set("Authorization", `Bearer ${manager}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID() })
        .expect(400);
      await call()
        .put(base())
        .set("Authorization", `Bearer ${manager}`)
        .set("If-Match", '"0"')
        .send({ requestId: randomUUID(), deadline: null, managerId: reader })
        .expect(400);
    });
    it("keeps dedicated write authority separate from read-all and role labels", async () => {
      await call()
        .get(base())
        .set("Authorization", `Bearer ${noManage}`)
        .expect(200);
      await put({ date: "2026-10-13" }, 0, randomUUID(), noManage).expect(403);
      await call()
        .get(`${base()}/edit`)
        .set("Authorization", `Bearer ${reader}`)
        .expect(404);
      await put({ date: "2026-10-13" }, 0, randomUUID(), reader).expect(404);
      await call().get(base()).expect(401);
    });
    it("preserves assigned-only/existence-safe and cross-workspace read/write scope", async () => {
      const unassigned = await call()
        .get(base())
        .set("Authorization", `Bearer ${assignedOnly}`)
        .expect(404);
      const missing = await call()
        .get(`/tasks/${randomUUID()}/deadline`)
        .set("Authorization", `Bearer ${assignedOnly}`)
        .expect(404);
      const foreign = await call()
        .get(base())
        .set("Authorization", `Bearer ${outsider}`)
        .expect(404);
      expect(unassigned.body).toEqual(missing.body);
      expect(foreign.body).toEqual(missing.body);
      await put({ date: "2026-10-13" }, 0, randomUUID(), outsider).expect(404);
      expect(await prisma.taskDeadline.count({ where: { taskId } })).toBe(0);
    });
    it("supports manager edit snapshots without granting read permission", async () => {
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: P.TASKS_READ },
      });
      try {
        await call()
          .get(base())
          .set("Authorization", `Bearer ${manager}`)
          .expect(403);
        await call()
          .get(`${base()}/edit`)
          .set("Authorization", `Bearer ${manager}`)
          .expect(200);
        await put({ date: "2026-10-13" }).expect(200);
      } finally {
        await prisma.rolePermission.create({
          data: { roleId, permissionKey: P.TASKS_READ },
        });
      }
    });
    it("replays the same canonical request without mutation and rejects changed reuse", async () => {
      const requestId = randomUUID(),
        service = app.get(TaskDeadlinesService);
      const first = await service.put(actor(), taskId, 0, {
        requestId,
        deadline: { date: "2026-10-13" },
      });
      expect(
        await service.put(actor(), taskId.toUpperCase(), 0, {
          requestId: requestId.toUpperCase(),
          deadline: {
            date: "2026-10-13",
            time: null,
            timeZone: null,
            utcOffset: null,
          },
        }),
      ).toEqual(first);
      const response = await call()
        .get(
          `/tasks/${taskId.toUpperCase()}/deadline/operations/${requestId.toUpperCase()}`,
        )
        .set("Authorization", `Bearer ${manager}`)
        .expect(200);
      expect(response.body.requestId).toBe(requestId);
      await put({ date: "2026-10-14" }, 0, requestId).expect(409);
      expect(await prisma.taskDeadlineAudit.count({ where: { taskId } })).toBe(
        1,
      );
    });
    it("replays an accepted timed request without reinterpreting changed timezone rules", async () => {
      const service = app.get(TaskDeadlinesService),
        requestId = randomUUID(),
        deadline = {
          date: "2026-11-01",
          time: "01:30",
          timeZone: "America/New_York",
          utcOffset: "-04:00",
        };
      const first = await service.put(actor(), taskId, 0, {
        requestId,
        deadline,
      });
      const formatter = jest
        .spyOn(Intl, "DateTimeFormat")
        .mockImplementation(() => {
          throw new RangeError("Injected changed timezone runtime");
        });
      try {
        expect(
          await service.put(actor(), taskId, 0, { requestId, deadline }),
        ).toEqual(first);
        expect(await service.operation(actor(), taskId, requestId)).toEqual(
          first,
        );
        await expect(
          service.put(actor(), taskId, 0, {
            requestId,
            deadline: { ...deadline, utcOffset: "-05:00" },
          }),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.put(actor(), taskId, 1, {
            requestId: randomUUID(),
            deadline,
          }),
        ).rejects.toMatchObject({ status: 400 });
        expect(
          await prisma.taskDeadlineAudit.count({ where: { taskId } }),
        ).toBe(1);
      } finally {
        formatter.mockRestore();
      }
    });
    it.each([undefined, "0", '"00"'])(
      "requires a valid revision header %s",
      async (header) => {
        const req = call()
          .put(base())
          .set("Authorization", `Bearer ${manager}`)
          .send({ requestId: randomUUID(), deadline: null });
        if (header !== undefined) req.set("If-Match", header);
        await req.expect(header === undefined ? 428 : 400);
      },
    );
    it("serializes competing deadline changes with one commit and one conflict", async () => {
      const service = app.get(TaskDeadlinesService);
      const results = await Promise.allSettled([
        service.put(actor(), taskId, 0, {
          requestId: randomUUID(),
          deadline: { date: "2026-10-13" },
        }),
        service.put(actor(), taskId, 0, {
          requestId: randomUUID(),
          deadline: { date: "2026-10-14" },
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          results.find((r) => r.status === "rejected") as PromiseRejectedResult
        ).reason.getStatus(),
      ).toBe(409);
      expect(await prisma.taskDeadlineAudit.count({ where: { taskId } })).toBe(
        1,
      );
    });
    it("rechecks permission after lock waits and never trusts captured grants", async () => {
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
      const blocker = prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, workspaceId);
          await tx.rolePermission.deleteMany({
            where: { roleId, permissionKey: P.TASK_DEADLINES_MANAGE },
          });
          locked();
          await gate;
        },
        { timeout: 30000 },
      );
      await ready;
      const denied = expect(
        app
          .get(TaskDeadlinesService)
          .put(actor(), taskId, 0, { requestId: randomUUID(), deadline: null }),
      ).rejects.toMatchObject({ status: 403 });
      release();
      await blocker;
      try {
        await denied;
        expect(await prisma.taskDeadline.count({ where: { taskId } })).toBe(0);
      } finally {
        await prisma.rolePermission.create({
          data: { roleId, permissionKey: P.TASK_DEADLINES_MANAGE },
        });
      }
    });
    it("revokes edit/audit/replay authority when the current task manager changes", async () => {
      const requestId = randomUUID();
      await put({ date: "2026-10-13" }, 0, requestId).expect(200);
      await prisma.task.update({
        where: { id: taskId },
        data: { managerId: reader },
      });
      await call()
        .get(base())
        .set("Authorization", `Bearer ${manager}`)
        .expect(200); // existing read-all remains read-only
      await put(null, 1).expect(404);
      await call()
        .get(`${base()}/operations/${requestId}`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(404);
      await call()
        .get(`${base()}/audit`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(404);
    });
    it("rejects non-OPEN/mismatched-workspace actors even with captured permissions", async () => {
      await prisma.user.update({
        where: { id: manager },
        data: { status: "BANNED" },
      });
      try {
        await put(null).expect(401);
        await expect(
          app.get(TaskDeadlinesService).read(actor(), taskId, true),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await prisma.user.update({
          where: { id: manager },
          data: { status: "OPEN" },
        });
      }
      await expect(
        app
          .get(TaskDeadlinesService)
          .read({ ...actor(), workspaceId: foreignWorkspace }, taskId, true),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("rolls back values/revisions if audit persistence fails", async () => {
      const extended = prisma.$extends({
        query: {
          taskDeadlineAudit: {
            create() {
              throw new Error("Injected private audit failure");
            },
          },
        },
      });
      await expect(
        new TaskDeadlinesService(extended as unknown as PrismaService).put(
          actor(),
          taskId,
          0,
          { requestId: randomUUID(), deadline: { date: "2026-10-13" } },
        ),
      ).rejects.toThrow();
      expect(await prisma.taskDeadline.count({ where: { taskId } })).toBe(0);
      expect(await prisma.taskDeadlineAudit.count({ where: { taskId } })).toBe(
        0,
      );
    });
    it("pages manager-only audit and rejects invalid IDs and queries", async () => {
      for (let revision = 0; revision < 3; revision++)
        await put({ date: `2026-10-${13 + revision}` }, revision).expect(200);
      const page = await call()
        .get(`${base()}/audit?limit=2`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(200);
      expect(page.body).toMatchObject({ hasMore: true, nextAfterRevision: 2 });
      expect(page.body.items.map((row: any) => row.revision)).toEqual([1, 2]);
      const next = await call()
        .get(`${base()}/audit?limit=2&afterRevision=2`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(200);
      expect(next.body.items).toHaveLength(1);
      expect(next.body.hasMore).toBe(false);
      await call()
        .get(`${base()}/audit?limit=0`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(400);
      await call()
        .get(`/tasks/invalid/deadline`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(400);
      await call()
        .get(`${base()}/audit?workspaceId=forged`)
        .set("Authorization", `Bearer ${manager}`)
        .expect(400);
    });
    it("publishes explicit deadline values, nullable clear and revision contracts", () => {
      const doc = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().build(),
        ),
        schema: any = doc.components!.schemas;
      const write = doc.paths["/tasks/{taskId}/deadline"]!.put!;
      expect(write.responses).toHaveProperty("428");
      expect(write.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "If-Match", required: true }),
        ]),
      );
      expect(schema.PutDeadlineDto.required).toEqual(
        expect.arrayContaining(["requestId", "deadline"]),
      );
      expect(schema.PutDeadlineDto.properties.deadline.nullable).toBe(true);
      expect(schema.DeadlineValueDto.properties.kind.enum).toEqual([
        "DATE",
        "TIMED",
      ]);
      expect(schema.DeadlineValueDto.properties.instant).toMatchObject({
        type: "string",
        format: "date-time",
        nullable: true,
      });
    });
  },
);
