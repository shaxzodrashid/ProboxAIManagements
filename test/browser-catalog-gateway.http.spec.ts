import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { AuthService } from "../src/auth/auth.service";
import { BrowserSessionController } from "../src/browser-sessions/browser-session.controller";
import {
  browserCookieName,
  browserDigest,
  browserSessionConfig,
  encryptBrowserBundle,
} from "../src/browser-sessions/browser-session.config";
import {
  BROWSER_SESSION_CONFIG,
  BrowserSessionService,
} from "../src/browser-sessions/browser-session.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { backendReleaseVersion } from "../src/release-version";
import { ManagedModelController } from "../src/sessions/managed-model.controller";
import { ManagedModelService } from "../src/sessions/managed-model.service";

describe("browser catalog gateway contract", () => {
  const allowlistKey = "PROBOXAI_MODEL_CATALOG_ADMIN_IDS";
  const originalAllowlist = process.env[allowlistKey];
  const jwt = new JwtService({ secret: "isolated-browser-catalog-fixture" });
  const config = browserSessionConfig({
    BROWSER_SESSIONS_ENABLED: "true",
    BROWSER_SESSION_ORIGIN: "https://fixture.test",
    BROWSER_SESSION_KEY: randomBytes(32).toString("base64url"),
  });
  const user = {
    id: "catalog-operator",
    workspaceId: "catalog-workspace",
    status: "OPEN",
    fullName: "Catalog operator",
    roleAssignments: [
      { role: { permissions: [] as { permissionKey: string }[] } },
    ],
  };
  const cookieValue = randomBytes(32).toString("base64url");
  const cookie = `${browserCookieName(config)}=${cookieValue}`;
  const browserId = browserDigest(cookieValue);
  const list = jest.fn().mockResolvedValue([{ id: "fixture-model" }]);
  let app: INestApplication;
  let origin: string;

  beforeAll(async () => {
    const expiry = new Date(Date.now() + 600_000);
    const refreshToken = randomBytes(32).toString("base64url");
    const row = {
      id: browserId,
      userId: user.id,
      workspaceId: user.workspaceId,
      refreshId: "fixture-refresh",
      createdAt: new Date(),
      idleExpiresAt: expiry,
      absoluteExpiresAt: expiry,
      bundle: encryptBrowserBundle(config, browserId, {
        csrfToken: randomBytes(32).toString("base64url"),
        accessToken: jwt.sign(
          { id: user.id, type: "access" },
          { expiresIn: 600 },
        ),
        accessExpiresAt: expiry.getTime(),
        refreshToken,
      }),
    };
    const database = {
      $queryRaw: jest.fn(),
      browserSession: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn(),
      },
      sessionToken: {
        findUnique: jest.fn().mockResolvedValue({
          user,
          userId: user.id,
          purpose: "REFRESH",
          expiresAt: expiry,
          tokenHash: browserDigest(refreshToken),
        }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(user),
        findFirst: jest.fn().mockResolvedValue(user),
      },
    };
    const module = await Test.createTestingModule({
      controllers: [BrowserSessionController, ManagedModelController],
      providers: [
        BrowserSessionService,
        { provide: BROWSER_SESSION_CONFIG, useValue: config },
        { provide: AuthService, useValue: {} },
        { provide: JwtService, useValue: jwt },
        { provide: ManagedModelService, useValue: { list } },
        {
          provide: PrismaService,
          useValue: {
            ...database,
            $transaction: (run: (tx: typeof database) => unknown) =>
              run(database),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const openapi = new DocumentBuilder()
      .setVersion(backendReleaseVersion)
      .build();
    SwaggerModule.setup("api/v1/docs", app, () =>
      SwaggerModule.createDocument(app, openapi),
    );
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  });

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env[allowlistKey];
    else process.env[allowlistKey] = originalAllowlist;
    await app?.close();
  });

  it.each([
    [true, false, 403],
    [false, true, 403],
    [true, true, 200],
  ])(
    "keeps browser identity and catalog authorization aligned (%s, %s)",
    async (allowlisted, granted, status) => {
      process.env[allowlistKey] = allowlisted
        ? `another-user, ${user.id} `
        : "another-user";
      user.roleAssignments[0]!.role.permissions = granted
        ? [{ permissionKey: "settings.manage" }]
        : [];
      const browser = `${origin}/api/v1/browser`;
      const options = { headers: { Cookie: cookie } };
      const session = await fetch(`${browser}/session`, options);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        authenticated: true,
        canManageModelCatalog: status === 200,
      });
      list.mockClear();
      const models = await fetch(
        `${browser}/api/admin/model-catalog/providers/openai/models`,
        options,
      );
      expect(models.status).toBe(status);
      await models.json();
      if (status === 200) expect(list).toHaveBeenCalledWith("openai");
      else expect(list).not.toHaveBeenCalled();
    },
  );

  it("passes the deployment verifier against the running gateway", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      resolve("scripts/verify-browser-catalog-gateway.mjs"),
      origin,
      backendReleaseVersion,
    ]);
    expect(stdout).toContain("gateway verified");
  });
});
