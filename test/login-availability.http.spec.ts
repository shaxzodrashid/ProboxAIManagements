import {
  BadRequestException,
  ConflictException,
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { scryptSync } from "node:crypto";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { loginDependency } from "../src/auth/authentication-failures";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";
const request = require("supertest");

const unavailableCodes = [
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1010",
  "P1011",
  "P1017",
  "P2024",
  "P2037",
];
const privateFailure =
  "postgresql://private:secret@hidden-db/database C:\\private\\credentials";
const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(privateFailure, {
    code,
    clientVersion: "6.19.3",
    meta: { private: privateFailure },
  });

describe("login dependency availability HTTP", () => {
  let app: INestApplication;
  let sign: jest.SpyInstance;
  const jwt = new JwtService({
    secret: "isolated-login-availability-signing-key",
  });
  const password = "Synthetic-Login-42!";
  const salt = Buffer.from("login-availability-test");
  const user = {
    id: "synthetic",
    workspaceId: "workspace",
    username: "synthetic.user",
    status: "OPEN",
    passwordHash: `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")}`,
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    sessionToken: { create: jest.fn() },
  };
  const body = { username: user.username, password };
  const unavailable = {
    statusCode: 503,
    message: "Authentication is temporarily unavailable",
    error: "Service Unavailable",
  };
  const login = () =>
    request(app.getHttpServer()).post("/auth/login").send(body);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: TelegramService, useValue: {} },
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
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.restoreAllMocks();
    prisma.user.findUnique.mockReset().mockResolvedValue(user);
    prisma.sessionToken.create
      .mockReset()
      .mockResolvedValue({ id: "saved-refresh" });
    sign = jest.spyOn(jwt, "sign");
  });
  it.each(unavailableCodes)(
    "sanitizes database availability %s at lookup and persistence without issuing credentials",
    async (code) => {
      for (const stage of ["lookup", "persistence"]) {
        const failure = known(code);
        if (stage === "lookup")
          prisma.user.findUnique.mockRejectedValueOnce(failure);
        else prisma.sessionToken.create.mockRejectedValueOnce(failure);
        const result = await login().expect(503);
        expect(result.body).toEqual(unavailable);
        expect(result.body).not.toHaveProperty("accessToken");
        expect(result.body).not.toHaveProperty("refreshToken");
        expect(JSON.stringify(result.body)).not.toContain("private");
        expect(sign).not.toHaveBeenCalled();
      }
      // Only the explicit persistence-stage call attempted a write; no retries.
      expect(prisma.sessionToken.create).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["initialization", "service", "synchronous"])(
    "sanitizes %s dependency failure at both login DB boundaries",
    async (kind) => {
      for (const stage of ["lookup", "persistence"]) {
        const operation =
          stage === "lookup"
            ? prisma.user.findUnique
            : prisma.sessionToken.create;
        const error =
          kind === "initialization"
            ? new Prisma.PrismaClientInitializationError(
                privateFailure,
                "6.19.3",
                "P1001",
              )
            : kind === "service"
              ? new ServiceUnavailableException(privateFailure)
              : known("P1017");
        if (kind === "synchronous")
          operation.mockImplementationOnce(() => {
            throw error;
          });
        else operation.mockRejectedValueOnce(error);
        expect((await login().expect(503)).body).toEqual(unavailable);
        expect(sign).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["missing", "closed", "unregistered", "wrong-password"])(
    "keeps %s credentials at 401 with no persistence or signing",
    async (kind) => {
      prisma.user.findUnique.mockResolvedValue(
        kind === "missing"
          ? null
          : kind === "closed"
            ? { ...user, status: "BANNED" }
            : kind === "unregistered"
              ? { ...user, passwordHash: null }
              : user,
      );
      const result = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          ...body,
          ...(kind === "wrong-password" ? { password: "incorrect" } : {}),
        })
        .expect(401);
      expect(result.body.message).toBe("Invalid username or password");
      expect(prisma.sessionToken.create).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    },
  );
  it("keeps validation errors outside the availability boundary", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: body.username, password: "", workspaceId: "other" })
      .expect(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
  it("preserves explicit business errors from either dependency boundary", async () => {
    for (const operation of [
      prisma.user.findUnique,
      prisma.sessionToken.create,
    ]) {
      operation.mockRejectedValueOnce(
        new ConflictException("Existing business conflict"),
      );
      expect((await login().expect(409)).body.message).toBe(
        "Existing business conflict",
      );
    }
    expect(sign).not.toHaveBeenCalled();
  });
  it.each(["P2002", "P2003", "P2025", "P2034"])(
    "does not label constraint/state error %s as retryable unavailability",
    async (code) => {
      for (const operation of [
        prisma.user.findUnique,
        prisma.sessionToken.create,
      ]) {
        operation.mockRejectedValueOnce(known(code));
        expect((await login().expect(500)).body.message).toBe(
          "Internal server error",
        );
      }
      expect(sign).not.toHaveBeenCalled();
    },
  );
  it("keeps unknown/programming and signing failures outside dependency classification", async () => {
    for (const operation of [
      prisma.user.findUnique,
      prisma.sessionToken.create,
    ]) {
      operation.mockRejectedValueOnce(new TypeError(privateFailure));
      expect((await login().expect(500)).body.message).toBe(
        "Internal server error",
      );
    }
    expect(sign).not.toHaveBeenCalled();
    sign.mockImplementationOnce(() => {
      throw new Error(privateFailure);
    });
    expect((await login().expect(500)).body.message).toBe(
      "Internal server error",
    );
    expect(prisma.sessionToken.create).toHaveBeenCalledTimes(2);
  });
  it("recovers with one later explicit login and preserves token lifetime/hash-only persistence", async () => {
    prisma.sessionToken.create.mockRejectedValueOnce(known("P2024"));
    await login().expect(503);
    expect(sign).not.toHaveBeenCalled();
    const result = await login().expect(200);
    const payload = jwt.verify(result.body.accessToken);
    expect(payload.exp - payload.iat).toBe(1800);
    expect(payload).toMatchObject({
      id: user.id,
      workspaceId: user.workspaceId,
      type: "access",
    });
    expect(result.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const saved = prisma.sessionToken.create.mock.calls.at(-1)![0].data;
    expect(saved).toMatchObject({
      userId: user.id,
      purpose: "REFRESH",
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(saved)).not.toContain(result.body.refreshToken);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(prisma.sessionToken.create).toHaveBeenCalledTimes(2);
  });
  it("documents the existing success/401/400 contracts plus sanitized 503", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const operation = doc.paths["/auth/login"]!.post!;
    for (const status of ["200", "400", "401", "503"])
      expect(operation.responses).toHaveProperty(status);
    expect(
      (operation.responses["503"] as any).content["application/json"].schema
        .$ref,
    ).toContain("ApiErrorResponseDto");
  });
});

describe("narrow login dependency error preservation", () => {
  it.each([
    new BadRequestException("Existing validation failure"),
    new ConflictException("Existing business conflict"),
    known("P2002"),
    known("P2034"),
    new Prisma.PrismaClientValidationError("query misuse", {
      clientVersion: "6.19.3",
    }),
    new Prisma.PrismaClientUnknownRequestError("unexpected query failure", {
      clientVersion: "6.19.3",
    }),
    new TypeError("programming failure"),
  ])("rethrows an unclassified error unchanged", async (error) => {
    await expect(loginDependency(() => Promise.reject(error))).rejects.toBe(
      error,
    );
  });
});
