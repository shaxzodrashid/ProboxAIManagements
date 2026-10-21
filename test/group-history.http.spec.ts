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
import { lockWorkspace } from "../src/prisma/workspace-lock";
import { requireFixtureDatabase } from "./support/frontend-session-harness";
const request = require("supertest"),
  url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "bounded admitted group message history",
  () => {
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
    const read = (query: object = {}, id = member, groupId = g) =>
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
    async function all(topicId?: string, id = member) {
      const items: any[] = [];
      let cursor: string | undefined;
      do {
        const page = await read(
          {
            limit: 100,
            ...(topicId ? { topicId } : {}),
            ...(cursor ? { cursor } : {}),
          },
          id,
        ).expect(200);
        items.push(...page.body.items);
        cursor = page.body.nextCursor ?? undefined;
      } while (cursor);
      return items;
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
        controllers: [GroupsController, GroupMessagesController],
        providers: [
          GroupsService,
          GroupAdmissionService,
          GroupMessagesService,
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
    it("returns an empty no-store founder page without counts or raw counters", async () => {
      const page = await read({}, owner).expect(200);
      expect(page.headers["cache-control"]).toBe("no-store");
      expect(page.body).toEqual({ items: [], nextCursor: null });
      const m = await db.chatGroupMembership.findUniqueOrThrow({
        where: { groupId_accountId: { groupId: g, accountId: owner } },
      });
      expect(m.historyEpoch).toBeTruthy();
      expect(m.historyCutoffSequence).toBe(0);
    });
    it.each(["NONE", "LAST_100", "LAST_300", "ALL"] as const)(
      "enforces exact frozen %s independently in three interleaved partitions",
      async (policy) => {
        await seed([
          { topicId: null, count: 350, prefix: "main" },
          { topicId: topicA, count: 350, prefix: "A" },
          { topicId: topicB, count: 17, prefix: "B" },
        ]);
        await admit(policy);
        await seed([
          { topicId: null, count: 1, prefix: "later-main" },
          { topicId: topicA, count: 1, prefix: "later-A" },
          { topicId: topicB, count: 1, prefix: "later-B" },
        ]);
        const n =
          policy === "NONE"
            ? 0
            : policy === "LAST_100"
              ? 100
              : policy === "LAST_300"
                ? 300
                : 350;
        const main = await all(),
          a = await all(topicA),
          b = await all(topicB);
        expect(main.length).toBe(n + 1);
        expect(a.length).toBe(n + 1);
        expect(b.length).toBe((policy === "NONE" ? 0 : 17) + 1);
        expect(main[0].text).toBe("later-main-1");
        expect(a[0].text).toBe("later-A-1");
        if (n) expect(main[main.length - 1].text).toBe(`main-${351 - n}`);
        expect(Object.keys(main[0]).sort()).toEqual([
          "authorId",
          "createdAt",
          "id",
          "text",
          "topicId",
        ]);
        expect(new Set([...main, ...a, ...b].map((i) => i.id)).size).toBe(
          main.length + a.length + b.length,
        );
      },
    );
    it("allows a partition first populated after admission without inventing pre-join visibility", async () => {
      await admit("LAST_100");
      await seed([{ topicId: topicA, count: 2, prefix: "new-topic" }]);
      expect((await all(topicA)).map((i) => i.text)).toEqual([
        "new-topic-2",
        "new-topic-1",
      ]);
    });
    it("does not expand a frozen window after a visible message disappears before first read", async () => {
      await seed([{ topicId: null, count: 125, prefix: "old" }]);
      await admit("LAST_100");
      await db.chatGroupMessage.deleteMany({
        where: { groupId: g, text: "old-125" },
      });
      const items = await all();
      expect(items).toHaveLength(99);
      expect(items[items.length - 1].text).toBe("old-26");
      expect(items.some((i) => i.text === "old-25")).toBe(false);
    });
    it("keeps a paging snapshot stable across new sends and removal of the cursor anchor", async () => {
      await seed([{ topicId: null, count: 30, prefix: "old" }]);
      await admit("ALL");
      const first = (await read({ limit: 10 }).expect(200)).body;
      await db.chatGroupMessage.delete({ where: { id: first.items[9].id } });
      await seed([{ topicId: null, count: 1, prefix: "new" }]);
      const second = (
        await read({ limit: 10, cursor: first.nextCursor }).expect(200)
      ).body;
      expect(second.items.map((i: any) => i.text)).toEqual(
        Array.from({ length: 10 }, (_, i) => `old-${20 - i}`),
      );
      expect(second.items.some((i: any) => i.text === "new-1")).toBe(false);
      expect((await read({ limit: 10 }).expect(200)).body.items[0].text).toBe(
        "new-1",
      );
    });
    it("binds opaque continuations to member, group, topic, page size and admission generation", async () => {
      await seed([{ topicId: null, count: 5, prefix: "old" }]);
      await admit("ALL");
      await admit("ALL", other);
      const token = (await read({ limit: 1 }).expect(200)).body.nextCursor;
      expect(token).toMatch(
        /^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      );
      await read({ limit: 2, cursor: token }).expect(400);
      await read({ limit: 1, topicId: topicA, cursor: token }).expect(400);
      await read({ limit: 1, cursor: token }, other).expect(400);
      const otherGroup = (
        await groups.create(actor(), { name: "Other", requestId: randomUUID() })
      ).group.id;
      await admission.create(actor(), otherGroup, {
        requestId: randomUUID(),
        recipientId: member,
        mode: "DIRECT",
        historyAccess: "ALL",
      });
      await read({ limit: 1, cursor: token }, member, otherGroup).expect(400);
      await db.chatGroupMembership.update({
        where: { groupId_accountId: { groupId: g, accountId: member } },
        data: { historyEpoch: randomUUID() },
      });
      await read({ limit: 1, cursor: token }).expect(409);
    });
    it("rejects tampering and unknown selectors without disclosing history", async () => {
      await seed([{ topicId: null, count: 2, prefix: "old" }]);
      await admit("ALL");
      const token = (await read({ limit: 1 }).expect(200)).body.nextCursor;
      await read({
        limit: 1,
        cursor:
          token.slice(0, 25) +
          (token[25] === "A" ? "B" : "A") +
          token.slice(26),
      }).expect(400);
      for (const query of [
        { limit: 0 },
        { limit: 101 },
        { limit: "many" },
        { topicId: "bad" },
        { cursor: "" },
        { cursor: "a".repeat(1025) },
        { beforeSequence: 0 },
        { accountId: owner },
        { includeHidden: true },
      ])
        await read(query).expect(400);
    });
    it("reauthorizes each page after removal and account/workspace changes", async () => {
      await seed([{ topicId: null, count: 3, prefix: "old" }]);
      await admit("ALL");
      const token = (await read({ limit: 1 }).expect(200)).body.nextCursor;
      await db.user.update({
        where: { id: member },
        data: { status: "BANNED" },
      });
      await read({ limit: 1, cursor: token }).expect(401);
      await expect(
        messages.history(actor(member), g, { limit: 1, cursor: token }),
      ).rejects.toMatchObject({ status: 403 });
      await db.user.update({
        where: { id: member },
        data: { status: "OPEN", workspaceId: fw },
      });
      await expect(
        messages.history(actor(member), g, {}),
      ).rejects.toMatchObject({ status: 403 });
      await read({ limit: 1, cursor: token }).expect(400);
      await db.chatGroupMembership.delete({
        where: { groupId_accountId: { groupId: g, accountId: member } },
      });
      await read({ limit: 1, cursor: token }).expect(404);
    });
    it("permits explicit cross-workspace membership and reading after sending restriction", async () => {
      await seed([{ topicId: null, count: 2, prefix: "old" }]);
      await admit("ALL", foreign);
      await messages.setPolicy(actor(), g, 0, false);
      expect((await all(undefined, foreign)).length).toBe(2);
      await read({}, other).expect(404);
      await admission.create(actor(), g, {
        requestId: randomUUID(),
        recipientId: member,
        mode: "APPROVABLE",
        historyAccess: "ALL",
      });
      await read().expect(404);
    });
    it("preserves legacy records and fails closed only when a historical cutoff is needed but unproved", async () => {
      await seed([{ topicId: null, count: 3, prefix: "legacy" }]);
      await admit("NONE");
      await db.chatGroupMembership.update({
        where: { groupId_accountId: { groupId: g, accountId: member } },
        data: { historyEpoch: null, historyCutoffSequence: null },
      });
      const before = await db.chatGroupMessage.findMany({
        where: { groupId: g },
      });
      const response = await read().expect(409);
      expect(response.body.code).toBe("GROUP_HISTORY_BOUNDARY_UNAVAILABLE");
      expect(
        await db.chatGroupMessage.findMany({ where: { groupId: g } }),
      ).toEqual(before);
      const unchanged = await db.chatGroupMembership.findUniqueOrThrow({
        where: { groupId_accountId: { groupId: g, accountId: member } },
      });
      expect(unchanged.historyEpoch).toBeNull();
      expect(unchanged.historyCutoffSequence).toBeNull();
      await db.chatGroupMembership.update({
        where: { groupId_accountId: { groupId: g, accountId: member } },
        data: { historyAccess: "ALL" },
      });
      expect((await all()).length).toBe(3);
    });
    it("freezes approvable history at acceptance, and exact acceptance replay does not widen it", async () => {
      await seed([{ topicId: null, count: 110, prefix: "early" }]);
      const pending = await admission.create(actor(), g, {
        requestId: randomUUID(),
        recipientId: member,
        mode: "APPROVABLE",
        historyAccess: "LAST_100",
      });
      await read().expect(404);
      await seed([{ topicId: null, count: 20, prefix: "pending" }]);
      await admission.decide(
        actor(member),
        pending.invitation.conversationId!,
        pending.invitation.id,
        true,
      );
      const frozen = await db.chatGroupMembership.findUniqueOrThrow({
        where: { groupId_accountId: { groupId: g, accountId: member } },
      });
      expect(frozen.historyCutoffSequence).toBe(130);
      const initial = await all();
      expect(initial).toHaveLength(100);
      expect(initial[0].text).toBe("pending-20");
      expect(initial[99].text).toBe("early-31");
      await seed([{ topicId: null, count: 5, prefix: "after" }]);
      await admission.decide(
        actor(member),
        pending.invitation.conversationId!,
        pending.invitation.id,
        true,
      );
      expect(
        await db.chatGroupMembership.findUniqueOrThrow({
          where: { groupId_accountId: { groupId: g, accountId: member } },
        }),
      ).toEqual(frozen);
      const later = await all();
      expect(later).toHaveLength(105);
      expect(later[later.length - 1].text).toBe("early-31");
    });
    it("captures admission after the group fence even while timestamps are equal", async () => {
      let entered!: () => void, release!: () => void;
      const ready = new Promise<void>((r) => {
          entered = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const held = db.$transaction(async (tx) => {
        await lockWorkspace(tx, w);
        await tx.$queryRaw`SELECT id FROM "ChatGroup" WHERE id=${g} FOR UPDATE`;
        entered();
        await gate;
        await tx.chatGroupMessage.create({
          data: {
            groupId: g,
            authorId: owner,
            requestId: randomUUID(),
            text: "before",
            sequence: 1,
          },
        });
        await tx.chatGroup.update({
          where: { id: g },
          data: { lastMessageSequence: 1 },
        });
      });
      await ready;
      const joining = admit("NONE");
      release();
      await held;
      await joining;
      const m = await db.chatGroupMembership.findUniqueOrThrow({
        where: { groupId_accountId: { groupId: g, accountId: member } },
      });
      expect(m.historyCutoffSequence).toBe(1);
      await db.chatGroupMessage.updateMany({
        where: { groupId: g },
        data: { createdAt: m.joinedAt },
      });
      await messages.send(actor(), g, {
        requestId: randomUUID(),
        text: "after",
      });
      await db.chatGroupMessage.updateMany({
        where: { groupId: g },
        data: { createdAt: m.joinedAt },
      });
      expect((await all()).map((i) => i.text)).toEqual(["after"]);
    });
    it("rolls back admission and invitation if boundary persistence fails", async () => {
      await seed([{ topicId: null, count: 3, prefix: "old" }]);
      const original = db.$transaction.bind(db);
      jest.spyOn(db, "$transaction").mockImplementationOnce(((run: any) =>
        original(async (tx) => {
          jest
            .spyOn(tx.chatGroupHistoryBoundary, "createMany")
            .mockRejectedValueOnce(
              new Error("synthetic boundary write failure"),
            );
          return run(tx);
        })) as any);
      await expect(admit("LAST_100")).rejects.toThrow(
        "synthetic boundary write failure",
      );
      expect(
        await db.chatGroupMembership.count({
          where: { groupId: g, accountId: member },
        }),
      ).toBe(0);
      expect(
        await db.chatGroupHistoryBoundary.count({
          where: { groupId: g, accountId: member },
        }),
      ).toBe(0);
      expect(
        await db.chatGroupInvitation.count({
          where: { groupId: g, recipientId: member },
        }),
      ).toBe(0);
    });
    it("returns sanitized read dependency errors and requires configured cursor protection", async () => {
      await admit("ALL");
      jest.spyOn(db.chatGroupMessage, "findMany");
      const original = db.$transaction.bind(db);
      jest.spyOn(db, "$transaction").mockImplementationOnce(((run: any) =>
        original(async (tx) => {
          jest.spyOn(tx.chatGroupMessage, "findMany").mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError("secret database path", {
              code: "P1001",
              clientVersion: "fixture",
            }),
          );
          return run(tx);
        })) as any);
      const response = await read().expect(503);
      expect(response.body.code).toBe("READ_DEPENDENCY_UNAVAILABLE");
      expect(JSON.stringify(response.body)).not.toContain("secret");
      await expect(
        new GroupMessagesService(db as PrismaService).history(
          actor(member),
          g,
          {},
        ),
      ).rejects.toMatchObject({ status: 503 });
    });
  },
);
