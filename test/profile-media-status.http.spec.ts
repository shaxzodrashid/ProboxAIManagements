import {
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService, JsonWebTokenError } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AccountsService } from "../src/accounts/accounts.service";
import { ProfileSaveController } from "../src/accounts/profile-save.controller";
import { ProfileSaveService } from "../src/accounts/profile-save.service";
import { ProfilePrivacyController } from "../src/accounts/profile-privacy.controller";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { PublicProfileController } from "../src/accounts/public-profile.controller";
import {
  ManualStatusController,
  PublicManualStatusController,
} from "../src/accounts/manual-status.controller";
import { ManualStatusService } from "../src/accounts/manual-status.service";
import {
  ProfileAvatarController,
  PublicProfileAvatarController,
} from "../src/accounts/profile-avatar.controller";
import { ProfileAvatarService } from "../src/accounts/profile-avatar.service";
import { ProfileAvatarStorage } from "../src/accounts/profile-avatar-storage";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthorizationService } from "../src/authorization/authorization.service";
const request = require("supertest");
const sharp: typeof import("sharp").default = require("sharp");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test");
}

(url ? describe : describe.skip)(
  "approved avatar and custom-status HTTP/PostgreSQL",
  () => {
    let app: INestApplication,
      db: PrismaClient,
      avatars: ProfileAvatarService,
      saves: ProfileSaveService;
    let w: string, otherW: string, owner: string, peer: string, outside: string;
    const objects = new Map<string, { bytes: Buffer; sha256: string }>();
    const put = async (key: string, bytes: Buffer, sha256: string) => {
      objects.set(key, { bytes: Buffer.from(bytes), sha256 });
    };
    const storage = {
      put: jest.fn(put),
      head: jest.fn(async (key: string) => {
        const v = objects.get(key);
        return v ? { size: v.bytes.length, sha256: v.sha256 } : null;
      }),
      get: jest.fn(async (key: string) => {
        const v = objects.get(key);
        if (!v) throw new Error("missing");
        return Buffer.from(v.bytes);
      }),
      delete: jest.fn(async (key: string) => {
        objects.delete(key);
      }),
    };
    const http = () => request(app.getHttpServer());
    const edit = (id = owner) =>
      http()
        .get("/users/me/profile/edit")
        .set("Authorization", "Bearer " + id);
    const save = (body: object, id = owner) =>
      http()
        .put("/users/me/profile/changes")
        .set("Authorization", "Bearer " + id)
        .send(body);
    const draft = async <T extends object>(extra: T = {} as T, id = owner) => ({
      requestId: randomUUID(),
      expectedRevision: (await edit(id).expect(200)).body.revision,
      audiences: [],
      ...extra,
    });
    const status = (
      text: string | null = "Working",
      emoji: string | null = "🧑🏽‍💻",
      expiresAt: string | null = null,
    ) => ({ text, emoji, expiresAt });
    const policy = (
      field: string,
      mode = "EVERYONE",
      accountIds: string[] = [],
      workspaceIds: string[] = [],
    ) => ({ field, mode, accountIds, workspaceIds });
    const profile = (viewer?: string) => {
      const req = http().get(`/profiles/${owner}`);
      return viewer ? req.set("Authorization", "Bearer " + viewer) : req;
    };
    const png = (width = 16, height = 10, background = "red") =>
      sharp({ create: { width, height, channels: 4, background } })
        .png()
        .toBuffer();
    const upload = (
      bytes: Buffer,
      requestId = randomUUID(),
      id = owner,
      extra: Record<string, string> = {},
    ) => {
      let req = http()
        .post("/users/me/avatar-uploads")
        .set("Authorization", "Bearer " + id)
        .field("requestId", requestId);
      for (const [key, value] of Object.entries(extra))
        req = req.field(key, value);
      return req.attach("file", bytes, {
        filename: "private-original.png",
        contentType: "image/png",
      });
    };
    const image = (assetId: string, viewer?: string) => {
      const req = http().get(`/profiles/${owner}/avatar/${assetId}`);
      return viewer ? req.set("Authorization", "Bearer " + viewer) : req;
    };
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      otherW = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      const user = async (workspaceId: string) =>
        (
          await db.user.create({
            data: {
              workspaceId,
              fullName: "Legacy profile owner",
              phoneNumber: randomUUID(),
              status: "OPEN",
            },
          })
        ).id;
      owner = await user(w);
      peer = await user(w);
      outside = await user(otherW);
      const module = await Test.createTestingModule({
        controllers: [
          ProfileSaveController,
          ProfilePrivacyController,
          PublicProfileController,
          ManualStatusController,
          PublicManualStatusController,
          ProfileAvatarController,
          PublicProfileAvatarController,
        ],
        providers: [
          AccountsService,
          ProfileSaveService,
          ProfilePrivacyService,
          ManualStatusService,
          ProfileAvatarService,
          { provide: ProfileAvatarStorage, useValue: storage },
          { provide: PrismaService, useValue: db },
          { provide: AuthorizationService, useValue: {} },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => {
                if (id === "invalid")
                  throw new JsonWebTokenError("invalid signature");
                return {
                  id,
                  type: id === "agent" ? "agent" : "access",
                  exp: Math.floor(Date.now() / 1000) + 3600,
                };
              },
            },
          },
        ],
      }).compile();
      avatars = module.get(ProfileAvatarService);
      saves = module.get(ProfileSaveService);
      jest.spyOn(avatars, "onModuleInit").mockImplementation(() => undefined);
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
      jest.restoreAllMocks();
      objects.clear();
      storage.put.mockReset().mockImplementation(put);
      storage.head.mockReset().mockImplementation(async (key) => {
        const v = objects.get(key);
        return v ? { size: v.bytes.length, sha256: v.sha256 } : null;
      });
      storage.get.mockReset().mockImplementation(async (key) => {
        const v = objects.get(key);
        if (!v) throw new Error("missing");
        return Buffer.from(v.bytes);
      });
      storage.delete.mockReset().mockImplementation(async (key) => {
        objects.delete(key);
      });
      await db.user.updateMany({
        where: { id: { in: [owner, peer, outside] } },
        data: {
          avatarAssetId: null,
          customStatusText: null,
          customStatusEmoji: null,
          customStatusExpiresAt: null,
          status: "OPEN",
        },
      });
      await db.user.update({ where: { id: peer }, data: { workspaceId: w } });
      await db.profileAvatarAsset.deleteMany({
        where: { ownerId: { in: [owner, peer, outside] } },
      });
      await db.profileSaveReceipt.deleteMany({
        where: { ownerId: { in: [owner, peer, outside] } },
      });
      await db.profileAudiencePolicy.deleteMany({
        where: { ownerId: { in: [owner, peer, outside] } },
      });
      await db.profileContact.deleteMany({
        where: { ownerId: { in: [owner, peer, outside] } },
      });
      await db.manualProfileStatus.deleteMany({
        where: { ownerId: { in: [owner, peer, outside] } },
      });
    });
    afterAll(async () => {
      await app?.close();
      if (db) {
        await db.user.updateMany({
          where: { id: { in: [owner, peer, outside] } },
          data: { avatarAssetId: null },
        });
        await db.profileAvatarAsset.deleteMany({
          where: { ownerId: { in: [owner, peer, outside] } },
        });
        await db.user.deleteMany({
          where: { workspaceId: { in: [w, otherW] } },
        });
        await db.workspace.deleteMany({ where: { id: { in: [w, otherW] } } });
        await db.$disconnect();
      }
    });
    it("stores API 100-character statuses atomically, including astral code points, without changing shared availability", async () => {
      for (const text of ["x".repeat(100), "😀".repeat(100)]) {
        const body = await draft({
          customStatus: status(text),
          availability: "BUSY",
          audiences: [policy("STATUS")],
        });
        const result = await save(body).expect(200);
        expect(result.body).not.toHaveProperty("customStatus");
        expect((await edit()).body.customStatus).toEqual({
          ...status(text),
          active: true,
        });
        expect((await profile()).body.customStatus.text).toBe(text);
        expect((await http().get(`/profiles/${owner}/status`)).body).toEqual({
          accountId: owner,
          availability: "BUSY",
        });
        expect(
          (
            await db.profileSaveReceipt.findUniqueOrThrow({
              where: {
                ownerId_requestId: {
                  ownerId: owner,
                  requestId: body.requestId,
                },
              },
            })
          ).actorId,
        ).toBe(owner);
        const [row] = await db.$queryRaw<
          { n: number }[]
        >`SELECT char_length("customStatusText") AS n FROM "User" WHERE "id"=${owner}`;
        expect(row!.n).toBe(100);
      }
    });
    it.each(["x".repeat(101), "😀".repeat(101)])(
      "rejects API text above 100 and preserves the draft and receipt namespace",
      async (text) => {
        const before = (await edit()).body;
        const body = await draft({
          customStatus: status(text),
          bio: "must roll back",
        });
        const result = await save(body).expect(400);
        expect(JSON.stringify(result.body)).toContain("100");
        expect((await edit()).body).toEqual(before);
        expect(
          await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
        ).toBe(0);
      },
    );
    it("supports database capacity through 300 without mistaking it for the API input limit", async () => {
      for (const text of ["x".repeat(300), "😀".repeat(300)]) {
        await db.user.update({
          where: { id: owner },
          data: { customStatusText: text },
        });
        expect((await edit()).body.customStatus.text).toBe(text);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: owner } }))
            .customStatusText,
        ).toBe(text);
      }
      await expect(
        db.user.update({
          where: { id: owner },
          data: { customStatusText: "😀".repeat(301) },
        }),
      ).rejects.toMatchObject({ code: "P2000" });
      const meta = await db.$queryRaw<
        { character_maximum_length: number }[]
      >`SELECT character_maximum_length FROM information_schema.columns WHERE table_name='User' AND column_name='customStatusText'`;
      expect(meta[0]!.character_maximum_length).toBe(300);
      await save(await draft({ customStatus: status("x".repeat(300)) })).expect(
        400,
      );
    });
    it.each(["🙂🙂", "A", "<svg>", "🏽", "", "a\u200db"])(
      "rejects non-single emoji %j",
      async (emoji) => {
        await save(
          await draft({ customStatus: status("Working", emoji) }),
        ).expect(400);
      },
    );
    it.each(["🏳️‍🌈", "🇺🇿", "👨‍👩‍👧‍👦", "👍🏽"])(
      "accepts a complete emoji sequence %j",
      async (emoji) => {
        await save(await draft({ customStatus: status(null, emoji) })).expect(
          200,
        );
        expect((await edit()).body.customStatus.emoji).toBe(emoji);
      },
    );
    it("uses STATUS audiences with directed Contacts and live Custom membership, independently of availability", async () => {
      await save(
        await draft({ customStatus: status(), availability: "AWAY" }),
      ).expect(200);
      expect((await profile(owner)).body.customStatus).toBeNull();
      expect(
        (await http().get(`/profiles/${owner}/status`)).body.availability,
      ).toBe("AWAY");
      await save(
        await draft({ audiences: [policy("STATUS", "CONTACTS")] }),
      ).expect(200);
      await db.profileContact.create({
        data: { ownerId: outside, contactAccountId: owner },
      });
      expect((await profile(outside)).body.customStatus).toBeNull();
      await db.profileContact.create({
        data: { ownerId: owner, contactAccountId: outside },
      });
      expect((await profile(outside)).body.customStatus.text).toBe("Working");
      await db.profileContact.deleteMany({ where: { ownerId: owner } });
      expect((await profile(outside)).body.customStatus).toBeNull();
      await save(
        await draft({
          audiences: [policy("STATUS", "CUSTOM", [outside], [w])],
        }),
      ).expect(200);
      expect((await profile(peer)).body.customStatus.text).toBe("Working");
      await db.user.update({
        where: { id: peer },
        data: { workspaceId: otherW },
      });
      expect((await profile(peer)).body.customStatus).toBeNull();
      expect((await profile(outside)).body.customStatus.text).toBe("Working");
    });
    it("normalizes expiry offsets, suppresses expired display and replays the original receipt after expiry", async () => {
      const expires = new Date(Date.now() + 3600_000).toISOString();
      const body = await draft({
        customStatus: status("Working", null, expires),
        audiences: [policy("STATUS")],
      });
      const committed = (await save(body).expect(200)).body;
      const now = jest
        .spyOn(Date, "now")
        .mockReturnValue(new Date(expires).getTime() + 1);
      try {
        expect((await profile()).body.customStatus).toBeNull();
        expect((await edit()).body.customStatus).toMatchObject({
          text: "Working",
          active: false,
        });
        expect((await save(body).expect(200)).body).toEqual(committed);
        await save(await draft({ customStatus: body.customStatus })).expect(
          400,
        );
      } finally {
        now.mockRestore();
      }
      await save(await draft({ customStatus: null })).expect(200);
      expect((await edit()).body.customStatus).toBeNull();
    });
    it.each([
      "2026-01-01",
      "2026-02-30T12:00:00Z",
      "2026-01-01T12:00:00",
      "9999-12-31T23:59:59-14:00",
    ])("rejects malformed/unbounded expiry %j", async (expires) => {
      await save(
        await draft({ customStatus: status("Working", null, expires) }),
      ).expect(400);
    });
    it("normalizes, stages and privately previews a photo without changing current profile or audience", async () => {
      const before = (await edit()).body;
      const uploaded = (await upload(await png(1000, 800)).expect(201)).body;
      expect(uploaded).toMatchObject({
        state: "STAGED",
        width: 512,
        height: 512,
      });
      expect((await edit()).body).toEqual(before);
      const preview = await http()
        .get(`/users/me/avatar-uploads/${uploaded.assetId}/content`)
        .set("Authorization", "Bearer " + owner)
        .expect(200);
      expect(preview.headers["cache-control"]).toBe("no-store");
      expect(preview.headers["x-content-type-options"]).toBe("nosniff");
      const decoded = await sharp(preview.body).metadata();
      expect(decoded).toMatchObject({ format: "png", width: 512, height: 512 });
      expect(decoded.exif).toBeUndefined();
      expect((await profile()).body.avatar).toBeNull();
      await image(uploaded.assetId).expect(404);
      await http()
        .get(`/users/me/avatar-uploads/${uploaded.assetId}/content`)
        .set("Authorization", "Bearer " + outside)
        .expect(404);
      expect(JSON.stringify(uploaded)).not.toMatch(
        /private-original|objectKey|sha256|accounts\//,
      );
    });
    it("publishes and removes avatar/status/audiences atomically and never resurrects them on old receipt replay", async () => {
      const uploaded = (await upload(await png()).expect(201)).body;
      const body = await draft({
        avatarAssetId: uploaded.assetId,
        customStatus: status(),
        availability: "BUSY",
        audiences: [policy("AVATAR"), policy("STATUS")],
      });
      const result = (await save(body).expect(200)).body;
      expect((await profile()).body).toMatchObject({
        avatar: { assetId: uploaded.assetId },
        customStatus: { text: "Working" },
      });
      await image(uploaded.assetId)
        .expect(200)
        .expect("Content-Type", /image\/png/);
      await save(
        await draft({ avatarAssetId: null, customStatus: null }),
      ).expect(200);
      await image(uploaded.assetId).expect(404);
      await avatars.cleanup();
      expect(
        (
          await db.profileAvatarAsset.findUniqueOrThrow({
            where: { id: uploaded.assetId },
          })
        ).state,
      ).toBe("DELETED");
      expect((await save(body).expect(200)).body).toEqual(result);
      expect((await edit()).body).toMatchObject({
        avatar: null,
        customStatus: null,
        status: { availability: "BUSY" },
      });
    });
    it("deduplicates exact upload retries, rejects changed reuse and repairs a lost put acknowledgment without another put", async () => {
      const bytes = await png();
      const key = randomUUID();
      storage.put.mockImplementationOnce(async (...args) => {
        await put(...args);
        throw new Error("lost put acknowledgement");
      });
      await upload(bytes, key).expect(503);
      const receipt = (
        await http()
          .get(`/users/me/avatar-uploads/operations/${key}`)
          .set("Authorization", "Bearer " + owner)
          .expect(200)
      ).body;
      expect(receipt.state).toBe("STAGED");
      expect((await upload(bytes, key).expect(201)).body).toEqual(receipt);
      expect(storage.put).toHaveBeenCalledTimes(1);
      await upload(await png(16, 10, "blue"), key).expect(409);
      await http()
        .get(`/users/me/avatar-uploads/operations/${key}`)
        .set("Authorization", "Bearer " + peer)
        .expect(404);
    });
    it("keeps a missing uncertain upload fenced past expiry without replaying put or deleting possibly pending bytes", async () => {
      const key = randomUUID();
      const bytes = await png();
      storage.put.mockRejectedValueOnce(
        new Error("transport lost before outcome"),
      );
      await upload(bytes, key).expect(503);
      const asset = await db.profileAvatarAsset.findUniqueOrThrow({
        where: { ownerId_requestId: { ownerId: owner, requestId: key } },
      });
      await db.profileAvatarAsset.update({
        where: { id: asset.id },
        data: { expiresAt: new Date(0) },
      });
      await avatars.cleanup();
      expect(storage.delete).not.toHaveBeenCalled();
      expect((await upload(bytes, key).expect(201)).body.state).toBe(
        "UPLOADING",
      );
      expect(storage.put).toHaveBeenCalledTimes(1);
      await save(await draft({ avatarAssetId: asset.id })).expect(409);
    });
    it("expires abandoned ready stages, retries cleanup failures and protects the current image", async () => {
      const current = (await upload(await png()).expect(201)).body;
      await save(await draft({ avatarAssetId: current.assetId })).expect(200);
      const abandoned = (await upload(await png(10, 10, "blue")).expect(201))
        .body;
      await db.profileAvatarAsset.updateMany({
        where: { ownerId: owner },
        data: { expiresAt: new Date(0) },
      });
      storage.delete.mockRejectedValueOnce(
        new Error("private storage path failure"),
      );
      await avatars.cleanup();
      const failed = await db.profileAvatarAsset.findUniqueOrThrow({
        where: { id: abandoned.assetId },
      });
      expect(failed.state).toBe("DELETING");
      expect(failed.lastErrorCode).toBe("AVATAR_CLEANUP_UNAVAILABLE");
      await db.profileAvatarAsset.update({
        where: { id: abandoned.assetId },
        data: { nextAttemptAt: new Date(0) },
      });
      await avatars.cleanup();
      expect(
        (
          await db.profileAvatarAsset.findUniqueOrThrow({
            where: { id: abandoned.assetId },
          })
        ).state,
      ).toBe("DELETED");
      expect(
        (
          await db.profileAvatarAsset.findUniqueOrThrow({
            where: { id: current.assetId },
          })
        ).state,
      ).toBe("ACTIVE");
      expect((await edit()).body.avatar.assetId).toBe(current.assetId);
      await save(await draft({ avatarAssetId: abandoned.assetId })).expect(409);
    });
    it("rechecks audience after storage fetch and returns no revoked image bytes", async () => {
      const asset = (await upload(await png()).expect(201)).body;
      await save(
        await draft({
          avatarAssetId: asset.assetId,
          audiences: [policy("AVATAR")],
        }),
      ).expect(200);
      storage.get.mockImplementationOnce(async (key) => {
        await db.profileAudiencePolicy.update({
          where: { ownerId_field: { ownerId: owner, field: "AVATAR" } },
          data: { mode: "NO_ONE" },
        });
        return Buffer.from(objects.get(key)!.bytes);
      });
      const response = await image(asset.assetId).expect(404);
      expect(response.headers["content-type"]).not.toContain("image/png");
      expect(response.body).not.toHaveProperty("assetId");
    });
    it("rejects unsupported image bytes, out-of-bounds crop and oversized upload before publishing", async () => {
      for (const bytes of [
        Buffer.from("<svg/>"),
        Buffer.from([255, 216, 255, 0]),
        Buffer.from("GIF89a"),
      ])
        await upload(bytes).expect(400);
      await upload(await png(), randomUUID(), owner, {
        cropX: "0",
        cropY: "0",
        cropSize: "999",
      }).expect(400);
      await upload(await png(), randomUUID(), owner, { cropX: "0" }).expect(
        400,
      );
      await upload(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
      await upload(await png(), randomUUID(), owner, {
        ownerId: outside,
      }).expect(400);
      expect(
        await db.profileAvatarAsset.count({ where: { ownerId: owner } }),
      ).toBe(0);
      expect((await edit()).body.avatar).toBeNull();
    });
    it("allows explicit staged discard, denies active/foreign discard and enforces owner binding on Save", async () => {
      const own = (await upload(await png()).expect(201)).body;
      const foreign = (
        await upload(await png(), randomUUID(), outside).expect(201)
      ).body;
      await save(await draft({ avatarAssetId: foreign.assetId })).expect(409);
      await http()
        .delete(`/users/me/avatar-uploads/${own.assetId}`)
        .set("Authorization", "Bearer " + peer)
        .expect(404);
      for (let n = 0; n < 2; n++)
        await http()
          .delete(`/users/me/avatar-uploads/${own.assetId}`)
          .set("Authorization", "Bearer " + owner)
          .expect(200);
      await save(await draft({ avatarAssetId: own.assetId })).expect(409);
      await save(
        await draft({ avatarAssetId: foreign.assetId }, outside),
        outside,
      ).expect(200);
      await http()
        .delete(`/users/me/avatar-uploads/${foreign.assetId}`)
        .set("Authorization", "Bearer " + outside)
        .expect(409);
    });
    it("rolls back every supplied field when the final receipt cannot be persisted", async () => {
      const asset = (await upload(await png()).expect(201)).body;
      const before = (await edit()).body;
      const body = await draft({
        firstName: "Uncommitted",
        avatarAssetId: asset.assetId,
        customStatus: status(),
        availability: "BUSY",
        audiences: [policy("AVATAR"), policy("STATUS")],
      });
      // A database trigger fails the last write, after all content changes ran.
      await db.$executeRawUnsafe(
        `CREATE FUNCTION test_profile_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected final receipt failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER test_profile_receipt_failure BEFORE INSERT ON "ProfileSaveReceipt" FOR EACH ROW EXECUTE FUNCTION test_profile_receipt_failure()`,
      );
      try {
        await save(body).expect(503);
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER test_profile_receipt_failure ON "ProfileSaveReceipt"`,
        );
        await db.$executeRawUnsafe(
          `DROP FUNCTION test_profile_receipt_failure()`,
        );
      }
      expect((await edit()).body).toEqual(before);
      expect(
        (
          await db.profileAvatarAsset.findUniqueOrThrow({
            where: { id: asset.assetId },
          })
        ).state,
      ).toBe("STAGED");
      expect(
        await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
      ).toBe(0);
      await save(body).expect(200);
    });
    it("checks directed Contacts and live Custom membership for image delivery", async () => {
      const asset = (await upload(await png()).expect(201)).body;
      await save(
        await draft({
          avatarAssetId: asset.assetId,
          audiences: [policy("AVATAR", "CONTACTS")],
        }),
      ).expect(200);
      await image(asset.assetId, outside).expect(404);
      await db.profileContact.create({
        data: { ownerId: outside, contactAccountId: owner },
      });
      await image(asset.assetId, outside).expect(404);
      await db.profileContact.create({
        data: { ownerId: owner, contactAccountId: outside },
      });
      await image(asset.assetId, outside).expect(200);
      await db.profileContact.deleteMany({ where: { ownerId: owner } });
      await image(asset.assetId, outside).expect(404);
      await save(
        await draft({
          audiences: [policy("AVATAR", "CUSTOM", [outside], [w])],
        }),
      ).expect(200);
      await image(asset.assetId, peer).expect(200);
      await db.user.update({
        where: { id: peer },
        data: { workspaceId: otherW },
      });
      await image(asset.assetId, peer).expect(404);
      await image(asset.assetId, outside).expect(200);
    });
    it("allocates one immutable asset and issues one put for concurrent exact uploads", async () => {
      const bytes = await png(),
        requestId = randomUUID();
      const results = await Promise.all([
        upload(bytes, requestId),
        upload(bytes, requestId),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0].body.assetId).toBe(results[1].body.assetId);
      expect(storage.put).toHaveBeenCalledTimes(1);
      expect(
        await db.profileAvatarAsset.count({
          where: { ownerId: owner, requestId },
        }),
      ).toBe(1);
    });
    it("advances aggregate revisions for direct status writes and rejects foreign or retired pointers in PostgreSQL", async () => {
      const stale = await draft({ customStatus: status("stale") });
      await db.user.update({
        where: { id: owner },
        data: { customStatusText: "external writer" },
      });
      await save(stale).expect(409);
      expect((await edit()).body.customStatus.text).toBe("external writer");
      const own = (await upload(await png()).expect(201)).body;
      const foreign = (
        await upload(await png(), randomUUID(), outside).expect(201)
      ).body;
      await save(await draft({ avatarAssetId: own.assetId })).expect(200);
      await expect(
        db.profileAvatarAsset.update({
          where: { id: own.assetId },
          data: { state: "DELETING" },
        }),
      ).rejects.toThrow();
      await expect(
        db.user.update({
          where: { id: outside },
          data: { avatarAssetId: own.assetId },
        }),
      ).rejects.toThrow();
      await expect(
        db.user.update({
          where: { id: outside },
          data: { avatarAssetId: foreign.assetId },
        }),
      ).rejects.toThrow();
      expect((await edit()).body.avatar.assetId).toBe(own.assetId);
    });
    it("rejects stale concurrent drafts and preserves one complete winner", async () => {
      const a = (await upload(await png()).expect(201)).body;
      const b = (await upload(await png(10, 10, "blue")).expect(201)).body;
      const base = await draft();
      const results = await Promise.all([
        save({
          ...base,
          avatarAssetId: a.assetId,
          customStatus: status("first"),
        }),
        save({
          ...base,
          requestId: randomUUID(),
          avatarAssetId: b.assetId,
          customStatus: status("second"),
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const current = (await edit()).body;
      expect(current.avatar.assetId).toBe(
        current.customStatus.text === "first" ? a.assetId : b.assetId,
      );
      expect(
        await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
      ).toBe(1);
    });
    it("reconciles a lost whole-Save acknowledgment without duplicating content or activating twice", async () => {
      const asset = (await upload(await png()).expect(201)).body;
      const body = await draft({
        avatarAssetId: asset.assetId,
        customStatus: status(),
      });
      const original = saves.commit.bind(saves);
      const lost = jest
        .spyOn(saves, "commit")
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new ServiceUnavailableException("Injected lost acknowledgment");
        });
      try {
        await save(body).expect(503);
      } finally {
        lost.mockRestore();
      }
      const receipt = (
        await http()
          .get(`/users/me/profile/operations/${body.requestId}`)
          .set("Authorization", "Bearer " + owner)
          .expect(200)
      ).body;
      expect((await save(body).expect(200)).body).toEqual(receipt);
      expect((await edit()).body.avatar.assetId).toBe(asset.assetId);
      expect(storage.put).toHaveBeenCalledTimes(1);
    });
    it("enforces lifecycle, authentication, selector and tampered-object boundaries", async () => {
      const asset = (await upload(await png()).expect(201)).body;
      await save(
        await draft({
          avatarAssetId: asset.assetId,
          audiences: [policy("AVATAR")],
        }),
      ).expect(200);
      await image(asset.assetId, "invalid").expect(401);
      await http()
        .get(`/profiles/${owner}/avatar/${asset.assetId}?viewerId=${owner}`)
        .expect(400);
      await http()
        .get(`/users/me/avatar-uploads/${asset.assetId}/content`)
        .expect(401);
      storage.get.mockResolvedValueOnce(Buffer.from("tampered"));
      await image(asset.assetId).expect(503);
      await db.user.update({
        where: { id: owner },
        data: { status: "BANNED" },
      });
      await image(asset.assetId).expect(404);
      await edit().expect(401);
    });
    it("documents API input 100 versus stored/read capacity 300 and the staged/public image contract", () => {
      const spec: any = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        spec.components.schemas.CustomStatusInputDto.properties.text.maxLength,
      ).toBe(100);
      expect(
        spec.components.schemas.CustomStatusResponseDto.properties.text
          .maxLength,
      ).toBe(300);
      expect(
        spec.components.schemas.CommitSelfProfileDto.properties.avatarAssetId
          .nullable,
      ).toBe(true);
      expect(
        spec.paths["/users/me/avatar-uploads"].post.requestBody.content[
          "multipart/form-data"
        ].schema.required,
      ).toEqual(["requestId", "file"]);
      expect(
        spec.paths["/profiles/{accountId}/avatar/{assetId}"].get.responses[
          "200"
        ],
      ).toBeDefined();
    });
  },
);
