import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectInitializationsController } from "../src/projects/project-initializations.controller";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { SessionsController } from "../src/sessions/sessions.controller";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";
const request = require("supertest");

describe("protected project error contracts", () => {
  let app: INestApplication, spec: any;
  const jwt = new JwtService({ secret: "isolated-project-error-test-secret" });
  const prisma = { user: { findFirst: jest.fn() } };
  const projects = Object.fromEntries(
    [
      "listProtectedFileTypes",
      "addProtectedFileType",
      "updateProtectedFileType",
      "removeProtectedFileType",
      "listFileOperations",
      "fileOperation",
      "reconcileFileOperation",
      "downloadFile",
    ].map((name) => [name, jest.fn()]),
  );
  const initializations = {
    list: jest.fn(),
    get: jest.fn(),
    retry: jest.fn(),
    stream: jest.fn(),
  };
  const sessions = { stream: jest.fn() };
  const routes: [string, string][] = [
    ["get", "/projects/{projectId}/initializations"],
    ["get", "/projects/{projectId}/initializations/{initializationId}"],
    ["post", "/projects/{projectId}/initializations/retry"],
    ["get", "/projects/{id}/protected-file-types"],
    ["post", "/projects/{id}/protected-file-types"],
    ["put", "/projects/{id}/protected-file-types/{typeId}"],
    ["delete", "/projects/{id}/protected-file-types/{typeId}"],
    ["get", "/projects/{id}/file-operations"],
    ["get", "/projects/{id}/file-operations/{operationId}"],
    ["post", "/projects/{id}/file-operations/{operationId}/reconcile"],
    ["get", "/projects/{id}/files/download"],
    [
      "get",
      "/projects/{projectId}/initializations/{initializationId}/events/stream",
    ],
    ["get", "/sessions/{id}/events/stream"],
  ];
  const token = () =>
    jwt.sign(
      // Stale token claims never supply current resource authority.
      { id: "caller", type: "access", permissions: ["projects.files.delete"] },
      { expiresIn: 1800 },
    );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ProjectsController,
        ProjectInitializationsController,
        SessionsController,
      ],
      providers: [
        { provide: JwtService, useValue: jwt },
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projects },
        { provide: ProjectInitializationService, useValue: initializations },
        { provide: SessionsService, useValue: sessions },
        { provide: SessionEventsService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ type: "http", scheme: "bearer" }, "access-token")
        .build(),
    );
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());
  const handlersNotCalled = () => {
    for (const handler of [
      ...Object.values(projects),
      ...Object.values(initializations),
      ...Object.values(sessions),
    ])
      expect(handler).not.toHaveBeenCalled();
  };
  async function expectFailures(status: number, bearer?: string) {
    for (const [method, path] of routes) {
      const call = request(app.getHttpServer())[method](
        path.replace(/\{[^}]+\}/g, "6a706bac-dd23-4b69-95ec-299923438205"),
      );
      if (bearer) call.set("Authorization", `Bearer ${bearer}`);
      const response = await call.expect(status);
      expect(response.headers["content-type"]).toContain("application/json");
      const schema =
        spec.paths[path][method].responses[status].content["application/json"]
          .schema;
      expect(schema.$ref).toBe("#/components/schemas/ApiErrorResponseDto");
      const documented = spec.components.schemas.ApiErrorResponseDto;
      for (const key of documented.required)
        expect(response.body).toHaveProperty(key);
      expect(response.body.statusCode).toBe(status);
      expect(typeof response.body.message).toBe("string");
      expect(typeof response.body.error).toBe("string");
      if (status === 503)
        expect(response.body).toEqual({
          statusCode: 503,
          message: "Authentication is temporarily unavailable",
          error: "Service Unavailable",
        });
    }
    handlersNotCalled();
  }
  it("documents all missing access, resource, invalid-input and unexpected failure envelopes", () => {
    for (const [method, path] of routes)
      for (const status of [400, 401, 403, 404, 409, 500, 503])
        expect(
          spec.paths[path][method].responses[status].content["application/json"]
            .schema.$ref,
        ).toBe("#/components/schemas/ApiErrorResponseDto");
  });
  it("returns documented 401 before querying identities or running handlers", async () => {
    await expectFailures(401);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
  it("documents stream/binary success independently from JSON errors and leaves domain codes open", () => {
    for (const [path, media] of [
      ["/projects/{id}/files/download", "application/octet-stream"],
      [
        "/projects/{projectId}/initializations/{initializationId}/events/stream",
        "text/event-stream",
      ],
      ["/sessions/{id}/events/stream", "text/event-stream"],
    ] as const) {
      expect(Object.keys(spec.paths[path].get.responses[200].content)).toEqual([
        media,
      ]);
    }
    expect(
      spec.components.schemas.ApiErrorResponseDto.properties.code,
    ).toMatchObject({ type: "string" });
    expect(
      spec.components.schemas.ApiErrorResponseDto.properties.code.enum,
    ).toBeUndefined();
  });
  it("uses persisted grants rather than token permission claims for documented 403", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "caller",
      workspaceId: "workspace",
      roleAssignments: [],
    });
    await expectFailures(403, token());
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(routes.length);
  });
  it("returns sanitized documented 503 on authentication dependency failure without running handlers", async () => {
    prisma.user.findFirst.mockRejectedValue(
      new Error("private connection details"),
    );
    await expectFailures(503, token());
    for (const [method, path] of routes) {
      expect(spec.paths[path][method].responses[503].description).toContain(
        "preserve signed-in context",
      );
    }
  });
});
