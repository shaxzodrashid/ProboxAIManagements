import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { ProjectInitializationsController } from "../src/projects/project-initializations.controller";
import { ProjectInitializationEventsService } from "../src/projects/project-initialization-events.service";
import { InitializationEventReadback } from "../src/projects/initialization-event-readback";
import { of } from "rxjs";
import { PrismaService } from "../src/prisma/prisma.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { manifestInclude } from "../src/configuration-templates/configuration-templates.service";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
const request = require("supertest");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "55439" ||
    parsed.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test database");
}
(url ? describe : describe.skip)(
  "persisted project initial-enqueue recovery HTTP",
  () => {
    let prisma: PrismaClient,
      app: INestApplication,
      service: ProjectInitializationService;
    let projects: ProjectsService;
    let workspace: string,
      foreignWorkspace: string,
      member: string,
      outsider: string,
      reader: string,
      foreign: string,
      role: string,
      department: string,
      project: string,
      template: string,
      version: string,
      directory: string,
      root: string;
    const priorRoot = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    const permissions = [
      "projects.initializations.manage",
      "projects.initializations.read",
      "projects.create",
    ];
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url } } });
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-enqueue-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
      for (const key of permissions)
        await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key, description: "test", category: "test" },
        });
      service = new ProjectInitializationService(
        prisma as any,
        {} as any,
        new WorkspacePathPolicy(),
        new ProjectInitializationEventsService(),
      );
      // Never start the application's worker or real commands in this fixture.
      service.onModuleInit = async () => undefined;
      projects = new ProjectsService(
        prisma as any,
        {} as any,
        new WorkspacePathPolicy(),
        service,
      );
      projects.onModuleInit = () => undefined;
      const module = await Test.createTestingModule({
        controllers: [ProjectInitializationsController, ProjectsController],
        providers: [
          { provide: ProjectsService, useValue: projects },
          { provide: ProjectInitializationService, useValue: service },
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                type: "access",
                exp: Math.floor(Date.now() / 1000) + 60,
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
    });
    beforeEach(async () => {
      workspace = (
        await prisma.workspace.create({ data: { slug: randomUUID() } })
      ).id;
      foreignWorkspace = (
        await prisma.workspace.create({ data: { slug: randomUUID() } })
      ).id;
      role = (
        await prisma.role.create({
          data: {
            workspaceId: workspace,
            key: "manager",
            name: "Manager",
            permissions: {
              create: permissions.map((permissionKey) => ({ permissionKey })),
            },
          },
        })
      ).id;
      async function user(workspaceId: string, grantRole?: string) {
        return (
          await prisma.user.create({
            data: {
              workspaceId,
              fullName: "Fixture",
              phoneNumber: randomUUID(),
              status: "OPEN",
              ...(grantRole
                ? { roleAssignments: { create: { roleId: grantRole } } }
                : {}),
            },
          })
        ).id;
      }
      member = await user(workspace, role);
      outsider = await user(workspace, role);
      const readRole = (
        await prisma.role.create({
          data: {
            workspaceId: workspace,
            key: "reader",
            name: "Reader",
            permissions: {
              create: { permissionKey: "projects.initializations.read" },
            },
          },
        })
      ).id;
      reader = await user(workspace, readRole);
      const foreignRole = (
        await prisma.role.create({
          data: {
            workspaceId: foreignWorkspace,
            key: "foreign",
            name: "Foreign",
            permissions: {
              create: { permissionKey: "projects.initializations.manage" },
            },
          },
        })
      ).id;
      foreign = await user(foreignWorkspace, foreignRole);
      department = (
        await prisma.department.create({
          data: {
            workspaceId: workspace,
            name: "Fixture",
            slug: randomUUID(),
            homePath: root,
          },
        })
      ).id;
      template = (
        await prisma.configurationTemplate.create({
          data: {
            workspaceId: workspace,
            departmentId: department,
            name: "Pinned",
            slug: randomUUID(),
            creatorId: member,
          },
        })
      ).id;
      version = (
        await prisma.configurationTemplateVersion.create({
          data: {
            templateId: template,
            version: 1,
            status: "PUBLISHED",
            revision: 0,
            creatorId: member,
          },
        })
      ).id;
      directory = randomUUID();
      project = (
        await prisma.project.create({
          data: {
            workspaceId: workspace,
            departmentId: department,
            name: "Persisted failure",
            directoryName: directory,
            creatorId: member,
            appliedTemplateVersionId: version,
            status: "FAILED",
            members: { create: { userId: member } },
          },
        })
      ).id;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.project.deleteMany({ where: { workspaceId: workspace } });
      await prisma.configurationTemplate.deleteMany({
        where: { workspaceId: { in: [workspace, foreignWorkspace] } },
      });
      await prisma.department.deleteMany({
        where: { workspaceId: { in: [workspace, foreignWorkspace] } },
      });
      await prisma.user.deleteMany({
        where: { workspaceId: { in: [workspace, foreignWorkspace] } },
      });
      await prisma.role.deleteMany({
        where: { workspaceId: { in: [workspace, foreignWorkspace] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspace, foreignWorkspace] } },
      });
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
      if (priorRoot === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoot;
      if (
        !path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(root).startsWith("proboxai-enqueue-")
      )
        throw new Error("Unsafe fixture cleanup");
      await fs.rm(root, { recursive: true, force: true });
    });
    const http = () => request(app.getHttpServer());
    const state = (actor = member, id = project) =>
      http()
        .get(`/projects/${id}/initializations/recovery`)
        .set("Authorization", "Bearer " + actor);
    const recover = (actor = member, pinned = version, id = project) =>
      http()
        .post(`/projects/${id}/initializations/recover-enqueue`)
        .set("Authorization", "Bearer " + actor)
        .send({ templateVersionId: pinned });
    const eventActor = (id = member) => ({
      id,
      workspaceId: workspace,
      roles: [],
      permissions: [],
      accessExpiresAt: Date.now() + 10000,
    });
    const eventRead = (
      id: string,
      query = "",
      actor = member,
      scope = project,
    ) =>
      http()
        .get(`/projects/${scope}/initializations/${id}/events${query}`)
        .set("Authorization", "Bearer " + actor);
    const waitFor = async (condition: () => boolean) => {
      for (let n = 0; n < 200; n++) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Timed out waiting for initialization stream");
    };
    const addEvent = async (id: string, count = 1) =>
      prisma.$transaction(async (tx) => {
        const updated = await tx.projectInitialization.update({
          where: { id },
          data: { lastSequence: { increment: count } },
        });
        await tx.projectInitializationEvent.createMany({
          data: Array.from({ length: count }, (_, n) => ({
            initializationId: id,
            sequence: updated.lastSequence - count + n + 1,
            type: "fixture.event",
            payload: { message: "fixture " + n },
          })),
        });
      });
    it("bounds persisted event pages, preserves payloads and rejects malformed/ahead cursors", async () => {
      const id = (await recover().expect(200)).body.initialization.id;
      await addEvent(id, 105);
      const first = await eventRead(id).expect(200);
      expect(first.headers["cache-control"]).toBe("no-store");
      expect(first.body).toHaveLength(100);
      expect(first.body.map((e: any) => e.sequence)).toEqual(
        Array.from({ length: 100 }, (_, n) => n + 1),
      );
      const rest = await eventRead(id, "?after=100&limit=10").expect(200);
      expect(rest.body.map((e: any) => e.sequence)).toEqual([
        101, 102, 103, 104, 105, 106,
      ]);
      expect((await eventRead(id, "?after=106").expect(200)).body).toEqual([]);
      for (const query of [
        "?after=-1",
        "?after=1.5",
        "?after=",
        "?after=1e2",
        "?after=0x10",
        "?after=2147483648",
        "?limit=0",
        "?limit=101",
        "?unknown=1",
      ])
        await eventRead(id, query).expect(400);
      await eventRead(id, "?after=107").expect(409);
      await eventRead("invalid").expect(400);
      expect((await eventRead(id).expect(200)).body).toEqual(first.body);
    });
    it.each([2, 3])(
      "rejects missing persisted sequence %s rather than silently advancing",
      async (missing) => {
        const id = (await recover().expect(200)).body.initialization.id;
        await addEvent(id, 2);
        await prisma.projectInitializationEvent.deleteMany({
          where: { initializationId: id, sequence: missing },
        });
        expect((await eventRead(id).expect(409)).body.code).toBe(
          "INITIALIZATION_HISTORY_UNAVAILABLE",
        );
        let error: any;
        const received: any[] = [];
        const sub = (
          await service.stream(eventActor() as any, project, id)
        ).subscribe({
          next: (e) => received.push(e),
          error: (e) => {
            error = e;
          },
        });
        try {
          await waitFor(() => Boolean(error));
          expect(error.status).toBe(409);
          expect(received).toEqual([]);
        } finally {
          sub.unsubscribe();
        }
      },
    );
    it("delivers commits between stream creation and subscription, including without notifications", async () => {
      const id = (await recover().expect(200)).body.initialization.id;
      const stream = await service.stream(eventActor() as any, project, id);
      await addEvent(id);
      const received: any[] = [];
      const sub = stream.subscribe((e) => received.push(e));
      try {
        await waitFor(() => received.length === 2);
        await addEvent(id);
        await waitFor(() => received.length === 3);
        expect(received.map((e) => e.id)).toEqual(["1", "2", "3"]);
        const persisted = (await eventRead(id).expect(200)).body;
        expect(received.map((e) => e.data)).toEqual(
          persisted.map((e: any) => e.payload),
        );
        const replay: any[] = [];
        const resumed = (
          await service.stream(eventActor() as any, project, id, 1)
        ).subscribe((e) => replay.push(e));
        try {
          await waitFor(() => replay.length === 2);
          expect(replay.map((e) => e.id)).toEqual(["2", "3"]);
        } finally {
          resumed.unsubscribe();
        }
      } finally {
        sub.unsubscribe();
      }
    });
    it.each([
      "grant",
      "membership",
      "closed",
      "workspace",
      "public",
      "read-all",
    ])("stops subsequent batches on current %s revocation", async (change) => {
      const id = (await recover().expect(200)).body.initialization.id;
      if (["public", "read-all"].includes(change)) {
        await prisma.projectMember.deleteMany({
          where: { projectId: project, userId: member },
        });
        if (change === "public")
          await prisma.project.update({
            where: { id: project },
            data: { readAccessEnabled: true },
          });
        else {
          await prisma.permission.upsert({
            where: { key: "projects.read-all" },
            update: {},
            create: {
              key: "projects.read-all",
              name: "test",
              description: "test",
              category: "test",
            },
          });
          await prisma.rolePermission.create({
            data: { roleId: role, permissionKey: "projects.read-all" },
          });
        }
      }
      const received: any[] = [];
      let streamError: any;
      const sub = (
        await service.stream(eventActor() as any, project, id)
      ).subscribe({
        next: (e) => received.push(e),
        error: (e) => {
          streamError = e;
        },
      });
      try {
        await waitFor(() => received.length === 1);
        if (change === "grant")
          await prisma.rolePermission.deleteMany({
            where: {
              roleId: role,
              permissionKey: "projects.initializations.read",
            },
          });
        if (change === "membership")
          await prisma.projectMember.deleteMany({
            where: { projectId: project, userId: member },
          });
        if (change === "closed")
          await prisma.user.update({
            where: { id: member },
            data: { status: "BANNED" },
          });
        if (change === "workspace") {
          await prisma.userRoleAssignment.deleteMany({
            where: { userId: member },
          });
          await prisma.user.update({
            where: { id: member },
            data: { workspaceId: foreignWorkspace },
          });
        }
        if (change === "public")
          await prisma.project.update({
            where: { id: project },
            data: { readAccessEnabled: false },
          });
        if (change === "read-all")
          await prisma.rolePermission.deleteMany({
            where: { roleId: role, permissionKey: "projects.read-all" },
          });
        await addEvent(id);
        await waitFor(() => Boolean(streamError));
        expect(streamError.status).toBe(403);
        expect(received).toHaveLength(1);
      } finally {
        sub.unsubscribe();
      }
    });
    it("rechecks public project read scope and read-all instead of trusting stale actor grants", async () => {
      const id = (await recover().expect(200)).body.initialization.id;
      await eventRead(id, "", outsider).expect(403);
      await eventRead(id, "", foreign).expect(403);
      const foreignGrant = await prisma.userRoleAssignment.findFirstOrThrow({
        where: { userId: foreign },
      });
      await prisma.rolePermission.create({
        data: {
          roleId: foreignGrant.roleId,
          permissionKey: "projects.initializations.read",
        },
      });
      await eventRead(id, "", foreign).expect(404);
      await prisma.project.update({
        where: { id: project },
        data: { readAccessEnabled: true },
      });
      await eventRead(id, "", reader).expect(200);
      await prisma.project.update({
        where: { id: project },
        data: { readAccessEnabled: false },
      });
      await eventRead(id, "", reader).expect(403);
      await prisma.permission.upsert({
        where: { key: "projects.read-all" },
        update: {},
        create: {
          key: "projects.read-all",
          name: "test",
          description: "test",
          category: "test",
        },
      });
      await prisma.rolePermission.create({
        data: { roleId: role, permissionKey: "projects.read-all" },
      });
      await eventRead(id, "", outsider).expect(200);
      await prisma.rolePermission.deleteMany({
        where: { roleId: role, permissionKey: "projects.read-all" },
      });
      await expect(
        service.events(
          {
            ...eventActor(outsider),
            permissions: ["projects.read-all", "projects.initializations.read"],
          } as any,
          project,
          id,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await eventRead(randomUUID()).expect(404);
    });
    it("streams more than one persisted batch without gaps or duplicates", async () => {
      const id = (await recover().expect(200)).body.initialization.id;
      await addEvent(id, 105);
      const received: any[] = [];
      const sub = (
        await service.stream(eventActor() as any, project, id)
      ).subscribe((e) => received.push(e));
      try {
        await waitFor(() => received.length === 106);
        expect(received.map((e) => Number(e.id))).toEqual(
          Array.from({ length: 106 }, (_, n) => n + 1),
        );
      } finally {
        sub.unsubscribe();
      }
    });
    it.each(["unsubscribe", "expiry"])(
      "does not emit a completed database batch after pending-read %s",
      async (reason) => {
        const id = (await recover().expect(200)).body.initialization.id;
        const rows = await service.events(eventActor() as any, project, id);
        const stream = await service.stream(
          { ...eventActor(), accessExpiresAt: Date.now() + 200 } as any,
          project,
          id,
        );
        let release!: () => void;
        let entered = false;
        const pendingRead = new Promise<void>((resolve) => {
          release = resolve;
        });
        const spy = jest
          .spyOn(InitializationEventReadback.prototype, "read")
          .mockImplementationOnce(async () => {
            entered = true;
            await pendingRead;
            return rows;
          });
        const received: any[] = [];
        let ended = false;
        const sub = stream.subscribe({
          next: (e) => received.push(e),
          complete: () => {
            ended = true;
          },
        });
        try {
          await waitFor(() => entered);
          if (reason === "unsubscribe") sub.unsubscribe();
          else await new Promise((r) => setTimeout(r, 250));
          release();
          await new Promise((r) => setTimeout(r, 30));
          expect(received).toEqual([]);
          if (reason === "expiry") expect(ended).toBe(true);
        } finally {
          release();
          sub.unsubscribe();
          spy.mockRestore();
        }
      },
    );
    it("expires idle streams and cancels delivery on unsubscribe without cancelling setup", async () => {
      const id = (await recover().expect(200)).body.initialization.id;
      let ended = false;
      const received: any[] = [];
      const expiring = (
        await service.stream(
          { ...eventActor(), accessExpiresAt: Date.now() + 1000 } as any,
          project,
          id,
        )
      ).subscribe({
        next: (e) => received.push(e),
        complete: () => {
          ended = true;
        },
      });
      try {
        await waitFor(() => ended);
        await addEvent(id);
        await new Promise((r) => setTimeout(r, 120));
        expect(received).toHaveLength(1);
      } finally {
        expiring.unsubscribe();
      }
      const cancelled: any[] = [];
      const sub = (
        await service.stream(eventActor() as any, project, id)
      ).subscribe((e) => cancelled.push(e));
      sub.unsubscribe();
      await new Promise((r) => setTimeout(r, 40));
      expect(cancelled).toEqual([]);
      expect(
        (
          await prisma.projectInitialization.findUniqueOrThrow({
            where: { id },
          })
        ).status,
      ).toBe("QUEUED");
    });
    it("sanitizes unavailable database reads and documents event DTOs", async () => {
      const id = (await recover().expect(200)).body.initialization.id;
      jest
        .spyOn(prisma, "$transaction")
        .mockRejectedValueOnce(new Error("private database credential"));
      const error = await service
        .events(eventActor() as any, project, id)
        .catch((e) => e);
      expect(error.status).toBe(503);
      expect(JSON.stringify(error.getResponse())).not.toContain("credential");
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const schemas: any = doc.components!.schemas;
      expect(schemas.InitializationPersistedEventDto.required).toContain(
        "sequence",
      );
      expect(
        schemas.InitializationStreamEventDto.properties.data,
      ).toBeDefined();
      for (const [query, header] of [
        ["?after=1", "2"],
        ["", "-1"],
        ["?limit=2", "1"],
      ])
        await http()
          .get(
            `/projects/${project}/initializations/${id}/events/stream${query}`,
          )
          .set("Authorization", "Bearer " + member)
          .set("Last-Event-ID", header!)
          .expect(400);
      const streamSpy = jest.spyOn(service, "stream").mockResolvedValue(
        of({
          id: "2",
          type: "fixture.event",
          data: { message: "fixture" },
        } as unknown as MessageEvent),
      );
      for (const query of ["", "?after=1"]) {
        await http()
          .get(
            `/projects/${project}/initializations/${id}/events/stream${query}`,
          )
          .set("Authorization", "Bearer " + member)
          .set("Last-Event-ID", "1")
          .expect(200);
        expect(streamSpy.mock.calls.at(-1)![3]).toBe(1);
      }
    });
    it("distinguishes missing attempt and registers only the exact pinned template", async () => {
      const before = await state().expect(200);
      expect(before.headers["cache-control"]).toBe("no-store");
      expect(before.body).toEqual({
        projectId: project,
        projectStatus: "FAILED",
        pinnedTemplateVersionId: version,
        state: "NO_ATTEMPT",
        canRegisterInitialSetup: true,
        blockedReason: null,
        latestAttempt: null,
      });
      await prisma.configurationTemplateVersion.create({
        data: {
          templateId: template,
          version: 2,
          status: "PUBLISHED",
          creatorId: member,
        },
      });
      const result = await recover().expect(200);
      expect(result.body).toEqual({
        registered: true,
        created: true,
        projectId: project,
        projectStatus: "INITIALIZING",
        pinnedTemplateVersionId: version,
        initialization: {
          id: expect.any(String),
          templateVersionId: version,
          attempt: 1,
          status: "QUEUED",
        },
      });
      expect((await state().expect(200)).body).toMatchObject({
        state: "ATTEMPT_EXISTS",
        canRegisterInitialSetup: false,
        blockedReason: "ATTEMPT_EXISTS",
        latestAttempt: result.body.initialization,
      });
      expect(await prisma.project.count({ where: { id: project } })).toBe(1);
      const audit = await prisma.projectInitializationEvent.findMany({
        where: { initializationId: result.body.initialization.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.payload).toEqual({
        actorId: member,
        projectId: project,
        templateVersionId: version,
        registrationOnly: true,
      });
    });
    it("serializes simultaneous recovery and returns one registration identity", async () => {
      const responses = await Promise.all([
        recover().expect(200),
        recover().expect(200),
        recover().expect(200),
      ]);
      expect(responses.filter((r) => r.body.created)).toHaveLength(1);
      expect(new Set(responses.map((r) => r.body.initialization.id)).size).toBe(
        1,
      );
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(1);
    });
    it("repeating registration never retries a failed attempt", async () => {
      const first = (await recover().expect(200)).body;
      await prisma.projectInitialization.update({
        where: { id: first.initialization.id },
        data: { status: "FAILED", error: "private worker error" },
      });
      await prisma.project.update({
        where: { id: project },
        data: { status: "FAILED" },
      });
      const repeated = (await recover().expect(200)).body;
      expect(repeated).toMatchObject({
        created: false,
        projectStatus: "FAILED",
        initialization: {
          id: first.initialization.id,
          status: "FAILED",
          attempt: 1,
        },
      });
      expect(JSON.stringify(repeated)).not.toContain("private worker error");
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(1);
    });
    it("reconciles actual commit with lost acknowledgment without a new attempt", async () => {
      const original = prisma.$transaction.bind(prisma);
      jest.spyOn(prisma, "$transaction").mockImplementationOnce((async (
        ...args: any[]
      ) => {
        await (original as any)(...args);
        throw new Error("lost acknowledgment secret");
      }) as any);
      const unknown = await recover().expect(503);
      expect(unknown.body).toMatchObject({
        code: "PROJECT_ENQUEUE_OUTCOME_UNKNOWN",
        projectId: project,
        templateVersionId: version,
      });
      expect(JSON.stringify(unknown.body)).not.toContain("secret");
      const read = await state().expect(200);
      expect(read.body.state).toBe("ATTEMPT_EXISTS");
      expect((await recover().expect(200)).body).toMatchObject({
        created: false,
        initialization: read.body.latestAttempt,
      });
    });
    it("rolls back job and project state when audit persistence fails", async () => {
      const original = prisma.$transaction.bind(prisma);
      jest.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: any) =>
        original(async (tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                if (prop === "projectInitializationEvent")
                  return {
                    create: async () => {
                      throw new Error("injected audit rejection");
                    },
                  };
                return Reflect.get(target, prop);
              },
            }),
          ),
        )) as any);
      await recover().expect(503);
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(0);
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id: project } }))
          .status,
      ).toBe("FAILED");
      expect((await recover().expect(200)).body.created).toBe(true);
    });
    it("enforces current grants, membership and workspace independently of readAccessEnabled", async () => {
      await state(reader).expect(403);
      await recover(reader).expect(403);
      await state(outsider).expect(403);
      await recover(outsider).expect(403);
      await state(foreign).expect(404);
      await recover(foreign).expect(404);
      await prisma.project.update({
        where: { id: project },
        data: { readAccessEnabled: true },
      });
      await recover(outsider).expect(403);
      await prisma.userRoleAssignment.delete({
        where: { userId_roleId: { userId: member, roleId: role } },
      });
      const stale = {
        id: member,
        workspaceId: workspace,
        permissions,
        roles: [],
      } as any;
      await expect(
        service.recoverEnqueue(stale, project, version),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(0);
    });
    it("rejects changed pin, unavailable template, deleting and ready-without-attempt projects", async () => {
      await recover(member, randomUUID()).expect(409);
      await prisma.configurationTemplateVersion.update({
        where: { id: version },
        data: { status: "DRAFT" },
      });
      expect((await state().expect(200)).body.blockedReason).toBe(
        "PINNED_TEMPLATE_UNAVAILABLE",
      );
      await recover().expect(409);
      await prisma.configurationTemplateVersion.update({
        where: { id: version },
        data: { status: "PUBLISHED" },
      });
      for (const status of ["DELETING", "READY"] as const) {
        await prisma.project.update({
          where: { id: project },
          data: { status },
        });
        expect((await state().expect(200)).body.blockedReason).toBe(
          "PROJECT_NOT_RECOVERABLE",
        );
        await recover().expect(409);
      }
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(0);
    });
    it("does not clear existing project data and the worker refuses nonempty destination", async () => {
      const final = path.join(root, directory);
      await fs.mkdir(final);
      await fs.writeFile(path.join(final, "keep.txt"), "Existing data");
      const first = (await recover().expect(200)).body;
      const job = await prisma.projectInitialization.findUniqueOrThrow({
        where: { id: first.initialization.id },
        include: {
          project: { include: { department: true } },
          templateVersion: { include: manifestInclude },
        },
      });
      await expect((service as any).materialize(job)).rejects.toThrow(
        "Project directory already exists",
      );
      expect(await fs.readFile(path.join(final, "keep.txt"), "utf8")).toBe(
        "Existing data",
      );
    });
    it("allows minimal recovery readback with manage-only permission", async () => {
      await prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: role,
            permissionKey: "projects.initializations.read",
          },
        },
      });
      expect((await state().expect(200)).body.state).toBe("NO_ATTEMPT");
      expect((await recover().expect(200)).body.created).toBe(true);
    });
    it("returns first registration unchanged when later work already exists", async () => {
      const first = (await recover().expect(200)).body.initialization;
      await prisma.projectInitialization.update({
        where: { id: first.id },
        data: { status: "FAILED" },
      });
      const second = await prisma.projectInitialization.create({
        data: {
          projectId: project,
          templateVersionId: version,
          attempt: 2,
          status: "RUNNING",
        },
      });
      const repeated = await recover().expect(200);
      expect(repeated.body).toMatchObject({
        created: false,
        initialization: { id: first.id, attempt: 1, status: "FAILED" },
      });
      expect((await state().expect(200)).body.latestAttempt.id).toBe(second.id);
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(2);
    });
    it("refuses history gaps rather than inventing a first attempt", async () => {
      await prisma.projectInitialization.create({
        data: {
          projectId: project,
          templateVersionId: version,
          attempt: 2,
          status: "FAILED",
        },
      });
      expect((await recover().expect(409)).body.code).toBe(
        "INITIALIZATION_HISTORY_CONFLICT",
      );
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(1);
    });
    const submit = (body: any, actor = member) =>
      http()
        .post("/projects/creation-submissions")
        .set("Authorization", "Bearer " + actor)
        .send(body);
    const outcome = (key: string, actor = member) =>
      http()
        .get(`/projects/creation-submissions/${key}`)
        .set("Authorization", "Bearer " + actor);
    const creation = (extra = {}) => ({
      requestId: randomUUID(),
      name: "Submission-" + randomUUID(),
      departmentId: department,
      ...extra,
    });
    async function settled(key: string) {
      for (let n = 0; n < 150; n++) {
        const r = await outcome(key).expect(200);
        if (r.body.executionFinished) return r.body;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Creation callback did not settle");
    }
    it("discovers original committed creation after response loss without project-list permission", async () => {
      const body = creation({ configurationTemplateId: template });
      const original = projects.submitCreation.bind(projects);
      jest
        .spyOn(projects, "submitCreation")
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new Error("Injected lost original response");
        });
      await submit(body).expect(500);
      const read = await outcome(body.requestId).expect(200);
      expect(read.headers["cache-control"]).toBe("no-store");
      expect(read.body).toMatchObject({
        requestId: body.requestId,
        state: "COMPLETED",
        projectId: expect.any(String),
        initializationId: expect.any(String),
        departmentId: department,
        templateVersionId: version,
        willReplay: false,
      });
      await http()
        .get("/projects")
        .set("Authorization", "Bearer " + member)
        .expect(403);
      const duplicate = await submit(body).expect(202);
      expect(duplicate.body.projectId).toBe(read.body.projectId);
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(1);
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: read.body.projectId },
        }),
      ).toBe(1);
      expect(
        await prisma.projectCreationSubmission.count({
          where: { workspaceId: workspace, requestId: body.requestId },
        }),
      ).toBe(1);
      expect(Object.keys(read.body).sort()).toEqual(
        [
          "requestId",
          "state",
          "projectId",
          "initializationId",
          "departmentId",
          "templateVersionId",
          "failureCode",
          "executionFinished",
          "willReplay",
          "createdAt",
        ].sort(),
      );
    });
    it("binds same key to normalized original inputs and denies cross-user/workspace discovery", async () => {
      const body = creation();
      const first = await submit(body).expect(202);
      expect(first.body.state).toBe("COMPLETED");
      await submit({ ...body, name: body.name + "-changed" }).expect(409);
      await submit({ ...body, existingDirectoryAction: "CLEAR" }).expect(409);
      await outcome(body.requestId, outsider).expect(404);
      await submit(body, outsider).expect(404);
      await outcome(body.requestId, foreign).expect(403);
      const foreignRole = await prisma.role.findFirstOrThrow({
        where: { workspaceId: foreignWorkspace },
      });
      await prisma.rolePermission.create({
        data: { roleId: foreignRole.id, permissionKey: "projects.create" },
      });
      await outcome(body.requestId, foreign).expect(404);
      await submit(body, foreign).expect(409);
      await outcome(body.requestId, reader).expect(403);
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(1);
    });
    it("serializes same-key concurrent creation into one project and one job", async () => {
      const body = creation({ configurationTemplateId: template });
      await Promise.all([
        submit(body).expect(202),
        submit(body).expect(202),
        submit(body).expect(202),
      ]);
      const read = await settled(body.requestId);
      expect(read.state).toBe("COMPLETED");
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(1);
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: read.projectId },
        }),
      ).toBe(1);
      expect(
        await prisma.projectCreationSubmission.count({
          where: { workspaceId: workspace, requestId: body.requestId },
        }),
      ).toBe(1);
    });
    it("does not repeat CLEAR or recreate a removed project on same-key retry", async () => {
      const body = creation({ existingDirectoryAction: "CLEAR" });
      const target = path.join(root, body.name);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "original.txt"), "Original");
      const removal = jest.spyOn(fs, "rm");
      const first = await submit(body).expect(202);
      expect(first.body.state).toBe("COMPLETED");
      expect(removal).toHaveBeenCalledTimes(1);
      await fs.writeFile(path.join(target, "replacement.txt"), "Replacement");
      await prisma.project.delete({ where: { id: first.body.projectId } });
      expect((await submit(body).expect(202)).body.projectId).toBe(
        first.body.projectId,
      );
      expect(removal).toHaveBeenCalledTimes(1);
      expect(
        await fs.readFile(path.join(target, "replacement.txt"), "utf8"),
      ).toBe("Replacement");
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(0);
    });
    it("returns unresolved after rollback and never repeats a failed CLEAR", async () => {
      const body = creation({ existingDirectoryAction: "CLEAR" });
      const target = path.join(root, body.name);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "original.txt"), "Original");
      const original = prisma.$transaction.bind(prisma);
      jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(original as any)
        .mockImplementationOnce(((fn: any, opts: any) =>
          original(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "project")
                      return new Proxy(t.project, {
                        get(model, key) {
                          if (key === "create")
                            return async () => {
                              throw new Error("Injected project rejection");
                            };
                          return Reflect.get(model, key);
                        },
                      });
                    return Reflect.get(t, p);
                  },
                }),
              ),
            opts,
          )) as any);
      const failure = await submit(body).expect(202);
      expect(failure.body).toMatchObject({
        state: "UNRESOLVED",
        projectId: null,
        initializationId: null,
        failureCode: "CREATION_OUTCOME_UNKNOWN",
        willReplay: false,
      });
      await settled(body.requestId);
      await fs.writeFile(path.join(target, "replacement.txt"), "Replacement");
      const removal = jest.spyOn(fs, "rm");
      await submit(body).expect(202);
      expect(removal).not.toHaveBeenCalled();
      expect(
        await fs.readFile(path.join(target, "replacement.txt"), "utf8"),
      ).toBe("Replacement");
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(0);
    });
    it("reconciles commit-with-lost-database-acknowledgment through the recorded project ID", async () => {
      const body = creation({ configurationTemplateId: template });
      const original = prisma.$transaction.bind(prisma);
      jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(original as any)
        .mockImplementationOnce((async (...args: any[]) => {
          await (original as any)(...args);
          throw new Error("Lost database acknowledgment");
        }) as any);
      const result = await submit(body).expect(202);
      expect(result.body.state).toBe("COMPLETED");
      expect((await outcome(body.requestId).expect(200)).body.projectId).toBe(
        result.body.projectId,
      );
      expect((await submit(body).expect(202)).body.initializationId).toBe(
        result.body.initializationId,
      );
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: result.body.projectId },
        }),
      ).toBe(1);
    });
    it("never executes a reservation whose commit acknowledgment was lost", async () => {
      const body = creation({ existingDirectoryAction: "CLEAR" });
      const target = path.join(root, body.name);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "original.txt"), "Original");
      const original = prisma.$transaction.bind(prisma);
      jest.spyOn(prisma, "$transaction").mockImplementationOnce((async (
        ...args: any[]
      ) => {
        await (original as any)(...args);
        throw new Error("Lost reservation acknowledgment");
      }) as any);
      await submit(body).expect(503);
      expect((await outcome(body.requestId).expect(200)).body).toMatchObject({
        state: "UNRESOLVED",
        projectId: null,
        executionFinished: false,
      });
      await submit(body).expect(202);
      expect(await fs.readFile(path.join(target, "original.txt"), "utf8")).toBe(
        "Original",
      );
      await submit({ ...body, requestId: randomUUID() }).expect(409);
      await http()
        .post("/projects")
        .set("Authorization", "Bearer " + member)
        .send({
          name: body.name,
          departmentId: department,
          existingDirectoryAction: "KEEP",
        })
        .expect(409);
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(0);
    });
    it("keeps an in-flight CLEAR fenced after timeout until the callback really settles", async () => {
      const body = creation({ existingDirectoryAction: "CLEAR" });
      const target = path.join(root, body.name);
      await fs.mkdir(target);
      const file = path.join(target, "original.txt");
      await fs.writeFile(file, "Original");
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const originalRm = fs.rm.bind(fs);
      jest.spyOn(fs, "rm").mockImplementation((async (
        value: any,
        options: any,
      ) => {
        if (String(value) === file) {
          entered();
          await blocked;
        }
        return originalRm(value, options);
      }) as any);
      const original = prisma.$transaction.bind(prisma);
      jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(original as any)
        .mockImplementationOnce(((fn: any) => {
          const transaction = original(fn, { timeout: 250 });
          void transaction.catch(() => undefined);
          return Promise.race([
            transaction,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Injected lost timeout acknowledgment")),
                500,
              ),
            ),
          ]);
        }) as any);
      const pending = submit(body)
        .expect(202)
        .then((r: any) => r);
      try {
        await started;
        const timeout = await pending;
        expect(timeout.body).toMatchObject({
          state: "UNRESOLVED",
          projectId: null,
          executionFinished: false,
        });
        await submit(body).expect(202);
        await submit({ ...body, requestId: randomUUID() }).expect(409);
        await http()
          .post("/projects")
          .set("Authorization", "Bearer " + member)
          .send({
            name: body.name,
            departmentId: department,
            existingDirectoryAction: "KEEP",
          })
          .expect(409);
      } finally {
        release();
      }
      expect((await settled(body.requestId)).state).toBe("UNRESOLVED");
      await fs.writeFile(path.join(target, "replacement.txt"), "Replacement");
      await submit(body).expect(202);
      expect(
        await fs.readFile(path.join(target, "replacement.txt"), "utf8"),
      ).toBe("Replacement");
    });
    it("fences tracked creation behind a timed-out legacy directory write", async () => {
      const body = creation();
      const target = path.join(root, body.name);
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        entered = r;
      });
      const originalMkdir = fs.mkdir.bind(fs);
      jest.spyOn(fs, "mkdir").mockImplementation((async (
        value: any,
        options: any,
      ) => {
        if (String(value) === target) {
          entered();
          await blocked;
        }
        return originalMkdir(value, options);
      }) as any);
      const original = prisma.$transaction.bind(prisma);
      jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(original as any)
        .mockImplementationOnce(((fn: any) => {
          const transaction = original(fn, { timeout: 250 });
          void transaction.catch(() => undefined);
          return Promise.race([
            transaction,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Lost legacy timeout acknowledgment")),
                500,
              ),
            ),
          ]);
        }) as any);
      const pending = http()
        .post("/projects")
        .set("Authorization", "Bearer " + member)
        .send({ name: body.name, departmentId: department })
        .expect(500)
        .then((r: any) => r);
      let key = "";
      try {
        await started;
        await pending;
        key = (
          await prisma.projectCreationSubmission.findFirstOrThrow({
            where: { workspaceId: workspace, targetPath: target },
          })
        ).requestId;
        await submit(body).expect(409);
        expect((await outcome(key).expect(200)).body.executionFinished).toBe(
          false,
        );
      } finally {
        release();
      }
      await settled(key);
      expect(
        await prisma.project.count({
          where: { departmentId: department, directoryName: body.name },
        }),
      ).toBe(0);
    });
    it("rejects case aliases of managed project data before CLEAR", async () => {
      if (process.platform !== "win32") return; // Case-sensitive filesystems are a different namespace.
      const body = creation();
      const first = await submit(body).expect(202);
      const target = path.join(root, body.name);
      await fs.writeFile(path.join(target, "keep.txt"), "Managed data");
      await submit({
        ...body,
        requestId: randomUUID(),
        name: body.name.toLowerCase(),
        existingDirectoryAction: "KEEP",
      }).expect(409);
      await http()
        .post("/projects")
        .set("Authorization", "Bearer " + member)
        .send({
          name: body.name.toLowerCase(),
          departmentId: department,
          existingDirectoryAction: "KEEP",
        })
        .expect(409);
      expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe(
        "Managed data",
      );
      expect(
        await prisma.project.count({ where: { id: first.body.projectId } }),
      ).toBe(1);
    });
    it("pins implicit department and exact template before later configuration changes", async () => {
      await prisma.department.update({
        where: { id: department },
        data: { isDefault: true },
      });
      const body = creation({
        departmentId: undefined,
        configurationTemplateId: template,
      });
      const original = projects.create.bind(projects);
      jest.spyOn(projects, "create").mockImplementationOnce(async (...args) => {
        await prisma.configurationTemplateVersion.create({
          data: {
            templateId: template,
            version: 2,
            status: "PUBLISHED",
            creatorId: member,
          },
        });
        await prisma.department.update({
          where: { id: department },
          data: { isDefault: false },
        });
        return original(...args);
      });
      const result = await submit(body).expect(202);
      expect(result.body).toMatchObject({
        state: "COMPLETED",
        departmentId: department,
        templateVersionId: version,
      });
      expect(
        (
          await prisma.projectInitialization.findUniqueOrThrow({
            where: { id: result.body.initializationId },
          })
        ).templateVersionId,
      ).toBe(version);
    });
    it("keeps lookup and repeat submission authorized against current grants", async () => {
      const body = creation();
      await submit(body).expect(202);
      await prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: role,
            permissionKey: "projects.create",
          },
        },
      });
      await outcome(body.requestId).expect(403);
      await submit(body).expect(403);
      const stale = {
        id: member,
        workspaceId: workspace,
        roles: [],
        permissions: ["projects.create"],
      } as any;
      await expect(
        projects.creationOutcome(stale, body.requestId),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("documents submission identity and validates request IDs", async () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/projects/creation-submissions"]!.post!.responses["202"],
      ).toMatchObject({
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ProjectCreationOutcomeDto" },
          },
        },
      });
      expect(
        doc.paths["/projects/creation-submissions/{requestId}"]!.get,
      ).toBeDefined();
      await submit(creation({ requestId: "invalid" })).expect(400);
      await outcome("invalid").expect(400);
      await outcome(randomUUID()).expect(404);
    });
    it("requires client identity for CLEAR instead of silently retrying legacy destructive work", async () => {
      const body = creation();
      const target = path.join(root, body.name);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "keep.txt"), "Keep");
      for (let n = 0; n < 2; n++) {
        const r = await http()
          .post("/projects")
          .set("Authorization", "Bearer " + member)
          .send({
            name: body.name,
            departmentId: department,
            existingDirectoryAction: "CLEAR",
          })
          .expect(428);
        expect(r.body.code).toBe("PROJECT_CREATION_ID_REQUIRED");
      }
      expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe(
        "Keep",
      );
      expect(
        await prisma.projectCreationSubmission.count({
          where: { workspaceId: workspace },
        }),
      ).toBe(0);
    });
    it("publishes allowlisted schemas and UUID validation", async () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths["/projects/{projectId}/initializations/recover-enqueue"]!
          .post!.responses["200"],
      ).toMatchObject({
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ProjectEnqueueRecoveryResponseDto",
            },
          },
        },
      });
      expect(
        (doc.components!.schemas!.RecoverProjectEnqueueDto as any).required,
      ).toEqual(["templateVersionId"]);
      await http()
        .post(`/projects/${project}/initializations/recover-enqueue`)
        .set("Authorization", "Bearer " + member)
        .send({})
        .expect(400);
      await recover(member, "not-a-uuid").expect(400);
      await state(member, "not-a-uuid").expect(400);
    });
    it.each(["SUCCEEDED", "CANCELLED", "RUNNING"] as const)(
      "never reexecutes an existing %s registration",
      async (status) => {
        const first = (await recover().expect(200)).body.initialization;
        await prisma.projectInitialization.update({
          where: { id: first.id },
          data: { status },
        });
        expect((await recover().expect(200)).body).toMatchObject({
          created: false,
          initialization: { id: first.id, status },
        });
        expect(
          await prisma.projectInitialization.count({
            where: { projectId: project },
          }),
        ).toBe(1);
        expect(
          await prisma.projectInitializationEvent.count({
            where: { initializationId: first.id },
          }),
        ).toBe(1);
      },
    );
    it("rejects a first attempt bound to a different template without changing it", async () => {
      const alternate = await prisma.configurationTemplateVersion.create({
        data: {
          templateId: template,
          version: 2,
          status: "PUBLISHED",
          creatorId: member,
        },
      });
      await prisma.projectInitialization.create({
        data: {
          projectId: project,
          templateVersionId: alternate.id,
          attempt: 1,
          status: "FAILED",
        },
      });
      expect((await recover().expect(409)).body.code).toBe(
        "INITIALIZATION_HISTORY_CONFLICT",
      );
      expect(
        (
          await prisma.projectInitialization.findFirstOrThrow({
            where: { projectId: project },
          })
        ).templateVersionId,
      ).toBe(alternate.id);
    });
    it("requires active department and rejects a foreign-workspace pinned template", async () => {
      await prisma.department.update({
        where: { id: department },
        data: { status: "ARCHIVED" },
      });
      expect((await state().expect(200)).body.blockedReason).toBe(
        "PINNED_TEMPLATE_UNAVAILABLE",
      );
      await recover().expect(409);
      await prisma.department.update({
        where: { id: department },
        data: { status: "ACTIVE" },
      });
      const otherDepartment = await prisma.department.create({
        data: {
          workspaceId: foreignWorkspace,
          name: "Foreign",
          slug: randomUUID(),
          homePath: root,
        },
      });
      const otherTemplate = await prisma.configurationTemplate.create({
        data: {
          workspaceId: foreignWorkspace,
          departmentId: otherDepartment.id,
          name: "Foreign",
          slug: randomUUID(),
          creatorId: foreign,
        },
      });
      const otherVersion = await prisma.configurationTemplateVersion.create({
        data: {
          templateId: otherTemplate.id,
          version: 1,
          status: "PUBLISHED",
          creatorId: foreign,
        },
      });
      await prisma.project.update({
        where: { id: project },
        data: { appliedTemplateVersionId: otherVersion.id },
      });
      expect(
        (await recover(member, otherVersion.id).expect(409)).body.code,
      ).toBe("PINNED_TEMPLATE_UNAVAILABLE");
      expect(
        await prisma.projectInitialization.count({
          where: { projectId: project },
        }),
      ).toBe(0);
    });
  },
);
