import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  PrismaClient,
  ProjectInitializationStatus,
  ProjectInitializationStepStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectInitializationsController } from "../src/projects/project-initializations.controller";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { ProjectInitializationEventsService } from "../src/projects/project-initialization-events.service";
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest"),
  url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test");
}

(url ? describe : describe.skip)(
  "persisted initialization/extension and empty-webhook contracts",
  () => {
    let app: INestApplication,
      db: PrismaClient,
      initializations: ProjectInitializationService,
      spec: any;
    let w: string,
      fw: string,
      owner: string,
      member: string,
      reader: string,
      outsider: string,
      foreign: string,
      manageOnly: string,
      department: string,
      template: string,
      version: string,
      project: string;
    const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET,
      secret = "isolated-contract-webhook-secret";
    const bot = { handle: jest.fn() },
      telegram = { requestContact: jest.fn(), sendText: jest.fn() },
      accounts = { verifyTelegramContact: jest.fn() };
    const http = () => request(app.getHttpServer());
    const get = (path: string, id = owner) =>
      http()
        .get(path)
        .set("Authorization", "Bearer " + id);
    const initBase = () => `/projects/${project}/initializations`,
      extensionBase = () => `/projects/${project}/protected-file-types`;
    const act = (method: string, path: string, id = owner, body: object = {}) =>
      http()
        [method](path)
        .set("Authorization", "Bearer " + id)
        .send(body);
    function assertSchema(value: any, schema: any) {
      if (schema.$ref)
        return assertSchema(
          value,
          schema.$ref
            .slice(2)
            .split("/")
            .reduce((o: any, k: string) => o[k], spec),
        );
      if (value === null) {
        expect(schema.nullable).toBe(true);
        return;
      }
      if (schema.enum) expect(schema.enum).toContain(value);
      if (schema.type === "array") {
        expect(Array.isArray(value)).toBe(true);
        for (const item of value) assertSchema(item, schema.items);
        return;
      }
      if (schema.type === "object" || schema.properties) {
        for (const key of schema.required ?? [])
          expect(value).toHaveProperty(key);
        expect(Object.keys(value).sort()).toEqual(
          Object.keys(schema.properties).sort(),
        );
        for (const [key, child] of Object.entries(schema.properties))
          assertSchema(value[key], child);
        return;
      }
      if (schema.type === "string") {
        expect(typeof value).toBe("string");
        if (schema.format === "date-time")
          expect(new Date(value).toISOString()).toBe(value);
      }
      if (schema.type === "boolean") expect(typeof value).toBe("boolean");
      if (schema.type === "number" || schema.type === "integer")
        expect(typeof value).toBe("number");
    }
    const schema = (path: string, method = "get", status = 200) =>
      spec.paths[path][method].responses[status].content["application/json"]
        .schema;
    const createAttempt = (
      status: ProjectInitializationStatus = "QUEUED",
      attempt = 1,
    ) =>
      db.projectInitialization.create({
        data: {
          projectId: project,
          templateVersionId: version,
          attempt,
          status,
        },
      });
    beforeAll(async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = secret;
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      fw = (await db.workspace.create({ data: { slug: randomUUID() } })).id;
      const keys = [
        "projects.files.delete",
        "projects.initializations.read",
        "projects.initializations.manage",
      ];
      await db.permission.createMany({
        data: keys.map((key) => ({
          key,
          name: key,
          description: key,
          category: "test",
        })),
        skipDuplicates: true,
      });
      const user = async (workspaceId: string, grants: string[]) => {
        const role = await db.role.create({
          data: {
            workspaceId,
            key: randomUUID(),
            name: "ADMIN",
            permissions: {
              create: grants.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        return (
          await db.user.create({
            data: {
              workspaceId,
              phoneNumber: randomUUID(),
              fullName: "Fixture",
              status: "OPEN",
              roleAssignments: { create: { roleId: role.id } },
            },
          })
        ).id;
      };
      owner = await user(w, keys);
      member = await user(w, keys);
      outsider = await user(w, keys);
      reader = await user(w, ["projects.initializations.read"]);
      manageOnly = await user(w, ["projects.initializations.manage"]);
      foreign = await user(fw, keys);
      department = (
        await db.department.create({
          data: {
            workspaceId: w,
            name: "Contracts",
            slug: randomUUID(),
            homePath: "/opt/contract-fixture",
          },
        })
      ).id;
      template = (
        await db.configurationTemplate.create({
          data: {
            workspaceId: w,
            departmentId: department,
            name: "Pinned",
            slug: randomUUID(),
            creatorId: owner,
          },
        })
      ).id;
      version = (
        await db.configurationTemplateVersion.create({
          data: {
            templateId: template,
            version: 1,
            status: "PUBLISHED",
            creatorId: owner,
          },
        })
      ).id;
      project = (
        await db.project.create({
          data: {
            workspaceId: w,
            departmentId: department,
            creatorId: owner,
            name: "Contracts",
            directoryName: randomUUID(),
            appliedTemplateVersionId: version,
            members: {
              create: [owner, member, reader, manageOnly].map((userId) => ({
                userId,
              })),
            },
          },
        })
      ).id;
      initializations = new ProjectInitializationService(
        db as any,
        {} as any,
        new WorkspacePathPolicy(),
        new ProjectInitializationEventsService(),
      );
      initializations.onModuleInit = async () => undefined;
      jest.spyOn(initializations as any, "tick").mockResolvedValue(undefined);
      const projects = new ProjectsService(
        db as any,
        {} as any,
        new WorkspacePathPolicy(),
        initializations,
      );
      projects.onModuleInit = () => undefined;
      const module = await Test.createTestingModule({
        controllers: [
          ProjectsController,
          ProjectInitializationsController,
          AccountsController,
        ],
        providers: [
          { provide: ProjectsService, useValue: projects },
          { provide: ProjectInitializationService, useValue: initializations },
          { provide: PrismaService, useValue: db },
          { provide: AccountsService, useValue: accounts },
          { provide: TelegramService, useValue: telegram },
          { provide: TelegramBotService, useValue: bot },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                type: "access",
                exp: Math.floor(Date.now() / 1000) + 3600,
              }),
            },
          },
        ],
      }).compile();
      app = module.createNestApplication({ logger: false });
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
      spec = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    });
    beforeEach(async () => {
      bot.handle.mockReset().mockResolvedValue(false);
      telegram.requestContact.mockReset().mockResolvedValue(undefined);
      telegram.sendText.mockReset().mockResolvedValue(undefined);
      accounts.verifyTelegramContact.mockReset().mockResolvedValue(false);
      await db.projectInitialization.deleteMany({
        where: { projectId: project },
      });
      await db.projectProtectedFileType.deleteMany({
        where: { projectId: project },
      });
      await db.project.update({
        where: { id: project },
        data: { status: "READY", archivedAt: null, readAccessEnabled: false },
      });
    });
    afterAll(async () => {
      await app?.close();
      jest.restoreAllMocks();
      if (oldSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
      else process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
      if (db) {
        await db.project.deleteMany({ where: { workspaceId: w } });
        await db.configurationTemplate.deleteMany({
          where: { workspaceId: w },
        });
        await db.department.deleteMany({ where: { id: department } });
        await db.user.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.role.deleteMany({ where: { workspaceId: { in: [w, fw] } } });
        await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
        await db.$disconnect();
      }
    });
    it("matches list/detail schemas for all persisted statuses, nullable metadata and ordered steps", async () => {
      let detailId = "";
      for (const [i, status] of Object.values(
        ProjectInitializationStatus,
      ).entries()) {
        const job = await createAttempt(status, i + 1);
        detailId = job.id;
        for (const [j, stepStatus] of Object.values(
          ProjectInitializationStepStatus,
        ).entries())
          await db.projectInitializationStep.create({
            data: {
              initializationId: job.id,
              key: "step-" + j,
              kind: "fixture",
              position: 4 - j,
              status: stepStatus,
              stdout: j === 0 ? "bounded output" : null,
              stderr: j === 1 ? "warning" : null,
              exitCode: j === 2 ? 0 : null,
              outputTruncated: j === 3,
            },
          });
      }
      const list = (await get(initBase()).expect(200)).body;
      assertSchema(list, schema("/projects/{projectId}/initializations"));
      expect(list.map((x: any) => x.attempt)).toEqual([5, 4, 3, 2, 1]);
      expect(list[0].steps.map((s: any) => s.position)).toEqual([
        0, 1, 2, 3, 4,
      ]);
      const detail = (await get(initBase() + "/" + detailId).expect(200)).body;
      assertSchema(
        detail,
        schema("/projects/{projectId}/initializations/{initializationId}"),
      );
      expect(detail).toEqual(list[0]);
    });
    it("returns only the cancellation acknowledgment without claiming quarantine or descendant exit", async () => {
      const job = await createAttempt("RUNNING");
      await db.projectInitialization.update({
        where: { id: job.id },
        data: {
          stagingPath: "/fixture/private-stage",
          leaseOwner: "fixture-worker",
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });
      const result = (
        await act("post", initBase() + "/" + job.id + "/cancel").expect(200)
      ).body;
      assertSchema(
        result,
        schema(
          "/projects/{projectId}/initializations/{initializationId}/cancel",
          "post",
        ),
      );
      expect(result).toEqual({ cancelled: true });
      const row = await db.projectInitialization.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row).toMatchObject({
        status: "CANCELLED",
        stagingPath: "/fixture/private-stage",
        quarantinePath: null,
        leaseOwner: "fixture-worker",
      });
      expect(
        await db.projectInitializationEvent.count({
          where: { initializationId: job.id, type: "initialization.cancelled" },
        }),
      ).toBe(1);
    });
    it("returns a scalar retry registration without steps and exposes steps only in detail", async () => {
      await createAttempt("FAILED");
      const result = (
        await act("post", initBase() + "/retry", manageOnly).expect(201)
      ).body;
      assertSchema(
        result,
        schema("/projects/{projectId}/initializations/retry", "post", 201),
      );
      expect(result).toMatchObject({
        attempt: 2,
        status: "QUEUED",
        projectId: project,
        templateVersionId: version,
      });
      expect(result).not.toHaveProperty("steps");
      const detail = (await get(initBase() + "/" + result.id).expect(200)).body;
      expect(detail.steps).toEqual([]);
      assertSchema(
        detail,
        schema("/projects/{projectId}/initializations/{initializationId}"),
      );
      await get(initBase(), manageOnly).expect(403);
    });
    it("keeps initialization read/manage, membership and tenant gates unchanged", async () => {
      const job = await createAttempt();
      await http().get(initBase()).expect(401);
      await get(initBase(), reader).expect(200);
      await get(initBase(), outsider).expect(403);
      await get(initBase(), foreign).expect(404);
      await act("post", initBase() + "/" + job.id + "/cancel", reader).expect(
        403,
      );
      await act("post", initBase() + "/retry", reader).expect(403);
      expect(
        (
          await db.projectInitialization.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).status,
      ).toBe("QUEUED");
    });
    it("matches extension list/add/update/remove shapes while retaining original creation attribution", async () => {
      const added = (
        await act("post", extensionBase(), member, {
          extension: ".TXT",
        }).expect(201)
      ).body;
      assertSchema(
        added,
        schema("/projects/{id}/protected-file-types", "post", 201),
      );
      expect(added).toMatchObject({
        projectId: project,
        extension: ".txt",
        createdById: member,
      });
      expect(
        (
          await act("post", extensionBase(), member, {
            extension: ".txt",
          }).expect(201)
        ).body,
      ).toEqual(added);
      const changed = (
        await act("put", extensionBase() + "/" + added.id, owner, {
          extension: ".PDF",
        }).expect(200)
      ).body;
      assertSchema(
        changed,
        schema("/projects/{id}/protected-file-types/{typeId}", "put"),
      );
      expect(changed).toMatchObject({
        id: added.id,
        extension: ".pdf",
        createdById: member,
        createdAt: added.createdAt,
      });
      const list = (await get(extensionBase()).expect(200)).body;
      assertSchema(list, schema("/projects/{id}/protected-file-types"));
      expect(list).toEqual([changed]);
      const removed = (
        await act("delete", extensionBase() + "/" + added.id).expect(200)
      ).body;
      assertSchema(
        removed,
        schema("/projects/{id}/protected-file-types/{typeId}", "delete"),
      );
      expect(removed).toEqual({ removed: true });
      await act("delete", extensionBase() + "/" + added.id).expect(404);
    });
    it("publishes the existing 64-character input limit and preserves leading-dot/trim validation", async () => {
      await act("post", extensionBase(), member, { extension: "txt" }).expect(
        400,
      );
      await act("post", extensionBase(), member, {
        extension: "." + "x".repeat(64),
      }).expect(400);
      expect(
        spec.components.schemas.ProtectedFileTypeDto.properties.extension
          .maxLength,
      ).toBe(64);
      const normalized = (
        await act("post", extensionBase(), member, {
          extension: " .TXT ",
        }).expect(201)
      ).body;
      expect(normalized.extension).toBe(".txt");
      assertSchema(
        normalized,
        schema("/projects/{id}/protected-file-types", "post", 201),
      );
    });
    it("preserves sensitive access for extension append/list and owner-only update/remove", async () => {
      const rule = (
        await act("post", extensionBase(), member, {
          extension: ".txt",
        }).expect(201)
      ).body;
      await get(extensionBase(), reader).expect(403);
      await get(extensionBase(), outsider).expect(403);
      await get(extensionBase(), foreign).expect(404);
      await act("put", extensionBase() + "/" + rule.id, member, {
        extension: ".pdf",
      }).expect(403);
      await act("delete", extensionBase() + "/" + rule.id, member).expect(403);
      expect(
        (
          await db.projectProtectedFileType.findUniqueOrThrow({
            where: { id: rule.id },
          })
        ).extension,
      ).toBe(".txt");
    });
    it("documents scoped paths/output and does not overstate cancellation evidence", () => {
      const text =
        spec.paths[
          "/projects/{projectId}/initializations/{initializationId}/cancel"
        ].post.responses[200].description;
      expect(text).toContain("do not prove");
      expect(text).not.toBe("Processes stopped and staging quarantined.");
      expect(
        spec.components.schemas.InitializationAttemptResponseDto.properties
          .leaseOwner.nullable,
      ).toBe(true);
      expect(
        spec.components.schemas.InitializationStepResponseDto.properties.status
          .enum,
      ).toEqual(Object.values(ProjectInitializationStepStatus));
    });
    it("keeps webhook secret rejection and irrelevant-update acknowledgment bodyless", async () => {
      for (const header of [undefined, "wrong-secret"]) {
        let r = http().post("/telegram/webhook");
        if (header) r = r.set("x-telegram-bot-api-secret-token", header);
        const response = await r.send({ update_id: 1 }).expect(200);
        expect(response.text).toBe("");
      }
      expect(bot.handle).not.toHaveBeenCalled();
      const ignored = await http()
        .post("/telegram/webhook")
        .set("x-telegram-bot-api-secret-token", secret)
        .send({ update_id: 2 })
        .expect(200);
      expect(ignored.text).toBe("");
      expect(bot.handle).toHaveBeenCalledTimes(1);
      expect(
        spec.paths["/telegram/webhook"].post.responses[200].content,
      ).toBeUndefined();
    });
    it("keeps handled and contact-request webhook branches empty without real messaging", async () => {
      bot.handle.mockResolvedValueOnce(true);
      const handled = await http()
        .post("/telegram/webhook")
        .set("x-telegram-bot-api-secret-token", secret)
        .send({ update_id: 3, message: { text: "handled" } })
        .expect(200);
      expect(handled.text).toBe("");
      expect(telegram.requestContact).not.toHaveBeenCalled();
      const start = await http()
        .post("/telegram/webhook")
        .set("x-telegram-bot-api-secret-token", secret)
        .send({
          update_id: 4,
          message: { chat: { id: 12, type: "private" }, text: "/start" },
        })
        .expect(200);
      expect(start.text).toBe("");
      expect(telegram.requestContact).toHaveBeenCalledWith("12");
      expect(telegram.sendText).not.toHaveBeenCalled();
    });
  },
);
