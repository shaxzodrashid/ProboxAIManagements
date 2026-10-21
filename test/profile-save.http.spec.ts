import {
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AccountsService } from "../src/accounts/accounts.service";
import {
  ManualStatusController,
  PublicManualStatusController,
} from "../src/accounts/manual-status.controller";
import { ManualStatusService } from "../src/accounts/manual-status.service";
import { SaveProfileAudienceDto } from "../src/accounts/profile-privacy.dto";
import { ProfilePrivacyController } from "../src/accounts/profile-privacy.controller";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { ProfileSaveController } from "../src/accounts/profile-save.controller";
import { ProfileSaveService } from "../src/accounts/profile-save.service";
import { AuthorizationService } from "../src/authorization/authorization.service";
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
(url ? describe : describe.skip)("atomic Profile Save HTTP/PostgreSQL", () => {
  let db: PrismaClient,
    app: INestApplication,
    service: ProfileSaveService,
    accounts: AccountsService;
  let workspaceId: string,
    otherWorkspaceId: string,
    owner: string,
    peer: string;
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
  const readback = (key: string, id = owner) =>
    http()
      .get("/users/me/profile/operations/" + key)
      .set("Authorization", "Bearer " + id);
  const actor = (id = owner, workspace = workspaceId) => ({
    id,
    workspaceId: workspace,
    roles: [],
    permissions: [],
    type: "access" as const,
  });
  const draft = async <T extends object>(extra: T = {} as T) => ({
    requestId: randomUUID(),
    expectedRevision: (await edit()).body.revision,
    audiences: [] as SaveProfileAudienceDto[],
    ...extra,
  });
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    workspaceId = (await db.workspace.create({ data: { slug: randomUUID() } }))
      .id;
    otherWorkspaceId = (
      await db.workspace.create({ data: { slug: randomUUID() } })
    ).id;
    const module = await Test.createTestingModule({
      controllers: [
        ProfileSaveController,
        ProfilePrivacyController,
        ManualStatusController,
        PublicManualStatusController,
      ],
      providers: [
        ProfileSaveService,
        ProfilePrivacyService,
        ManualStatusService,
        AccountsService,
        { provide: PrismaService, useValue: db },
        { provide: AuthorizationService, useValue: {} },
        {
          provide: JwtService,
          useValue: {
            verify: (id: string) => ({
              id,
              type: id === "agent" ? "agent" : "access",
            }),
          },
        },
      ],
    }).compile();
    service = module.get(ProfileSaveService);
    accounts = module.get(AccountsService);
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
    const create = async (w: string) =>
      (
        await db.user.create({
          data: {
            workspaceId: w,
            phoneNumber: randomUUID(),
            fullName: "Unsplit Legacy  Name",
            bio: "Before",
            status: "OPEN",
          },
        })
      ).id;
    owner = await create(workspaceId);
    peer = await create(otherWorkspaceId);
  });
  afterAll(async () => {
    await app?.close();
    await db.user.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await db.$disconnect();
  });
  it("reads a private coherent zero-grant baseline without writing or splitting legacy names", async () => {
    const result = await edit();
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toMatchObject({
      revision: 0,
      status: { availability: null, revision: 0 },
      profile: {
        displayName: "Unsplit Legacy  Name",
        firstName: null,
        lastName: null,
      },
    });
    expect(
      await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
    ).toBe(0);
    expect(
      await db.manualProfileStatus.count({ where: { ownerId: owner } }),
    ).toBe(0);
  });
  it("commits names, bio, birthday, privacy and shared status with one minimal private receipt", async () => {
    const body = await draft({
      firstName: "Only",
      bio: "After",
      birthDate: "2000-02-29",
      availability: "BUSY",
      audiences: [
        { field: "BIO", mode: "EVERYONE", accountIds: [], workspaceIds: [] },
      ],
    });
    const result = await save(body);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual([
      "createdAt",
      "expectedRevision",
      "requestId",
      "revision",
    ]);
    expect(result.body.revision).toBeGreaterThan(0);
    const current = await edit();
    expect(current.body).toMatchObject({
      revision: result.body.revision,
      profile: {
        firstName: "Only",
        lastName: null,
        bio: "After",
        birthDate: "2000-02-29",
      },
      status: { availability: "BUSY", revision: 1 },
    });
    expect(
      current.body.audiences.find((p: any) => p.field === "BIO").mode,
    ).toBe("EVERYONE");
    expect((await http().get(`/profiles/${owner}/status`)).body).toEqual({
      accountId: owner,
      availability: "BUSY",
    });
    const receipt = await db.profileSaveReceipt.findFirstOrThrow({
      where: { ownerId: owner },
    });
    expect(receipt.actorId).toBe(owner);
    expect(JSON.stringify(receipt)).not.toContain("After");
    expect(
      await db.manualProfileStatusMutation.findUniqueOrThrow({
        where: {
          ownerId_requestId: {
            ownerId: owner,
            requestId: receipt.statusRequestId!,
          },
        },
      }),
    ).toMatchObject({ actorId: owner, availability: "BUSY" });
    expect((await readback(body.requestId)).body).toEqual(result.body);
    expect((await readback(body.requestId, peer)).status).toBe(404);
  });
  it("rolls every component and revision back when final receipt persistence fails", async () => {
    const before = (await edit()).body;
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_profile_save_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database internals'; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_profile_save_test BEFORE INSERT ON "ProfileSaveReceipt" FOR EACH ROW EXECUTE FUNCTION fail_profile_save_test()',
    );
    try {
      const result = await save(
        await draft({
          bio: "Must rollback",
          birthDate: "2001-01-01",
          availability: "AWAY",
          audiences: [
            {
              field: "BIO",
              mode: "EVERYONE",
              accountIds: [],
              workspaceIds: [],
            },
          ],
        }),
      );
      expect(result.status).toBe(503);
      expect(JSON.stringify(result.body)).not.toContain(
        "private database internals",
      );
      expect((await edit()).body).toEqual(before);
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(0);
      expect(
        await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER fail_profile_save_test ON "ProfileSaveReceipt"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION fail_profile_save_test()");
    }
  });
  it("rejects unavailable recipients atomically and preserves the draft baseline", async () => {
    const before = (await edit()).body;
    const result = await save(
      await draft({
        bio: "Invalid",
        availability: "BUSY",
        audiences: [
          {
            field: "BIO",
            mode: "CUSTOM",
            accountIds: [randomUUID()],
            workspaceIds: [],
          },
        ],
      }),
    );
    expect(result.status).toBe(400);
    expect((await edit()).body).toEqual(before);
  });
  it("concurrent exact retries converge to one complete mutation and one receipt", async () => {
    const body = await draft({ bio: "One write", availability: "AVAILABLE" });
    const results = await Promise.all([save(body), save(body), save(body)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results[1].body).toEqual(results[0].body);
    expect(results[2].body).toEqual(results[0].body);
    expect(
      await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
    ).toBe(1);
    expect(
      await db.manualProfileStatusMutation.count({ where: { ownerId: owner } }),
    ).toBe(1);
  });
  it("concurrent distinct drafts yield one conflict with no partial losing changes", async () => {
    const first = await draft({ bio: "Winner A", availability: "BUSY" });
    const second = {
      ...first,
      requestId: randomUUID(),
      bio: "Winner B",
      availability: "AWAY",
    };
    const results = await Promise.all([save(first), save(second)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? first : second;
    expect((await edit()).body).toMatchObject({
      profile: { bio: winner.bio },
      status: { availability: winner.availability },
    });
    expect(
      await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
    ).toBe(1);
  });
  it("exact replay after a newer clear acknowledges history without resurrecting data", async () => {
    const body = await draft({ bio: "Original", availability: "BUSY" });
    const original = await save(body);
    expect(
      (await save(await draft({ bio: null, availability: null }))).status,
    ).toBe(200);
    const before = (await edit()).body;
    expect((await save(body)).body).toEqual(original.body);
    expect((await edit()).body).toEqual(before);
    expect(before.profile.bio).toBeNull();
    expect(before.status.availability).toBeNull();
    expect((await save({ ...body, bio: "Changed reuse" })).status).toBe(409);
  });
  it("lost acknowledgment reconciles the whole operation by the original identity", async () => {
    const original = service.commit.bind(service);
    const spy = jest
      .spyOn(service, "commit")
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new ServiceUnavailableException("Acknowledgment lost");
      });
    const body = await draft({ bio: "Committed", availability: "AWAY" });
    expect((await save(body)).status).toBe(503);
    spy.mockRestore();
    const receipt = await readback(body.requestId);
    expect(receipt.status).toBe(200);
    expect((await save(body)).body).toEqual(receipt.body);
    expect(
      await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
    ).toBe(1);
  });
  it("normalizes audience set ordering for exact retries but preserves omitted versus null", async () => {
    const body = await draft({
      audiences: [
        {
          field: "BIO",
          mode: "CUSTOM",
          accountIds: [owner, peer],
          workspaceIds: [],
        },
        { field: "STATUS", mode: "NO_ONE", accountIds: [], workspaceIds: [] },
      ],
    });
    const result = await save(body);
    expect(result.status).toBe(200);
    expect(
      (
        await save({
          ...body,
          audiences: [
            { ...body.audiences[1] },
            { ...body.audiences[0], accountIds: [peer, owner] },
          ],
        })
      ).body,
    ).toEqual(result.body);
    expect((await save({ ...body, availability: null })).status).toBe(409);
  });
  it("guards drafts against all legacy profile, policy, recipient, seed and status writers", async () => {
    const changes = [
      () => accounts.updateSelf(workspaceId, owner, { bio: "Legacy PATCH" }),
      () =>
        http()
          .put("/users/me/profile")
          .set("Authorization", "Bearer " + owner)
          .send({ bio: "Legacy Save", audiences: [] })
          .expect(200),
      () =>
        http()
          .put("/users/me/privacy/BIO")
          .set("Authorization", "Bearer " + owner)
          .send({ mode: "EVERYONE", accountIds: [], workspaceIds: [] })
          .expect(200),
      () =>
        db.profileAudienceAccountRecipient.create({
          data: { ownerId: owner, field: "BIO", accountId: peer },
        }),
      () =>
        db.profileAudienceWorkspaceRecipient.create({
          data: { ownerId: owner, field: "BIO", workspaceId },
        }),
      () =>
        db.user.update({
          where: { id: owner },
          data: { fullName: "Seed display text" },
        }),
      () =>
        http()
          .put("/users/me/status")
          .set("Authorization", "Bearer " + owner)
          .set("If-Match", '"0"')
          .send({ requestId: randomUUID(), availability: "BUSY" })
          .expect(200),
    ];
    for (const change of changes) {
      const stale = await draft({
        bio: "Stale must not write",
        availability: "AVAILABLE",
      });
      await change();
      const before = (await edit()).body;
      expect(before.revision).toBeGreaterThan(stale.expectedRevision);
      expect((await save(stale)).status).toBe(409);
      expect((await edit()).body).toEqual(before);
    }
  });
  it("does not conflate Contacts, authentication or authorization changes with covered content", async () => {
    const body = await draft({ bio: "Valid" });
    await http()
      .put(`/users/me/contacts/${peer}`)
      .set("Authorization", "Bearer " + owner)
      .expect(200);
    await db.user.update({
      where: { id: owner },
      data: { telegramUserId: BigInt(Date.now()) },
    });
    await db.workspace.update({
      where: { id: workspaceId },
      data: { authorizationRevision: { increment: 1 } },
    });
    expect((await edit()).body.revision).toBe(body.expectedRevision);
    expect((await save(body)).status).toBe(200);
    expect(await db.profileContact.count({ where: { ownerId: owner } })).toBe(
      1,
    );
  });
  it("retains standalone status errors, revision and receipt behavior after a combined Save", async () => {
    const body = await draft({ availability: "BUSY" });
    await save(body).expect(200);
    const key = randomUUID();
    const put = (rev?: string) => {
      const req = http()
        .put("/users/me/status")
        .set("Authorization", "Bearer " + owner);
      return (rev ? req.set("If-Match", rev) : req).send({
        requestId: key,
        availability: null,
      });
    };
    expect((await put()).status).toBe(428);
    expect((await put("bad")).status).toBe(400);
    expect((await put('"0"')).status).toBe(409);
    const result = await put('"1"');
    expect(result.status).toBe(200);
    expect(result.body.revision).toBe(2);
    expect((await put('"1"')).body).toEqual(result.body);
  });
  it.each([
    "roles",
    "permissions",
    "workspaceId",
    "status",
    "username",
    "phoneNumber",
    "avatar",
    "actorId",
  ])("rejects unauthorized input %s", async (field) => {
    expect((await save(await draft({ [field]: "forbidden" }))).status).toBe(
      400,
    );
  });
  it("enforces fresh human self workspace/lifecycle scope and rejects selectors", async () => {
    const body = await draft({ bio: "Never" });
    expect((await http().get("/users/me/profile/edit")).status).toBe(401);
    expect((await edit("agent")).status).toBe(401);
    expect(
      (
        await http()
          .get("/users/me/profile/edit?ownerId=" + peer)
          .set("Authorization", "Bearer " + owner)
      ).status,
    ).toBe(400);
    await expect(
      service.commit(actor(owner, otherWorkspaceId), body),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.edit({ ...actor(), type: "agent" } as any),
    ).rejects.toMatchObject({ status: 403 });
    await db.user.update({ where: { id: owner }, data: { status: "BANNED" } });
    expect((await save(body)).status).toBe(401);
    expect(
      await db.profileSaveReceipt.count({ where: { ownerId: owner } }),
    ).toBe(0);
  });
  it("advances explicit empty/equal-value commands but never their retries", async () => {
    const body = await draft();
    const result = await save(body);
    expect(result.status).toBe(200);
    expect(result.body.revision).toBeGreaterThan(body.expectedRevision);
    expect((await save(body)).body).toEqual(result.body);
    expect((await save(await draft({ bio: "Before" }))).status).toBe(200);
    expect((await edit()).body.revision).toBeGreaterThan(result.body.revision);
  });
  it("documents the additive API and explicit contracts in OpenAPI", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(
      doc.paths["/users/me/profile/changes"]!.put!.responses["409"],
    ).toBeDefined();
    expect(
      doc.paths["/users/me/profile/edit"]!.get!.responses["200"],
    ).toBeDefined();
    const schemas: any = doc.components!.schemas;
    expect(schemas.CommitSelfProfileDto.required).toEqual(
      expect.arrayContaining(["audiences", "requestId", "expectedRevision"]),
    );
    expect(schemas.CommitSelfProfileDto.properties.availability.nullable).toBe(
      true,
    );
    expect(schemas.ProfileSaveReceiptDto.properties.bio).toBeUndefined();
  });
  it("normalizes direct callers identically to HTTP and hashes the normalized intent", async () => {
    const body = await draft({
      firstName: " ".repeat(150) + "Ada" + " ".repeat(150),
    });
    const receipt = await service.commit(actor(), body);
    expect((await edit()).body.profile.firstName).toBe("Ada");
    expect((await save({ ...body, firstName: "Ada" })).body).toEqual(receipt);
  });
  it.each(["status-first", "profile-first"])(
    "keeps root and standalone UUID namespaces independent: %s",
    async (order) => {
      const key = randomUUID();
      const standalone = (revision: number) =>
        http()
          .put("/users/me/status")
          .set("Authorization", "Bearer " + owner)
          .set("If-Match", `"${revision}"`)
          .send({ requestId: key, availability: "AWAY" });
      if (order === "status-first") await standalone(0).expect(200);
      const body = await draft({ requestId: key, availability: "BUSY" });
      const root = await save(body).expect(200);
      if (order === "profile-first") await standalone(1).expect(200);
      expect((await readback(key)).body).toEqual(root.body);
      const current = (await edit()).body;
      expect((await save(body)).body).toEqual(root.body);
      expect((await edit()).body).toEqual(current);
      expect(
        await db.manualProfileStatusMutation.count({
          where: { ownerId: owner },
        }),
      ).toBe(2);
    },
  );
  it("keeps an edit read coherent when a complete Save commits between its component reads", async () => {
    const body = await draft({
      bio: "Concurrent",
      availability: "BUSY",
      audiences: [
        { field: "BIO", mode: "EVERYONE", accountIds: [], workspaceIds: [] },
      ],
    });
    const before = (await edit()).body;
    const original = db.$transaction.bind(db);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    // Pause only the next transaction's policy read, after its user/revision read.
    const spy = jest.spyOn(db, "$transaction").mockImplementationOnce(((
      action: any,
      options: any,
    ) =>
      original(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, key) {
            if (key === "profileAudiencePolicy")
              return new Proxy(target.profileAudiencePolicy, {
                get(model, method) {
                  if (method === "findMany")
                    return async (args: any) => {
                      entered();
                      await gate;
                      return model.findMany(args);
                    };
                  return Reflect.get(model, method);
                },
              });
            return Reflect.get(target, key);
          },
        });
        return action(wrapped);
      }, options)) as any);
    const pending = service.edit(actor());
    await ready;
    spy.mockRestore();
    try {
      expect((await save(body)).status).toBe(200);
    } finally {
      release();
    }
    expect(await pending).toEqual(before);
    expect((await edit()).body).toMatchObject({
      profile: { bio: "Concurrent" },
      status: { availability: "BUSY" },
    });
  });
});
