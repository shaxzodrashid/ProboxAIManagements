import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { TasksController } from "../src/tasks/tasks.controller";
import { TasksService } from "../src/tasks/tasks.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTask } from "../src/tasks/task-creation";
const request = require("supertest");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "55439" ||
    target.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test");
}
(url ? describe : describe.skip)(
  "task creation recovery HTTP/PostgreSQL",
  () => {
    let app: INestApplication,
      db: PrismaClient,
      service: TasksService,
      w: string,
      fw: string,
      owner: string,
      peer: string,
      foreign: string,
      denied: string,
      ownerRole: string;
    const body = {
      title: "  Exact task 😀  ",
      description: "Literal <b>text</b>\nKeep spaces ",
    };
    const http = () => request(app.getHttpServer());
    const post = (data: object, actor = owner) =>
      http()
        .post("/tasks")
        .set("Authorization", "Bearer " + actor)
        .send(data);
    const read = (key: string, actor = owner) =>
      http()
        .get("/tasks/creations/" + key)
        .set("Authorization", "Bearer " + actor);
    const count = () =>
      db.task.count({ where: { workspaceId: { in: [w, fw] } } });
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      fw = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      await db.permission.createMany({
        data: ["tasks.create", "tasks.read-all"].map((key) => ({
          key,
          name: key,
          category: "test",
          description: "test",
        })),
        skipDuplicates: true,
      });
      async function user(workspaceId: string, key = "tasks.create") {
        const role = await db.role.create({
          data: {
            workspaceId,
            key: randomUUID(),
            name: "ADMIN",
            permissions: { create: { permissionKey: key } },
          },
        });
        const user = await db.user.create({
          data: {
            workspaceId,
            fullName: "Creator",
            phoneNumber: randomUUID(),
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: user.id, roleId: role.id };
      }
      const o = await user(w);
      owner = o.id;
      ownerRole = o.roleId;
      peer = (await user(w)).id;
      foreign = (await user(fw)).id;
      denied = (await user(w, "tasks.read-all")).id;
      const module = await Test.createTestingModule({
        controllers: [TasksController],
        providers: [
          TasksService,
          { provide: PrismaService, useValue: db },
          {
            provide: JwtService,
            useValue: { verify: (id: string) => ({ id, type: "access" }) },
          },
        ],
      }).compile();
      service = module.get(TasksService);
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
      await db.task.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
      await db.user.update({ where: { id: owner }, data: { status: "OPEN" } });
      await db.rolePermission.createMany({
        data: [{ roleId: ownerRole, permissionKey: "tasks.create" }],
        skipDuplicates: true,
      });
    });
    afterAll(async () => {
      await app?.close();
      await db.task.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
      await db.user.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
      await db.role.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
      await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
      await db.$disconnect();
    });
    it("preserves legacy no-key creation, exact fields and existing execution-manager defaults", async () => {
      const a = await post(body).expect(201),
        b = await post(body).expect(201);
      expect(a.body.id).not.toBe(b.body.id);
      expect(a.body).toMatchObject({
        ...body,
        creatorId: owner,
        managerId: owner,
        workspaceId: w,
        status: "QUEUED",
        criteria: null,
      });
      expect(Object.keys(a.body).sort()).toEqual([
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
      expect(
        await db.taskCreationReceipt.count({ where: { workspaceId: w } }),
      ).toBe(0);
      expect(
        await db.taskBoardEntry.count({ where: { task: { workspaceId: w } } }),
      ).toBe(0);
      expect(
        await db.taskAssignee.count({ where: { task: { workspaceId: w } } }),
      ).toBe(0);
      expect(
        await db.proboxAiSession.count({ where: { workspaceId: w } }),
      ).toBe(0);
    });
    it("converges concurrent identical requests to one atomic task and frozen receipt", async () => {
      const requestId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post({ ...body, requestId })),
      );
      // Preserve response bodies in any failure diff; a status-only assertion
      // cannot distinguish an authorization dependency outage from a write error.
      expect(results.map((r) => ({ status: r.status, body: r.body }))).toEqual(
        results.map(() => ({ status: 201, body: results[0].body })),
      );
      for (const r of results) {
        expect(r.status).toBe(201);
        expect(r.body).toEqual(results[0].body);
      }
      expect(await count()).toBe(1);
      expect(
        await db.taskCreationReceipt.count({ where: { workspaceId: w } }),
      ).toBe(1);
      expect((await read(requestId).expect(200)).body).toEqual(results[0].body);
      expect(results[0].headers["cache-control"]).toBe("no-store");
      expect((await read(requestId)).headers["cache-control"]).toBe("no-store");
    });
    it("distinguishes a failed authorization database read from concurrent receipt creation", async () => {
      const requestId = randomUUID();
      const failure = new Prisma.PrismaClientUnknownRequestError(
        'could not open file "base/16384/17429": Invalid argument (Windows 1450)',
        { clientVersion: "6.19.3" },
      );
      const lookup = jest
        .spyOn(db.user, "findFirst")
        .mockRejectedValueOnce(failure);
      try {
        const result = await post({ ...body, requestId }).expect(503);
        expect(result.body).toEqual({
          statusCode: 503,
          message: "Authentication is temporarily unavailable",
          error: "Service Unavailable",
        });
        expect(await count()).toBe(0);
        expect(
          await db.taskCreationReceipt.count({ where: { workspaceId: w } }),
        ).toBe(0);
      } finally {
        lookup.mockRestore();
      }
      const accepted = await post({ ...body, requestId }).expect(201);
      expect((await post({ ...body, requestId }).expect(201)).body).toEqual(
        accepted.body,
      );
      expect(await count()).toBe(1);
      expect(
        await db.taskCreationReceipt.count({ where: { workspaceId: w } }),
      ).toBe(1);
    });
    it("conflicts concurrent changed reuse without a second task", async () => {
      const requestId = randomUUID();
      const responses = await Promise.all([
        post({ ...body, requestId }),
        post({ ...body, requestId, title: "Different" }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await count()).toBe(1);
      expect((await read(requestId).expect(200)).body).toEqual(
        responses.find((r) => r.status === 201)!.body,
      );
    });
    it("canonicalizes request UUID and omitted/null criteria without trimming task text", async () => {
      const requestId = randomUUID();
      const first = await post({
        ...body,
        requestId: requestId.toUpperCase(),
      }).expect(201);
      expect(
        (await post({ ...body, requestId, criteria: null }).expect(201)).body,
      ).toEqual(first.body);
      expect((await read(requestId.toUpperCase()).expect(200)).body).toEqual(
        first.body,
      );
      await post({ ...body, requestId, title: body.title.trim() }).expect(409);
      await post({ ...body, requestId, criteria: "Different" }).expect(409);
      expect(await count()).toBe(1);
    });
    it("recovers an actually committed create after the HTTP acknowledgment is lost", async () => {
      const requestId = randomUUID(),
        original = service.create.bind(service);
      const spy = jest
        .spyOn(service, "create")
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new Error("Injected lost task creation acknowledgment");
        });
      try {
        await post({ ...body, requestId }).expect(500);
      } finally {
        spy.mockRestore();
      }
      const receipt = await read(requestId).expect(200);
      expect((await post({ ...body, requestId }).expect(201)).body).toEqual(
        receipt.body,
      );
      expect(await count()).toBe(1);
    });
    it("replays the original allowlisted creation snapshot after task edits", async () => {
      const requestId = randomUUID(),
        first = await post({ ...body, requestId }).expect(201);
      await db.task.update({
        where: { id: first.body.id },
        data: {
          title: "Later title",
          criteria: "Later criteria",
          status: "COMPLETED",
        },
      });
      expect((await post({ ...body, requestId }).expect(201)).body).toEqual(
        first.body,
      );
      expect((await read(requestId).expect(200)).body).toEqual(first.body);
      const row = await db.taskCreationReceipt.findFirstOrThrow({
        where: { taskId: first.body.id },
      });
      expect(row.outcome).toEqual(first.body);
      expect(first.body).not.toHaveProperty("inputHash");
    });
    it("supports create-only readback and conceals other owners and workspaces", async () => {
      const requestId = randomUUID(),
        first = await post({ ...body, requestId }).expect(201);
      await http()
        .get("/tasks/" + first.body.id)
        .set("Authorization", "Bearer " + owner)
        .expect(403);
      await read(requestId, peer).expect(404);
      await read(requestId, foreign).expect(404);
      await read(requestId, denied).expect(403);
      await read(randomUUID()).expect(404);
      const second = await post({ ...body, requestId }, peer).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect((await read(requestId, peer).expect(200)).body.creatorId).toBe(
        peer,
      );
      expect((await read(requestId).expect(200)).body).toEqual(first.body);
    });
    it("rechecks revoked creation authority even with stale service caller context", async () => {
      const requestId = randomUUID();
      await post({ ...body, requestId }).expect(201);
      await db.rolePermission.deleteMany({
        where: { roleId: ownerRole, permissionKey: "tasks.create" },
      });
      await post({ ...body, requestId }).expect(403);
      await read(requestId).expect(403);
      await expect(service.create(owner, w, body)).rejects.toMatchObject({
        status: 403,
      });
      expect(await count()).toBe(1);
    });
    it.each(["PENDING", "BANNED", "DELETED"] as const)(
      "rejects %s creator authentication",
      async (status) => {
        const requestId = randomUUID();
        await post({ ...body, requestId }).expect(201);
        await db.user.update({ where: { id: owner }, data: { status } });
        await post({ ...body, requestId }).expect(401);
        await read(requestId).expect(401);
      },
    );
    it("conceals moved tasks on readback and replay without reusing their retained key", async () => {
      const requestId = randomUUID(),
        first = await post({ ...body, requestId }).expect(201);
      await db.task.update({
        where: { id: first.body.id },
        data: { workspaceId: fw },
      });
      await read(requestId).expect(404);
      await post({ ...body, requestId }).expect(404);
      expect(await count()).toBe(1);
    });
    it("rolls back the task when receipt persistence fails and sanitizes failure", async () => {
      const client = db.$extends({
        query: {
          taskCreationReceipt: {
            create: async () => {
              throw new Error("PRIVATE DATABASE SECRET");
            },
          },
        },
      });
      const response = await createTask(client as any, owner, w, {
        ...body,
        requestId: randomUUID(),
      }).catch((e) => e.getResponse());
      expect(response).toEqual({
        code: "TASK_CREATION_UNAVAILABLE",
        message:
          "Task creation outcome unavailable; reread a known request before retrying",
      });
      expect(await count()).toBe(0);
    });
    it("rejects malformed keys, forged ownership and read selectors without creating data", async () => {
      for (const extra of [
        { requestId: null },
        { requestId: "bad" },
        { creatorId: peer },
        { managerId: peer },
        { workspaceId: fw },
        { status: "SUCCEEDED" },
      ])
        await post({ ...body, ...extra }).expect(400);
      await http().post("/tasks").send(body).expect(401);
      await read("bad").expect(400);
      await read(randomUUID() + "?creatorId=" + peer).expect(400);
      expect(await count()).toBe(0);
    });
    it("allowlists stored receipt fields and rejects inconsistent receipt scope", async () => {
      const requestId = randomUUID(),
        first = await post({ ...body, requestId }).expect(201);
      await db.taskCreationReceipt.update({
        where: { taskId: first.body.id },
        data: {
          outcome: { ...first.body, privateInternal: "PRIVATE STORED DATA" },
        },
      });
      expect((await read(requestId).expect(200)).body).toEqual(first.body);
      await db.taskCreationReceipt.update({
        where: { taskId: first.body.id },
        data: { outcome: { ...first.body, workspaceId: fw } },
      });
      const response = await read(requestId).expect(503);
      expect(response.body.code).toBe("TASK_CREATION_UNAVAILABLE");
      expect(JSON.stringify(response.body)).not.toContain(fw);
      await post({ ...body, requestId }).expect(503);
      expect(await count()).toBe(1);
    });
    it("publishes optional creation request identity and frozen readback without changing task response fields", () => {
      const doc = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().build(),
        ),
        schemas: any = doc.components!.schemas;
      expect(schemas.CreateTaskDto.properties.requestId.format).toBe("uuid");
      expect(schemas.CreateTaskDto.required).not.toContain("requestId");
      expect(schemas.TaskResponseDto.properties).not.toHaveProperty(
        "requestId",
      );
      expect(
        doc.paths["/tasks/creations/{requestId}"]?.get?.responses["200"],
      ).toBeDefined();
      expect(doc.paths["/tasks"]?.post?.responses["409"]).toBeDefined();
    });
  },
);
