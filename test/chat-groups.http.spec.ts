import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { GroupsController } from "../src/groups/groups.controller";
import { GroupsService } from "../src/groups/groups.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "55439" ||
    parsed.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
(url ? describe : describe.skip)(
  "chat group metadata HTTP and isolated PostgreSQL",
  () => {
    let prisma: PrismaClient, app: INestApplication, service: GroupsService;
    let w1: string, w2: string, a: string, b: string, c: string;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url } } });
      w1 = (
        await prisma.workspace.create({
          data: { slug: "groups-" + randomUUID() },
        })
      ).id;
      w2 = (
        await prisma.workspace.create({
          data: { slug: "groups-" + randomUUID() },
        })
      ).id;
      const user = async (workspaceId: string) =>
        (
          await prisma.user.create({
            data: {
              workspaceId,
              phoneNumber: "groups-" + randomUUID(),
              fullName: "Group creator",
              status: "OPEN",
            },
          })
        ).id;
      a = await user(w1);
      b = await user(w1);
      c = await user(w2);
      const module = await Test.createTestingModule({
        controllers: [GroupsController],
        providers: [
          GroupsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id: id === "refresh-test" ? a : id,
                type: id === "refresh-test" ? "refresh" : "access",
                workspaceId: "stale",
              }),
            },
          },
        ],
      }).compile();
      service = module.get(GroupsService);
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
      await prisma.user.update({
        where: { id: a },
        data: { workspaceId: w1, status: "OPEN" },
      });
    });
    afterAll(async () => {
      await app?.close();
      if (prisma) {
        await prisma.chatGroupCreation.deleteMany({
          where: { creatorId: { in: [a, b, c] } },
        });
        await prisma.chatGroup.deleteMany({
          where: { creatorId: { in: [a, b, c] } },
        });
        await prisma.user.deleteMany({ where: { id: { in: [a, b, c] } } });
        await prisma.workspace.deleteMany({ where: { id: { in: [w1, w2] } } });
        await prisma.$disconnect();
      }
    });
    const call = () => request(app.getHttpServer());
    const create = (
      body: Record<string, unknown> = {
        requestId: randomUUID(),
        name: " Team ",
      },
      actor = a,
    ) =>
      call()
        .post("/chat-groups")
        .set("Authorization", "Bearer " + actor)
        .send(body);
    const get = (path: string, actor = a) =>
      call()
        .get(path)
        .set("Authorization", "Bearer " + actor);
    it("creates for zero-permission OPEN account, derives initial owner, returns narrow metadata", async () => {
      const result = await create().expect(201);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(result.body).sort()).toEqual(["group", "requestId"]);
      expect(Object.keys(result.body.group).sort()).toEqual([
        "createdAt",
        "creatorId",
        "id",
        "name",
        "ownerId",
      ]);
      expect(result.body.group).toMatchObject({
        name: "Team",
        creatorId: a,
        ownerId: a,
      });
      expect(
        (await get("/chat-groups/" + result.body.group.id).expect(200)).body,
      ).toEqual(result.body.group);
      expect(
        (
          await get("/chat-groups/creations/" + result.body.requestId).expect(
            200,
          )
        ).body,
      ).toEqual(result.body);
    });
    it("recovers a lost acknowledgment by identical replay, canonicalizing UUID case and name whitespace", async () => {
      const requestId = randomUUID();
      const original = prisma.$transaction.bind(prisma);
      const transaction = jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce((async (fn: any, options: any) => {
          await original(fn, options);
          throw new Error("Injected lost group acknowledgment after commit");
        }) as any);
      try {
        const lost = await create({ requestId, name: " Team " }).expect(500);
        expect(JSON.stringify(lost.body)).not.toContain("Injected lost");
      } finally {
        transaction.mockRestore();
      }
      const first = await get("/chat-groups/creations/" + requestId).expect(
        200,
      );
      expect(
        (await get("/chat-groups/" + first.body.group.id).expect(200)).body,
      ).toEqual(first.body.group);
      const replay = await create({
        requestId: requestId.toUpperCase(),
        name: "Team",
      }).expect(201);
      expect(replay.body).toEqual(first.body);
      expect(
        await prisma.chatGroupCreation.count({
          where: { creatorId: a, requestId },
        }),
      ).toBe(1);
      expect(
        (
          await get("/chat-groups/creations/" + requestId.toUpperCase()).expect(
            200,
          )
        ).body,
      ).toEqual(first.body);
    });
    it("rejects request ID reuse with changed input without changing stored metadata", async () => {
      const requestId = randomUUID();
      const first = await create({ requestId, name: "Original" }).expect(201);
      const failure = await create({ requestId, name: "Changed" }).expect(409);
      expect(failure.body.code).toBe("GROUP_REQUEST_CONFLICT");
      expect(
        (await get("/chat-groups/" + first.body.group.id).expect(200)).body
          .name,
      ).toBe("Original");
    });
    it("serializes concurrent identical retries to a single durable group", async () => {
      const requestId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          create({ requestId, name: "Concurrent" }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      results.forEach((r) => expect(r.body).toEqual(results[0].body));
      expect(
        await prisma.chatGroupCreation.count({
          where: { creatorId: a, requestId },
        }),
      ).toBe(1);
    });
    it("keeps creation receipt frozen independently of current group metadata", async () => {
      const created = await create().expect(201);
      await prisma.chatGroup.update({
        where: { id: created.body.group.id },
        data: { name: "Future name" },
      });
      expect(
        (
          await create({
            requestId: created.body.requestId,
            name: "Team",
          }).expect(201)
        ).body,
      ).toEqual(created.body);
      expect(
        (await get("/chat-groups/" + created.body.group.id).expect(200)).body
          .name,
      ).toBe("Future name");
    });
    it.each(["same workspace", "foreign workspace"])(
      "denies %s noncreator reads and scopes retry IDs to creator",
      async (scope) => {
        const other = scope === "same workspace" ? b : c;
        const created = await create().expect(201);
        await get("/chat-groups/" + created.body.group.id, other).expect(404);
        await get(
          "/chat-groups/creations/" + created.body.requestId,
          other,
        ).expect(404);
        const own = await create(
          { requestId: created.body.requestId, name: "Other" },
          other,
        ).expect(201);
        expect(own.body.group.id).not.toBe(created.body.group.id);
      },
    );
    it("does not let administrator role labels bypass creator-only reads", async () => {
      const role = await prisma.role.create({
        data: {
          workspaceId: w1,
          key: "groups-test-admin-" + randomUUID(),
          name: "Owner admin",
        },
      });
      await prisma.userRoleAssignment.create({
        data: { workspaceId: w1, userId: b, roleId: role.id },
      });
      try {
        const created = await create().expect(201);
        await get("/chat-groups/" + created.body.group.id, b).expect(404);
      } finally {
        await prisma.userRoleAssignment.deleteMany({
          where: { roleId: role.id },
        });
        await prisma.role.delete({ where: { id: role.id } });
      }
    });
    it.each(["PENDING", "BANNED", "DELETED"] as const)(
      "rejects %s account authentication for create and readback",
      async (status) => {
        const created = await create().expect(201);
        await prisma.user.update({ where: { id: a }, data: { status } });
        await create().expect(401);
        await get("/chat-groups/" + created.body.group.id).expect(401);
        await get("/chat-groups/creations/" + created.body.requestId).expect(
          401,
        );
      },
    );
    it("rejects anonymous, nonexistent and non-access credentials", async () => {
      await call()
        .post("/chat-groups")
        .send({ requestId: randomUUID(), name: "Group" })
        .expect(401);
      await create(undefined, randomUUID()).expect(401);
      await create(undefined, "refresh-test").expect(401);
    });
    it("rechecks account state and workspace after guard scope was captured", async () => {
      const actor = { id: a, workspaceId: w1, roles: [], permissions: [] };
      await prisma.user.update({
        where: { id: a },
        data: { status: "BANNED" },
      });
      await expect(
        service.create(actor, { requestId: randomUUID(), name: "No" }),
      ).rejects.toMatchObject({ status: 401 });
      await prisma.user.update({
        where: { id: a },
        data: { status: "OPEN", workspaceId: w2 },
      });
      await expect(
        service.create(actor, { requestId: randomUUID(), name: "No" }),
      ).rejects.toMatchObject({ status: 401 });
      await expect(service.read(actor, randomUUID())).rejects.toMatchObject({
        status: 401,
      });
    });
    it("allows the same active creator to read and retry after current workspace changes", async () => {
      const created = await create().expect(201);
      await prisma.user.update({ where: { id: a }, data: { workspaceId: w2 } });
      expect(
        (await get("/chat-groups/" + created.body.group.id).expect(200)).body,
      ).toEqual(created.body.group);
      expect(
        (
          await create({
            requestId: created.body.requestId,
            name: "Team",
          }).expect(201)
        ).body,
      ).toEqual(created.body);
    });
    it.each([
      "ownerId",
      "creatorId",
      "workspaceId",
      "participants",
      "history",
      "permissions",
      "agents",
      "trustedAdmins",
    ])("rejects unapproved selector %s without writing", async (field) => {
      const before = await prisma.chatGroup.count();
      await create({
        requestId: randomUUID(),
        name: "Group",
        [field]: a,
      }).expect(400);
      expect(await prisma.chatGroup.count()).toBe(before);
    });
    it.each(["", "  ", "x".repeat(121), null, 123])(
      "rejects invalid name %p",
      async (name) => {
        await create({ requestId: randomUUID(), name }).expect(400);
      },
    );
    it("rejects malformed UUIDs, unknown query fields, and returns opaque missing IDs", async () => {
      await create({ requestId: "bad", name: "Group" }).expect(400);
      await get("/chat-groups/bad").expect(400);
      await get("/chat-groups/creations/bad").expect(400);
      await get("/chat-groups/" + randomUUID()).expect(404);
      await get("/chat-groups/creations/" + randomUUID()).expect(404);
      await get("/chat-groups/" + randomUUID() + "?creatorId=" + a).expect(400);
      await call()
        .post("/chat-groups?workspaceId=" + w1)
        .set("Authorization", "Bearer " + a)
        .send({ requestId: randomUUID(), name: "Group" })
        .expect(400);
    });
    it("rolls back group insertion when durable receipt insertion fails", async () => {
      const before = await prisma.chatGroup.count();
      const failing = prisma.$extends({
        query: {
          chatGroupCreation: {
            create: async () => {
              throw new Error("injected receipt failure");
            },
          },
        },
      });
      const failingService = new GroupsService(
        failing as unknown as PrismaService,
      );
      const requestId = randomUUID();
      await expect(
        failingService.create(
          { id: a, workspaceId: w1, roles: [], permissions: [] },
          { requestId, name: "Unsaved" },
        ),
      ).rejects.toThrow("injected receipt failure");
      expect(await prisma.chatGroup.count()).toBe(before);
      await get("/chat-groups/creations/" + requestId).expect(404);
      await create({ requestId, name: "Unsaved" }).expect(201);
    });
    it("resolves concurrent different inputs for one key as one success and one conflict", async () => {
      const requestId = randomUUID();
      const results = await Promise.all([
        create({ requestId, name: "First" }),
        create({ requestId, name: "Second" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const success = results.find((r) => r.status === 201);
      expect(
        (await get("/chat-groups/creations/" + requestId).expect(200)).body,
      ).toEqual(success.body);
    });
    it("accepts maximum length plain text without markup interpretation", async () => {
      const name = "<b>" + "x".repeat(113) + "</b>";
      const created = await create({ requestId: randomUUID(), name }).expect(
        201,
      );
      expect(created.body.group.name).toBe(name);
      expect(
        (await get("/chat-groups/" + created.body.group.id).expect(200)).body
          .name,
      ).toBe(name);
    });
    it("exposes explicit request/response OpenAPI schemas and creator-only scope", () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(doc.paths["/chat-groups"]?.post?.responses["201"]).toBeDefined();
      expect(
        JSON.stringify(doc.paths["/chat-groups"]?.post?.responses["409"]),
      ).toContain("GROUP_REQUEST_CONFLICT");
      expect(
        JSON.stringify(doc.paths["/chat-groups"]?.post?.responses["503"]),
      ).toContain("OPERATION_OUTCOME_UNKNOWN");
      expect(
        doc.paths["/chat-groups/creations/{requestId}"]?.get?.responses["200"],
      ).toBeDefined();
      expect(
        (doc.components?.schemas?.CreateChatGroupDto as SchemaObject)?.required,
      ).toEqual(["requestId", "name"]);
      expect(
        Object.keys(
          (doc.components?.schemas?.ChatGroupResponseDto as SchemaObject)
            ?.properties ?? {},
        ).sort(),
      ).toEqual(["createdAt", "creatorId", "id", "name", "ownerId"]);
    });
  },
);
