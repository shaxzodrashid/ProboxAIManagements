import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { GroupsController } from "../src/groups/groups.controller";
import { GroupsService } from "../src/groups/groups.service";
import { GroupAdmissionController } from "../src/groups/group-admission.controller";
import { GroupAdmissionService } from "../src/groups/group-admission.service";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";
const request = require("supertest"),
  url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "owner-granted group admission and structured invitation DMs",
  () => {
    let db: PrismaClient,
      app: INestApplication,
      w: string,
      fw: string,
      owner: string,
      member: string,
      recipient: string,
      outsider: string,
      groupId: string;
    const http = () => request(app.getHttpServer());
    const get = (path: string, actor = owner) =>
      http()
        .get(path)
        .set("Authorization", "Bearer " + actor);
    const post = (path: string, body: unknown, actor = owner) =>
      http()
        .post(path)
        .set("Authorization", "Bearer " + actor)
        .send(body);
    const put = (
      path: string,
      body: unknown,
      actor = owner,
      revision?: number,
    ) => {
      const call = http()
        .put(path)
        .set("Authorization", "Bearer " + actor);
      if (revision !== undefined) call.set("If-Match", `"${revision}"`);
      return call.send(body);
    };
    const invite = (
      to = recipient,
      mode = "APPROVABLE",
      historyAccess = "LAST_100",
      actor = owner,
      requestId = randomUUID(),
    ) =>
      post(
        `/chat-groups/${groupId}/invitations`,
        { requestId, recipientId: to, mode, historyAccess },
        actor,
      );
    const right = (
      to: string,
      canInvite: boolean,
      revision: number,
      actor = owner,
    ) =>
      put(
        `/chat-groups/${groupId}/invitation-permissions/${to}`,
        { canInvite },
        actor,
        revision,
      );
    const decision = (row: any, accept = true, actor = recipient) =>
      put(
        `/direct-conversations/${row.conversationId}/invitations/${row.id}/decision`,
        { accept },
        actor,
      );
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (
        await db.workspace.create({
          data: { slug: "group-admission-" + randomUUID() },
        })
      ).id;
      fw = (
        await db.workspace.create({
          data: { slug: "group-admission-" + randomUUID() },
        })
      ).id;
      const administrativeKeys = [
        "roles.manage",
        "users.manage",
        "projects.manage-all",
      ];
      await db.permission.createMany({
        data: administrativeKeys.map((key) => ({
          key,
          name: key,
          category: "test",
          description: key,
        })),
        skipDuplicates: true,
      });
      const createUser = async (workspaceId: string, admin = false) => {
        const role = await db.role.create({
          data: {
            workspaceId,
            key: randomUUID(),
            name: admin ? "ADMIN" : "USER",
            ...(admin
              ? {
                  permissions: {
                    create: administrativeKeys.map((permissionKey) => ({
                      permissionKey,
                    })),
                  },
                }
              : {}),
          },
        });
        return (
          await db.user.create({
            data: {
              workspaceId,
              phoneNumber: "group-admission-" + randomUUID(),
              fullName: "Synthetic participant",
              status: "OPEN",
              roleAssignments: { create: { roleId: role.id } },
            },
          })
        ).id;
      };
      owner = await createUser(w);
      member = await createUser(w, true);
      recipient = await createUser(fw);
      outsider = await createUser(w, true);
      const module = await Test.createTestingModule({
        controllers: [GroupsController, GroupAdmissionController],
        providers: [
          GroupsService,
          GroupAdmissionService,
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
        where: { id: { in: [owner, member, recipient, outsider] } },
        data: { status: "OPEN" },
      });
      const made = await post("/chat-groups", {
        requestId: randomUUID(),
        name: "Admission fixture",
      }).expect(201);
      groupId = made.body.group.id;
    });
    afterAll(async () => {
      await app?.close();
      if (db) {
        const groups = await db.chatGroup.findMany({
          where: { creatorId: owner },
          select: { id: true },
        });
        await db.chatGroupCreation.deleteMany({
          where: { groupId: { in: groups.map((g) => g.id) } },
        });
        await db.chatGroup.deleteMany({
          where: { id: { in: groups.map((g) => g.id) } },
        });
        await db.humanDirectConversation.deleteMany({
          where: {
            OR: [
              { lowerAccountId: { in: [owner, member, recipient, outsider] } },
              { upperAccountId: { in: [owner, member, recipient, outsider] } },
            ],
          },
        });
        await db.user.deleteMany({
          where: { id: { in: [owner, member, recipient, outsider] } },
        });
        await db.role.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
        await db.$disconnect();
      }
    }, 30000);
    it("creates explicit owner membership/invite authority without workspace role grants", async () => {
      expect(
        (
          await get(`/chat-groups/${groupId}/invitation-permissions`).expect(
            200,
          )
        ).body,
      ).toEqual({
        revision: 0,
        items: [{ accountId: owner, canInvite: true }],
      });
      await get(
        `/chat-groups/${groupId}/invitation-permissions`,
        outsider,
      ).expect(404);
      await invite(recipient, "DIRECT", "ALL", outsider).expect(403);
      expect(await db.chatGroupMembership.count({ where: { groupId } })).toBe(
        1,
      );
    });
    it("directly admits an OPEN cross-workspace account with the inviter's history choice and no DM", async () => {
      const result = (await invite(recipient, "DIRECT", "LAST_300").expect(201))
        .body.invitation;
      expect(result).toMatchObject({
        status: "ADDED",
        historyAccess: "LAST_300",
        conversationId: null,
      });
      const joined = await db.chatGroupMembership.findUniqueOrThrow({
        where: { groupId_accountId: { groupId, accountId: recipient } },
      });
      expect(joined.historyAccess).toBe("LAST_300");
      expect(joined.invitationId).toBe(result.id);
      expect(joined.joinedAt.toISOString()).toBe(result.resolvedAt);
      await get(`/chat-groups/${groupId}`, recipient).expect(200);
      const own = (await get("/users/me/chat-groups", recipient).expect(200))
        .body.items;
      expect(
        own.some(
          (m: any) => m.group.id === groupId && m.historyAccess === "LAST_300",
        ),
      ).toBe(true);
      expect(
        await db.directInvitationCard.count({
          where: { invitationId: result.id },
        }),
      ).toBe(0);
    });
    it("requires the owner's explicit member grant and lets that inviter select history without another approval", async () => {
      await invite(member, "DIRECT", "NONE").expect(201);
      await invite(recipient, "APPROVABLE", "ALL", member).expect(403);
      await right(member, true, 0).expect(200);
      await right(member, true, 1, member).expect(404);
      const row = (
        await invite(recipient, "APPROVABLE", "ALL", member).expect(201)
      ).body.invitation;
      expect(row.historyAccess).toBe("ALL");
      expect(row.status).toBe("PENDING");
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(0);
      await decision(row).expect(200);
      expect(
        (
          await db.chatGroupMembership.findUniqueOrThrow({
            where: { groupId_accountId: { groupId, accountId: recipient } },
          })
        ).historyAccess,
      ).toBe("ALL");
      expect(
        await db.chatGroupPermissionAudit.count({ where: { groupId } }),
      ).toBe(1);
    });
    it("delivers an actual durable structured card to the two-party DM and grants no group access until accepted", async () => {
      const row = (await invite().expect(201)).body.invitation;
      await get(`/chat-groups/${groupId}`, recipient).expect(404);
      const messages = (
        await get(
          `/direct-conversations/${row.conversationId}/messages?limit=1`,
          recipient,
        ).expect(200)
      ).body;
      expect(messages.items[0]).toMatchObject({
        kind: "GROUP_INVITATION",
        sequence: expect.any(Number),
        invitation: {
          id: row.id,
          groupId,
          historyAccess: "LAST_100",
          status: "PENDING",
        },
      });
      expect(JSON.stringify(messages)).not.toMatch(
        /inputHash|requestId|phone|workspaceId|permissions|password/,
      );
      const threads = (
        await get("/direct-conversations", recipient).expect(200)
      ).body.items;
      expect(
        threads.some(
          (t: any) => t.id === row.conversationId && t.counterpartId === owner,
        ),
      ).toBe(true);
      await get(
        `/direct-conversations/${row.conversationId}/messages`,
        outsider,
      ).expect(404);
      expect(
        (await get("/direct-conversations", outsider).expect(200)).body.items,
      ).toEqual([]);
      await decision(row, true, owner).expect(404);
      await decision(row).expect(200);
      await get(`/chat-groups/${groupId}`, recipient).expect(200);
      expect(
        (
          await get(
            `/direct-conversations/${row.conversationId}/messages`,
            recipient,
          ).expect(200)
        ).body.items.find((m: any) => m.invitation.id === row.id).invitation
          .status,
      ).toBe("ACCEPTED");
    });
    it("replays stable create intent once, rejects changed input and exposes caller-scoped outcome", async () => {
      const requestId = randomUUID();
      const [a, b] = await Promise.all([
        invite(recipient, "APPROVABLE", "NONE", owner, requestId),
        invite(recipient, "APPROVABLE", "NONE", owner, requestId),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      expect(
        await db.chatGroupInvitation.count({
          where: { inviterId: owner, requestId },
        }),
      ).toBe(1);
      expect(
        await db.directInvitationCard.count({
          where: { invitationId: a.body.invitation.id },
        }),
      ).toBe(1);
      await invite(recipient, "APPROVABLE", "ALL", owner, requestId).expect(
        409,
      );
      expect(
        (
          await get(
            `/chat-groups/${groupId}/invitations/by-request/${requestId}`,
          ).expect(200)
        ).body,
      ).toEqual(a.body);
      await get(
        `/chat-groups/${groupId}/invitations/by-request/${requestId}`,
        outsider,
      ).expect(403);
      await right(owner, false, 0).expect(200);
      await invite(recipient, "APPROVABLE", "NONE", owner, requestId).expect(
        403,
      );
    });
    it("preserves the selected history and admission timestamp across matching accept retries", async () => {
      const row = (
        await invite(recipient, "APPROVABLE", "LAST_300").expect(201)
      ).body.invitation;
      const accepted = (await decision(row).expect(200)).body;
      expect((await decision(row).expect(200)).body).toEqual(accepted);
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(1);
      expect(
        (
          await db.chatGroupMembership.findUniqueOrThrow({
            where: { groupId_accountId: { groupId, accountId: recipient } },
          })
        ).historyAccess,
      ).toBe("LAST_300");
      await decision(row, false).expect(409);
      await invite(recipient, "DIRECT", "ALL").expect(409);
    });
    it("serializes contrary concurrent decisions without changing an established admission window", async () => {
      const row = (await invite().expect(201)).body.invitation;
      const results = await Promise.all([
        decision(row, true),
        decision(row, false),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const stored = await db.chatGroupInvitation.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(stored.status === "ACCEPTED" ? 1 : 0);
      expect(stored.historyAccess).toBe("LAST_100");
    });
    it("declines without membership and refuses pending duplicate/history replacement", async () => {
      const row = (await invite().expect(201)).body.invitation;
      await invite(recipient, "DIRECT", "ALL").expect(409);
      await decision(row, false).expect(200);
      await decision(row, false).expect(200);
      await decision(row, true).expect(409);
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(0);
    });
    it("checks current issuer lifecycle and still permits declining an unavailable invitation", async () => {
      const row = (await invite().expect(201)).body.invitation;
      await db.user.update({
        where: { id: owner },
        data: { status: "BANNED" },
      });
      await decision(row, true).expect(409);
      await decision(row, false).expect(200);
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(0);
    });
    it("fences accept against a permission revocation committed ahead of admission", async () => {
      await invite(member, "DIRECT", "NONE").expect(201);
      await right(member, true, 0).expect(200);
      const row = (
        await invite(recipient, "APPROVABLE", "ALL", member).expect(201)
      ).body.invitation;
      let entered!: () => void, release!: () => void;
      const ready = new Promise<void>((r) => {
          entered = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const holding = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${w} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "ChatGroup" WHERE "id"=${groupId} FOR UPDATE`;
          entered();
          await gate;
          await tx.chatGroupInvitationPermission.update({
            where: { groupId_accountId: { groupId, accountId: member } },
            data: { canInvite: false },
          });
        },
        { timeout: 20000 },
      );
      await ready;
      const pending = decision(row, true).then((r: any) => r);
      try {
        await untilFixture(async () => {
          const rows = await db.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Workspace%'`;
          return Number(rows[0]?.n) > 0;
        }, 8000);
        release();
        await holding;
        expect((await pending).status).toBe(403);
      } finally {
        release();
        await holding;
        await pending;
      }
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(0);
      expect(
        (
          await db.chatGroupInvitation.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).historyAccess,
      ).toBe("ALL");
    });
    it("rolls invitation, thread and card back together on card persistence failure", async () => {
      const requestId = randomUUID(),
        original = db.$transaction.bind(db);
      const outer = jest
        .spyOn(db, "$transaction")
        .mockImplementationOnce((async (
          fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: any,
        ) =>
          original(async (tx) => {
            const spy = jest
              .spyOn(tx.directInvitationCard, "create")
              .mockRejectedValueOnce(
                new Error("injected card persistence failure"),
              );
            try {
              return await fn(tx);
            } finally {
              spy.mockRestore();
            }
          }, options)) as never);
      try {
        await invite(recipient, "APPROVABLE", "NONE", owner, requestId).expect(
          500,
        );
      } finally {
        outer.mockRestore();
      }
      expect(
        await db.chatGroupInvitation.count({
          where: { inviterId: owner, requestId },
        }),
      ).toBe(0);
      expect(
        await db.chatGroupMembership.count({
          where: { groupId, accountId: recipient },
        }),
      ).toBe(0);
      await invite(recipient, "APPROVABLE", "NONE", owner, requestId).expect(
        201,
      );
    });
    it("recovers a lost create response by the same intent without another card", async () => {
      const requestId = randomUUID(),
        original = db.$transaction.bind(db);
      const outer = jest
        .spyOn(db, "$transaction")
        .mockImplementationOnce((async (fn: never, options: any) => {
          await original(fn, options);
          throw new Error("injected lost acknowledgment after commit");
        }) as never);
      try {
        await invite(recipient, "APPROVABLE", "NONE", owner, requestId).expect(
          500,
        );
      } finally {
        outer.mockRestore();
      }
      const recovered = (
        await get(
          `/chat-groups/${groupId}/invitations/by-request/${requestId}`,
        ).expect(200)
      ).body;
      expect(
        (
          await invite(
            recipient,
            "APPROVABLE",
            "NONE",
            owner,
            requestId,
          ).expect(201)
        ).body,
      ).toEqual(recovered);
      expect(
        await db.directInvitationCard.count({
          where: { invitationId: recovered.invitation.id },
        }),
      ).toBe(1);
    });
    it("rejects forged history/actor fields, invalid choices, stale grants and cursor possession", async () => {
      await post(`/chat-groups/${groupId}/invitations`, {
        requestId: randomUUID(),
        recipientId: recipient,
        mode: "DIRECT",
        historyAccess: "OTHER",
      }).expect(400);
      await post(`/chat-groups/${groupId}/invitations`, {
        requestId: randomUUID(),
        recipientId: recipient,
        mode: "DIRECT",
        ownerId: owner,
      }).expect(400);
      await right(owner, false, 99).expect(409);
      const row = (await invite().expect(201)).body.invitation;
      await put(
        `/direct-conversations/${row.conversationId}/invitations/${row.id}/decision`,
        { accept: true, historyAccess: "ALL" },
        recipient,
      ).expect(400);
      await get(
        `/direct-conversations/${row.conversationId}/messages?afterSequence=1`,
        outsider,
      ).expect(404);
      await get(
        `/direct-conversations/${row.conversationId}/messages?limit=101`,
        recipient,
      ).expect(400);
      await get("/users/me/chat-groups?accountId=" + owner, recipient).expect(
        400,
      );
      await get("/direct-conversations", "agent-token").expect(401);
    });
    it("returns accurate recipient action availability without inventing expired or permanently revoked states", async () => {
      const row = (await invite().expect(201)).body.invitation;
      const card = async (actor = recipient) =>
        (
          await get(
            `/direct-conversations/${row.conversationId}/messages`,
            actor,
          ).expect(200)
        ).body.items.find((item: any) => item.invitation.id === row.id);
      expect((await card()).actions).toEqual({ accept: true, decline: true });
      expect((await card(owner)).actions).toEqual({
        accept: false,
        decline: false,
      });
      await right(owner, false, 0).expect(200);
      expect((await card()).invitation.status).toBe("PENDING");
      expect((await card()).actions).toEqual({ accept: false, decline: true });
      await decision(row).expect(403);
      await right(owner, true, 1).expect(200);
      await decision(row).expect(200);
      expect((await card()).actions).toEqual({ accept: false, decline: false });
    });
    it("allows revoking an inactive member's grant without permitting new grants to inactive accounts", async () => {
      await invite(member, "DIRECT", "NONE").expect(201);
      await right(member, true, 0).expect(200);
      await db.user.update({
        where: { id: member },
        data: { status: "BANNED" },
      });
      await right(member, false, 1).expect(200);
      await right(member, true, 2).expect(404);
      expect(
        (
          await db.chatGroupInvitationPermission.findUniqueOrThrow({
            where: { groupId_accountId: { groupId, accountId: member } },
          })
        ).canInvite,
      ).toBe(false);
    });
    it("paginates durable DM cards without treating a sequence cursor as conversation authority", async () => {
      const row = (await invite().expect(201)).body.invitation;
      const first = (
        await get(
          `/direct-conversations/${row.conversationId}/messages?limit=1`,
          recipient,
        ).expect(200)
      ).body;
      if (first.hasMore) {
        const next = (
          await get(
            `/direct-conversations/${row.conversationId}/messages?afterSequence=${first.nextAfterSequence}&limit=1`,
            recipient,
          ).expect(200)
        ).body;
        expect(next.items[0].sequence).toBeGreaterThan(first.items[0].sequence);
      }
      await get(
        `/direct-conversations/${row.conversationId}/messages?afterSequence=${first.items[0].sequence}`,
        outsider,
      ).expect(404);
    });
    it("publishes explicit owner-grant, invitation, membership and structured DM contracts", () => {
      const spec = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        spec.paths["/chat-groups/{groupId}/invitations"]?.post?.responses[
          "201"
        ],
      ).toBeDefined();
      expect(
        spec.paths["/direct-conversations/{conversationId}/messages"]?.get
          ?.responses["200"],
      ).toBeDefined();
      expect(spec.components?.schemas?.DirectInvitationCardDto).toBeDefined();
    });
  },
);
