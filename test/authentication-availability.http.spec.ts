import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService, JsonWebTokenError } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { AuthorizationController } from "../src/authorization/authorization.controller";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { PublicProfileController } from "../src/accounts/public-profile.controller";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";
const request = require("supertest");

describe("authentication availability HTTP contracts", () => {
  let app: INestApplication;
  const secret = "isolated-auth-classification-test-secret";
  const jwt = new JwtService({ secret });
  const prisma = {
    user: { findFirst: jest.fn() },
    sessionToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const privacy = { publicProfile: jest.fn() };
  const authorization = { listPermissions: jest.fn() };
  const refreshToken = "r".repeat(64);
  const user = {
    id: "caller",
    workspaceId: "current-workspace",
    status: "OPEN",
    roleAssignments: [],
  };
  const routes = ["/authorization/me", "/profiles/by-username/example"];
  const privateFailure =
    "postgresql://private:secret@hidden-host/private-db C:\\private\\key";
  const unavailable = {
    statusCode: 503,
    message: "Authentication is temporarily unavailable",
    error: "Service Unavailable",
  };
  const access = (payload = {}) =>
    jwt.sign(
      {
        id: user.id,
        workspaceId: "stale-workspace",
        type: "access",
        ...payload,
      },
      { expiresIn: 1800 },
    );
  const tokenRecord = () => ({
    purpose: "REFRESH",
    revokedAt: null,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user,
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthorizationController,
        PublicProfileController,
        AuthController,
      ],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: TelegramService, useValue: {} },
        { provide: AuthorizationService, useValue: authorization },
        { provide: ProfilePrivacyService, useValue: privacy },
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
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset().mockResolvedValue(user);
    prisma.sessionToken.findUnique.mockReset().mockResolvedValue(tokenRecord());
    privacy.publicProfile.mockResolvedValue({ id: "public-account" });
    authorization.listPermissions.mockResolvedValue([]);
  });
  const call = () => request(app.getHttpServer());
  it.each(routes)(
    "sanitizes persisted identity failure on %s without entering the handler",
    async (route) => {
      prisma.user.findFirst.mockRejectedValue(new Error(privateFailure));
      const response = await call()
        .get(route)
        .set("Authorization", `Bearer ${access()}`)
        .expect(503);
      expect(response.body).toEqual(unavailable);
      expect(privacy.publicProfile).not.toHaveBeenCalled();
    },
  );
  it.each(routes)(
    "sanitizes synchronous dependency failure on %s",
    async (route) => {
      prisma.user.findFirst.mockImplementation(() => {
        throw new Error(privateFailure);
      });
      expect(
        (
          await call()
            .get(route)
            .set("Authorization", `Bearer ${access()}`)
            .expect(503)
        ).body,
      ).toEqual(unavailable);
      expect(privacy.publicProfile).not.toHaveBeenCalled();
    },
  );
  it.each(routes)(
    "does not classify a database JWT-shaped error as a credential failure on %s",
    async (route) => {
      prisma.user.findFirst.mockRejectedValue(
        new JsonWebTokenError("invalid signature"),
      );
      expect(
        (
          await call()
            .get(route)
            .set("Authorization", `Bearer ${access()}`)
            .expect(503)
        ).body,
      ).toEqual(unavailable);
    },
  );
  it.each(routes)(
    "treats missing verifier key as unavailable on %s",
    async (route) => {
      jest
        .spyOn(jwt, "verify")
        .mockImplementation((token) => new JwtService().verify(token));
      expect(
        (
          await call()
            .get(route)
            .set("Authorization", `Bearer ${access()}`)
            .expect(503)
        ).body,
      ).toEqual(unavailable);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(privacy.publicProfile).not.toHaveBeenCalled();
    },
  );
  it.each(routes)(
    "sanitizes unexpected verifier failure on %s",
    async (route) => {
      jest.spyOn(jwt, "verify").mockImplementation(() => {
        throw new Error(privateFailure);
      });
      expect(
        (
          await call()
            .get(route)
            .set("Authorization", `Bearer ${access()}`)
            .expect(503)
        ).body,
      ).toEqual(unavailable);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(privacy.publicProfile).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed JSON credentials without treating unexpected verifier SyntaxError as rejection", async () => {
    const parts = access().split(".");
    for (const index of [0, 1]) {
      const malformed = [...parts];
      malformed[index] = Buffer.from("{broken").toString("base64url");
      for (const route of routes)
        await call()
          .get(route)
          .set("Authorization", `Bearer ${malformed.join(".")}`)
          .expect(401);
    }
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(privacy.publicProfile).not.toHaveBeenCalled();
    jest.spyOn(jwt, "verify").mockImplementation(() => {
      throw new SyntaxError(privateFailure);
    });
    for (const route of routes)
      expect(
        (
          await call()
            .get(route)
            .set("Authorization", `Bearer ${access()}`)
            .expect(503)
        ).body,
      ).toEqual(unavailable);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(privacy.publicProfile).not.toHaveBeenCalled();
  });
  it.each(["key-material", "provider", "options"])(
    "does not reject credentials for %s verifier configuration failures",
    async (kind) => {
      const message =
        kind === "key-material"
          ? "secretOrPublicKey is not valid key material"
          : kind === "provider"
            ? `error in secret or public key callback: ${privateFailure}`
            : "clockTimestamp must be a number";
      jest.spyOn(jwt, "verify").mockImplementation(() => {
        throw new JsonWebTokenError(message);
      });
      for (const route of routes)
        expect(
          (
            await call()
              .get(route)
              .set("Authorization", `Bearer ${access()}`)
              .expect(503)
          ).body,
        ).toEqual(unavailable);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(privacy.publicProfile).not.toHaveBeenCalled();
    },
  );
  it.each(["audience", "issuer", "subject", "jwtid", "nonce"])(
    "preserves configured %s claim rejection",
    async (claim) => {
      const verifier = new JwtService({
        secret,
        verifyOptions: { [claim]: "expected-test-claim" },
      });
      jest
        .spyOn(jwt, "verify")
        .mockImplementation((token) => verifier.verify(token));
      for (const route of routes)
        await call()
          .get(route)
          .set("Authorization", `Bearer ${access()}`)
          .expect(401);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each([
    "malformed",
    "signature",
    "expired",
    "not-before",
    "wrong-purpose",
    "missing-id",
  ])("rejects %s credentials before identity lookup", async (kind) => {
    const token =
      kind === "malformed"
        ? "not-a-jwt"
        : kind === "signature"
          ? new JwtService({ secret: "wrong-test-key" }).sign({
              id: user.id,
              type: "access",
            })
          : kind === "expired"
            ? jwt.sign({ id: user.id, type: "access" }, { expiresIn: -1 })
            : kind === "not-before"
              ? jwt.sign({ id: user.id, type: "access" }, { notBefore: 300 })
              : kind === "wrong-purpose"
                ? access({ type: "temporary" })
                : access({ id: null });
    for (const route of routes)
      await call()
        .get(route)
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(privacy.publicProfile).not.toHaveBeenCalled();
  });
  it("allows anonymous profile access only when authorization is absent", async () => {
    prisma.user.findFirst.mockRejectedValue(new Error(privateFailure));
    await call().get(routes[1]).expect(200);
    expect(privacy.publicProfile).toHaveBeenCalledWith(
      { username: "example" },
      undefined,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    privacy.publicProfile.mockClear();
    await call().get(routes[1]).set("Authorization", "").expect(401);
    await call()
      .get(routes[1])
      .set("Authorization", "Basic invalid")
      .expect(401);
    expect(privacy.publicProfile).not.toHaveBeenCalled();
  });
  it("keeps unavailable/non-OPEN identity rejection separate from dependency failure", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    for (const route of routes)
      await call()
        .get(route)
        .set("Authorization", `Bearer ${access()}`)
        .expect(401);
    expect(privacy.publicProfile).not.toHaveBeenCalled();
  });
  it("retains zero-grant self access and permission-gated 403", async () => {
    const response = await call()
      .get(routes[0])
      .set("Authorization", `Bearer ${access()}`)
      .expect(200);
    expect(response.body).toEqual({
      id: user.id,
      workspaceId: user.workspaceId,
      roles: [],
      permissions: [],
    });
    await call()
      .get("/authorization/permissions")
      .set("Authorization", `Bearer ${access()}`)
      .expect(403);
    expect(authorization.listPermissions).not.toHaveBeenCalled();
  });
  it.each(["rejected", "synchronous"])(
    "sanitizes %s refresh database failure without signing or mutating tokens",
    async (kind) => {
      if (kind === "rejected")
        prisma.sessionToken.findUnique.mockRejectedValue(
          new Error(privateFailure),
        );
      else
        prisma.sessionToken.findUnique.mockImplementation(() => {
          throw new Error(privateFailure);
        });
      const sign = jest.spyOn(jwt, "sign");
      expect(
        (await call().post("/auth/refresh").send({ refreshToken }).expect(503))
          .body,
      ).toEqual(unavailable);
      expect(sign).not.toHaveBeenCalled();
      expect(prisma.sessionToken.create).not.toHaveBeenCalled();
      expect(prisma.sessionToken.updateMany).not.toHaveBeenCalled();
    },
  );
  it("sanitizes refresh signing failure without revoking or rotating the refresh token", async () => {
    jest.spyOn(jwt, "sign").mockImplementation(() => {
      throw new Error(privateFailure);
    });
    expect(
      (await call().post("/auth/refresh").send({ refreshToken }).expect(503))
        .body,
    ).toEqual(unavailable);
    expect(prisma.sessionToken.create).not.toHaveBeenCalled();
    expect(prisma.sessionToken.updateMany).not.toHaveBeenCalled();
  });
  it.each(["missing", "purpose", "revoked", "consumed", "expired", "non-OPEN"])(
    "retains 401 for %s refresh records",
    async (kind) => {
      const record = tokenRecord();
      prisma.sessionToken.findUnique.mockResolvedValue(
        kind === "missing"
          ? null
          : {
              ...record,
              ...(kind === "purpose"
                ? { purpose: "REGISTRATION" }
                : kind === "revoked"
                  ? { revokedAt: new Date() }
                  : kind === "consumed"
                    ? { consumedAt: new Date() }
                    : kind === "expired"
                      ? { expiresAt: new Date(0) }
                      : { user: { ...user, status: "BANNED" } }),
            },
      );
      const sign = jest.spyOn(jwt, "sign");
      await call().post("/auth/refresh").send({ refreshToken }).expect(401);
      expect(sign).not.toHaveBeenCalled();
    },
  );
  it("retains refresh success, access lifetime and no rotation", async () => {
    const response = await call()
      .post("/auth/refresh")
      .send({ refreshToken })
      .expect(200);
    expect(Object.keys(response.body)).toEqual(["accessToken"]);
    const payload: any = jwt.verify(response.body.accessToken);
    expect(payload).toMatchObject({
      id: user.id,
      workspaceId: user.workspaceId,
      type: "access",
    });
    expect(payload.exp - payload.iat).toBe(1800);
    expect(prisma.sessionToken.create).not.toHaveBeenCalled();
    expect(prisma.sessionToken.updateMany).not.toHaveBeenCalled();
  });
  it("documents unavailable separately from credential and permission rejection", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const [route, method] of [
      ["/authorization/me", "get"],
      ["/profiles/by-username/{username}", "get"],
      ["/auth/refresh", "post"],
    ] as const) {
      const operation = (doc.paths[route] as any)[method];
      expect(operation.responses).toHaveProperty("401");
      expect(operation.responses["503"].description).toContain(
        "not a credential rejection",
      );
    }
  });
});
