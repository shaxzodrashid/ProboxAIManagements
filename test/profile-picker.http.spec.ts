import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService, JsonWebTokenError } from "@nestjs/jwt";
import {
  PrismaClient,
  ProfileAudienceField as F,
  ProfileAudienceMode as M,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ProfilePrivacyController } from "../src/accounts/profile-privacy.controller";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { ProfilePickerController } from "../src/accounts/profile-picker.controller";
import { ProfilePickerService } from "../src/accounts/profile-picker.service";
import { PublicProfileController } from "../src/accounts/public-profile.controller";
import { AccountsService } from "../src/accounts/accounts.service";
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
    throw new Error("Requires isolated profile_test database");
}
(url ? describe : describe.skip)(
  "profile picker, aliases and public projection HTTP",
  () => {
    let app: INestApplication, prisma: PrismaClient;
    let w1: string,
      w2: string,
      a: string,
      b: string,
      c: string,
      pending: string;
    const prefix = "picker" + randomUUID().replaceAll("-", "").slice(0, 12);
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url } } });
      w1 = (
        await prisma.workspace.create({ data: { slug: prefix + "-workspace" } })
      ).id;
      w2 = (
        await prisma.workspace.create({ data: { slug: prefix + "-hidden" } })
      ).id;
      const user = async (
        workspaceId: string,
        suffix: string,
        status: "OPEN" | "PENDING" = "OPEN",
      ) =>
        (
          await prisma.user.create({
            data: {
              // Ensure the case-variant revocation fixtures always change an ID.
              id: suffix === "Blake" ? "b" + randomUUID().slice(1) : undefined,
              workspaceId,
              phoneNumber: randomUUID(),
              fullName: prefix + " " + suffix,
              username: prefix + "_" + suffix.toLowerCase(),
              status,
              bio: "private biography",
              birthDate: new Date("2000-02-29T00:00:00Z"),
            },
          })
        ).id;
      a = await user(w1, "Owner");
      b = await user(w2, "Blake");
      c = await user(w1, "Cara");
      pending = await user(w2, "Pending", "PENDING");
      const module = await Test.createTestingModule({
        controllers: [
          ProfilePrivacyController,
          ProfilePickerController,
          PublicProfileController,
        ],
        providers: [
          ProfilePrivacyService,
          ProfilePickerService,
          {
            provide: AccountsService,
            useValue: new AccountsService(prisma as never, {} as never),
          },
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => {
                if (id === "invalid")
                  throw new JsonWebTokenError("invalid token");
                return { id, workspaceId: "stale", type: "access" };
              },
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
      await prisma.profileAudiencePolicy.deleteMany({
        where: { ownerId: { in: [a, b, c] } },
      });
      await prisma.profileContact.deleteMany({
        where: { ownerId: { in: [a, b, c] } },
      });
      await prisma.user.update({
        where: { id: b },
        data: { status: "OPEN", workspaceId: w2 },
      });
      await prisma.user.update({
        where: { id: c },
        data: { status: "OPEN", workspaceId: w1 },
      });
    });
    afterAll(async () => {
      await app?.close();
      await prisma.user.deleteMany({
        where: { id: { in: [a, b, c, pending] } },
      });
      await prisma.workspace.deleteMany({ where: { id: { in: [w1, w2] } } });
      await prisma.$disconnect();
    });
    const http = () => request(app.getHttpServer());
    const picker = (query: any = {}, owner = a) =>
      http()
        .get("/users/me/audience-picker")
        .set("Authorization", "Bearer " + owner)
        .query({ field: F.BIO, q: prefix, ...query });
    const policy = (
      field: F,
      mode: M,
      accountIds: string[] = [],
      workspaceIds: string[] = [],
      owner = a,
    ) =>
      http()
        .put("/users/me/privacy/" + field)
        .set("Authorization", "Bearer " + owner)
        .send({ mode, accountIds, workspaceIds });
    const contact = (id = b, owner = a) =>
      http()
        .put("/users/me/contacts/" + id)
        .set("Authorization", "Bearer " + owner);
    const alias = (value: any, owner = a, id = b) =>
      http()
        .put(`/users/me/contacts/${id}/alias`)
        .set("Authorization", "Bearer " + owner)
        .send(value);
    const publicRead = (owner = a, viewer?: string) => {
      const call = http().get("/profiles/" + owner);
      return viewer ? call.set("Authorization", "Bearer " + viewer) : call;
    };
    const expectNoPrivate = (body: any) => {
      const serialized = JSON.stringify(body);
      for (const field of [
        "phoneNumber",
        "passwordHash",
        "roleAssignments",
        "roles",
        "permissions",
        "telegramChatId",
        "status",
        "homePath",
        "projectsHomePath",
      ])
        expect(serialized).not.toContain('"' + field + '"');
    };
    it("returns mixed typed results with public identity and only authorized parent context", async () => {
      const result = await picker().expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body.items.map((row: any) => row.id).sort()).toEqual(
        [a, b, c, w1].sort(),
      );
      expect(result.body.items.find((row: any) => row.id === b)).toMatchObject({
        kind: "ACCOUNT",
        displayName: prefix + " Blake",
        firstName: null,
        lastName: null,
        username: prefix + "_blake",
        alias: null,
        parentWorkspaceId: null,
        selectedViaWorkspace: null,
      });
      expect(result.body.items.find((row: any) => row.id === c)).toMatchObject({
        parentWorkspaceId: w1,
        selectedViaWorkspace: false,
      });
      expect(result.body.workspaceContext).toMatchObject({
        id: w1,
        label: prefix + "-workspace",
        selectionState: "UNCHECKED",
      });
      expectNoPrivate(result.body);
      expect(JSON.stringify(result.body)).not.toContain(w2);
    });
    it("expands current workspace children without admin permissions and rejects foreign expansion", async () => {
      const result = await picker({ workspaceId: w1 }).expect(200);
      expect(result.body.items.map((row: any) => row.id).sort()).toEqual(
        [a, c].sort(),
      );
      expect(result.body.workspaceContext.id).toBe(w1);
      await picker({ workspaceId: w2 }).expect(404);
      await picker({ workspaceId: randomUUID() }).expect(404);
      await http()
        .get("/users/me/audience-picker")
        .query({ field: F.BIO })
        .expect(401);
      await picker({}, pending).expect(401);
    });
    it("reads, writes and clears only owner aliases without changing identity or contact grants", async () => {
      await alias({ alias: "Local name" }).expect(404);
      await contact().expect(200);
      await contact(b, c).expect(200);
      expect(
        (await alias({ alias: "  Local name  " }).expect(200)).body,
      ).toEqual({ accountId: b, alias: "Local name" });
      await alias({ alias: "Other owner alias" }, c).expect(200);
      expect(
        (
          await http()
            .get(`/users/me/contacts/${b}/alias`)
            .set("Authorization", "Bearer " + a)
            .expect(200)
        ).body.alias,
      ).toBe("Local name");
      expect(
        (
          await http()
            .get(`/users/me/contacts/${b}/alias`)
            .set("Authorization", "Bearer " + c)
            .expect(200)
        ).body.alias,
      ).toBe("Other owner alias");
      await http()
        .delete(`/users/me/contacts/${b}/alias`)
        .set("Authorization", "Bearer " + a)
        .expect(200);
      expect(
        (
          await prisma.profileContact.findUniqueOrThrow({
            where: {
              ownerId_contactAccountId: { ownerId: a, contactAccountId: b },
            },
          })
        ).alias,
      ).toBeNull();
      expect((await publicRead(b).expect(200)).body.displayName).toBe(
        prefix + " Blake",
      );
      expect(
        (
          await http()
            .get(`/users/me/contacts/${b}/alias`)
            .set("Authorization", "Bearer " + c)
            .expect(200)
        ).body.alias,
      ).toBe("Other owner alias");
    });
    it.each(["uppercase", "mixed-case"])(
      "revokes Contacts-only biography and birthday with a %s UUID and preserves other owners",
      async (casing) => {
        await contact().expect(200);
        await contact(b, c).expect(200);
        await alias({ alias: "Owner private alias" }).expect(200);
        await alias({ alias: "Other owner private alias" }, c).expect(200);
        for (const field of [F.BIO, F.BIRTHDAY_DAY_MONTH, F.BIRTHDAY_YEAR])
          await policy(field, M.CONTACTS).expect(200);
        await policy(F.BIO, M.CONTACTS, [], [], c).expect(200);
        expect((await publicRead(a, b).expect(200)).body).toMatchObject({
          bio: "private biography",
          birthdayDayMonth: { day: 29, month: 2 },
          birthdayYear: 2000,
        });
        const reference =
          casing === "uppercase"
            ? b.toUpperCase()
            : b.replace(/[a-f]/i, (letter) => letter.toUpperCase());
        expect(reference).not.toBe(b);
        for (let attempt = 0; attempt < 2; attempt++) {
          const removed = await http()
            .delete("/users/me/contacts/" + reference)
            .set("Authorization", "Bearer " + a)
            .expect(200);
          expect(removed.body).toEqual({ removed: true });
          expect(removed.headers["cache-control"]).toBe("no-store");
          expect((await publicRead(a, b).expect(200)).body).toMatchObject({
            bio: null,
            birthdayDayMonth: null,
            birthdayYear: null,
          });
        }
        expect(
          await prisma.profileContact.findUnique({
            where: {
              ownerId_contactAccountId: { ownerId: a, contactAccountId: b },
            },
          }),
        ).toBeNull();
        expect((await publicRead(c, b).expect(200)).body.bio).toBe(
          "private biography",
        );
        expect(
          (
            await http()
              .get(`/users/me/contacts/${b}/alias`)
              .set("Authorization", "Bearer " + c)
              .expect(200)
          ).body.alias,
        ).toBe("Other owner private alias");
        await http()
          .get(`/users/me/contacts/${b}/alias`)
          .set("Authorization", "Bearer " + a)
          .expect(404);
      },
    );
    it("revokes legacy mixed-case Contact references without rewriting identities or other owners' grants", async () => {
      const lowerId = "d" + randomUUID().slice(1);
      const upperId = lowerId.toUpperCase();
      try {
        for (const id of [lowerId, upperId]) {
          await prisma.user.create({
            data: {
              id,
              workspaceId: w2,
              phoneNumber: randomUUID(),
              fullName: "Legacy case fixture",
              status: "OPEN",
            },
          });
          await prisma.profileContact.create({
            data: { ownerId: a, contactAccountId: id },
          });
        }
        await prisma.profileContact.create({
          data: {
            ownerId: c,
            contactAccountId: upperId,
            alias: "Keep another owner's grant",
          },
        });
        await policy(F.BIO, M.CONTACTS).expect(200);
        for (const viewer of [lowerId, upperId])
          expect((await publicRead(a, viewer).expect(200)).body.bio).toBe(
            "private biography",
          );
        await http()
          .delete("/users/me/contacts/" + lowerId)
          .set("Authorization", "Bearer " + a)
          .expect(200);
        for (const viewer of [lowerId, upperId]) {
          expect((await publicRead(a, viewer).expect(200)).body.bio).toBeNull();
          expect(
            await prisma.user.findUnique({ where: { id: viewer } }),
          ).not.toBeNull();
        }
        expect(
          await prisma.profileContact.findMany({ where: { ownerId: a } }),
        ).toEqual([]);
        expect(
          await prisma.profileContact.findUnique({
            where: {
              ownerId_contactAccountId: {
                ownerId: c,
                contactAccountId: upperId,
              },
            },
          }),
        ).toMatchObject({ alias: "Keep another owner's grant" });
      } finally {
        await prisma.user.deleteMany({
          where: { id: { in: [lowerId, upperId] } },
        });
      }
    });
    it("keeps Contact revocation authenticated, validated and idempotent for unknown UUIDs", async () => {
      await contact().expect(200);
      await http()
        .delete("/users/me/contacts/" + b.toUpperCase())
        .expect(401);
      await http()
        .delete("/users/me/contacts/not-a-uuid")
        .set("Authorization", "Bearer " + a)
        .expect(400);
      for (let attempt = 0; attempt < 2; attempt++)
        await http()
          .delete("/users/me/contacts/" + randomUUID().toUpperCase())
          .set("Authorization", "Bearer " + a)
          .expect(200, { removed: true });
      expect(
        await prisma.profileContact.findUnique({
          where: {
            ownerId_contactAccountId: { ownerId: a, contactAccountId: b },
          },
        }),
      ).not.toBeNull();
    });
    it("preserves independently allowed profile fields and public identity after Contact removal", async () => {
      await contact().expect(200);
      await policy(F.BIO, M.EVERYONE).expect(200);
      await policy(F.BIRTHDAY_DAY_MONTH, M.CUSTOM, [b]).expect(200);
      await policy(F.BIRTHDAY_YEAR, M.CONTACTS).expect(200);
      await http()
        .delete("/users/me/contacts/" + b.toUpperCase())
        .set("Authorization", "Bearer " + a)
        .expect(200);
      expect((await publicRead(a, b).expect(200)).body).toMatchObject({
        id: a,
        displayName: prefix + " Owner",
        bio: "private biography",
        birthdayDayMonth: { day: 29, month: 2 },
        birthdayYear: null,
      });
      const policies = (
        await http()
          .get("/users/me/privacy")
          .set("Authorization", "Bearer " + a)
          .expect(200)
      ).body;
      expect(
        policies.find((entry: any) => entry.field === F.BIRTHDAY_DAY_MONTH),
      ).toMatchObject({ mode: M.CUSTOM, accountIds: [b] });
      expect(
        policies.find((entry: any) => entry.field === F.BIO),
      ).toMatchObject({ mode: M.EVERYONE });
    });
    it("matches public names, @username and caller aliases, deduplicating multiple matches", async () => {
      await contact().expect(200);
      await contact(b, c).expect(200);
      await alias({ alias: prefix + " private friend" }).expect(200);
      await alias({ alias: "otherownersecret" }, c).expect(200);
      for (const q of ["blake", "@" + prefix + "_blake", "private friend"])
        expect(
          (await picker({ q }).expect(200)).body.items.map((r: any) => r.id),
        ).toEqual([b]);
      expect(
        (await picker().expect(200)).body.items.filter((r: any) => r.id === b),
      ).toHaveLength(1);
      expect(
        (await picker({ q: "otherownersecret" }).expect(200)).body.items,
      ).toEqual([]);
      expect(
        (await picker({ q: "private friend" }, c).expect(200)).body.items,
      ).toEqual([]);
      const publicResult = (await publicRead(b, a).expect(200)).body;
      expect(publicResult).not.toHaveProperty("alias");
      expect(JSON.stringify(publicResult)).not.toContain("private friend");
    });
    it("treats search input literally and parameterizes quotes/wildcards", async () => {
      for (const q of ["%", "_", "' OR 1=1 --", "\\"]) {
        const result = await picker({ q }).expect(200);
        if (q !== "_") expect(result.body.items).toEqual([]);
        else
          expect(
            result.body.items.every(
              (r: any) => r.kind === "ACCOUNT" && r.username.includes("_"),
            ),
          ).toBe(true);
      }
      expect(
        (await picker({ q: prefix + "-workspace" }).expect(200)).body.items.map(
          (r: any) => r.kind,
        ),
      ).toEqual(["WORKSPACE"]);
    });
    it("browses only own workspace and rejects crafted foreign workspace grants on both Save paths", async () => {
      for (const q of ["", "  ", "@"]) {
        const r = await picker({ q }).expect(200);
        expect(r.body.items.some((row: any) => row.id === b)).toBe(false);
        expect(
          r.body.items
            .filter((row: any) => row.kind === "ACCOUNT")
            .every((row: any) => row.parentWorkspaceId === w1),
        ).toBe(true);
      }
      expect(
        (await picker({ q: prefix + " Blake" }).expect(200)).body.items.map(
          (r: any) => r.id,
        ),
      ).toContain(b);
      for (const target of [w2, randomUUID()]) {
        await policy(F.BIO, M.CUSTOM, [b], [target]).expect(400);
        await http()
          .put("/users/me/profile")
          .set("Authorization", "Bearer " + a)
          .send({
            bio: "must not save",
            audiences: [
              {
                field: F.BIO,
                mode: M.CUSTOM,
                accountIds: [b],
                workspaceIds: [target],
              },
            ],
          })
          .expect(400);
      }
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: a } })).bio,
      ).toBe("private biography");
      await policy(F.BIO, M.CUSTOM, [b], [w1]).expect(200);
    });
    it("uses live keyset pagination without duplicate typed IDs and retains off-page selections", async () => {
      await policy(F.BIO, M.CUSTOM, [b, c], [w1]).expect(200);
      // Historical opaque grant remains visible in the owner's saved set, never in roster discovery.
      await prisma.profileAudienceWorkspaceRecipient.create({
        data: { ownerId: a, field: F.BIO, workspaceId: w2 },
      });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const result: any = await picker({
          limit: 1,
          ...(cursor ? { cursor } : {}),
        }).expect(200);
        expect(result.body.selection).toMatchObject({
          accountIds: [b, c].sort(),
          workspaceIds: [w1, w2].sort(),
          accountCount: 2,
          workspaceCount: 2,
        });
        seen.push(...result.body.items.map((r: any) => r.kind + ":" + r.id));
        cursor = result.body.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(4);
      expect(seen).toHaveLength(4);
      const result = await picker({ q: "no-match" }).expect(200);
      expect(result.body.items).toEqual([]);
      expect(result.body.selection.accountIds).toEqual([b, c].sort());
      expect(result.body.workspaceContext.explicitSelected).toBe(true);
    });
    it("binds cursors to owner/query/field/expansion/current membership and validates bounds", async () => {
      const first = await picker({ limit: 1 }).expect(200);
      const cursor = first.body.nextCursor;
      expect(cursor).not.toBeNull();
      await picker({ cursor, q: "different" }).expect(400);
      await picker({ cursor, field: F.STATUS }).expect(400);
      await picker({ cursor, workspaceId: w1 }).expect(400);
      await picker({ cursor }, c).expect(400);
      for (const query of [
        { limit: 0 },
        { limit: 101 },
        { limit: "abc" },
        { cursor: "malformed" },
        { field: "future" },
        { q: "x".repeat(121) },
        { ownerId: b },
      ])
        await picker(query).expect(400);
      await prisma.user.update({ where: { id: a }, data: { workspaceId: w2 } });
      try {
        await picker({ cursor }).expect(400);
      } finally {
        await prisma.user.update({
          where: { id: a },
          data: { workspaceId: w1 },
        });
      }
    });
    it("preserves explicit accounts versus dynamic workspace grants and derives parent state off-page", async () => {
      await policy(F.BIO, M.CUSTOM, [c]).expect(200);
      let result = await picker({ q: "no-match" }).expect(200);
      expect(result.body.workspaceContext).toMatchObject({
        explicitSelected: false,
        hasExplicitChildren: true,
        selectionState: "INDETERMINATE",
      });
      await policy(F.BIO, M.CUSTOM, [], [w1]).expect(200);
      result = await picker().expect(200);
      expect(result.body.workspaceContext.selectionState).toBe("CHECKED");
      expect(result.body.items.find((r: any) => r.id === c)).toMatchObject({
        explicitSelected: false,
        selectedViaWorkspace: true,
      });
      await prisma.user.update({ where: { id: c }, data: { workspaceId: w2 } });
      result = await picker().expect(200);
      expect(result.body.items.find((r: any) => r.id === c)).toMatchObject({
        explicitSelected: false,
        selectedViaWorkspace: null,
        parentWorkspaceId: null,
      });
      expect(result.body.selection.workspaceIds).toEqual([w1]);
      await policy(F.BIO, M.CUSTOM, [c]).expect(200);
      expect(
        (await picker().expect(200)).body.items.find((r: any) => r.id === c)
          .explicitSelected,
      ).toBe(true);
    });
    it("rejects alias mass assignment/blank/oversize, accepts null clear and removal erases alias", async () => {
      await contact().expect(200);
      for (const value of [
        {},
        { alias: " " },
        { alias: "x".repeat(121) },
        { alias: 1 },
        { alias: "x", ownerId: c },
        { alias: "x", accountId: c },
      ])
        await alias(value).expect(400);
      await alias({ alias: "private alias" }).expect(200);
      await alias({ alias: null }).expect(200);
      await alias({ alias: "private alias" }).expect(200);
      await http()
        .delete("/users/me/contacts/" + b)
        .set("Authorization", "Bearer " + a)
        .expect(200);
      await http()
        .get(`/users/me/contacts/${b}/alias`)
        .set("Authorization", "Bearer " + a)
        .expect(404);
      expect(
        (await picker({ q: "private alias" }).expect(200)).body.items,
      ).toEqual([]);
    });
    it("publishes names without splitting legacy text and keeps private fields hidden by default", async () => {
      const result = await publicRead().expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body).toEqual({
        id: a,
        displayName: prefix + " Owner",
        firstName: null,
        lastName: null,
        username: prefix + "_owner",
        bio: null,
        birthdayDayMonth: null,
        birthdayYear: null,
      });
      expectNoPrivate(result.body);
      expect(result.body).not.toHaveProperty("workspaceId");
      expect(
        (
          await http()
            .get("/profiles/by-username/@" + (prefix + "_owner").toUpperCase())
            .expect(200)
        ).body,
      ).toEqual(result.body);
      await publicRead(pending).expect(404);
      await publicRead(randomUUID()).expect(404);
      await publicRead(a, "invalid").expect(401);
      await publicRead(a, pending).expect(401);
      await http()
        .get("/profiles/" + a)
        .set("Authorization", "invalid")
        .expect(401);
    });
    it("redacts biography and independent birthday parts for anonymous and authenticated viewers", async () => {
      await policy(F.BIO, M.EVERYONE).expect(200);
      await policy(F.BIRTHDAY_DAY_MONTH, M.EVERYONE).expect(200);
      await policy(F.BIRTHDAY_YEAR, M.CUSTOM, [b]).expect(200);
      expect((await publicRead().expect(200)).body).toMatchObject({
        bio: "private biography",
        birthdayDayMonth: { day: 29, month: 2 },
        birthdayYear: null,
      });
      expect((await publicRead(a, b).expect(200)).body.birthdayYear).toBe(2000);
      expect((await publicRead(a, c).expect(200)).body.birthdayYear).toBeNull();
      await policy(F.BIO, M.NO_ONE).expect(200);
      expect((await publicRead(a, a).expect(200)).body.bio).toBeNull();
      await prisma.user.update({
        where: { id: b },
        data: { status: "BANNED" },
      });
      await publicRead(b).expect(404);
      await publicRead(a, b).expect(401);
      expect((await picker({ q: "blake" }).expect(200)).body.items).toEqual([]);
    });
    it("Contacts is unilateral and viewer query input cannot forge identity", async () => {
      await policy(F.BIO, M.CONTACTS).expect(200);
      await contact().expect(200);
      expect((await publicRead(a, b).expect(200)).body.bio).toBe(
        "private biography",
      );
      expect((await publicRead(b, a).expect(200)).body.bio).toBeNull();
      expect(
        (
          await http()
            .get("/profiles/" + a)
            .query({ viewer: b })
            .expect(200)
        ).body.bio,
      ).toBeNull();
      await http()
        .delete("/users/me/contacts/" + b)
        .set("Authorization", "Bearer " + a)
        .expect(200);
      expect((await publicRead(a, b).expect(200)).body.bio).toBeNull();
    });
    it("Custom checks live persisted workspace membership and explicit grants survive moves", async () => {
      await policy(F.BIO, M.CUSTOM, [b], [w1]).expect(200);
      expect((await publicRead(a, c).expect(200)).body.bio).toBe(
        "private biography",
      );
      await prisma.user.update({ where: { id: c }, data: { workspaceId: w2 } });
      expect((await publicRead(a, c).expect(200)).body.bio).toBeNull();
      await prisma.user.update({ where: { id: b }, data: { workspaceId: w1 } });
      expect((await publicRead(a, b).expect(200)).body.bio).toBe(
        "private biography",
      );
      await prisma.user.update({ where: { id: b }, data: { workspaceId: w2 } });
      expect((await publicRead(a, b).expect(200)).body.bio).toBe(
        "private biography",
      );
    });
    it("fails closed on shipping profile/picker read failure instead of returning permissive fallback", async () => {
      const failure = jest
        .spyOn(prisma, "$transaction")
        .mockRejectedValueOnce(new Error("Database fault"));
      try {
        const result = await publicRead().expect(503);
        expect(result.body).not.toHaveProperty("displayName");
        failure.mockRejectedValueOnce(new Error("Database fault"));
        const pickerResult = await picker().expect(503);
        expect(pickerResult.body).not.toHaveProperty("items");
      } finally {
        failure.mockRestore();
      }
    });
    it("installs the search indexes required by the real SQL contract", async () => {
      const indexes = await prisma.$queryRaw<
        { indexname: string }[]
      >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('User_public_fullName_search_idx', 'User_public_firstName_search_idx', 'User_public_lastName_search_idx', 'User_public_username_search_idx', 'ProfileContact_alias_search_idx') AND indexdef LIKE '%USING gin%'`;
      expect(indexes).toHaveLength(5);
    });
    it("OpenAPI declares discriminated picker items, privacy-safe public fields and nullable aliases", () => {
      const doc: any = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const schemas = doc.components.schemas;
      expect(
        schemas.AudiencePickerResponseDto.properties.items.items.oneOf,
      ).toHaveLength(2);
      expect(schemas.SetContactAliasDto.required).toContain("alias");
      expect(schemas.SetContactAliasDto.properties.alias.nullable).toBe(true);
      expect(
        schemas.PickerAccountResponseDto.properties.selectedViaWorkspace
          .nullable,
      ).toBe(true);
      for (const field of [
        "alias",
        "phoneNumber",
        "workspaceId",
        "roles",
        "status",
        "birthDate",
      ])
        expect(schemas.PublicProfileResponseDto.properties).not.toHaveProperty(
          field,
        );
      expect(
        schemas.PublicProfileResponseDto.properties.birthdayDayMonth.$ref ??
          schemas.PublicProfileResponseDto.properties.birthdayDayMonth
            .allOf?.[0].$ref,
      ).toContain("BirthdayDayMonthResponseDto");
    });
  },
);
