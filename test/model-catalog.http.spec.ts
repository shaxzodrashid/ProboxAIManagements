import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { SessionsController } from "../src/sessions/sessions.controller";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";
import {
  ModelCatalogService,
  REASONING_EFFORTS,
} from "../src/sessions/model-catalog.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest");

describe("managed model catalog HTTP/schema", () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: "isolated-model-catalog-test-secret" });
  const catalog = new ModelCatalogService();
  const actual = new SessionsService(
    {} as PrismaService,
    {} as ProboxAiRunner,
    {} as SessionEventsService,
    catalog,
  );
  // Register only the bound reader, never runner/recovery lifecycle hooks.
  const sessions = {
    listModelCatalog: jest.fn(actual.listModelCatalog.bind(actual)),
  };
  const database = { user: { findFirst: jest.fn() } };
  const token = jwt.sign(
    { id: "catalog-reader", type: "access" },
    { expiresIn: 3600 },
  );
  const get = (query: object = {}) =>
    request(app.getHttpServer())
      .get("/sessions/model-catalog")
      .set("Authorization", "Bearer " + token)
      .query(query);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: sessions },
        { provide: SessionEventsService, useValue: {} },
        { provide: PrismaService, useValue: database },
        { provide: JwtService, useValue: jwt },
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
    sessions.listModelCatalog.mockClear();
    database.user.findFirst.mockReset().mockResolvedValue({
      id: "catalog-reader",
      workspaceId: "current-workspace",
      roleAssignments: [
        {
          role: {
            id: "role",
            key: "MEMBER",
            name: "Member",
            permissions: [{ permissionKey: "sessions.create" }],
          },
        },
      ],
    });
  });
  afterAll(async () => {
    await app.close();
  });
  it("returns the actual managed catalog and model-specific defaults without starting a runner", async () => {
    const r = await get().expect(200);
    expect(r.body).toEqual(
      JSON.parse(JSON.stringify(actual.listModelCatalog())),
    );
    for (const provider of r.body.providers) {
      expect(Object.keys(provider).sort()).toEqual([
        "defaultModel",
        "displayName",
        "id",
        "models",
      ]);
      expect(
        provider.models.some((m: any) => m.id === provider.defaultModel),
      ).toBe(true);
      for (const model of provider.models) {
        expect(Object.keys(model).sort()).toEqual([
          "defaultReasoningEffort",
          "displayName",
          "id",
          "supportedReasoningEfforts",
        ]);
        expect(model.supportedReasoningEfforts).toContain(
          model.defaultReasoningEffort,
        );
      }
    }
  });
  it("keeps filtering to one configured provider and rejects unknown providers", async () => {
    const r = await get({ providerId: "anthropic" }).expect(200);
    expect(r.body.providers).toEqual(
      JSON.parse(JSON.stringify(catalog.list("anthropic"))),
    );
    await get({ providerId: "not-configured" }).expect(400);
  });
  it("retains authentication and sessions.create gates", async () => {
    await request(app.getHttpServer())
      .get("/sessions/model-catalog")
      .expect(401);
    database.user.findFirst.mockResolvedValueOnce({
      id: "catalog-reader",
      workspaceId: "current-workspace",
      roleAssignments: [],
    });
    await get().expect(403);
    expect(sessions.listModelCatalog).not.toHaveBeenCalled();
  });
  it("keeps identity outages distinct from missing permission or empty catalog", async () => {
    database.user.findFirst.mockRejectedValueOnce(
      new Error("test-only database details"),
    );
    const r = await get().expect(503);
    expect(JSON.stringify(r.body)).not.toContain("test-only database details");
    expect(sessions.listModelCatalog).not.toHaveBeenCalled();
  });
  it("rejects unsupported query selectors instead of using them as identity", async () => {
    await get({ accountId: "another-user" }).expect(400);
    await get({ providerId: ["openai", "anthropic"] }).expect(400);
  });
  it("publishes complete nested response schemas and effort vocabulary", () => {
    const spec: any = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(
      spec.paths["/sessions/model-catalog"].get.responses[200].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/ModelCatalogResponseDto");
    const schemas = spec.components.schemas;
    expect(schemas.ModelCatalogResponseDto.required).toEqual([
      "version",
      "providers",
    ]);
    expect(schemas.ModelProviderResponseDto.required).toEqual([
      "id",
      "displayName",
      "defaultModel",
      "models",
    ]);
    expect(
      schemas.SupportedModelResponseDto.properties.supportedReasoningEfforts
        .items.enum,
    ).toEqual([...REASONING_EFFORTS]);
    expect(schemas.SupportedModelResponseDto.required).toEqual([
      "id",
      "displayName",
      "defaultReasoningEffort",
      "supportedReasoningEfforts",
    ]);
  });
});
