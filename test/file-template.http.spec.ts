import { randomUUID } from "node:crypto";
import {
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { ConfigurationTemplatesController } from "../src/configuration-templates/configuration-templates.controller";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";
import { TemplateStorageService } from "../src/configuration-templates/template-storage.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { DepartmentsService } from "../src/departments/departments.service";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";
const request = require("supertest");
const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const u = new URL(databaseUrl);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
(databaseUrl ? describe : describe.skip)(
  "file/template HTTP contracts with isolated PostgreSQL and local filesystem",
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let workspaceId: string;
    let otherId: string;
    let managerId: string;
    let readerId: string;
    let manageOnlyId: string;
    let deleteOnlyId: string;
    let fileReadOnlyId: string;
    let emptyId: string;
    let outsiderId: string;
    let projectId: string;
    let templateId: string;
    let draftId: string;
    let departmentId: string;
    let root: string;
    let projectPath: string;
    const envKeys = [
      "PROBOXAI_ALLOWED_WORKSPACE_ROOTS",
      "PROBOXAI_PROJECT_UPLOAD_MAX_BYTES",
      "PROBOXAI_TEMPLATE_FILE_MAX_BYTES",
      "PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES",
      "PROBOXAI_UPLOAD_TEMP_DIR",
    ];
    const prior = envKeys.map((key) => process.env[key]);
    const storage = {
      putObject: jest.fn(async (_key, body) => {
        if (body?.[Symbol.asyncIterator])
          for await (const _chunk of body) void _chunk;
      }),
      headObject: jest
        .fn()
        .mockResolvedValue({ ContentLength: 3, Metadata: { sha256: "hash" } }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const grants = [
      "projects.read",
      "projects.files.read",
      "projects.files.write",
      "projects.files.delete",
      "configuration-templates.read",
      "configuration-templates.manage",
    ];
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      root = await fs.mkdtemp(
        path.join(os.tmpdir(), "proboxai-file-template-test-"),
      );
      projectPath = path.join(root, "Project");
      await fs.mkdir(projectPath);
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
      process.env.PROBOXAI_PROJECT_UPLOAD_MAX_BYTES = "16";
      process.env.PROBOXAI_TEMPLATE_FILE_MAX_BYTES = "12";
      process.env.PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES = "20";
      process.env.PROBOXAI_UPLOAD_TEMP_DIR = path.join(root, "uploads");
      workspaceId = (
        await prisma.workspace.create({ data: { slug: "file-template-http" } })
      ).id;
      otherId = (
        await prisma.workspace.create({
          data: { slug: "file-template-http-other" },
        })
      ).id;
      await prisma.permission.createMany({
        data: grants.map((key) => ({
          key,
          name: key,
          description: key,
          category: "test",
        })),
        skipDuplicates: true,
      });
      async function user(workspace: string, phone: string, keys: string[]) {
        const role = await prisma.role.create({
          data: {
            workspaceId: workspace,
            key: phone,
            name: "Test",
            permissions: {
              create: keys.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        return (
          await prisma.user.create({
            data: {
              workspaceId: workspace,
              phoneNumber: phone,
              fullName: "Test",
              status: "OPEN",
              roleAssignments: { create: { roleId: role.id } },
            },
          })
        ).id;
      }
      managerId = await user(workspaceId, "+998909000001", grants);
      readerId = await user(
        workspaceId,
        "+998909000002",
        grants.filter((k) => k !== "configuration-templates.manage"),
      );
      manageOnlyId = await user(workspaceId, "+998909000005", [
        "configuration-templates.manage",
      ]);
      deleteOnlyId = await user(workspaceId, "+998909000006", [
        "projects.files.delete",
      ]);
      fileReadOnlyId = await user(workspaceId, "+998909000007", [
        "projects.files.read",
      ]);
      emptyId = await user(workspaceId, "+998909000003", []);
      outsiderId = await user(otherId, "+998909000004", grants);
      departmentId = (
        await prisma.department.create({
          data: { workspaceId, name: "Test", slug: "test", homePath: root },
        })
      ).id;
      projectId = (
        await prisma.project.create({
          data: {
            workspaceId,
            departmentId,
            creatorId: managerId,
            name: "Project",
            directoryName: "Project",
            readAccessEnabled: true,
            members: {
              create: [
                { userId: managerId },
                { userId: deleteOnlyId },
                { userId: fileReadOnlyId },
              ],
            },
          },
        })
      ).id;
      templateId = (
        await prisma.configurationTemplate.create({
          data: {
            workspaceId,
            departmentId,
            creatorId: managerId,
            name: "Template",
            slug: "template",
          },
        })
      ).id;
      for (const version of [1, 2, 3]) {
        const v = await prisma.configurationTemplateVersion.create({
          data: {
            templateId,
            version,
            creatorId: managerId,
            status: version === 3 ? "DRAFT" : "PUBLISHED",
            publishedAt: version === 3 ? null : new Date(),
            publishedById: version === 3 ? null : managerId,
          },
        });
        if (version === 3) draftId = v.id;
      }
      await prisma.configurationTemplateFile.create({
        data: {
          versionId: draftId,
          destinationPath: "file.bin",
          objectKey: "private-object-key",
          originalName: "file.bin",
          contentType: "application/octet-stream",
          size: 3,
          sha256: "hash",
        },
      });
      const module = await Test.createTestingModule({
        controllers: [ProjectsController, ConfigurationTemplatesController],
        providers: [
          ProjectsService,
          ConfigurationTemplatesService,
          WorkspacePathPolicy,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                workspaceId: "stale",
                type: "access",
              }),
            },
          },
          { provide: TemplateStorageService, useValue: storage },
          ...[
            DepartmentsService,
            ProjectInitializationService,
            TelegramService,
            ProboxAiRunner,
          ].map((provide) => ({ provide, useValue: {} })),
        ],
      }).compile();
      jest
        .spyOn(module.get(ProjectsService), "onModuleInit")
        .mockImplementation(() => {});
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
      await app?.close();
      if (prisma) {
        await prisma.project.deleteMany({ where: { workspaceId } });
        await prisma.configurationTemplate.deleteMany({
          where: { workspaceId },
        });
        await prisma.department.deleteMany({ where: { workspaceId } });
        await prisma.user.deleteMany({
          where: { workspaceId: { in: [workspaceId, otherId] } },
        });
        await prisma.role.deleteMany({
          where: { workspaceId: { in: [workspaceId, otherId] } },
        });
        await prisma.workspace.deleteMany({
          where: { id: { in: [workspaceId, otherId] } },
        });
        await prisma.$disconnect();
      }
      envKeys.forEach((key, index) => {
        if (prior[index] === undefined) delete process.env[key];
        else process.env[key] = prior[index];
      });
      if (
        root &&
        path.dirname(root) === os.tmpdir() &&
        path.basename(root).startsWith("proboxai-file-template-test-")
      )
        await fs.rm(root, { recursive: true, force: true });
    });
    const call = (method: string, route: string, actor = managerId) => {
      const req = request(app.getHttpServer())
        [method](route)
        .set("Authorization", "Bearer " + actor);
      const originalThen = req.then.bind(req);
      req.then = async (resolve: any, reject: any) => {
        if (method !== "get") {
          const version = route.match(
            /configuration-templates\/versions\/([^/]+)/,
          );
          const department = route.match(/^\/departments\/([^/]+)/);
          if (version || department) {
            const readPath = version
              ? "/configuration-templates/versions/" + version[1] + "/revision"
              : "/departments/" + department![1] + "/revision";
            const read = await request(app.getHttpServer())
              .get(readPath)
              .set("Authorization", "Bearer " + actor);
            // Denied/missing-resource cases still reach the mutation's own guards.
            req.set("If-Match", '"' + (read.body.revision ?? 0) + '"');
          }
        }
        return originalThen(resolve, reject);
      };
      return req;
    };
    const clean = (body: unknown) => {
      const serialized = JSON.stringify(body);
      for (const privateName of [
        "objectKey",
        "homePath",
        "leaseOwner",
        "leaseExpiresAt",
        "lastError",
        "trashPath",
        "private-object-key",
      ])
        expect(serialized).not.toContain(privateName);
    };
    it("lets manage-only template writers read narrow revisions and recover stale inputs", async () => {
      const read = (actor = manageOnlyId) =>
        request(app.getHttpServer())
          .get("/configuration-templates/versions/" + draftId + "/revision")
          .set("Authorization", "Bearer " + actor);
      await call(
        "get",
        "/configuration-templates/" + templateId,
        manageOnlyId,
      ).expect(403);
      const baseline = await read().expect(200);
      expect(Object.keys(baseline.body)).toEqual(["revision"]);
      await read(readerId).expect(403);
      await read(outsiderId).expect(404);
      const edit = () =>
        request(app.getHttpServer())
          .put("/configuration-templates/versions/" + draftId + "/manifest")
          .set("Authorization", "Bearer " + manageOnlyId)
          .set("If-Match", '"' + baseline.body.revision + '"');
      const saved = await edit()
        .send({ folders: [], commandStages: [] })
        .expect(200);
      expect(saved.body.revision).toBe(baseline.body.revision + 1);
      const stale = await edit()
        .send({ folders: [], commandStages: [] })
        .expect(409);
      expect(stale.body.code).toBe("STALE_REVISION");
      expect((await read().expect(200)).body.revision).toBe(
        saved.body.revision,
      );
    });
    it("exposes distinct effective metadata only under existing upload grants/access", async () => {
      expect(
        (
          await call(
            "get",
            `/projects/${projectId}/files/upload-configuration`,
          ).expect(200)
        ).body,
      ).toEqual({ maxUploadBytes: 16, requestMode: "single-file" });
      expect(
        (
          await call(
            "get",
            "/configuration-templates/upload-configuration",
          ).expect(200)
        ).body,
      ).toEqual({
        maxFileBytes: 12,
        maxVersionBytes: 20,
        requestMode: "single-file",
      });
      await call(
        "get",
        `/projects/${projectId}/files/upload-configuration`,
        readerId,
      ).expect(403);
      await call(
        "get",
        `/projects/${projectId}/files/upload-configuration`,
        outsiderId,
      ).expect(404);
      await call(
        "get",
        "/configuration-templates/upload-configuration",
        readerId,
      ).expect(403);
      await call(
        "get",
        "/configuration-templates/upload-configuration",
        emptyId,
      ).expect(403);
      await request(app.getHttpServer())
        .get("/configuration-templates/upload-configuration")
        .expect(401);
    });
    it("does not replace unavailable metadata with a default", async () => {
      const fail = jest
        .spyOn(app.get(ProjectsService), "uploadConfiguration")
        .mockRejectedValueOnce(new ServiceUnavailableException("Unavailable"));
      try {
        const result = await call(
          "get",
          `/projects/${projectId}/files/upload-configuration`,
        ).expect(503);
        expect(result.body).not.toHaveProperty("maxUploadBytes");
      } finally {
        fail.mockRestore();
      }
      const templateFail = jest
        .spyOn(app.get(ConfigurationTemplatesService), "uploadConfiguration")
        .mockImplementationOnce(() => {
          throw new ServiceUnavailableException("Unavailable");
        });
      try {
        const result = await call(
          "get",
          "/configuration-templates/upload-configuration",
        ).expect(503);
        expect(result.body).not.toHaveProperty("maxFileBytes");
        expect(result.body).not.toHaveProperty("maxVersionBytes");
      } finally {
        templateFail.mockRestore();
      }
    });
    it("accepts exact project upload size, rejects excess and multiple files", async () => {
      await call("post", `/projects/${projectId}/files/upload`)
        .attach("file", Buffer.alloc(16), "exact.bin")
        .expect(201);
      await call("post", `/projects/${projectId}/files/upload`)
        .attach("file", Buffer.alloc(17), "excess.bin")
        .expect(413);
      await call("post", `/projects/${projectId}/files/upload`)
        .attach("file", Buffer.alloc(1), "one.bin")
        .attach("file", Buffer.alloc(1), "two.bin")
        .expect(400);
      expect(
        await fs.readFile(path.join(projectPath, "exact.bin")),
      ).toHaveLength(16);
      await expect(
        fs.stat(path.join(projectPath, "excess.bin")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("keeps metadata and interceptor limits aligned when configuration changes", async () => {
      process.env.PROBOXAI_PROJECT_UPLOAD_MAX_BYTES = "2";
      try {
        expect(
          (
            await call(
              "get",
              `/projects/${projectId}/files/upload-configuration`,
            ).expect(200)
          ).body.maxUploadBytes,
        ).toBe(2);
        await call("post", `/projects/${projectId}/files/upload`)
          .attach("file", Buffer.alloc(2), "changed-exact.bin")
          .expect(201);
        await call("post", `/projects/${projectId}/files/upload`)
          .attach("file", Buffer.alloc(3), "changed-excess.bin")
          .expect(413);
      } finally {
        process.env.PROBOXAI_PROJECT_UPLOAD_MAX_BYTES = "16";
      }
    });
    it("publishes both delete branches, exact trash scalars and restoration", async () => {
      await fs.writeFile(path.join(projectPath, "direct.bin"), "direct");
      await fs.writeFile(path.join(projectPath, "protected.txt"), "protected");
      await prisma.projectProtectedFileType.create({
        data: { projectId, extension: ".txt", createdById: managerId },
      });
      const direct = await call("post", `/projects/${projectId}/files/delete`)
        .send({ path: "direct.bin", operationId: randomUUID() })
        .expect(201);
      expect(Object.keys(direct.body).sort()).toEqual(
        ["operationId", "trashed", "trashId", "path", "expiresAt"].sort(),
      );
      expect(direct.body.trashed).toBe(true);
      const confirmation = await call(
        "post",
        `/projects/${projectId}/files/delete`,
      )
        .send({ path: "protected.txt", operationId: randomUUID() })
        .expect(201);
      expect(Object.keys(confirmation.body).sort()).toEqual(
        [
          "operationId",
          "confirmationRequired",
          "confirmationId",
          "expiresAt",
        ].sort(),
      );
      expect(confirmation.body.confirmationRequired).toBe(true);
      const confirmed = await call(
        "post",
        `/projects/${projectId}/files/delete-confirmations/${confirmation.body.confirmationId}/confirm`,
      ).expect(201);
      expect(Object.keys(confirmed.body).sort()).toEqual(
        Object.keys(direct.body).sort(),
      );
      await call(
        "post",
        `/projects/${projectId}/files/delete-confirmations/${confirmation.body.confirmationId}/confirm`,
      ).expect(201);
      const trash = await call("get", `/projects/${projectId}/trash`).expect(
        200,
      );
      clean(trash.body);
      expect(trash.body.map((t: any) => t.originalPath)).toEqual([
        "protected.txt",
        "direct.bin",
      ]);
      expect(Object.keys(trash.body[0]).sort()).toEqual(
        [
          "id",
          "projectId",
          "originalPath",
          "isDirectory",
          "deletedById",
          "status",
          "expiresAt",
          "createdAt",
          "restoredAt",
          "purgedAt",
        ].sort(),
      );
      expect(trash.body[0]).toMatchObject({
        isDirectory: false,
        status: "ACTIVE",
        restoredAt: null,
        purgedAt: null,
      });
      expect(
        (
          await call(
            "post",
            `/projects/${projectId}/trash/${direct.body.trashId}/restore`,
          ).expect(201)
        ).body,
      ).toEqual({ restored: true, path: "direct.bin" });
      expect(
        await fs.readFile(path.join(projectPath, "direct.bin"), "utf8"),
      ).toBe("direct");
    });
    it("scopes operation readback and repair to the existing delete grant and project access", async () => {
      await fs.writeFile(path.join(projectPath, "journal.bin"), "journal");
      await call("post", `/projects/${projectId}/files/delete`)
        .send({ path: "journal.bin" })
        .expect(400);
      const id = randomUUID();
      await call("post", `/projects/${projectId}/files/delete`, deleteOnlyId)
        .send({ path: "journal.bin", operationId: id })
        .expect(201);
      const route = `/projects/${projectId}/file-operations/${id}`;
      const result = await call("get", route, deleteOnlyId).expect(200);
      expect(result.body).toMatchObject({
        id,
        projectId,
        kind: "DELETE",
        state: "COMPLETED",
        path: "journal.bin",
      });
      for (const field of [
        "contentHash",
        "sourceIdentity",
        "trashPath",
        "actorId",
      ])
        expect(result.body).not.toHaveProperty(field);
      await call(
        "get",
        `/projects/${projectId}/file-operations`,
        deleteOnlyId,
      ).expect(200);
      await call("post", route + "/reconcile", deleteOnlyId).expect(201);
      for (const member of [fileReadOnlyId, emptyId]) {
        await call("get", route, member).expect(403);
        await call("post", route + "/reconcile", member).expect(403);
      }
      await call("get", route, outsiderId).expect(404);
      await call("post", route + "/reconcile", outsiderId).expect(404);
      await call(
        "get",
        `/projects/${projectId}/file-operations/${randomUUID()}`,
        deleteOnlyId,
      ).expect(404);
    });
    it("represents trashed directories and keeps restore collision/changed confirmation errors", async () => {
      await fs.mkdir(path.join(projectPath, "folder"));
      const directory = await call(
        "post",
        `/projects/${projectId}/files/delete`,
      )
        .send({ path: "folder", operationId: randomUUID() })
        .expect(201);
      const list = await call("get", `/projects/${projectId}/trash`).expect(
        200,
      );
      expect(
        list.body.find((t: any) => t.id === directory.body.trashId).isDirectory,
      ).toBe(true);
      await fs.mkdir(path.join(projectPath, "folder"));
      await call(
        "post",
        `/projects/${projectId}/trash/${directory.body.trashId}/restore`,
      ).expect(409);
      await fs.rmdir(path.join(projectPath, "folder"));
      await call(
        "post",
        `/projects/${projectId}/trash/${directory.body.trashId}/restore`,
      ).expect(201);
      await fs.writeFile(path.join(projectPath, "changed.txt"), "before");
      const confirmation = await call(
        "post",
        `/projects/${projectId}/files/delete`,
      )
        .send({ path: "changed.txt", operationId: randomUUID() })
        .expect(201);
      await fs.writeFile(path.join(projectPath, "changed.txt"), "after");
      await call(
        "post",
        `/projects/${projectId}/files/delete-confirmations/${confirmation.body.confirmationId}/confirm`,
      ).expect(409);
      expect(
        (
          await prisma.projectFileDeletionConfirmation.findUnique({
            where: { id: confirmation.body.confirmationId },
          })
        )?.status,
      ).toBe("EXPIRED");
    });
    it("represents expired ACTIVE trash but gates restore/config/delete on READY", async () => {
      const expired = await prisma.projectFileTrashItem.create({
        data: {
          projectId,
          originalPath: "expired.bin",
          trashPath: "expired",
          deletedById: managerId,
          isDirectory: false,
          expiresAt: new Date("2020-01-01"),
          leaseOwner: "private-lease",
          lastError: "private-error",
        },
      });
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "INITIALIZING" },
      });
      try {
        const list = await call("get", `/projects/${projectId}/trash`).expect(
          200,
        );
        expect(list.body[0]).toMatchObject({
          id: expired.id,
          status: "ACTIVE",
          expiresAt: "2020-01-01T00:00:00.000Z",
        });
        clean(list.body);
        await call(
          "get",
          `/projects/${projectId}/files/upload-configuration`,
        ).expect(409);
        await call("post", `/projects/${projectId}/files/delete`)
          .send({ path: "direct.bin", operationId: randomUUID() })
          .expect(409);
        await call(
          "post",
          `/projects/${projectId}/trash/${expired.id}/restore`,
        ).expect(409);
      } finally {
        await prisma.project.update({
          where: { id: projectId },
          data: { status: "READY" },
        });
      }
      await call(
        "post",
        `/projects/${projectId}/trash/${expired.id}/restore`,
      ).expect(404);
      await call("post", `/projects/${projectId}/files/delete`)
        .send({ path: "missing.bin", operationId: randomUUID() })
        .expect(404);
      await call("get", `/projects/${projectId}/trash`, readerId).expect(403);
      await call("get", `/projects/${projectId}/trash`, outsiderId).expect(404);
      await call("get", `/projects/${projectId}/trash`, emptyId).expect(403);
    });
    it("types the two list versions separately from full visible detail history", async () => {
      const list = await call("get", "/configuration-templates").expect(200);
      expect(list.body[0].versions.map((v: any) => v.version)).toEqual([3, 2]);
      expect(list.body[0].versions[0]).not.toHaveProperty("files");
      clean(list.body);
      const reader = await call(
        "get",
        "/configuration-templates",
        readerId,
      ).expect(200);
      expect(reader.body[0].versions.map((v: any) => v.version)).toEqual([
        2, 1,
      ]);
      const detail = await call(
        "get",
        `/configuration-templates/${templateId}`,
      ).expect(200);
      expect(detail.body.versions.map((v: any) => v.version)).toEqual([
        3, 2, 1,
      ]);
      expect(detail.body.department).toEqual({
        id: departmentId,
        name: "Test",
        slug: "test",
      });
      clean(detail.body);
      expect(Object.keys(detail.body.versions[0].files[0]).sort()).toEqual(
        [
          "id",
          "versionId",
          "destinationPath",
          "originalName",
          "contentType",
          "size",
          "sha256",
          "createdAt",
          "updatedAt",
        ].sort(),
      );
      const visible = await call(
        "get",
        `/configuration-templates/${templateId}`,
        readerId,
      ).expect(200);
      expect(visible.body.versions.map((v: any) => v.version)).toEqual([2, 1]);
      await call(
        "get",
        `/configuration-templates/${templateId}`,
        outsiderId,
      ).expect(404);
    });
    it("manifest save retains files and publishes structured issue locations", async () => {
      const invalid = await call(
        "put",
        `/configuration-templates/versions/${draftId}/manifest`,
      )
        .send({
          folders: [],
          commandStages: [
            {
              name: "Run",
              mode: "SEQUENTIAL",
              commands: [
                {
                  name: "Run",
                  type: "STRUCTURED",
                  executable: "node",
                  workingDirectory: "missing",
                },
              ],
            },
          ],
        })
        .expect(400);
      expect(invalid.body).toMatchObject({
        code: "TEMPLATE_MANIFEST_INVALID",
        issues: [
          {
            code: "COMMAND_FOLDER_INVALID",
            location: "commandStages.0.commands.0.workingDirectory",
          },
        ],
      });
      const saved = await call(
        "put",
        `/configuration-templates/versions/${draftId}/manifest`,
      )
        .send({
          folders: [],
          commandStages: [
            {
              name: "Run",
              mode: "SEQUENTIAL",
              commands: [
                {
                  name: "Run",
                  type: "STRUCTURED",
                  executable: "node",
                  workingDirectory: "",
                },
                {
                  name: "Shell",
                  type: "SHELL",
                  script: "echo okay",
                  workingDirectory: "",
                },
              ],
            },
          ],
        })
        .expect(200);
      expect(saved.body.files).toHaveLength(1);
      clean(saved.body);
      expect(
        saved.body.commandStages[0].commands.map((c: any) => c.arguments),
      ).toEqual([[], null]);
      await call(
        "put",
        `/configuration-templates/versions/${draftId}/manifest`,
        readerId,
      )
        .send({ folders: [], commandStages: [] })
        .expect(403);
    });
    it.each([
      [
        { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } },
        409,
        "TEMPLATE_OBJECT_MISSING",
      ],
      [
        { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
        503,
        undefined,
      ],
      [
        { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } },
        503,
        undefined,
      ],
      [
        { code: "ETIMEDOUT", message: "private endpoint credential" },
        503,
        undefined,
      ],
    ])(
      "distinguishes storage HEAD failure %j",
      async (error, status, issue) => {
        storage.headObject.mockRejectedValueOnce(error);
        const result = await call(
          "post",
          `/configuration-templates/versions/${draftId}/publish`,
        ).expect(status);
        if (issue)
          expect(result.body).toMatchObject({
            code: "TEMPLATE_MANIFEST_INVALID",
            issues: [{ code: issue, location: "files.0.destinationPath" }],
          });
        else expect(result.body.code).toBe("TEMPLATE_STORAGE_UNAVAILABLE");
        expect(JSON.stringify(result.body)).not.toContain("private");
        expect(
          (
            await prisma.configurationTemplateVersion.findUnique({
              where: { id: draftId },
            })
          )?.status,
        ).toBe("DRAFT");
      },
    );
    it("sanitizes upload storage failures without registering a file", async () => {
      storage.putObject.mockRejectedValueOnce(
        new Error("private credentials endpoint"),
      );
      const result = await call(
        "post",
        `/configuration-templates/versions/${draftId}/files`,
      )
        .field("destinationPath", "fail.bin")
        .attach("file", Buffer.alloc(1), "fail.bin")
        .expect(503);
      expect(result.body.code).toBe("TEMPLATE_STORAGE_UNAVAILABLE");
      clean(result.body);
      expect(
        await prisma.configurationTemplateFile.count({
          where: { versionId: draftId, destinationPath: "fail.bin" },
        }),
      ).toBe(0);
    });
    it("enforces exact template file and aggregate boundaries with distinct limits", async () => {
      await call("post", `/configuration-templates/versions/${draftId}/files`)
        .field("destinationPath", "exact.bin")
        .attach("file", Buffer.alloc(12), "exact.bin")
        .expect(201);
      await call("post", `/configuration-templates/versions/${draftId}/files`)
        .field("destinationPath", "excess.bin")
        .attach("file", Buffer.alloc(13), "excess.bin")
        .expect(413);
      await call("post", `/configuration-templates/versions/${draftId}/files`)
        .field("destinationPath", "total-exact.bin")
        .attach("file", Buffer.alloc(5), "total.bin")
        .expect(201);
      const total = await call(
        "post",
        `/configuration-templates/versions/${draftId}/files`,
      )
        .field("destinationPath", "total-excess.bin")
        .attach("file", Buffer.alloc(1), "extra.bin")
        .expect(400);
      expect(total.body.code).toBe("TEMPLATE_VERSION_LIMIT");
      expect(
        (
          await prisma.configurationTemplateFile.aggregate({
            where: { versionId: draftId },
            _sum: { size: true },
          })
        )._sum.size,
      ).toBe(20);
      await call(
        "post",
        `/configuration-templates/versions/${draftId}/files`,
        readerId,
      )
        .field("destinationPath", "denied.bin")
        .attach("file", Buffer.alloc(1), "denied.bin")
        .expect(403);
    });
    it("returns scalar metadata/archive and safe file move/remove results", async () => {
      const update = await call(
        "patch",
        `/configuration-templates/${templateId}`,
      )
        .send({ description: "New" })
        .expect(200);
      expect(update.body).not.toHaveProperty("department");
      expect(update.body).not.toHaveProperty("versions");
      await call("patch", `/configuration-templates/${templateId}`)
        .send({ name: null })
        .expect(400);
      const file = await prisma.configurationTemplateFile.findFirstOrThrow({
        where: { versionId: draftId, destinationPath: "exact.bin" },
      });
      const moved = await call(
        "patch",
        `/configuration-templates/versions/${draftId}/files/${file.id}`,
      )
        .send({ destinationPath: "moved.bin" })
        .expect(200);
      clean(moved.body);
      expect(
        (
          await call(
            "delete",
            `/configuration-templates/versions/${draftId}/files/${file.id}`,
          ).expect(200)
        ).body,
      ).toMatchObject({ deleted: true, versionRevision: expect.any(Number) });
      await call(
        "delete",
        `/configuration-templates/versions/${draftId}/files/${file.id}`,
      ).expect(404);
      const archive = await call(
        "post",
        `/configuration-templates/${templateId}/archive`,
      ).expect(201);
      expect(archive.body.status).toBe("ARCHIVED");
      expect(archive.body).not.toHaveProperty("versions");
      expect(
        (await call("get", "/configuration-templates", readerId).expect(200))
          .body,
      ).toEqual([]);
      await call(
        "get",
        `/configuration-templates/${templateId}`,
        readerId,
      ).expect(404);
      expect(
        (
          await call("get", `/configuration-templates/${templateId}`).expect(
            200,
          )
        ).body.status,
      ).toBe("ARCHIVED");
      expect(
        (
          await call(
            "post",
            `/configuration-templates/${templateId}/drafts`,
          ).expect(409)
        ).body.code,
      ).toBe("TEMPLATE_ARCHIVED");
    });
    it("creates a safe scalar draft response and publishes/clones full safe manifests", async () => {
      const created = await call("post", "/configuration-templates")
        .send({ departmentId, name: "New template" })
        .expect(201);
      clean(created.body);
      expect(created.body.versions[0]).not.toHaveProperty("files");
      const versionId = created.body.versions[0].id;
      const published = await call(
        "post",
        `/configuration-templates/versions/${versionId}/publish`,
      ).expect(201);
      expect(published.body).toMatchObject({
        status: "PUBLISHED",
        publishedById: managerId,
        files: [],
        folders: [],
        commandStages: [],
      });
      clean(published.body);
      const cloned = await call(
        "post",
        `/configuration-templates/${created.body.id}/drafts`,
      ).expect(201);
      expect(cloned.body).toMatchObject({
        status: "DRAFT",
        version: 2,
        publishedAt: null,
        publishedById: null,
      });
      clean(cloned.body);
      expect(
        (
          await call(
            "post",
            `/configuration-templates/${created.body.id}/drafts`,
          ).expect(409)
        ).body.code,
      ).toBe("TEMPLATE_DRAFT_EXISTS");
    });
  },
);
