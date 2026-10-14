import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { SettingsController } from "../src/projects/projects.controller";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";
import { ConfigurationTemplatesController } from "../src/configuration-templates/configuration-templates.controller";
import { DepartmentsService } from "../src/departments/departments.service";
import { DepartmentsController } from "../src/departments/departments.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
const request = require("supertest");
const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
function rejected(results: PromiseSettledResult<any>[]) {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason);
}
(databaseUrl ? describe : describe.skip)(
  "real database mutation races and filesystem reconciliation",
  () => {
    let prisma: PrismaClient,
      root: string,
      workspaceId: string,
      departmentId: string,
      actorId: string,
      templateId: string,
      versionId: string;
    let templates: ConfigurationTemplatesService,
      departments: DepartmentsService,
      projects: ProjectsService,
      paths: WorkspacePathPolicy;
    let app: INestApplication;
    const prior = [
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS,
      process.env.PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES,
    ];
    const storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      headObject: jest
        .fn()
        .mockResolvedValue({ ContentLength: 1, Metadata: { sha256: "hash" } }),
    };
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-races-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
    });
    beforeEach(async () => {
      storage.putObject.mockReset().mockResolvedValue(undefined);
      storage.deleteObject.mockReset().mockResolvedValue(undefined);
      storage.headObject
        .mockReset()
        .mockResolvedValue({ ContentLength: 1, Metadata: { sha256: "hash" } });
      process.env.PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES = "10";
      workspaceId = (
        await prisma.workspace.create({
          data: { slug: "races-" + randomUUID() },
        })
      ).id;
      actorId = (
        await prisma.user.create({
          data: {
            workspaceId,
            fullName: "Race tester",
            phoneNumber: randomUUID(),
            status: "OPEN",
          },
        })
      ).id;
      await prisma.permission.upsert({
        where: { key: "projects.create" },
        update: {},
        create: {
          key: "projects.create",
          name: "Create projects",
          description: "Test",
          category: "test",
        },
      });
      await prisma.role.create({
        data: {
          workspaceId,
          key: "project-creator",
          name: "Creator",
          permissions: { create: { permissionKey: "projects.create" } },
          userAssignments: { create: { userId: actorId } },
        },
      });
      departmentId = (
        await prisma.department.create({
          data: {
            workspaceId,
            name: "Test",
            slug: "test",
            homePath: root,
            isDefault: false,
          },
        })
      ).id;
      const t = await prisma.configurationTemplate.create({
        data: {
          workspaceId,
          departmentId,
          creatorId: actorId,
          name: "Test",
          slug: "test",
          versions: { create: { version: 1, creatorId: actorId } },
        },
        include: { versions: true },
      });
      templateId = t.id;
      versionId = t.versions[0]!.id;
      paths = new WorkspacePathPolicy();
      templates = new ConfigurationTemplatesService(
        prisma as any,
        storage as any,
      );
      departments = new DepartmentsService(prisma as any, paths);
      projects = new ProjectsService(
        prisma as any,
        departments,
        paths,
        {} as any,
      );
    });
    afterEach(async () => {
      await app?.close();
      app = undefined as any;
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.configurationTemplate.deleteMany({ where: { workspaceId } });
      await prisma.department.deleteMany({ where: { workspaceId } });
      await prisma.user.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await prisma.$disconnect();
      // Only a verified task-owned mkdtemp root is removed.
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith("proboxai-races-")
      )
        throw new Error("Unsafe test cleanup root");
      await fs.rm(root, { recursive: true, force: true });
      for (const [index, key] of [
        "PROBOXAI_ALLOWED_WORKSPACE_ROOTS",
        "PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES",
      ].entries()) {
        if (prior[index] === undefined) delete process.env[key];
        else process.env[key] = prior[index];
      }
    });
    const actor = () => ({
      id: actorId,
      workspaceId,
      roles: [],
      permissions: [],
      type: "access" as const,
    });
    const manifest = (folder: string) => ({
      folders: [{ path: folder }],
      commandStages: [],
    });
    const upload = (name: string, size: number, revision = 0) =>
      templates.uploadFile(
        workspaceId,
        versionId,
        name,
        {
          originalname: name,
          mimetype: "application/octet-stream",
          size,
          buffer: Buffer.alloc(size),
        },
        revision,
      );
    it("concurrent stale manifests have exactly one winner with no silently lost edits", async () => {
      const results = await Promise.allSettled([
        templates.replaceManifest(workspaceId, versionId, manifest("A"), 0),
        templates.replaceManifest(workspaceId, versionId, manifest("B"), 0),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected(results)[0].getResponse()).toMatchObject({
        code: "STALE_REVISION",
        statusCode: 409,
      });
      const row = await prisma.configurationTemplateVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { folders: true },
      });
      expect(row.revision).toBe(1);
      expect(row.folders).toHaveLength(1);
      const win = results.find(
        (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
      )!;
      expect(row.folders[0]!.path).toBe(win.value.folders[0].path);
    });
    it("publishing cannot commit an older manifest after a paused storage validation", async () => {
      await prisma.configurationTemplateFile.create({
        data: {
          versionId,
          destinationPath: "a.bin",
          objectKey: randomUUID(),
          originalName: "a.bin",
          contentType: "x",
          size: 1,
          sha256: "hash",
        },
      });
      const entered = gate(),
        release = gate();
      storage.headObject.mockImplementation(async () => {
        entered.open();
        await release.promise;
        return { ContentLength: 1, Metadata: { sha256: "hash" } };
      });
      const publishing = templates.publish(workspaceId, versionId, actorId, 0);
      await entered.promise;
      await templates.replaceManifest(
        workspaceId,
        versionId,
        manifest("new"),
        0,
      );
      release.open();
      await expect(publishing).rejects.toMatchObject({
        response: expect.objectContaining({ code: "STALE_REVISION" }),
      });
      expect(
        (
          await prisma.configurationTemplateVersion.findUniqueOrThrow({
            where: { id: versionId },
          })
        ).status,
      ).toBe("DRAFT");
    });
    it("a write already racing publication cannot modify the published definition", async () => {
      const publicationEntered = gate(),
        releasePublication = gate(),
        editEntered = gate();
      const publisherDb = prisma.$extends({
        query: {
          configurationTemplateVersion: {
            async update({ args, query }) {
              if (args.data.status === "PUBLISHED") {
                publicationEntered.open();
                await releasePublication.promise;
              }
              return query(args);
            },
          },
        },
      });
      const editorDb = prisma.$extends({
        query: {
          configurationTemplateVersion: {
            async updateMany({ args, query }) {
              editEntered.open();
              return query(args);
            },
          },
        },
      });
      const publishing = new ConfigurationTemplatesService(
        publisherDb as any,
        storage as any,
      ).publish(workspaceId, versionId, actorId, 0);
      await publicationEntered.promise; // Publisher holds the real version row lock.
      const editing = new ConfigurationTemplatesService(
        editorDb as any,
        storage as any,
      ).replaceManifest(workspaceId, versionId, manifest("late"), 0);
      await editEntered.promise;
      releasePublication.open();
      await publishing;
      await expect(editing).rejects.toMatchObject({
        response: expect.objectContaining({ code: "STALE_REVISION" }),
      });
      const row = await prisma.configurationTemplateVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { folders: true },
      });
      expect(row.status).toBe("PUBLISHED");
      expect(row.folders).toEqual([]);
      await expect(
        templates.replaceManifest(
          workspaceId,
          versionId,
          manifest("later"),
          row.revision,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "TEMPLATE_VERSION_IMMUTABLE",
        }),
      });
    });
    it("concurrent draft cloning intentionally creates one draft and rejects the other", async () => {
      await templates.publish(workspaceId, versionId, actorId, 0);
      const results = await Promise.allSettled([
        templates.createDraft(workspaceId, templateId, actorId),
        templates.createDraft(workspaceId, templateId, actorId),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected(results)[0].getResponse()).toMatchObject({
        code: "TEMPLATE_DRAFT_EXISTS",
      });
      expect(
        await prisma.configurationTemplateVersion.count({
          where: { templateId, status: "DRAFT" },
        }),
      ).toBe(1);
    });
    it("concurrent uploads serialize quota registration and clean only the definitely rejected object", async () => {
      const both = gate();
      let count = 0;
      storage.putObject.mockImplementation(async () => {
        if (++count === 2) both.open();
        await both.promise;
      });
      const results = await Promise.allSettled([
        upload("a.bin", 6),
        upload("b.bin", 6),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected(results)[0].getResponse()).toMatchObject({
        code: "STALE_REVISION",
      });
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
      expect(
        (
          await prisma.configurationTemplateFile.aggregate({
            where: { versionId },
            _sum: { size: true },
          })
        )._sum.size,
      ).toBe(6);
      await expect(upload("retry.bin", 6, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "TEMPLATE_VERSION_LIMIT" }),
      });
    });
    it("destination duplication and moves preserve valid layouts under contention", async () => {
      const results = await Promise.allSettled([
        upload("same.bin", 1),
        upload("same.bin", 1),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const file = await prisma.configurationTemplateFile.findFirstOrThrow({
        where: { versionId },
      });
      await expect(upload("same.bin", 1, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "TEMPLATE_FILE_CONFLICT" }),
      });
      const moves = await Promise.allSettled([
        templates.moveFile(
          workspaceId,
          versionId,
          file.id,
          { destinationPath: "A.bin" },
          1,
        ),
        templates.moveFile(
          workspaceId,
          versionId,
          file.id,
          { destinationPath: "B.bin" },
          1,
        ),
      ]);
      expect(moves.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected(moves)[0].getResponse()).toMatchObject({
        code: "STALE_REVISION",
      });
      await templates.replaceManifest(
        workspaceId,
        versionId,
        manifest("folder"),
        2,
      );
      await expect(upload("folder", 1, 3)).rejects.toMatchObject({
        response: expect.objectContaining({
          issues: [expect.objectContaining({ code: "PATH_DUPLICATE" })],
        }),
      });
      expect(
        (
          await prisma.configurationTemplateVersion.findUniqueOrThrow({
            where: { id: versionId },
          })
        ).revision,
      ).toBe(3);
    });
    it("default/archive races never produce an archived default and no default remains allowed", async () => {
      const results = await Promise.allSettled([
        departments.setDefault(workspaceId, departmentId, 0),
        departments.archive(workspaceId, departmentId, 0),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected(results)[0].getStatus()).toBe(409);
      const row = await departments.get(workspaceId, departmentId);
      expect(row.isDefault && row.status === "ARCHIVED").toBe(false);
      expect(
        await prisma.department.count({
          where: { workspaceId, isDefault: true },
        }),
      ).toBe(row.isDefault ? 1 : 0);
    });
    it("concurrent department creation/default selection is intentional and leaves one active default", async () => {
      const results = await Promise.all([
        departments.create(workspaceId, {
          name: "One",
          homePath: path.join(root, randomUUID()),
          isDefault: true,
        }),
        departments.create(workspaceId, {
          name: "Two",
          homePath: path.join(root, randomUUID()),
          isDefault: true,
        }),
      ]);
      const current = await prisma.department.findMany({
        where: { workspaceId, isDefault: true },
      });
      expect(current).toHaveLength(1);
      expect(current[0]!.status).toBe("ACTIVE");
      const demoted = results.find((row) => row.id !== current[0]!.id)!;
      const reread = await departments.get(workspaceId, demoted.id);
      expect(reread.revision).toBe(demoted.revision + 1);
      await expect(
        departments.archive(workspaceId, demoted.id, demoted.revision),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "STALE_REVISION" }),
      });
    });
    it("a committed home change makes a waiting project use the new authoritative home", async () => {
      const newHome = path.join(root, randomUUID()),
        entered = gate(),
        release = gate();
      const original = paths.provisionDepartmentHome.bind(paths);
      const spy = jest
        .spyOn(paths, "provisionDepartmentHome")
        .mockImplementation(async (home) => {
          if (home === newHome) {
            entered.open();
            await release.promise;
          }
          return original(home);
        });
      try {
        const changing = departments.update(
          workspaceId,
          departmentId,
          { homePath: newHome },
          0,
        );
        await entered.promise;
        const name = "New-home-" + randomUUID();
        const creating = projects.create(actor(), { name, departmentId });
        release.open();
        await changing;
        await creating;
        expect((await fs.stat(path.join(newHome, name))).isDirectory()).toBe(
          true,
        );
        await expect(fs.stat(path.join(root, name))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        release.open();
        spy.mockRestore();
      }
    });
    it("an unknown upload commit acknowledgement preserves a genuinely committed registration and object", async () => {
      const lost = new Error("Lost commit acknowledgement");
      const uncertain = {
        configurationTemplateVersion: prisma.configurationTemplateVersion,
        configurationTemplateFile: prisma.configurationTemplateFile,
        $transaction: async (fn: any, options: any) => {
          await prisma.$transaction(fn, options);
          throw lost;
        },
      };
      const service = new ConfigurationTemplatesService(
        uncertain as any,
        storage as any,
      );
      await expect(
        service.uploadFile(
          workspaceId,
          versionId,
          "committed.bin",
          {
            originalname: "committed.bin",
            mimetype: "x",
            size: 1,
            buffer: Buffer.from("x"),
          },
          0,
        ),
      ).rejects.toBe(lost);
      expect(
        await prisma.configurationTemplateFile.count({
          where: { versionId, destinationPath: "committed.bin" },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.configurationTemplateVersion.findUniqueOrThrow({
            where: { id: versionId },
          })
        ).revision,
      ).toBe(1);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it("stale name edits cannot overwrite a new home; current name-only edits retain it", async () => {
      const home = path.join(root, randomUUID());
      const changed = await departments.update(
        workspaceId,
        departmentId,
        { homePath: home },
        0,
      );
      await expect(
        departments.update(workspaceId, departmentId, { name: "Stale" }, 0),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "STALE_REVISION" }),
      });
      const renamed = await departments.update(
        workspaceId,
        departmentId,
        { name: "Fresh" },
        changed.revision,
      );
      expect(renamed.homePath).toBe(home);
    });
    it("project creation holding the shared lock blocks a racing home edit after its project guard", async () => {
      const entered = gate(),
        release = gate();
      const original = paths.provisionDepartmentHome.bind(paths);
      const spy = jest
        .spyOn(paths, "provisionDepartmentHome")
        .mockImplementation(async (home) => {
          entered.open();
          await release.promise;
          return original(home);
        });
      try {
        const creating = projects.create(actor(), {
          name: "Project-" + randomUUID(),
          departmentId,
        });
        await entered.promise;
        const editing = departments.update(
          workspaceId,
          departmentId,
          { homePath: path.join(root, randomUUID()) },
          0,
        );
        const rejectedEdit = expect(editing).rejects.toMatchObject({
          response: expect.objectContaining({ code: "DEPARTMENT_HOME_IN_USE" }),
        });
        release.open();
        const created = await creating;
        await rejectedEdit;
        expect(created.departmentId).toBe(departmentId);
        expect(
          (await departments.get(workspaceId, departmentId)).homePath,
        ).toBe(root);
        expect(
          (await fs.stat(path.join(root, created.directoryName))).isDirectory(),
        ).toBe(true);
      } finally {
        release.open();
        spy.mockRestore();
      }
    });
    it("archive holding the shared lock rejects a racing project before directory creation", async () => {
      const entered = gate(),
        release = gate();
      const archiverDb = prisma.$extends({
        query: {
          department: {
            async update({ args, query }) {
              entered.open();
              await release.promise;
              return query(args);
            },
          },
        },
      });
      const archiving = new DepartmentsService(
        archiverDb as any,
        paths,
      ).archive(workspaceId, departmentId, 0);
      await entered.promise;
      const name = "Rejected-" + randomUUID();
      const creating = projects.create(actor(), { name, departmentId });
      const rejectedCreation = expect(creating).rejects.toThrow("archived");
      release.open();
      await archiving;
      await rejectedCreation;
      await expect(fs.stat(path.join(root, name))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await prisma.project.count({ where: { departmentId } })).toBe(0);
    });
    it("retains provisioned files after a real rejected project write for explicit reconciliation", async () => {
      const name = "Retained-" + randomUUID();
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION race_test_reject_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test write rejected'; END $$",
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER race_test_reject_project BEFORE INSERT ON "Project" FOR EACH ROW EXECUTE FUNCTION race_test_reject_project()',
      );
      try {
        await expect(
          projects.create(actor(), { name, departmentId }),
        ).rejects.toBeDefined();
        expect(await prisma.project.count({ where: { departmentId } })).toBe(0);
        expect((await fs.stat(path.join(root, name))).isDirectory()).toBe(true);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER race_test_reject_project ON "Project"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION race_test_reject_project()",
        );
      }
      await expect(
        projects.create(actor(), { name, departmentId }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "PROJECT_DIRECTORY_EXISTS" }),
      });
      await projects.create(actor(), {
        name,
        departmentId,
        existingDirectoryAction: "KEEP",
      });
    });
    it("project and initialization registration commit atomically without postcommit enqueue uncertainty", async () => {
      await templates.publish(workspaceId, versionId, actorId, 0);
      const created = await projects.create(actor(), {
        name: "Atomic-" + randomUUID(),
        departmentId,
        configurationTemplateId: templateId,
      });
      expect(created.status).toBe("INITIALIZING");
      const attempts = await prisma.projectInitialization.findMany({
        where: { projectId: created.id },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.status).toBe("QUEUED");
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION race_test_reject_initialization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test initialization rejected'; END $$",
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER race_test_reject_initialization BEFORE INSERT ON "ProjectInitialization" FOR EACH ROW EXECUTE FUNCTION race_test_reject_initialization()',
      );
      const failedName = "Atomic-rejected-" + randomUUID();
      try {
        await expect(
          projects.create(actor(), {
            name: failedName,
            departmentId,
            configurationTemplateId: templateId,
          }),
        ).rejects.toBeDefined();
        expect(
          await prisma.project.count({
            where: { departmentId, name: failedName },
          }),
        ).toBe(0);
        expect(
          await prisma.projectInitialization.count({
            where: { projectId: created.id },
          }),
        ).toBe(1);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER race_test_reject_initialization ON "ProjectInitialization"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION race_test_reject_initialization()",
        );
      }
    });
    it("HTTP requires and documents revisions, rejects stale writes, and preserves authorization", async () => {
      for (const key of [
        "settings.manage",
        "departments.manage",
        "departments.read",
        "configuration-templates.manage",
        "configuration-templates.read",
      ])
        await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key, description: key, category: "test" },
        });
      const role = await prisma.role.create({
        data: {
          workspaceId,
          key: "RACE",
          name: "Race",
          permissions: {
            create: [
              "settings.manage",
              "departments.manage",
              "departments.read",
              "configuration-templates.manage",
              "configuration-templates.read",
            ].map((permissionKey) => ({ permissionKey })),
          },
        },
      });
      await prisma.userRoleAssignment.create({
        data: {
          workspaceId,
          userId: actorId,
          roleId: role.id,
          assignedById: actorId,
        },
      });
      const module = await Test.createTestingModule({
        controllers: [
          DepartmentsController,
          ConfigurationTemplatesController,
          SettingsController,
        ],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: DepartmentsService, useValue: departments },
          { provide: ProjectsService, useValue: projects },
          { provide: ConfigurationTemplatesService, useValue: templates },
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
      const edit = () =>
        request(app.getHttpServer())
          .put("/configuration-templates/versions/" + versionId + "/manifest")
          .set("Authorization", "Bearer " + actorId);
      await edit().send(manifest("missing")).expect(428);
      await edit().set("If-Match", "*").send(manifest("bad")).expect(400);
      await edit().set("If-Match", '"0"').send(manifest("saved")).expect(200);
      const stale = await edit()
        .set("If-Match", '"0"')
        .send(manifest("stale"))
        .expect(409);
      expect(stale.body.code).toBe("STALE_REVISION");
      await request(app.getHttpServer())
        .patch("/departments/" + departmentId)
        .set("Authorization", "Bearer " + actorId)
        .send({ name: "No revision" })
        .expect(428);

      const doc: any = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/configuration-templates/versions/{versionId}/manifest"].put
          .parameters,
      ).toContainEqual(
        expect.objectContaining({
          name: "If-Match",
          in: "header",
          required: true,
        }),
      );
      expect(
        doc.paths["/departments/{id}"].patch.responses["428"],
      ).toBeDefined();
      expect(
        doc.components.schemas.DepartmentResponseDto.properties.revision.type,
      ).toBe("integer");
      await departments.setDefault(workspaceId, departmentId, 0);
      const settings = await request(app.getHttpServer())
        .get("/settings/projects-home")
        .set("Authorization", "Bearer " + actorId)
        .expect(200);
      const other = await departments.create(workspaceId, {
        name: "Other",
        homePath: root,
        isDefault: false,
      });
      await departments.setDefault(workspaceId, other.id, other.revision);
      // Different target with the SAME numeric revision: departmentId must protect it.
      const currentDefault = await departments.get(workspaceId, other.id);
      expect(settings.body.revision).toBe(currentDefault.revision);
      const settingsPut = () =>
        request(app.getHttpServer())
          .put("/settings/projects-home")
          .set("Authorization", "Bearer " + actorId);
      await settingsPut()
        .send({ path: root, departmentId: other.id })
        .expect(428);
      await settingsPut()
        .set("If-Match", '"' + settings.body.revision + '"')
        .send({ path: root, departmentId: settings.body.departmentId })
        .expect(409);
      await settingsPut()
        .set("If-Match", '"' + currentDefault.revision + '"')
        .send({ path: root, departmentId: other.id })
        .expect(200);
      await request(app.getHttpServer())
        .put("/configuration-templates/versions/" + versionId + "/manifest")
        .set("If-Match", '"1"')
        .send(manifest("unauthorized"))
        .expect(401);
    });
  },
);
