import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService, JsonWebTokenError } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  ManualStatusController,
  PublicManualStatusController,
} from "../src/accounts/manual-status.controller";
import { ManualStatusService } from "../src/accounts/manual-status.service";
import {
  ProfileAudienceResponseDto,
  SaveProfileAudienceDto,
} from "../src/accounts/profile-privacy.dto";
import { AudiencePickerQueryDto } from "../src/accounts/profile-picker.dto";
import { PrismaService } from "../src/prisma/prisma.service";
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
  "shared manual availability HTTP/PostgreSQL",
  () => {
    let app: INestApplication,
      db: PrismaClient,
      service: ManualStatusService,
      w: string,
      fw: string,
      owner: string,
      peer: string,
      foreign: string;
    const http = () => request(app.getHttpServer());
    const self = (id = owner) =>
      http()
        .get("/users/me/status")
        .set("Authorization", "Bearer " + id);
    const put = (
      availability: unknown,
      key: string = randomUUID(),
      rev = 0,
      id = owner,
      extra = {},
    ) =>
      http()
        .put("/users/me/status")
        .set("Authorization", "Bearer " + id)
        .set("If-Match", `"${rev}"`)
        .send({ availability, requestId: key, ...extra });
    const readback = (key: string, id = owner) =>
      http()
        .get("/users/me/status/operations/" + key)
        .set("Authorization", "Bearer " + id);
    const actor = (id = owner, workspaceId = w) => ({
      id,
      workspaceId,
      roles: [],
      permissions: [],
      type: "access" as const,
    });
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      fw = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      async function user(workspaceId: string) {
        return (
          await db.user.create({
            data: {
              workspaceId,
              phoneNumber: randomUUID(),
              fullName: "Employee",
              status: "OPEN",
              bio: "PRIVATE BIO",
            },
          })
        ).id;
      }
      owner = await user(w);
      peer = await user(w);
      foreign = await user(fw);
      const module = await Test.createTestingModule({
        controllers: [ManualStatusController, PublicManualStatusController],
        providers: [
          ManualStatusService,
          { provide: PrismaService, useValue: db },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => {
                if (id === "bad")
                  throw new JsonWebTokenError("invalid signature");
                return { id, type: "access" };
              },
            },
          },
        ],
      }).compile();
      service = module.get(ManualStatusService);
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
      await db.manualProfileStatus.deleteMany({
        where: { ownerId: { in: [owner, peer, foreign] } },
      });
      await db.profileAudiencePolicy.deleteMany({ where: { ownerId: owner } });
      await db.user.update({ where: { id: owner }, data: { status: "OPEN" } });
    });
    afterAll(async () => {
      await app?.close();
      if (w) {
        await db.user.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
      }
      await db.$disconnect();
    });
    it("reads absent status as unset without selecting a default or writing a row", async () => {
      const response = await self();
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({ availability: null, revision: 0 });
      expect((await http().get(`/profiles/${owner}/status`)).body).toEqual({
        accountId: owner,
        availability: null,
      });
      expect(
        await db.manualProfileStatus.count({ where: { ownerId: owner } }),
      ).toBe(0);
    });
    it.each(["AVAILABLE", "AWAY", "BUSY"])(
      "round-trips selected %s with truthful human attribution and no profile/lifecycle changes",
      async (availability) => {
        const before = await db.user.findUniqueOrThrow({
            where: { id: owner },
          }),
          key = randomUUID();
        const result = await put(availability, key);
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          requestId: key,
          availability,
          revision: 1,
          actor: { kind: "EMPLOYEE", id: owner },
        });
        expect((await self()).body).toEqual({ availability, revision: 1 });
        expect((await http().get(`/profiles/${owner}/status`)).body).toEqual({
          accountId: owner,
          availability,
        });
        expect(
          await db.user.findUniqueOrThrow({ where: { id: owner } }),
        ).toEqual(before);
        expect(
          await db.manualProfileStatusMutation.findUniqueOrThrow({
            where: { ownerId_requestId: { ownerId: owner, requestId: key } },
          }),
        ).toMatchObject({
          actorId: owner,
          workspaceId: w,
          before: null,
          availability,
          expectedRevision: 0,
          revision: 1,
        });
      },
    );
    it("shares one value with anonymous, owner, same-workspace and outside viewers regardless of legacy STATUS policy", async () => {
      expect((await put("BUSY")).status).toBe(200);
      for (const mode of [
        "NO_ONE",
        "CONTACTS",
        "CUSTOM",
        "EVERYONE",
      ] as const) {
        await db.profileAudiencePolicy.upsert({
          where: { ownerId_field: { ownerId: owner, field: "STATUS" } },
          create: { ownerId: owner, field: "STATUS", mode },
          update: { mode },
        });
        for (const viewer of [undefined, owner, peer, foreign]) {
          let call = http().get(`/profiles/${owner}/status`);
          if (viewer) call = call.set("Authorization", "Bearer " + viewer);
          const response = await call;
          expect(response.status).toBe(200);
          expect(response.headers["cache-control"]).toBe("no-store");
          expect(response.body).toEqual({
            accountId: owner,
            availability: "BUSY",
          });
        }
        expect(
          (
            await db.profileAudiencePolicy.findUniqueOrThrow({
              where: { ownerId_field: { ownerId: owner, field: "STATUS" } },
            })
          ).mode,
        ).toBe(mode);
      }
    });
    it("clears to unset, keeps frozen history and does not reapply an old successful retry", async () => {
      const key = randomUUID(),
        saved = await put("AVAILABLE", key);
      expect((await put(null, randomUUID(), 1)).body).toMatchObject({
        availability: null,
        revision: 2,
      });
      const replay = await put("AVAILABLE", key.toUpperCase(), 0);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(saved.body);
      expect((await readback(key)).body).toEqual(saved.body);
      expect((await self()).body).toEqual({ availability: null, revision: 2 });
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(2);
    });
    it("reconciles an actually committed write after an injected lost HTTP acknowledgment", async () => {
      const original = service.set.bind(service),
        key = randomUUID();
      const spy = jest
        .spyOn(service, "set")
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new Error("Injected lost status acknowledgment");
        });
      try {
        expect((await put("AWAY", key)).status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      const receipt = await readback(key);
      expect(receipt.status).toBe(200);
      expect((await put("AWAY", key)).body).toEqual(receipt.body);
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(1);
    });
    it("converges concurrent exact retries and conflicts with a distinct competing write", async () => {
      const key = randomUUID(),
        results = await Promise.all(
          Array.from({ length: 6 }, () => put("AVAILABLE", key)),
        );
      expect(
        results.every(
          (row) =>
            row.status === 200 &&
            JSON.stringify(row.body) === JSON.stringify(results[0]!.body),
        ),
      ).toBe(true);
      expect((await put("BUSY", randomUUID(), 0)).status).toBe(409);
      const races = await Promise.all([
        put("BUSY", randomUUID(), 1),
        put("AWAY", randomUUID(), 1),
      ]);
      expect(races.map((row) => row.status).sort()).toEqual([200, 409]);
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(2);
    });
    it("rejects changed key reuse without rewriting any saved row", async () => {
      const key = randomUUID();
      await put("AVAILABLE", key);
      expect((await put("BUSY", key)).status).toBe(409);
      expect((await put("AVAILABLE", key, 1)).status).toBe(409);
      expect((await self()).body).toEqual({
        availability: "AVAILABLE",
        revision: 1,
      });
    });
    it.each(["OFFLINE", "OPEN", "available", "", 1, {}, []])(
      "rejects unsupported availability %#",
      async (value) => {
        expect((await put(value)).status).toBe(400);
        expect(
          await db.manualProfileStatus.count({ where: { ownerId: owner } }),
        ).toBe(0);
      },
    );
    it.each([
      "ownerId",
      "workspaceId",
      "agentId",
      "actor",
      "audiences",
      "customStatus",
      "emoji",
    ])("rejects forged or unsettled %s inputs", async (field) => {
      expect(
        (await put("BUSY", randomUUID(), 0, owner, { [field]: "Forged" }))
          .status,
      ).toBe(400);
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(0);
    });
    it("requires the availability field and exact revision syntax; unknown selectors cannot choose a viewer/owner", async () => {
      expect(
        (
          await http()
            .put("/users/me/status")
            .set("Authorization", "Bearer " + owner)
            .set("If-Match", '"0"')
            .send({ requestId: randomUUID() })
        ).status,
      ).toBe(400);
      expect(
        (
          await http()
            .put("/users/me/status")
            .set("Authorization", "Bearer " + owner)
            .send({ availability: "BUSY", requestId: randomUUID() })
        ).status,
      ).toBe(428);
      expect(
        (
          await http()
            .put("/users/me/status")
            .set("Authorization", "Bearer " + owner)
            .set("If-Match", "0")
            .send({ availability: "BUSY", requestId: randomUUID() })
        ).status,
      ).toBe(400);
      expect((await self().query({ ownerId: peer })).status).toBe(400);
      expect(
        (await http().get(`/profiles/${owner}/status`).query({ viewer: peer }))
          .status,
      ).toBe(400);
    });
    it("keeps mutation readback self-scoped even across workspaces and privileged role labels", async () => {
      const key = randomUUID();
      await put("AVAILABLE", key);
      for (const id of [peer, foreign]) {
        expect((await readback(key, id)).status).toBe(404);
        expect((await self(id)).body).toEqual({
          availability: null,
          revision: 0,
        });
      }
      await expect(service.self(actor(owner, fw))).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        service.set(actor(owner, fw), 0, {
          availability: "BUSY",
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it.each(["PENDING", "BANNED", "DELETED"] as const)(
      "denies %s accounts, including old receipt replay, and hides their public status",
      async (status) => {
        const key = randomUUID();
        await put("AVAILABLE", key);
        await db.user.update({ where: { id: owner }, data: { status } });
        expect((await self()).status).toBe(401);
        expect((await put("AVAILABLE", key)).status).toBe(401);
        expect((await readback(key)).status).toBe(401);
        expect((await http().get(`/profiles/${owner}/status`)).status).toBe(
          404,
        );
      },
    );
    it("requires human authentication and never downgrades invalid optional auth to anonymous", async () => {
      expect((await http().get("/users/me/status")).status).toBe(401);
      expect(
        (
          await http()
            .get(`/profiles/${owner}/status`)
            .set("Authorization", "Bearer bad")
        ).status,
      ).toBe(401);
      expect(
        (await http().get(`/profiles/${randomUUID()}/status`)).status,
      ).toBe(404);
      await expect(
        service.set({ ...actor(), type: "agent" } as any, 0, {
          availability: "BUSY",
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("rolls state and revision back if receipt persistence fails and sanitizes unknown read errors", async () => {
      const original = db.$transaction.bind(db);
      const spy = jest.spyOn(db, "$transaction").mockImplementationOnce(((
        callback: any,
        options: any,
      ) =>
        original(
          async (tx: any) =>
            callback(
              new Proxy(tx, {
                get(target, key) {
                  if (key === "manualProfileStatusMutation")
                    return {
                      ...target.manualProfileStatusMutation,
                      create: async () => {
                        throw new Error("PRIVATE FAILURE");
                      },
                    };
                  return Reflect.get(target, key);
                },
              }),
            ),
          options,
        )) as any);
      try {
        const result = await put("BUSY");
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toContain("PRIVATE FAILURE");
      } finally {
        spy.mockRestore();
      }
      expect((await self()).body).toEqual({ availability: null, revision: 0 });
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(0);
      const failed = jest
        .spyOn(db, "$transaction")
        .mockRejectedValueOnce(new Error("PRIVATE DATABASE PATH"));
      try {
        const result = await self();
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toContain(
          "PRIVATE DATABASE PATH",
        );
      } finally {
        failed.mockRestore();
      }
    });
    it("publishes explicit nullable choices, revision and public sharing without privacy/presence claims", () => {
      const doc = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().build(),
          {
            extraModels: [
              ProfileAudienceResponseDto,
              SaveProfileAudienceDto,
              AudiencePickerQueryDto,
            ],
          },
        ),
        schemas: any = doc.components!.schemas!;
      expect(schemas.SetManualStatusDto.required).toEqual(
        expect.arrayContaining(["requestId", "availability"]),
      );
      expect(schemas.SetManualStatusDto.properties.availability.enum).toEqual([
        "AVAILABLE",
        "AWAY",
        "BUSY",
      ]);
      expect(schemas.SetManualStatusDto.properties.availability.nullable).toBe(
        true,
      );
      expect(
        schemas.SetManualStatusDto.properties.availability,
      ).not.toHaveProperty("default");
      expect(
        Object.keys(schemas.PublicManualStatusResponseDto.properties).sort(),
      ).toEqual(["accountId", "availability"]);
      expect(doc.paths["/users/me/status"]!.put!.responses["428"]).toBeTruthy();
      for (const path of ["/users/me/status", "/profiles/{accountId}/status"])
        expect(
          JSON.stringify(doc.paths[path]!.get!.responses["503"]),
        ).toContain("MANUAL_STATUS_UNAVAILABLE");
      expect(
        JSON.stringify(doc.paths["/users/me/status"]!.put!.responses["409"]),
      ).toContain("MANUAL_STATUS_REVISION_CONFLICT");
      expect(
        JSON.stringify(doc.paths["/users/me/status"]!.put!.responses["409"]),
      ).toContain("MANUAL_STATUS_REQUEST_CONFLICT");
      for (const name of [
        "ProfileAudienceResponseDto",
        "SaveProfileAudienceDto",
        "AudiencePickerQueryDto",
      ])
        expect(schemas[name].properties.field.description).toContain("legacy");
    });
  },
);
