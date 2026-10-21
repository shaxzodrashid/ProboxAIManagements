import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { GroupsController } from "../src/groups/groups.controller";
import { GroupsService } from "../src/groups/groups.service";
import { GroupAdmissionController } from "../src/groups/group-admission.controller";
import { GroupAdmissionService } from "../src/groups/group-admission.service";
import { GroupMessagesController } from "../src/groups/group-messages.controller";
import { GroupMessagesService } from "../src/groups/group-messages.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { requireFixtureDatabase } from "./support/frontend-session-harness";
const request = require("supertest"),
  url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)("admitted human group text sending", () => {
  let db: PrismaClient,
    app: INestApplication,
    w: string,
    fw: string,
    owner: string,
    member: string,
    outsider: string,
    foreign: string,
    groupId: string;
  let roleId: string;
  const http = () => request(app.getHttpServer());
  const get = (path: string, actor = member) =>
    http()
      .get(path)
      .set("Authorization", "Bearer " + actor);
  const post = (path: string, body: unknown, actor = member) =>
    http()
      .post(path)
      .set("Authorization", "Bearer " + actor)
      .send(body);
  const send = (
    text = "Hello group",
    requestId: string = randomUUID(),
    actor = member,
  ) => post(`/chat-groups/${groupId}/messages`, { requestId, text }, actor);
  const policy = (membersCanSend: boolean, revision = 0, actor = owner) =>
    http()
      .put(`/chat-groups/${groupId}/sending-policy`)
      .set("Authorization", "Bearer " + actor)
      .set("If-Match", `"${revision}"`)
      .send({ membersCanSend });
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    w = (
      await db.workspace.create({
        data: { slug: "group-send-" + randomUUID() },
      })
    ).id;
    fw = (
      await db.workspace.create({
        data: { slug: "group-send-" + randomUUID() },
      })
    ).id;
    const user = async (workspaceId: string) =>
      (
        await db.user.create({
          data: {
            workspaceId,
            fullName: "Synthetic sender",
            phoneNumber: randomUUID(),
            status: "OPEN",
          },
        })
      ).id;
    owner = await user(w);
    member = await user(w);
    outsider = await user(w);
    foreign = await user(fw);
    await db.permission.upsert({
      where: { key: "users.manage" },
      create: {
        key: "users.manage",
        name: "Synthetic management",
        description: "Fixture",
        category: "test",
      },
      update: {},
    });
    roleId = (
      await db.role.create({
        data: {
          workspaceId: w,
          key: randomUUID(),
          name: "Synthetic administrator",
          permissions: { create: { permissionKey: "users.manage" } },
        },
      })
    ).id;
    await db.userRoleAssignment.createMany({
      data: [
        { userId: member, roleId, workspaceId: w },
        { userId: outsider, roleId, workspaceId: w },
      ],
    });
    const module = await Test.createTestingModule({
      controllers: [
        GroupsController,
        GroupAdmissionController,
        GroupMessagesController,
      ],
      providers: [
        GroupsService,
        GroupAdmissionService,
        GroupMessagesService,
        { provide: PrismaService, useValue: db },
        {
          provide: JwtService,
          useValue: {
            verify: (id: string) => ({
              id,
              type: id === "agent-token" ? "agent" : "access",
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  }, 30000);
  beforeEach(async () => {
    jest.restoreAllMocks();
    await db.user.updateMany({
      where: { id: { in: [owner, member, outsider, foreign] } },
      data: { status: "OPEN" },
    });
    await db.user.update({ where: { id: member }, data: { workspaceId: w } });
    const made = await post(
      "/chat-groups",
      { requestId: randomUUID(), name: "Message fixture" },
      owner,
    ).expect(201);
    groupId = made.body.group.id;
    await post(
      `/chat-groups/${groupId}/invitations`,
      { requestId: randomUUID(), recipientId: member, mode: "DIRECT" },
      owner,
    ).expect(201);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    if (db) {
      const groups = await db.chatGroup.findMany({
        where: { creatorId: owner },
        select: { id: true },
      });
      const ids = groups.map((g) => g.id);
      await db.chatGroupCreation.deleteMany({
        where: { groupId: { in: ids } },
      });
      await db.chatGroup.deleteMany({ where: { id: { in: ids } } });
      await db.user.deleteMany({
        where: { id: { in: [owner, member, outsider, foreign] } },
      });
      await db.role.delete({ where: { id: roleId } });
      await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
      await db.$disconnect();
    }
  }, 30000);
  it("allows admitted sending without an invite grant or added send permission", async () => {
    expect(
      (await get(`/chat-groups/${groupId}/sending-policy`).expect(200)).body,
    ).toEqual({ membersCanSend: true, revision: 0 });
    const sent = await send("  hello\nworld 👋  ").expect(201);
    expect(sent.body).toMatchObject({
      groupId,
      authorId: member,
      text: "  hello\nworld 👋  ",
      sequence: 1,
    });
    expect(
      await db.chatGroupInvitationPermission.findUnique({
        where: { groupId_accountId: { groupId, accountId: member } },
      }),
    ).toBeNull();
    await post(`/chat-groups/${groupId}/invitations`, {
      requestId: randomUUID(),
      recipientId: outsider,
      mode: "DIRECT",
    }).expect(403);
    await policy(false, 0, member).expect(404);
  });
  it("does not infer membership from workspace or foreign account context", async () => {
    await send("no", randomUUID(), outsider).expect(404);
    await send("no", randomUUID(), foreign).expect(404);
    await http()
      .post(`/chat-groups/${groupId}/messages`)
      .send({ requestId: randomUUID(), text: "no" })
      .expect(401);
    await send("no", randomUUID(), "agent-token").expect(401);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
  });
  it("honors explicit approved cross-workspace admission without workspace-wide access", async () => {
    await post(
      `/chat-groups/${groupId}/invitations`,
      { requestId: randomUUID(), recipientId: foreign, mode: "DIRECT" },
      owner,
    ).expect(201);
    await send("Admitted", randomUUID(), foreign).expect(201);
    await policy(false, 0, foreign).expect(404);
    await post(
      `/chat-groups/${groupId}/invitations`,
      { requestId: randomUUID(), recipientId: outsider, mode: "DIRECT" },
      foreign,
    ).expect(403);
  });
  it("requires actual admission after an approvable invitation", async () => {
    await post(
      `/chat-groups/${groupId}/invitations`,
      { requestId: randomUUID(), recipientId: foreign, mode: "APPROVABLE" },
      owner,
    ).expect(201);
    await send("pending", randomUUID(), foreign).expect(404);
    // Clean the synthetic card/conversation before common account cleanup.
    const conversations = await db.humanDirectConversation.findMany({
      where: { OR: [{ lowerAccountId: foreign }, { upperAccountId: foreign }] },
    });
    await db.humanDirectConversation.deleteMany({
      where: { id: { in: conversations.map((c) => c.id) } },
    });
  });
  it("deduplicates concurrent same-input retries and preserves exact author-scoped receipts", async () => {
    const requestId = randomUUID();
    const responses = await Promise.all([
      send("once", requestId),
      send("once", requestId),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(1);
    await send("changed", requestId).expect(409);
    expect(
      (
        await get(
          `/chat-groups/${groupId}/messages/by-request/${requestId}`,
        ).expect(200)
      ).body,
    ).toEqual(responses[0].body);
    await get(
      `/chat-groups/${groupId}/messages/by-request/${requestId}`,
      owner,
    ).expect(404);
    await get(
      `/chat-groups/${groupId}/messages/by-request/${requestId}`,
      outsider,
    ).expect(404);
    await send("own separate request scope", requestId, owner).expect(201);
  });
  it("orders distinct concurrent sends once and recovers a lost response by the same request", async () => {
    const requestId = randomUUID();
    await send("lost acknowledgement", requestId).expect(201);
    const receipt = (
      await get(
        `/chat-groups/${groupId}/messages/by-request/${requestId}`,
      ).expect(200)
    ).body;
    expect(
      (await send("lost acknowledgement", requestId).expect(201)).body,
    ).toEqual(receipt);
    const rows = await Promise.all([send("two"), send("three"), send("four")]);
    expect(rows.map((r) => r.body.sequence).sort()).toEqual([2, 3, 4]);
  });
  it("recovers the exact committed message after a lost acknowledgement without duplicating", async () => {
    const requestId = randomUUID(),
      original = db.$transaction.bind(db);
    jest.spyOn(db, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => {
      await original(callback);
      throw new Error("Synthetic lost send acknowledgement");
    }) as unknown as typeof db.$transaction);
    await send("committed", requestId).expect(500);
    const receipt = (
      await get(
        `/chat-groups/${groupId}/messages/by-request/${requestId}`,
      ).expect(200)
    ).body;
    expect((await send("committed", requestId).expect(201)).body).toEqual(
      receipt,
    );
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(1);
  });
  it("rolls back message sequence when insertion fails", async () => {
    const original = db.$transaction.bind(db);
    jest.spyOn(db, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      original(async (tx) => {
        const insertion = jest
          .spyOn(tx.chatGroupMessage, "create")
          .mockRejectedValueOnce(new Error("Synthetic insert failure"));
        try {
          return await callback(tx);
        } finally {
          insertion.mockRestore();
        }
      })) as unknown as typeof db.$transaction);
    await send().expect(500);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
    expect(
      (await db.chatGroup.findUniqueOrThrow({ where: { id: groupId } }))
        .lastMessageSequence,
    ).toBe(0);
    expect((await send().expect(201)).body.sequence).toBe(1);
  });
  it("serializes concurrent owner policy writes with one audit and no stale overwrite", async () => {
    const responses = await Promise.all([policy(false), policy(false)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.chatGroupSendingAudit.count({ where: { groupId } })).toBe(
      1,
    );
    await send().expect(403);
  });
  it("accepts the documented text bound and normalizes request UUID case", async () => {
    const requestId = randomUUID(),
      text = "x".repeat(4000);
    const response = await send(text, requestId.toUpperCase()).expect(201);
    expect(response.body.requestId).toBe(requestId);
    expect((await send(text, requestId).expect(201)).body).toEqual(
      response.body,
    );
  });
  it("sanitizes known read outages without returning empty successful content", async () => {
    jest
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          "Synthetic private database path",
          { code: "P1001", clientVersion: "fixture" },
        ),
      );
    const response = await get(`/chat-groups/${groupId}/sending-policy`).expect(
      503,
    );
    expect(response.body.code).toBe("READ_DEPENDENCY_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toContain("private database");
  });
  it("only owner can restrict and restore, with independent revisions and durable audits", async () => {
    await policy(false, 0, member).expect(404);
    expect((await policy(false).expect(200)).body).toEqual({
      membersCanSend: false,
      revision: 1,
    });
    await send().expect(403);
    await send("owner update", randomUUID(), owner).expect(201);
    await policy(true, 0).expect(409);
    await policy(false, 1).expect(200);
    expect(await db.chatGroupSendingAudit.count({ where: { groupId } })).toBe(
      1,
    );
    await policy(true, 1).expect(200);
    await send().expect(201);
    expect(
      (await db.chatGroup.findUniqueOrThrow({ where: { id: groupId } }))
        .permissionRevision,
    ).toBe(0);
    expect(
      await db.chatGroupSendingAudit.findMany({
        where: { groupId },
        orderBy: { revision: "asc" },
        select: { actorId: true, membersCanSend: true, revision: true },
      }),
    ).toEqual([
      { actorId: owner, membersCanSend: false, revision: 1 },
      { actorId: owner, membersCanSend: true, revision: 2 },
    ]);
  });
  it("reconciles an accepted message after restriction without authorizing new messages", async () => {
    const requestId = randomUUID();
    const row = (await send("accepted", requestId).expect(201)).body;
    await policy(false).expect(200);
    expect((await send("accepted", requestId).expect(201)).body).toEqual(row);
    await get(
      `/chat-groups/${groupId}/messages/by-request/${requestId}`,
    ).expect(200);
    await send().expect(403);
    await db.chatGroupMembership.delete({
      where: { groupId_accountId: { groupId, accountId: member } },
    });
    await send("accepted", requestId).expect(404);
    await get(
      `/chat-groups/${groupId}/messages/by-request/${requestId}`,
    ).expect(404);
  });
  it("requires membership even for owner, and rejects banned accounts", async () => {
    await db.user.update({ where: { id: member }, data: { status: "BANNED" } });
    await send().expect(401);
    await db.chatGroupMembership.delete({
      where: { groupId_accountId: { groupId, accountId: owner } },
    });
    await send("removed owner", randomUUID(), owner).expect(404);
    await policy(false).expect(404);
  });
  it.each([
    {},
    { requestId: randomUUID(), text: "   \n " },
    { requestId: randomUUID(), text: "x".repeat(4001) },
    { requestId: randomUUID(), text: null },
    { requestId: randomUUID(), text: "ok", authorId: "spoof" },
    { requestId: randomUUID(), text: "ok", topicId: randomUUID() },
  ])("rejects invalid or unauthorized input %j", async (body) => {
    await post(`/chat-groups/${groupId}/messages`, body).expect(400);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
  });
  it("validates revision, strict policy body and self-scoped query", async () => {
    await http()
      .put(`/chat-groups/${groupId}/sending-policy`)
      .set("Authorization", "Bearer " + owner)
      .send({ membersCanSend: false })
      .expect(428);
    await http()
      .put(`/chat-groups/${groupId}/sending-policy`)
      .set("Authorization", "Bearer " + owner)
      .set("If-Match", '"0"')
      .send({ membersCanSend: "false" })
      .expect(400);
    await get(
      `/chat-groups/${groupId}/sending-policy?accountId=${owner}`,
    ).expect(400);
  });
  const beforeAdmission = async (mutate: () => Promise<unknown>) => {
    const original = db.$transaction.bind(db);
    jest.spyOn(db, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: {
        timeout?: number;
        maxWait?: number;
        isolationLevel?: Prisma.TransactionIsolationLevel;
      },
    ) => {
      await mutate();
      return original(callback, options);
    }) as unknown as typeof db.$transaction);
    return send("stale admission");
  };
  it("rechecks a membership removed after HTTP authentication", async () => {
    expect(
      (
        await beforeAdmission(() =>
          db.chatGroupMembership.delete({
            where: { groupId_accountId: { groupId, accountId: member } },
          }),
        )
      ).status,
    ).toBe(404);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
  });
  it("rechecks account lifecycle after HTTP authentication", async () => {
    expect(
      (
        await beforeAdmission(() =>
          db.user.update({ where: { id: member }, data: { status: "BANNED" } }),
        )
      ).status,
    ).toBe(403);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
  });
  it("rejects a changed workspace context after HTTP authentication", async () => {
    expect(
      (
        await beforeAdmission(async () => {
          await db.userRoleAssignment.deleteMany({ where: { userId: member } });
          return db.user.update({
            where: { id: member },
            data: { workspaceId: fw },
          });
        })
      ).status,
    ).toBe(403);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
  });
  it("honors an owner restriction committed before send admission", async () => {
    expect(
      (
        await beforeAdmission(() =>
          db.chatGroup.update({
            where: { id: groupId },
            data: { membersCanSend: false, sendingRevision: { increment: 1 } },
          }),
        )
      ).status,
    ).toBe(403);
    expect(await db.chatGroupMessage.count({ where: { groupId } })).toBe(0);
  });
  it("declares explicit DTOs and recovery/restriction contracts in OpenAPI", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(
      doc.paths["/chat-groups/{groupId}/messages"]?.post?.responses[201],
    ).toBeDefined();
    expect(
      doc.paths["/chat-groups/{groupId}/messages/by-request/{requestId}"]?.get
        ?.responses[503],
    ).toBeDefined();
    expect(
      doc.paths["/chat-groups/{groupId}/sending-policy"]?.put?.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "If-Match", required: true }),
      ]),
    );
    expect(doc.components?.schemas?.SendGroupMessageDto).toMatchObject({
      required: ["requestId", "text"],
    });
  });
});
