import {
  Controller,
  Get,
  Header,
  INestApplication,
  Param,
  Query,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import {
  PrismaClient,
  ProfileAudienceField as F,
  ProfileAudienceMode as M,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ProfilePrivacyController } from "../src/accounts/profile-privacy.controller";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
const request = require("supertest");
// Fixture only. No production public profile route exists.
@Controller("test-projection")
class ProjectionFixture {
  constructor(private readonly privacy: ProfilePrivacyService) {}
  @Get(":id")
  @Header("Cache-Control", "no-store")
  read(@Param("id") id: string, @Query("viewer") viewer?: string) {
    return this.privacy.project(id, viewer);
  }
}
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
  "profile privacy HTTP and isolated PostgreSQL",
  () => {
    let prisma: PrismaClient,
      app: INestApplication,
      privacy: ProfilePrivacyService;
    let w1: string, w2: string, a: string, b: string, c: string;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url } } });
      w1 = (
        await prisma.workspace.create({
          data: { slug: "privacy-" + randomUUID() },
        })
      ).id;
      w2 = (
        await prisma.workspace.create({
          data: { slug: "privacy-" + randomUUID() },
        })
      ).id;
      const create = async (workspaceId: string, phoneNumber: string) =>
        (
          await prisma.user.create({
            data: {
              workspaceId,
              phoneNumber,
              fullName: "Private Name",
              status: "OPEN",
              bio: "private biography",
              birthDate: new Date("2000-02-29T00:00:00Z"),
            },
          })
        ).id;
      a = await create(w1, "+998901999001");
      b = await create(w2, "+998901999002");
      c = await create(w1, "+998901999003");
      const module = await Test.createTestingModule({
        controllers: [
          ProfilePrivacyController,
          AccountsController,
          ProjectionFixture,
        ],
        providers: [
          ProfilePrivacyService,
          AccountsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                workspaceId: "stale",
                type: "access",
              }),
            },
          },
          { provide: AuthorizationService, useValue: {} },
          { provide: TelegramService, useValue: {} },
          { provide: TelegramBotService, useValue: {} },
        ],
      }).compile();
      privacy = module.get(ProfilePrivacyService);
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
        data: { workspaceId: w2, status: "OPEN" },
      });
    });
    afterAll(async () => {
      await app?.close();
      if (prisma) {
        await prisma.user.deleteMany({
          where: { workspaceId: { in: [w1, w2] } },
        });
        await prisma.workspace.deleteMany({ where: { id: { in: [w1, w2] } } });
        await prisma.$disconnect();
      }
    });
    const call = () => request(app.getHttpServer());
    const set = (
      field: F,
      mode: M,
      accountIds: string[] = [],
      workspaceIds: string[] = [],
      owner = a,
    ) =>
      call()
        .put("/users/me/privacy/" + field)
        .set("Authorization", "Bearer " + owner)
        .send({ mode, accountIds, workspaceIds });
    const read = (owner = a, viewer?: string) =>
      call()
        .get("/test-projection/" + owner)
        .query(viewer ? { viewer } : {});
    it("defaults five fields private; rejects missing and inactive authentication", async () => {
      await call().get("/users/me/privacy").expect(401);
      await call()
        .get("/users/me/privacy")
        .set("Authorization", "Bearer " + randomUUID())
        .expect(401);
      await prisma.user.update({
        where: { id: b },
        data: { status: "BANNED" },
      });
      await call()
        .get("/users/me/contacts")
        .set("Authorization", "Bearer " + b)
        .expect(401);
      const result = await call()
        .get("/users/me/privacy")
        .set("Authorization", "Bearer " + a)
        .expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body).toHaveLength(5);
      for (const row of result.body)
        expect(row).toMatchObject({
          mode: "NO_ONE",
          accountIds: [],
          workspaceIds: [],
          accountCount: 0,
          workspaceCount: 0,
        });
      for (const viewer of [undefined, a, b, c])
        expect((await read(a, viewer).expect(200)).body).toEqual({
          bio: null,
          birthdayDayMonth: null,
          birthdayYear: null,
        });
    });
    it("Everyone is public across workspaces and without identity; projection contains no hidden identity fields", async () => {
      await set(F.BIO, M.EVERYONE).expect(200);
      for (const viewer of [undefined, b, randomUUID()]) {
        const response = await read(a, viewer).expect(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toEqual({
          bio: "private biography",
          birthdayDayMonth: null,
          birthdayYear: null,
        });
      }
      await set(F.BIO, M.NO_ONE).expect(200);
      expect((await read(a, b)).body.bio).toBeNull();
    });
    it("Contact direction is owner to viewer; removal revokes without affecting reverse list", async () => {
      await set(F.BIO, M.CONTACTS).expect(200);
      await set(F.BIO, M.CONTACTS, [], [], b).expect(200);
      const add = await call()
        .put("/users/me/contacts/" + b)
        .set("Authorization", "Bearer " + a)
        .expect(200);
      expect(Object.keys(add.body).sort()).toEqual(["accountId", "createdAt"]);
      expect((await read(a, b)).body.bio).toBe("private biography");
      expect((await read(b, a)).body.bio).toBeNull();
      expect(
        (
          await call()
            .get("/users/me/contacts")
            .set("Authorization", "Bearer " + b)
        ).body,
      ).toEqual([]);
      await call()
        .put("/users/me/contacts/" + a)
        .set("Authorization", "Bearer " + b)
        .expect(200);
      await call()
        .delete("/users/me/contacts/" + b)
        .set("Authorization", "Bearer " + a)
        .expect(200);
      expect((await read(a, b)).body.bio).toBeNull();
      expect((await read(b, a)).body.bio).toBe("private biography");
    });
    it("Custom unions accounts and current workspaces; account grants survive membership changes", async () => {
      const response = await set(F.BIO, M.CUSTOM, [b], [w1]).expect(200);
      expect(response.body).toMatchObject({
        accountCount: 1,
        workspaceCount: 1,
      });
      expect((await read(a, c)).body.bio).toBe("private biography");
      expect((await read(a, b)).body.bio).toBe("private biography");
      await prisma.user.update({ where: { id: b }, data: { workspaceId: w1 } });
      expect((await read(a, b)).body.bio).toBe("private biography");
      await set(F.BIO, M.CUSTOM, [], [w1]).expect(200);
      await prisma.user.update({ where: { id: b }, data: { workspaceId: w2 } });
      expect((await read(a, b)).body.bio).toBeNull();
      await set(F.BIO, M.CUSTOM, [b], []).expect(200);
      expect((await read(a, b)).body.bio).toBe("private biography");
      expect((await read(a)).body.bio).toBeNull();
    });
    it("birthday is self-only ISO date with independent component audiences, retain and clear", async () => {
      const patch = (body: object) =>
        call()
          .patch("/users/me")
          .set("Authorization", "Bearer " + a)
          .send(body);
      await patch({ birthDate: "1900-02-29" }).expect(400);
      const saved = await patch({ birthDate: "2004-02-29" }).expect(200);
      expect(saved.body.birthDate).toBe("2004-02-29");
      expect(saved.headers["cache-control"]).toBe("no-store");
      await patch({}).expect(200);
      await set(F.BIRTHDAY_DAY_MONTH, M.EVERYONE).expect(200);
      expect((await read(a)).body).toEqual({
        bio: null,
        birthdayDayMonth: { day: 29, month: 2 },
        birthdayYear: null,
      });
      await set(F.BIRTHDAY_YEAR, M.CUSTOM, [b]).expect(200);
      expect((await read(a, b)).body.birthdayYear).toBe(2004);
      expect((await read(a, c)).body.birthdayYear).toBeNull();
      await set(F.BIRTHDAY_DAY_MONTH, M.NO_ONE).expect(200);
      expect((await read(a, b)).body.birthdayDayMonth).toBeNull();
      await patch({ birthDate: null }).expect(200);
      expect((await read(a, b)).body).toEqual({
        bio: null,
        birthdayDayMonth: null,
        birthdayYear: null,
      });
      expect(
        (
          await call()
            .get("/users/me")
            .set("Authorization", "Bearer " + b)
        ).body.birthDate,
      ).toBe("2000-02-29");
    });
    it("rejects owner injection, invalid fields and recipient sets before persistence", async () => {
      await call()
        .put("/users/me/privacy/BIO")
        .set("Authorization", "Bearer " + b)
        .send({
          mode: "EVERYONE",
          accountIds: [],
          workspaceIds: [],
          ownerId: a,
        })
        .expect(400);
      await set("unknown" as F, M.EVERYONE).expect(400);
      await set(F.BIO, M.EVERYONE, [b]).expect(400);
      await set(F.BIO, M.CUSTOM, [b, b]).expect(400);
      await set(F.BIO, M.CUSTOM, [randomUUID()]).expect(400);
      await set(F.BIO, M.CUSTOM, [], [randomUUID()]).expect(400);
      await call()
        .put("/users/me/contacts/" + randomUUID())
        .set("Authorization", "Bearer " + a)
        .expect(400);
      expect(
        await prisma.profileAudiencePolicy.count({ where: { ownerId: a } }),
      ).toBe(0);
    });

    it("saves staged profile and audiences coherently, never Contacts; rejects nested injection", async () => {
      await call()
        .put("/users/me/contacts/" + b)
        .set("Authorization", "Bearer " + a)
        .expect(200);
      const body = {
        bio: "saved bio",
        birthDate: "2000-02-29",
        audiences: [
          { field: F.BIO, mode: M.CUSTOM, accountIds: [b], workspaceIds: [w1] },
          {
            field: F.BIRTHDAY_YEAR,
            mode: M.EVERYONE,
            accountIds: [],
            workspaceIds: [],
          },
        ],
      };
      const result = await call()
        .put("/users/me/profile")
        .set("Authorization", "Bearer " + a)
        .send(body)
        .expect(200);
      for (const audiences of [[[]], [[[]]]])
        await call()
          .put("/users/me/profile")
          .set("Authorization", "Bearer " + a)
          .send({ audiences })
          .expect(400);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body.profile).toMatchObject({
        bio: "saved bio",
        birthDate: "2000-02-29",
      });
      expect(result.body.audiences).toHaveLength(5);
      expect(
        await prisma.profileContact.count({
          where: { ownerId: a, contactAccountId: b },
        }),
      ).toBe(1);
      await call()
        .put("/users/me/profile")
        .set("Authorization", "Bearer " + a)
        .send({ ...body, contacts: [] })
        .expect(400);
      await call()
        .put("/users/me/profile")
        .set("Authorization", "Bearer " + a)
        .send({ ...body, audiences: [{ ...body.audiences[0], ownerId: b }] })
        .expect(400);
      await call()
        .put("/users/me/profile")
        .set("Authorization", "Bearer " + a)
        .send({ ...body, audiences: [body.audiences[0], body.audiences[0]] })
        .expect(400);
      await call()
        .put("/users/me/profile")
        .set("Authorization", "Bearer " + a)
        .send({
          ...body,
          bio: "reject",
          audiences: [{ ...body.audiences[0], accountIds: [randomUUID()] }],
        })
        .expect(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: a } })).bio,
      ).toBe("saved bio");
    });
    it("rolls back both recipient sets and policy if final insertion fails; sanitizes errors", async () => {
      await set(F.BIO, M.CUSTOM, [b], [w1]).expect(200);
      // Real transaction: a PostgreSQL trigger fails the final workspace insertion.
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION privacy_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'secret database path'; END $$",
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER privacy_test_reject BEFORE INSERT ON "ProfileAudienceWorkspaceRecipient" FOR EACH ROW EXECUTE FUNCTION privacy_test_reject()',
      );
      try {
        const before = await prisma.user.findUniqueOrThrow({
          where: { id: a },
        });
        const failed = await call()
          .put("/users/me/profile")
          .set("Authorization", "Bearer " + a)
          .send({
            bio: "must roll back",
            birthDate: "1999-01-01",
            audiences: [
              {
                field: F.BIRTHDAY_YEAR,
                mode: M.EVERYONE,
                accountIds: [],
                workspaceIds: [],
              },
              {
                field: F.BIO,
                mode: M.CUSTOM,
                accountIds: [c],
                workspaceIds: [w1],
              },
            ],
          })
          .expect(503);
        const after = await prisma.user.findUniqueOrThrow({ where: { id: a } });
        expect(after.bio).toBe(before.bio);
        expect(after.birthDate).toEqual(before.birthDate);
        expect(
          await prisma.profileAudiencePolicy.findUnique({
            where: { ownerId_field: { ownerId: a, field: F.BIRTHDAY_YEAR } },
          }),
        ).toBeNull();
        expect(JSON.stringify(failed.body)).not.toContain("secret");
        const rows = await privacy.policies(w1, a);
        expect(rows.find((r) => r.field === F.BIO)).toMatchObject({
          accountIds: [b],
          workspaceIds: [w1],
          mode: M.CUSTOM,
        });
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER privacy_test_reject ON "ProfileAudienceWorkspaceRecipient"',
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION privacy_test_reject()");
      }
    });
    it("round-trips approved 1000-character plain text bio privately until explicit audience selection", async () => {
      const prefix = "<b>Literal biography</b>\n";
      const bio = prefix + "x".repeat(1000 - prefix.length);
      const saved = await call()
        .patch("/users/me")
        .set("Authorization", "Bearer " + a)
        .send({ bio });
      expect(saved.status).toBe(200);
      expect(saved.body.bio).toBe(bio);
      expect((await read(a)).body.bio).toBeNull();
      expect((await read(a, b)).body.bio).toBeNull();
      const self = await call()
        .get("/users/me")
        .set("Authorization", "Bearer " + a);
      expect(self.body.bio).toBe(bio);
      const invalid = await call()
        .patch("/users/me")
        .set("Authorization", "Bearer " + a)
        .send({ bio: bio + "x" })
        .expect(400);
      expect(JSON.stringify(invalid.body.message)).toMatch(/bio/);
      expect(JSON.stringify(invalid.body.message)).toMatch(/1000/);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: a } })).bio,
      ).toBe(bio);
      await set(F.BIO, M.EVERYONE).expect(200);
      expect((await read(a)).body.bio).toBe(bio);
      await call()
        .patch("/users/me")
        .set("Authorization", "Bearer " + a)
        .send({ bio: null })
        .expect(200);
      expect((await read(a)).body.bio).toBeNull();
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: a } })).bio,
      ).toBeNull();
    });
    it("rejects unauthorized bio edits and forged owner selectors without changing stored content", async () => {
      const before = (await prisma.user.findUniqueOrThrow({ where: { id: a } }))
        .bio;
      await call().patch("/users/me").send({ bio: "Unauthorized" }).expect(401);
      await call()
        .patch("/users/me")
        .set("Authorization", "Bearer " + b)
        .send({ id: a, bio: "Forged owner" })
        .expect(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: a } })).bio,
      ).toBe(before);
      await prisma.user.update({
        where: { id: b },
        data: { status: "BANNED" },
      });
      await call()
        .patch("/users/me")
        .set("Authorization", "Bearer " + b)
        .send({ bio: "Inactive" })
        .expect(401);
    });
    it("OpenAPI exposes typed self policies and date; no public discovery endpoint", () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/users/me/privacy/{field}"]?.put?.responses?.["200"],
      ).toBeDefined();
      expect(
        (doc.components?.schemas?.UpdateSelfProfileDto as any)?.properties
          ?.birthDate,
      ).toMatchObject({ format: "date", nullable: true });
      expect(doc.paths["/profiles"]).toBeUndefined();
    });
  },
);
