import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { JwtAuthGuard } from "../src/auth/auth.guards";
import { OptionalJwtAuthGuard } from "../src/auth/optional-jwt-auth.guard";
import {
  ProfileAvatarController,
  PublicProfileAvatarController,
} from "../src/accounts/profile-avatar.controller";
import { ProfileAvatarService } from "../src/accounts/profile-avatar.service";
import { ProfileAvatarStorage } from "../src/accounts/profile-avatar-storage";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest");

describe("avatar dependency failures after authentication", () => {
  let app: INestApplication;
  const owner = randomUUID(),
    assetId = randomUUID(),
    requestId = randomUUID();
  const bytes = Buffer.from("normalized stored bytes");
  const asset = {
    id: assetId,
    ownerId: owner,
    requestId,
    state: "STAGED",
    expiresAt: new Date(Date.now() + 3600_000),
    width: 1,
    height: 1,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    objectKey: "private-object-key",
  };
  const db = {
    user: { findFirst: jest.fn() },
    profileAvatarAsset: { findUnique: jest.fn(), findFirst: jest.fn() },
  };
  const storage = { get: jest.fn(), put: jest.fn(), head: jest.fn() };
  const privacy = { publicProfile: jest.fn() };
  const actor = {
    id: owner,
    workspaceId: randomUUID(),
    type: "access",
    permissions: [],
    accessExpiresAt: Date.now() + 3600_000,
  };
  beforeAll(async () => {
    const guard = {
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = actor;
        return true;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [ProfileAvatarController, PublicProfileAvatarController],
      providers: [
        ProfileAvatarService,
        { provide: PrismaService, useValue: db },
        { provide: ProfileAvatarStorage, useValue: storage },
        { provide: ProfilePrivacyService, useValue: privacy },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guard)
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue(guard)
      .compile();
    jest
      .spyOn(module.get(ProfileAvatarService), "onModuleInit")
      .mockImplementation(() => undefined);
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    db.user.findFirst
      .mockReset()
      .mockResolvedValue({ id: owner, avatarAssetId: assetId });
    db.profileAvatarAsset.findUnique.mockReset().mockResolvedValue(asset);
    db.profileAvatarAsset.findFirst
      .mockReset()
      .mockResolvedValue({ ...asset, state: "ACTIVE" });
    privacy.publicProfile
      .mockReset()
      .mockResolvedValue({ id: owner, avatar: { assetId } });
    storage.get.mockReset().mockResolvedValue(bytes);
  });
  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });
  const unavailable = async (response: PromiseLike<any>) => {
    const r = await response;
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({
      code: "PROFILE_AVATAR_UNAVAILABLE",
      action: "profileAvatar",
    });
    expect(JSON.stringify(r.body)).not.toMatch(
      /private-object-key|injected database detail/,
    );
    expect(r.headers["content-type"]).not.toContain("image/png");
  };
  it("returns retryable 503 when owned upload receipt lookup fails", async () => {
    db.profileAvatarAsset.findUnique.mockRejectedValueOnce(
      new Error("injected database detail"),
    );
    await unavailable(
      request(app.getHttpServer()).get(
        `/users/me/avatar-uploads/operations/${requestId}`,
      ),
    );
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });
  it("preserves the upload identity when a later readback succeeds", async () => {
    db.profileAvatarAsset.findUnique.mockRejectedValueOnce(
      new Error("injected database detail"),
    );
    await unavailable(
      request(app.getHttpServer()).get(
        `/users/me/avatar-uploads/operations/${requestId}`,
      ),
    );
    const r = await request(app.getHttpServer())
      .get(`/users/me/avatar-uploads/operations/${requestId}`)
      .expect(200);
    expect(r.body).toMatchObject({ requestId, assetId, state: "STAGED" });
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.head).not.toHaveBeenCalled();
  });
  it("returns 503 for an ownership lookup outage instead of missing account", async () => {
    db.user.findFirst.mockRejectedValueOnce(
      new Error("injected database detail"),
    );
    await unavailable(
      request(app.getHttpServer()).get(
        `/users/me/avatar-uploads/${assetId}/content`,
      ),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });
  it("returns 503 for a private preview metadata outage before fetching bytes", async () => {
    db.profileAvatarAsset.findFirst.mockRejectedValueOnce(
      new Error("injected database detail"),
    );
    await unavailable(
      request(app.getHttpServer()).get(
        `/users/me/avatar-uploads/${assetId}/content`,
      ),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });
  it("suppresses already fetched preview bytes when the final ownership lookup fails", async () => {
    db.user.findFirst
      .mockResolvedValueOnce({ id: owner, avatarAssetId: assetId })
      .mockRejectedValueOnce(new Error("injected database detail"));
    await unavailable(
      request(app.getHttpServer()).get(
        `/users/me/avatar-uploads/${assetId}/content`,
      ),
    );
    expect(storage.get).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "returns 503 for public asset lookup failure afterFetch=%s",
    async (afterFetch) => {
      if (afterFetch)
        db.profileAvatarAsset.findFirst.mockResolvedValueOnce({
          ...asset,
          state: "ACTIVE",
        });
      db.profileAvatarAsset.findFirst.mockRejectedValueOnce(
        new Error("injected database detail"),
      );
      await unavailable(
        request(app.getHttpServer()).get(
          `/profiles/${owner}/avatar/${assetId}`,
        ),
      );
      expect(storage.get).toHaveBeenCalledTimes(afterFetch ? 1 : 0);
    },
  );
  it("keeps an authoritative missing owner as 404 without fetching bytes", async () => {
    db.user.findFirst.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get(`/users/me/avatar-uploads/${assetId}/content`)
      .expect(404);
    expect(storage.get).not.toHaveBeenCalled();
  });
});
