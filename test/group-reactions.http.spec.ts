import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { GroupHistoryAccess, Prisma, PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { GroupsController } from "../src/groups/groups.controller";
import { GroupsService } from "../src/groups/groups.service";
import { GroupAdmissionService } from "../src/groups/group-admission.service";
import { GroupMessagesController } from "../src/groups/group-messages.controller";
import { GroupMessagesService } from "../src/groups/group-messages.service";
import { GROUP_HISTORY_CURSOR_KEY } from "../src/groups/group-history-cursor";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { GroupReactionsController } from "../src/groups/group-reactions.controller";
import { GroupReactionsService } from "../src/groups/group-reactions.service";
import { validStatusEmoji } from "../src/accounts/custom-status";
import { lockWorkspace } from "../src/prisma/workspace-lock";
import { requireFixtureDatabase } from "./support/frontend-session-harness";
const request = require("supertest"),
  url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)("own visible group message reactions", () => {
  let db: PrismaClient,
    app: INestApplication,
    w: string,
    fw: string,
    owner: string,
    member: string,
    other: string,
    foreign: string,
    g: string;
  let groups: GroupsService,
    admission: GroupAdmissionService,
    messages: GroupMessagesService;
  const topicA = randomUUID(),
    topicB = randomUUID();
  const actor = (id = owner, workspaceId = w): AuthenticatedUser => ({
    id,
    workspaceId,
    roles: [],
    permissions: [],
    type: "access",
  });
  const history = (query: object = {}, id = member, groupId = g) =>
    request(app.getHttpServer())
      .get(`/chat-groups/${groupId}/messages`)
      .query(query)
      .set("Authorization", "Bearer " + id);
  const admit = (
    historyAccess: GroupHistoryAccess = "NONE",
    recipientId = member,
  ) =>
    admission.create(actor(), g, {
      requestId: randomUUID(),
      recipientId,
      mode: "DIRECT",
      historyAccess,
    });
  async function seed(
    partitions: { topicId: string | null; count: number; prefix: string }[],
  ) {
    // Synthetic import writer, serialized exactly like the application sender.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ChatGroup" WHERE id=${g} FOR UPDATE`;
      let sequence = (
        await tx.chatGroup.findUniqueOrThrow({ where: { id: g } })
      ).lastMessageSequence;
      const rows: Prisma.ChatGroupMessageCreateManyInput[] = [];
      for (let i = 1; i <= Math.max(...partitions.map((p) => p.count)); i++)
        for (const p of partitions)
          if (i <= p.count)
            rows.push({
              groupId: g,
              authorId: owner,
              requestId: randomUUID(),
              sequence: ++sequence,
              topicId: p.topicId,
              text: `${p.prefix}-${i}`,
              createdAt: new Date("2026-10-20T00:00:00Z"),
            });
      if (rows.length) await tx.chatGroupMessage.createMany({ data: rows });
      await tx.chatGroup.update({
        where: { id: g },
        data: { lastMessageSequence: sequence },
      });
    });
  }
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    w = (
      await db.workspace.create({ data: { slug: "history-" + randomUUID() } })
    ).id;
    fw = (
      await db.workspace.create({ data: { slug: "history-" + randomUUID() } })
    ).id;
    const user = async (workspaceId: string) =>
      (
        await db.user.create({
          data: {
            workspaceId,
            status: "OPEN",
            fullName: "Synthetic history account",
            phoneNumber: randomUUID(),
          },
        })
      ).id;
    owner = await user(w);
    member = await user(w);
    other = await user(w);
    foreign = await user(fw);
    const module = await Test.createTestingModule({
      controllers: [
        GroupsController,
        GroupMessagesController,
        GroupReactionsController,
      ],
      providers: [
        GroupsService,
        GroupAdmissionService,
        GroupMessagesService,
        GroupReactionsService,
        { provide: PrismaService, useValue: db },
        { provide: GROUP_HISTORY_CURSOR_KEY, useValue: randomBytes(32) },
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
    groups = app.get(GroupsService);
    admission = app.get(GroupAdmissionService);
    messages = app.get(GroupMessagesService);
  }, 30000);
  beforeEach(async () => {
    jest.restoreAllMocks();
    await db.user.updateMany({
      where: { id: { in: [owner, member, other, foreign] } },
      data: { status: "OPEN" },
    });
    await db.user.update({ where: { id: member }, data: { workspaceId: w } });
    g = (
      await groups.create(actor(), {
        name: "Synthetic history",
        requestId: randomUUID(),
      })
    ).group.id;
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    if (db) {
      const ids = (
        await db.chatGroup.findMany({
          where: { creatorId: owner },
          select: { id: true },
        })
      ).map((r) => r.id);
      await db.chatGroupCreation.deleteMany({
        where: { groupId: { in: ids } },
      });
      await db.chatGroupInvitation.deleteMany({
        where: { groupId: { in: ids } },
      });
      await db.chatGroup.deleteMany({ where: { id: { in: ids } } });
      await db.humanDirectConversation.deleteMany({
        where: {
          OR: [
            { lowerAccountId: { in: [owner, member, other, foreign] } },
            { upperAccountId: { in: [owner, member, other, foreign] } },
          ],
        },
      });
      await db.user.deleteMany({
        where: { id: { in: [owner, member, other, foreign] } },
      });
      await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
      await db.$disconnect();
    }
  }, 30000);
  let target: string;
  const route = (messageId = target, groupId = g) =>
    `/chat-groups/${groupId}/messages/${messageId}/reactions`;
  const read = (
    query: object = {},
    id = member,
    messageId = target,
    groupId = g,
  ) =>
    request(app.getHttpServer())
      .get(route(messageId, groupId))
      .query(query)
      .set("Authorization", "Bearer " + id);
  const set = (
    emoji = "👍",
    present = true,
    id = member,
    messageId = target,
    groupId = g,
  ) =>
    request(app.getHttpServer())
      .put(route(messageId, groupId))
      .set("Authorization", "Bearer " + id)
      .send({ emoji, present });
  beforeEach(async () => {
    await admit("NONE");
    target = (
      await messages.send(actor(), g, {
        requestId: randomUUID(),
        text: "Synthetic visible message",
      })
    ).id;
  });
  const error = (code: string) =>
    new Prisma.PrismaClientKnownRequestError(
      "Synthetic private database detail",
      { code, clientVersion: "fixture" },
    );
  const beforeAdmission = (mutate: () => Promise<unknown>) => {
    const original = db.$transaction.bind(db);
    jest.spyOn(db, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: any,
    ) => {
      await mutate();
      return original(callback, options);
    }) as unknown as typeof db.$transaction);
  };
  const inside = (mutate: (tx: Prisma.TransactionClient) => void) => {
    const original = db.$transaction.bind(db);
    jest.spyOn(db, "$transaction").mockImplementationOnce(((
      callback: any,
      options: any,
    ) =>
      original(async (tx) => {
        mutate(tx);
        return callback(tx);
      }, options)) as typeof db.$transaction);
  };
  it("preserves all other own emojis and exposes only counts and own presence", async () => {
    await set().expect(200);
    await set("🎉").expect(200);
    await set("👍", true, owner).expect(200);
    const page = await read().expect(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body.items).toHaveLength(2);
    expect(page.body.items).toEqual(
      expect.arrayContaining([
        { emoji: "👍", count: 2, mine: true },
        { emoji: "🎉", count: 1, mine: true },
      ]),
    );
    expect(Object.keys(page.body).sort()).toEqual(["items", "nextAfter"]);
    expect(page.body.nextAfter).toBeNull();
    expect(
      (await read({}, owner).expect(200)).body.items.find(
        (r: any) => r.emoji === "🎉",
      ).mine,
    ).toBe(false);
  });
  it("deduplicates own adds and removals without changing other accounts or emojis", async () => {
    for (let i = 0; i < 2; i++) await set().expect(200);
    await set("👍", true, owner).expect(200);
    await set("🎉").expect(200);
    for (let i = 0; i < 2; i++)
      expect((await set("👍", false).expect(200)).body).toEqual({
        emoji: "👍",
        present: false,
      });
    expect((await read().expect(200)).body.items).toEqual(
      expect.arrayContaining([
        { emoji: "👍", count: 1, mine: false },
        { emoji: "🎉", count: 1, mine: true },
      ]),
    );
    expect(
      await db.chatGroupMessageReaction.count({ where: { messageId: target } }),
    ).toBe(2);
  });
  it("serializes distinct and duplicate concurrent requests from separate clients", async () => {
    const second = new PrismaClient({ datasources: { db: { url } } });
    const service = new GroupReactionsService(
      second as unknown as PrismaService,
    );
    try {
      await Promise.all([
        set(),
        service.set(actor(member), g, target, { emoji: "👍", present: true }),
        service.set(actor(member), g, target, { emoji: "🎉", present: true }),
        set("🔥"),
      ]);
      expect(
        await db.chatGroupMessageReaction.count({
          where: { messageId: target, accountId: member },
        }),
      ).toBe(3);
      await Promise.all([
        service.set(actor(member), g, target, { emoji: "👍", present: false }),
        set("👍", false),
        set("🎉", false),
      ]);
      expect((await read().expect(200)).body.items).toEqual([
        { emoji: "🔥", count: 1, mine: true },
      ]);
    } finally {
      await second.$disconnect();
    }
  });
  it("orders opposite desired states by the shared fence, without replacing unrelated emoji", async () => {
    await set("🎉").expect(200);
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((resolve) => (ready = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve));
    const locker = db.$transaction(
      async (tx) => {
        await lockWorkspace(tx, w);
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await held;
    const adding = set().then((r: any) => r);
    const removing = set("👍", false).then((r: any) => r);
    release();
    await locker;
    const responses = await Promise.all([adding, removing]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const page = (await read().expect(200)).body.items;
    expect(page.find((r: any) => r.emoji === "🎉")).toEqual({
      emoji: "🎉",
      count: 1,
      mine: true,
    });
    expect(
      await db.chatGroupMessageReaction.count({
        where: { messageId: target, emoji: "👍" },
      }),
    ).toBeLessThanOrEqual(1);
  });
  it("allows add/remove/read while text is owner-restricted, including a policy race", async () => {
    beforeAdmission(() =>
      db.chatGroup.update({
        where: { id: g },
        data: { membersCanSend: false, sendingRevision: { increment: 1 } },
      }),
    );
    await set().expect(200);
    await read().expect(200);
    await set("👍", false).expect(200);
    await expect(
      messages.send(actor(member), g, {
        requestId: randomUUID(),
        text: "blocked",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await Promise.all([messages.setPolicy(actor(), g, 1, true), set("🎉")]);
    expect((await read().expect(200)).body.items).toEqual([
      { emoji: "🎉", count: 1, mine: true },
    ]);
  });
  it("supports explicit cross-workspace admission without workspace-wide access", async () => {
    await set("👍", true, foreign).expect(404);
    await admit("ALL", foreign);
    await set("👍", true, foreign).expect(200);
    expect((await read({}, foreign).expect(200)).body.items).toEqual([
      { emoji: "👍", count: 1, mine: true },
    ]);
  });
  it.each(["read", "add", "remove"])(
    "denies %s after membership revocation wins authentication",
    async (mode) => {
      await set().expect(200);
      beforeAdmission(() =>
        db.chatGroupMembership.delete({
          where: { groupId_accountId: { groupId: g, accountId: member } },
        }),
      );
      const response =
        mode === "read" ? await read() : await set("👍", mode === "add");
      expect(response.status).toBe(404);
      expect(
        await db.chatGroupMessageReaction.count({
          where: { messageId: target },
        }),
      ).toBe(1);
    },
  );
  it.each(["BANNED", "workspace"])(
    "rejects persisted %s changes after authentication",
    async (change) => {
      beforeAdmission(() =>
        db.user.update({
          where: { id: member },
          data:
            change === "workspace" ? { workspaceId: fw } : { status: "BANNED" },
        }),
      );
      await set().expect(403);
      expect(
        await db.chatGroupMessageReaction.count({
          where: { messageId: target },
        }),
      ).toBe(0);
    },
  );
  it("returns indistinguishable opaque errors for missing, foreign-group and nonmember targets", async () => {
    const a = await read({}, member, randomUUID()).expect(404);
    const b = await read({}, other).expect(404);
    const c = await read({}, member, target, randomUUID()).expect(404);
    expect(a.body).toEqual(b.body);
    expect(a.body).toEqual(c.body);
    await set("👍", true, other).expect(404);
    await set("👍", false, other).expect(404);
  });
  it("enforces NONE hidden-message visibility on read/add/remove without touching retained reactions", async () => {
    await set().expect(200);
    await db.chatGroupMembership.update({
      where: { groupId_accountId: { groupId: g, accountId: member } },
      data: { historyCutoffSequence: 1 },
    });
    const expected = (await read({}, member, randomUUID()).expect(404)).body;
    expect((await read().expect(404)).body).toEqual(expected);
    await set().expect(404);
    await set("👍", false).expect(404);
    expect(
      await db.chatGroupMessageReaction.count({ where: { messageId: target } }),
    ).toBe(1);
  });
  it.each(["LAST_100", "LAST_300"] as const)(
    "uses exact frozen per-topic %s windows and post-admission visibility",
    async (access) => {
      await seed([
        { topicId: topicA, count: 305, prefix: "a" },
        { topicId: topicB, count: 305, prefix: "b" },
      ]);
      await admit(access, other);
      const topicRows = await db.chatGroupMessage.findMany({
        where: { groupId: g, topicId: topicA },
        orderBy: { sequence: "asc" },
      });
      const n = access === "LAST_100" ? 100 : 300;
      const hidden = topicRows[topicRows.length - n - 1]!,
        visible = topicRows[topicRows.length - n]!;
      await set("👍", true, other, hidden.id).expect(404);
      await set("👍", true, other, visible.id).expect(200);
      await read({}, other, visible.id).expect(200);
      await set("👍", false, other, hidden.id).expect(404);
      const before = await history({ topicId: topicA }, other).expect(200);
      expect(before.body.items.some((m: any) => m.id === hidden.id)).toBe(
        false,
      );
      await seed([{ topicId: randomUUID(), count: 1, prefix: "new-topic" }]);
      const post = await db.chatGroupMessage.findFirstOrThrow({
        where: { groupId: g },
        orderBy: { sequence: "desc" },
      });
      await set("🔥", true, other, post.id).expect(200);
    },
  );
  it("uses each topic's boundary rather than another topic's boundary", async () => {
    await seed([
      { topicId: topicA, count: 105, prefix: "a" },
      { topicId: topicB, count: 1, prefix: "b" },
    ]);
    await admit("LAST_100", other);
    const b = await db.chatGroupMessage.findFirstOrThrow({
      where: { groupId: g, topicId: topicB },
    });
    await set("👍", true, other, b.id).expect(200);
    const hidden = await db.chatGroupMessage.findFirstOrThrow({
      where: { groupId: g, topicId: topicA },
      orderBy: { sequence: "asc" },
    });
    await read({}, other, hidden.id).expect(404);
  });
  it("preserves legacy ALL and fails closed on unproved or invalid restricted boundaries", async () => {
    const key = { groupId_accountId: { groupId: g, accountId: member } };
    await db.chatGroupMembership.update({
      where: key,
      data: {
        historyAccess: "ALL",
        historyEpoch: null,
        historyCutoffSequence: null,
      },
    });
    await set().expect(200);
    await db.chatGroupMembership.update({
      where: key,
      data: { historyAccess: "NONE" },
    });
    expect((await read().expect(409)).body.code).toBe(
      "GROUP_HISTORY_BOUNDARY_UNAVAILABLE",
    );
    await set().expect(409);
    await set("👍", false).expect(409);
    await read({}, member, randomUUID()).expect(409);
    await set("👍", true, member, randomUUID()).expect(409);
    await db.chatGroupMembership.update({
      where: key,
      data: {
        historyAccess: "LAST_100",
        historyEpoch: randomUUID(),
        historyCutoffSequence: 1,
      },
    });
    await db.chatGroupHistoryBoundary.create({
      data: {
        groupId: g,
        accountId: member,
        topicKey: "MAIN",
        firstSequence: 2,
      },
    });
    await read().expect(409);
    expect(
      await db.chatGroupMessageReaction.count({ where: { messageId: target } }),
    ).toBe(1);
  });
  it.each(["👍", "👍🏽", "👩‍💻", "🇺🇿", "1️⃣", "❤️", "❤", "🏳️‍🌈"])(
    "accepts one exact Unicode sequence %s",
    async (emoji) => {
      expect((await set(emoji).expect(200)).body).toEqual({
        emoji,
        present: true,
      });
    },
  );
  it("does not fold presentation or skin-tone variants into replacements", async () => {
    for (const emoji of ["❤", "❤️", "👍", "👍🏽"]) await set(emoji).expect(200);
    expect((await read().expect(200)).body.items).toHaveLength(4);
  });
  it.each([
    null,
    5,
    "",
    "text",
    "👍🎉",
    "🏽",
    "<img>",
    "👍\n",
    "a".repeat(1000),
  ])("rejects invalid bounded emoji %p", async (emoji) => {
    await request(app.getHttpServer())
      .put(route())
      .set("Authorization", "Bearer " + member)
      .send({ emoji, present: true })
      .expect(400);
    expect(
      await db.chatGroupMessageReaction.count({ where: { messageId: target } }),
    ).toBe(0);
  });
  it("bounds pages and rejects actor overrides, unknown queries and malformed booleans", async () => {
    for (const emoji of ["👍", "🎉", "🔥"]) await set(emoji).expect(200);
    const all = (await read().expect(200)).body.items;
    let after: string | undefined;
    const items: any[] = [];
    do {
      const page = (
        await read({ limit: 1, ...(after ? { after } : {}) }).expect(200)
      ).body;
      expect(page.items).toHaveLength(1);
      items.push(...page.items);
      after = page.nextAfter ?? undefined;
    } while (after);
    expect(items).toEqual(all);
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { after: "not-emoji" },
      { accountId: owner },
      { topicId: topicA },
    ])
      await read(query).expect(400);
    for (const body of [
      { emoji: "👍", present: "false" },
      { emoji: "👍" },
      { present: true },
      { emoji: "👍", present: true, accountId: owner },
    ])
      await request(app.getHttpServer())
        .put(route())
        .set("Authorization", "Bearer " + member)
        .send(body)
        .expect(400);
    await request(app.getHttpServer())
      .put(route())
      .query({ actorId: owner })
      .set("Authorization", "Bearer " + member)
      .send({ emoji: "👍", present: false })
      .expect(400);
  });
  it("caps a populated page at100 distinct emojis with a continuation", async () => {
    const emojis = Array.from({ length: 1024 }, (_, i) =>
      String.fromCodePoint(0x1f300 + i),
    )
      .filter(validStatusEmoji)
      .slice(0, 101);
    expect(emojis).toHaveLength(101);
    await db.chatGroupMessageReaction.createMany({
      data: emojis.map((emoji) => ({
        messageId: target,
        accountId: member,
        emoji,
      })),
    });
    const first = (await read({ limit: 100 }).expect(200)).body;
    expect(first.items).toHaveLength(100);
    expect(first.nextAfter).not.toBeNull();
    const last = (
      await read({ limit: 100, after: first.nextAfter }).expect(200)
    ).body;
    expect(last.items).toHaveLength(1);
    expect(last.nextAfter).toBeNull();
    expect(
      new Set([...first.items, ...last.items].map((r: any) => r.emoji)).size,
    ).toBe(101);
  });
  it("requires the message to belong to the selected admitted group", async () => {
    const second = (
      await groups.create(actor(), {
        name: "Second synthetic group",
        requestId: randomUUID(),
      })
    ).group.id;
    await admission.create(actor(), second, {
      requestId: randomUUID(),
      recipientId: member,
      mode: "DIRECT",
      historyAccess: "ALL",
    });
    await read({}, member, target, second).expect(404);
    await set("👍", true, member, target, second).expect(404);
  });
  it("preserves storage uniqueness and foreign keys without manufacturing reactions", async () => {
    await set().expect(200);
    await expect(
      db.chatGroupMessageReaction.create({
        data: { messageId: target, accountId: member, emoji: "👍" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      db.chatGroupMessageReaction.create({
        data: { messageId: randomUUID(), accountId: member, emoji: "🎉" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.chatGroupMessageReaction.create({
        data: { messageId: target, accountId: randomUUID(), emoji: "🎉" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    expect(
      await db.chatGroupMessageReaction.count({ where: { messageId: target } }),
    ).toBe(1);
  });
  it("reauthorizes continuations and pages after removal of an emoji anchor", async () => {
    await set().expect(200);
    await set("🎉").expect(200);
    const page = (await read({ limit: 1 }).expect(200)).body;
    await set(page.nextAfter, false).expect(200);
    expect(
      (await read({ limit: 1, after: page.nextAfter }).expect(200)).body.items,
    ).toHaveLength(1);
    await db.chatGroupMembership.delete({
      where: { groupId_accountId: { groupId: g, accountId: member } },
    });
    await read({ after: page.nextAfter }).expect(404);
  });
  it.each(["add", "remove"])(
    "reports lost committed %s acknowledgement without replaying automatically",
    async (mode) => {
      if (mode === "remove") await set().expect(200);
      const original = db.$transaction.bind(db);
      let calls = 0;
      jest.spyOn(db, "$transaction").mockImplementationOnce((async (
        callback: any,
        options: any,
      ) => {
        calls++;
        await original(callback, options);
        throw error("P2028");
      }) as typeof db.$transaction);
      const response = await set("👍", mode === "add").expect(503);
      expect(response.body.code).toBe("OPERATION_OUTCOME_UNKNOWN");
      expect(JSON.stringify(response.body)).not.toContain("private database");
      expect(calls).toBe(1);
      expect((await read().expect(200)).body.items.length).toBe(
        mode === "add" ? 1 : 0,
      );
      await set("👍", mode === "add").expect(200);
      expect(
        await db.chatGroupMessageReaction.count({
          where: { messageId: target },
        }),
      ).toBe(mode === "add" ? 1 : 0);
    },
  );
  it("rolls back a write failure and preserves text, order and other reactions", async () => {
    await set("🎉").expect(200);
    const before = await db.chatGroupMessage.findUniqueOrThrow({
      where: { id: target },
    });
    inside((tx) =>
      jest
        .spyOn(tx.chatGroupMessageReaction, "upsert")
        .mockRejectedValueOnce(new Error("Synthetic insert failure")),
    );
    await set().expect(500);
    expect(
      await db.chatGroupMessage.findUniqueOrThrow({ where: { id: target } }),
    ).toEqual(before);
    expect((await read().expect(200)).body.items).toEqual([
      { emoji: "🎉", count: 1, mine: true },
    ]);
  });
  it("sanitizes known read outages, preserving unknown errors and mutation semantics", async () => {
    inside((tx) =>
      jest
        .spyOn(tx.chatGroupMessageReaction, "groupBy")
        .mockRejectedValueOnce(error("P1001")),
    );
    const unavailable = await read().expect(503);
    expect(unavailable.body.code).toBe("READ_DEPENDENCY_UNAVAILABLE");
    expect(JSON.stringify(unavailable.body)).not.toContain("private database");
    inside((tx) =>
      jest
        .spyOn(tx.chatGroupMessageReaction, "groupBy")
        .mockRejectedValueOnce(new Error("Synthetic unknown")),
    );
    await read().expect(500);
    inside((tx) =>
      jest
        .spyOn(tx.chatGroupMessageReaction, "upsert")
        .mockRejectedValueOnce(error("P1001")),
    );
    await set().expect(500);
    expect(
      await db.chatGroupMessageReaction.count({ where: { messageId: target } }),
    ).toBe(0);
  });
  it("does not accept agent or unauthenticated requests", async () => {
    await request(app.getHttpServer()).get(route()).expect(401);
    await read({}, "agent-token").expect(401);
    await set("👍", true, "agent-token").expect(401);
  });
  it("declares bounded explicit schemas and independent reaction authority", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const endpoint =
      doc.paths["/chat-groups/{groupId}/messages/{messageId}/reactions"]!;
    expect(endpoint.get!.responses["200"]).toBeDefined();
    expect(endpoint.put!.responses["503"]).toBeDefined();
    expect(endpoint.put!.description).toContain("restrictions do not block");
    expect(
      Object.keys(
        (doc.components!.schemas!.GroupReactionDto as any).properties,
      ).sort(),
    ).toEqual(["count", "emoji", "mine"]);
  });
});
