import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { SessionsModule } from "../src/sessions/sessions.module";
import { PrismaModule } from "../src/prisma/prisma.module";
import { StorageModule } from "../src/storage/storage.module";
import { ManagedModelService } from "../src/sessions/managed-model.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { JwtAuthGuard } from "../src/auth/auth.guards";
const request = require("supertest");

const fixture = "postgresql://catalog_test@127.0.0.1:55487/catalog_test";
(process.env.CATALOG_TEST_DATABASE_URL === fixture ? describe : describe.skip)(
  "managed registry HTTP to PostgreSQL and CLI file",
  () => {
    const db = new PrismaService({ datasourceUrl: fixture });
    const url = "/admin/model-catalog/providers/anthropic/models";
    const id = "catalog-test-" + randomUUID();
    let app: INestApplication,
      file: string,
      directory: string,
      reader: ModelCatalogService,
      registry: ManagedModelService;
    const before = {
      path: process.env.CODEX_PROVIDER_CATALOG,
      admins: process.env.PROBOXAI_MODEL_CATALOG_ADMIN_IDS,
    };
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "probox-registry-"));
      file = join(directory, "provider-models.json");
      process.env.CODEX_PROVIDER_CATALOG = file;
      process.env.PROBOXAI_MODEL_CATALOG_ADMIN_IDS = "operator";
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ JWT_SECRET: "local-fixture-secret" })],
          }),
          PrismaModule,
          StorageModule,
          SessionsModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(ctx: any) {
            const req = ctx.switchToHttp().getRequest();
            req.user = {
              id: req.headers["x-actor"] ?? "operator",
              permissions: ["settings.manage", "sessions.create"],
            };
            return true;
          },
        })
        .compile();
      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
      registry = app.get(ManagedModelService);
      reader = app.get(ModelCatalogService);
    });
    afterAll(async () => {
      await db.managedModel.deleteMany({ where: { id } });
      await app?.close();
      await db.$disconnect();
      await rm(directory, { recursive: true, force: true });
      if (before.path === undefined) delete process.env.CODEX_PROVIDER_CATALOG;
      else process.env.CODEX_PROVIDER_CATALOG = before.path;
      if (before.admins === undefined)
        delete process.env.PROBOXAI_MODEL_CATALOG_ADMIN_IDS;
      else process.env.PROBOXAI_MODEL_CATALOG_ADMIN_IDS = before.admins;
    });
    it("publishes a new wire effort, fences operators, handles concurrent updates and repairs a failed export", async () => {
      const api = request(app.getHttpServer());
      const body = {
        id,
        displayName: "Catalog test",
        priority: -1,
        defaultReasoningEffort: "focused",
        supportedReasoningEfforts: ["focused"],
      };
      await api
        .post(url)
        .set("x-actor", "workspace-admin")
        .send(body)
        .expect(403);
      await api.post(url).send(body).expect(201);
      await api.post(url).send(body).expect(409);
      expect(reader.resolve("anthropic").effectiveModel).toBe(id);
      const picker = await api
        .get("/sessions/model-catalog")
        .query({ providerId: "anthropic" })
        .expect(200);
      expect(picker.body.providers[0]).toMatchObject({
        defaultModel: id,
        models: expect.arrayContaining([
          expect.objectContaining({ id, defaultReasoningEffort: "focused" }),
        ]),
      });
      expect(reader.resolve("anthropic", id).effectiveReasoningEffort).toBe(
        "focused",
      );
      const revision = (await api.get(url).expect(200)).body.find(
        (row: any) => row.id === id,
      ).revision;
      expect(revision).toMatch(/^[a-f0-9]{64}$/);
      await api
        .patch(url + "/" + id)
        .set("If-Match", '"' + revision + '"')
        .send({ displayName: "First revision" })
        .expect(200);
      await api
        .patch(url + "/" + id)
        .set("If-Match", '"' + revision + '"')
        .send({ displayName: "Stale edit" })
        .expect(409);
      const patch = (data: object) => api.patch(url + "/" + id).send(data);
      await patch({ supportedReasoningEfforts: ["Extended.v2"] }).expect(400);
      await patch({ isActive: null }).expect(400);
      await patch({ thinkingBudgets: { focused: 1 } }).expect(400);
      await Promise.all([
        patch({
          supportedReasoningEfforts: ["focused", "Extended.v2"],
          defaultReasoningEffort: "Extended.v2",
          thinkingBudgets: { focused: 2048, "Extended.v2": 8192 },
        }).expect(200),
        patch({ displayName: "Edited" }).expect(200),
      ]);
      const exported = (
        JSON.parse(await readFile(file, "utf8")).models as any[]
      ).find((m) => m.id === id);
      expect(exported).toMatchObject({
        displayName: "Edited",
        defaultReasoningEffort: "Extended.v2",
        thinkingBudgets: { focused: 2048, "Extended.v2": 8192 },
      });
      expect(reader.resolve("anthropic", id).effectiveReasoningEffort).toBe(
        "Extended.v2",
      );
      for (const [field, disabled, enabled] of [
        ["isAvailable", false, true],
        ["isActive", false, true],
        ["sunsetAt", "2000-01-01T00:00:00Z", null],
      ] as const) {
        await patch({ [field]: disabled }).expect(200);
        expect(() => reader.resolve("anthropic", id)).toThrow();
        await patch({ [field]: enabled }).expect(200);
        expect(reader.resolve("anthropic", id).effectiveModel).toBe(id);
      }
      const deadline = Date.now() + 60_000;
      await patch({ sunsetAt: new Date(deadline).toISOString() }).expect(200);
      const clock = jest.spyOn(Date, "now");
      try {
        clock.mockReturnValue(deadline - 1);
        const beforeSunset = reader.version;
        expect(reader.resolve("anthropic", id).effectiveModel).toBe(id);
        clock.mockReturnValue(deadline);
        expect(reader.version).not.toBe(beforeSunset);
        expect(() => reader.resolve("anthropic", id)).toThrow();
      } finally {
        clock.mockRestore();
      }
      await patch({ sunsetAt: null }).expect(200);
      // A directory in place of the file produces a real publication error, including on Windows.
      await rename(file, file + ".old");
      const { mkdir, rmdir } = await import("node:fs/promises");
      await mkdir(file);
      await patch({ isAvailable: false }).expect(503);
      expect(
        (await api.get(url).expect(200)).body.find((m: any) => m.id === id)
          .isAvailable,
      ).toBe(false);
      await rmdir(file);
      await registry.publish();
      expect(() => reader.resolve("anthropic", id)).toThrow();
    });
  },
);
