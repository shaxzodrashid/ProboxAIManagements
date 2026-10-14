import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService, TokenExpiredError } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
const request = require("supertest");
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";

describe("self profile HTTP contract", () => {
  let app: INestApplication;
  let row: any;
  const prisma: any = { user: {} };
  const authorization = { resolveRoleIds: jest.fn().mockResolvedValue([]) };
  beforeAll(async () => {
    prisma.$transaction = (callback: any) => callback(prisma);
    prisma.user.findFirst = jest.fn(async ({ where, select }: any) => {
      if (
        where.id !== row.id ||
        (where.workspaceId && where.workspaceId !== row.workspaceId) ||
        where.status !== row.status
      )
        return null;
      if (select.roleAssignments)
        return {
          id: row.id,
          workspaceId: row.workspaceId,
          roleAssignments: [],
        };
      return row;
    });
    prisma.user.updateMany = jest.fn(async ({ data, where }: any) => {
      if (where.workspaceId !== row.workspaceId) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    });
    const module = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        AccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthorizationService, useValue: authorization },
        {
          provide: JwtService,
          useValue: {
            verify: () => ({
              id: "self",
              workspaceId: "stale-workspace",
              type: "access",
            }),
          },
        },
        { provide: TelegramService, useValue: {} },
        { provide: TelegramBotService, useValue: {} },
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
  beforeEach(() => {
    row = {
      id: "self",
      workspaceId: "current-workspace",
      status: "OPEN",
      fullName: "Legacy Multi Word Name",
      firstName: null,
      lastName: null,
      username: "self",
      phoneNumber: "+998901234567",
      bio: null,
      birthDate: null,
      passwordHash: "secret",
      telegramUserId: 123n,
    };
    prisma.user.updateMany.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  const call = () => request(app.getHttpServer());
  it.each([
    [false, false, false, "NOT_LINKED"],
    [true, true, true, "LINKED"],
    [true, false, false, "INCOMPLETE"],
    [false, true, false, "INCOMPLETE"],
    [false, false, true, "INCOMPLETE"],
    [true, true, false, "INCOMPLETE"],
    [true, false, true, "INCOMPLETE"],
    [false, true, true, "INCOMPLETE"],
  ])(
    "projects stored Telegram record %s/%s/%s without private identifiers",
    async (user, chat, verified, linkState) => {
      row.telegramUserId = user ? 123456789123456789n : null;
      row.telegramChatId = chat ? 987654321987654321n : null;
      row.verifiedAt = verified ? new Date("2026-10-12T00:00:00Z") : null;
      const response = await call()
        .get("/users/me/telegram-link")
        .set("Authorization", "Bearer token")
        .expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({ linkState });
      expect(prisma.user.findFirst.mock.calls.at(-1)[0]).toEqual({
        where: { id: row.id, workspaceId: row.workspaceId, status: "OPEN" },
        select: {
          telegramUserId: true,
          telegramChatId: true,
          verifiedAt: true,
        },
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    },
  );
  it("rejects link selectors and exposes no link mutations or external calls", async () => {
    for (const query of [
      "?userId=other",
      "?workspaceId=foreign",
      "?phoneNumber=x",
      "?force=true",
    ])
      await call()
        .get("/users/me/telegram-link" + query)
        .set("Authorization", "Bearer token")
        .expect(400);
    await call().get("/users/me/telegram-link").expect(401);
    for (const method of ["post", "patch", "delete"])
      await call()
        [method]("/users/me/telegram-link")
        .set("Authorization", "Bearer token")
        .send({ telegramChatId: "other" })
        .expect(404);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it("repeated and concurrent Telegram status reads are side-effect-free", async () => {
    row.telegramUserId = 123n;
    row.telegramChatId = 123n;
    row.verifiedAt = new Date();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        call()
          .get("/users/me/telegram-link")
          .set("Authorization", "Bearer token")
          .expect(200),
      ),
    );
    expect(responses.map((r) => r.body)).toEqual(
      Array.from({ length: 8 }, () => ({ linkState: "LINKED" })),
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it.each(["workspace", "status"])(
    "fails closed when %s changes after authentication",
    async (change) => {
      const original = prisma.user.findFirst.getMockImplementation();
      prisma.user.findFirst.mockImplementationOnce(async (args: any) => {
        const authenticated = await original(args);
        if (change === "workspace") row.workspaceId = "other-workspace";
        else row.status = "BANNED";
        return authenticated;
      });
      await call()
        .get("/users/me/telegram-link")
        .set("Authorization", "Bearer token")
        .expect(404);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    },
  );
  it("rejects expired authentication and does not disclose database failure details", async () => {
    const jwt = app.get(JwtService);
    const verify = jest.spyOn(jwt, "verify").mockImplementationOnce(() => {
      throw new TokenExpiredError("jwt expired", new Date(0));
    });
    try {
      await call()
        .get("/users/me/telegram-link")
        .set("Authorization", "Bearer expired")
        .expect(401);
    } finally {
      verify.mockRestore();
    }
    const original = prisma.user.findFirst.getMockImplementation();
    prisma.user.findFirst
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error("private database credentials"));
    const failed = await call()
      .get("/users/me/telegram-link")
      .set("Authorization", "Bearer token")
      .expect(500);
    expect(failed.body).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
    expect(JSON.stringify(failed.body)).not.toContain("credentials");
  });
  it("reads legacy identity with zero permissions using persisted workspace and excludes secrets", async () => {
    const response = await call()
      .get("/users/me")
      .set("Authorization", "Bearer token")
      .expect(200);
    expect(response.body).toEqual({
      id: "self",
      workspaceId: "current-workspace",
      displayName: "Legacy Multi Word Name",
      firstName: null,
      lastName: null,
      username: "self",
      phoneNumber: "+998901234567",
      bio: null,
      birthDate: null,
    });
  });
  it("round-trips multiword names, supports one name and clears bio explicitly", async () => {
    const response = await call()
      .patch("/users/me")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "  Mary Jane  ",
        lastName: "de la Cruz",
        bio: "Hello",
      })
      .expect(200);
    expect(response.body.displayName).toBe("Mary Jane de la Cruz");
    expect(row.fullName).toBe("Mary Jane de la Cruz");
    await call()
      .patch("/users/me")
      .set("Authorization", "Bearer token")
      .send({ firstName: null, bio: null })
      .expect(200);
    expect(row.lastName).toBe("de la Cruz");
    expect(row.bio).toBeNull();
    await call()
      .get("/users/me")
      .set("Authorization", "Bearer token")
      .expect(200)
      .expect(({ body }: any) => expect(body.displayName).toBe("de la Cruz"));
  });
  it.each([
    "roles",
    "roleIds",
    "permissions",
    "status",
    "workspaceId",
    "id",
    "username",
    "phoneNumber",
    "fullName",
    "avatar",
  ])("rejects non-allowlisted %s", async (key) => {
    await call()
      .patch("/users/me")
      .set("Authorization", "Bearer token")
      .send({ [key]: "injected" })
      .expect(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { firstName: " " },
    { lastName: 42 },
    { firstName: "x".repeat(121) },
    { bio: "x".repeat(1001) },
    { firstName: null, lastName: null },
  ])("rejects invalid or empty name mutation %j", async (body) => {
    await call()
      .patch("/users/me")
      .set("Authorization", "Bearer token")
      .send(body)
      .expect(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it("preserves legacy display on bio-only and empty PATCH", async () => {
    await call()
      .patch("/users/me")
      .set("Authorization", "Bearer token")
      .send({ bio: "" })
      .expect(200);
    await call()
      .patch("/users/me")
      .set("Authorization", "Bearer token")
      .send({})
      .expect(200);
    expect(row.fullName).toBe("Legacy Multi Word Name");
    expect(row.firstName).toBeNull();
  });
  it.each(["PENDING", "BANNED", "DELETED"])(
    "rejects %s lifecycle with a previously issued token",
    async (status) => {
      row.status = status;
      await call()
        .get("/users/me")
        .set("Authorization", "Bearer token")
        .expect(401);
      await call()
        .get("/users/me/telegram-link")
        .set("Authorization", "Bearer token")
        .expect(401);
      await call()
        .patch("/users/me")
        .set("Authorization", "Bearer token")
        .send({ bio: "x" })
        .expect(401);
    },
  );
  it("requires authentication and preserves administrative permission gates", async () => {
    await call().get("/users/me").expect(401);
    await call().patch("/users/me").send({ bio: "x" }).expect(401);
    await call().get("/users").set("Authorization", "Bearer token").expect(403);
    await call()
      .post("/users")
      .set("Authorization", "Bearer token")
      .send({ firstName: "Ada", phoneNumber: "+998901234567" })
      .expect(403);
  });
  it("publishes explicit OpenAPI read and patch contracts", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ type: "http", scheme: "bearer" }, "access-token")
        .build(),
    );
    expect(doc.paths["/users/me"]?.get?.responses["200"]).toBeDefined();
    expect(doc.paths["/users/me"]?.patch?.responses["409"]).toBeDefined();
    const schemas = doc.components!.schemas!;
    expect(
      doc.paths["/users/me/telegram-link"]?.get?.responses["200"],
    ).toBeDefined();
    expect(schemas.SelfTelegramLinkResponseDto).toHaveProperty(
      "properties.linkState.enum",
      ["NOT_LINKED", "LINKED", "INCOMPLETE"],
    );
    expect((schemas.SelfTelegramLinkResponseDto as any).required).toEqual([
      "linkState",
    ]);
    expect(schemas.SelfProfileResponseDto).toHaveProperty(
      "properties.firstName.nullable",
      true,
    );
    expect(schemas.UpdateSelfProfileDto).not.toHaveProperty(
      "properties.status",
    );
  });
});
