import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { HealthController } from "../src/health.controller";
import { PrismaService } from "../src/prisma/prisma.service";
import { TemplateStorageService } from "../src/configuration-templates/template-storage.service";
const request = require("supertest");

describe("public health readiness contract", () => {
  let app: INestApplication;
  const database = { $queryRaw: jest.fn() },
    storage = { ready: jest.fn() };
  const unavailable = {
    status: "unavailable",
    service: "proboxai",
    message: "Required persistent dependencies are unavailable",
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: database },
        { provide: TemplateStorageService, useValue: storage },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });
  beforeEach(() => {
    database.$queryRaw.mockReset().mockResolvedValue([{ value: 1 }]);
    storage.ready.mockReset().mockResolvedValue(true);
  });
  afterAll(async () => {
    await app.close();
  });
  it("keeps liveness independent of database and storage", async () => {
    const r = await request(app.getHttpServer()).get("/health").expect(200);
    expect(r.body).toEqual({ status: "ok", service: "proboxai" });
    expect(database.$queryRaw).not.toHaveBeenCalled();
    expect(storage.ready).not.toHaveBeenCalled();
  });
  it("keeps successful readiness shape and existing dependency checks", async () => {
    const r = await request(app.getHttpServer())
      .get("/health/ready")
      .expect(200);
    expect(r.body).toEqual({
      status: "ok",
      service: "proboxai",
      dependencies: { postgres: "ok", minio: "ok" },
    });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    expect(storage.ready).toHaveBeenCalledTimes(1);
    expect(database.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      storage.ready.mock.invocationCallOrder[0]!,
    );
  });
  it("sanitizes database connection details and does not continue to storage", async () => {
    database.$queryRaw.mockRejectedValueOnce(
      new Error("postgresql://test-user:test-password@private-database/db"),
    );
    const r = await request(app.getHttpServer())
      .get("/health/ready")
      .expect(503);
    expect(r.body).toEqual(unavailable);
    expect(JSON.stringify(r.body)).not.toMatch(
      /test-password|private-database|postgresql/,
    );
    expect(storage.ready).not.toHaveBeenCalled();
  });
  it.each([
    new Error("test-secret in private bucket path"),
    "test-secret in private endpoint",
    {
      toString() {
        throw new Error("unsafe exception conversion");
      },
    },
  ])(
    "sanitizes storage rejection %# without serializing exception data",
    async (error) => {
      storage.ready.mockRejectedValueOnce(error);
      const r = await request(app.getHttpServer())
        .get("/health/ready")
        .expect(503);
      expect(r.body).toEqual(unavailable);
      expect(JSON.stringify(r.body)).not.toMatch(/test-secret|private|unsafe/);
    },
  );
  it("rereads dependency readiness after failure instead of caching a result", async () => {
    storage.ready.mockRejectedValueOnce(new Error("test-only error"));
    await request(app.getHttpServer()).get("/health/ready").expect(503);
    await request(app.getHttpServer()).get("/health/ready").expect(200);
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
    expect(storage.ready).toHaveBeenCalledTimes(2);
  });
  it("documents exact success and unavailable envelopes", () => {
    const spec: any = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const responses = spec.paths["/health/ready"].get.responses;
    expect(responses[200].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ReadyResponseDto",
    );
    expect(responses[503].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ReadyUnavailableResponseDto",
    );
    expect(spec.components.schemas.ReadyResponseDto.required).toEqual(
      expect.arrayContaining(["status", "service", "dependencies"]),
    );
    expect(
      spec.components.schemas.ReadyUnavailableResponseDto.required,
    ).toEqual(["status", "service", "message"]);
    expect(spec.paths["/health/ready"].get.description).toContain("template");
  });
});
