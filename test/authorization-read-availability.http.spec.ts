import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AuthorizationController } from "../src/authorization/authorization.controller";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest");
const privateFailure =
  "Synthetic private dependency detail; never return this to the caller";
const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(privateFailure, {
    code,
    clientVersion: "synthetic",
    meta: { private: privateFailure },
  });
const paths = [
  {
    path: "/authorization/permissions",
    action: "listPermissions",
    target: "permissions",
  },
  { path: "/authorization/roles", action: "listRoles", target: "roles" },
  {
    path: "/authorization/revision",
    action: "readAuthorization",
    target: "revision",
  },
  {
    path: "/authorization/roles/synthetic-role/edit",
    action: "readRole",
    target: "role",
  },
  {
    path: "/authorization/users/synthetic-target/roles",
    action: "readUserRoles",
    target: "user",
  },
] as const;
describe("authorization GET post-authentication availability", () => {
  let app: INestApplication, service: AuthorizationService;
  let grants: string[], fault: unknown, failSync: boolean;
  const content = {
    permissions: jest.fn(),
    roles: jest.fn(),
    revision: jest.fn(),
    role: jest.fn(),
    user: jest.fn(),
  };
  const permission = {
    key: "projects.read",
    name: "Read projects",
    description: "Synthetic",
    category: "Projects",
    createdAt: new Date("2026-10-20T00:00:00Z"),
    updatedAt: new Date("2026-10-20T00:00:00Z"),
  };
  const role = {
    id: "synthetic-role",
    workspaceId: "synthetic-workspace",
    key: "synthetic-role",
    name: "Synthetic role",
    description: null,
    isSystem: false,
    permissions: [{ permissionKey: permission.key, permission }],
    _count: { userAssignments: 2 },
    workspace: { authorizationRevision: 7 },
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
  const target = {
    id: "synthetic-target",
    workspace: { authorizationRevision: 7 },
    roleAssignments: [
      { role: { id: role.id, key: role.key, name: role.name } },
    ],
  };
  const prisma: any = {
    permission: { findMany: jest.fn(), count: jest.fn() },
    role: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    workspace: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    userRoleAssignment: { deleteMany: jest.fn(), createMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const failTarget = (
    name: keyof typeof content,
    error: unknown = known("P1001"),
    sync = false,
  ) => {
    fault = error;
    failSync = sync;
    content[name].mockImplementationOnce(() => {
      if (failSync) throw fault;
      return Promise.reject(fault);
    });
  };
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set("Authorization", "Bearer synthetic-access");
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthorizationController],
      providers: [
        AuthorizationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            verify: () => ({
              id: "synthetic-actor",
              type: "access",
              iat: Math.floor(Date.now() / 1000),
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    service = app.get(AuthorizationService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    grants = ["authorization.read", "authorization.manage"];
    fault = undefined;
    failSync = false;
    content.permissions.mockReset().mockResolvedValue([permission]);
    content.roles.mockReset().mockResolvedValue([role]);
    content.revision
      .mockReset()
      .mockResolvedValue({ authorizationRevision: 7 });
    content.role.mockReset().mockResolvedValue(role);
    content.user.mockReset().mockResolvedValue(target);
    prisma.permission.findMany
      .mockReset()
      .mockImplementation((...args: any[]) => content.permissions(...args));
    prisma.permission.count.mockReset().mockResolvedValue(0);
    prisma.role.findMany
      .mockReset()
      .mockImplementation((...args: any[]) => content.roles(...args));
    prisma.role.count.mockReset().mockResolvedValue(1);
    prisma.role.findFirst
      .mockReset()
      .mockImplementation((args: any) =>
        args.include?.userAssignments
          ? Promise.resolve({ ...role, userAssignments: [] })
          : content.role(args),
      );
    prisma.workspace.findUnique
      .mockReset()
      .mockImplementation((...args: any[]) => content.revision(...args));
    prisma.workspace.findUniqueOrThrow
      .mockReset()
      .mockResolvedValue({ authorizationRevision: 7 });
    prisma.workspace.update
      .mockReset()
      .mockResolvedValue({ authorizationRevision: 8 });
    prisma.user.findFirst.mockReset().mockImplementation((args: any) =>
      args.where.id === "synthetic-target"
        ? args.select?.workspace
          ? content.user(args)
          : Promise.resolve({ id: target.id })
        : Promise.resolve({
            id: "synthetic-actor",
            workspaceId: "synthetic-workspace",
            status: "OPEN",
            roleAssignments: [
              {
                role: {
                  id: "synthetic-grant-role",
                  key: "synthetic-grant-role",
                  name: "Synthetic grant role",
                  permissions: grants.map((permissionKey) => ({
                    permissionKey,
                  })),
                },
              },
            ],
          }),
    );
    prisma.user.findMany
      .mockReset()
      .mockResolvedValue([{ id: "synthetic-target" }]);
    for (const method of [
      prisma.rolePermission.deleteMany,
      prisma.rolePermission.createMany,
      prisma.userRoleAssignment.deleteMany,
      prisma.userRoleAssignment.createMany,
    ])
      method.mockReset().mockResolvedValue({ count: 0 });
    prisma.$queryRaw.mockReset().mockResolvedValue([]);
    prisma.$transaction
      .mockReset()
      .mockImplementation((run: any) => run(prisma));
  });
  it.each(paths)(
    "returns established503 after authentication for $path",
    async (route) => {
      failTarget(route.target);
      const result = await get(route.path).expect(503);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "synthetic-actor", status: "OPEN" },
        }),
      );
      expect(content[route.target]).toHaveBeenCalledTimes(1);
      expect(result.body).toEqual({
        statusCode: 503,
        error: "Service Unavailable",
        message: "Requested data is temporarily unavailable",
        code: "READ_DEPENDENCY_UNAVAILABLE",
        action: route.action,
      });
      expect(JSON.stringify(result.body)).not.toContain(privateFailure);
    },
  );
  it.each([
    "P1000",
    "P1001",
    "P1002",
    "P1003",
    "P1008",
    "P1010",
    "P1011",
    "P1017",
    "P2024",
    "P2037",
  ])("uses the existing narrow classifier for %s", async (code) => {
    failTarget("permissions", known(code));
    expect((await get(paths[0].path).expect(503)).body.code).toBe(
      "READ_DEPENDENCY_UNAVAILABLE",
    );
  });
  it("sanitizes client initialization errors", async () => {
    failTarget(
      "permissions",
      new Prisma.PrismaClientInitializationError(
        privateFailure,
        "synthetic",
        "P1001",
      ),
    );
    await get(paths[0].path).expect(503);
  });
  it.each(paths)(
    "handles synchronous content dependency rejection on $path",
    async (route) => {
      failTarget(route.target, known("P1001"), true);
      expect((await get(route.path).expect(503)).body.action).toBe(
        route.action,
      );
    },
  );
  it.each(paths.filter((p) => ["roles", "role", "user"].includes(p.target)))(
    "handles read transaction admission failure for $path",
    async (route) => {
      prisma.$transaction.mockRejectedValueOnce(known("P2024"));
      expect((await get(route.path).expect(503)).body.action).toBe(
        route.action,
      );
      expect(content[route.target]).not.toHaveBeenCalled();
    },
  );
  it.each(paths)(
    "preserves successful no-store projection for $path",
    async (route) => {
      const result = await get(route.path).expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      if (route.target === "permissions")
        expect(result.body).toEqual([JSON.parse(JSON.stringify(permission))]);
      if (route.target === "revision")
        expect(result.body).toEqual({ revision: 7 });
      if (route.target === "user")
        expect(result.body).toEqual({
          id: target.id,
          revision: 7,
          roles: target.roleAssignments.map((a) => a.role),
        });
      if (route.target === "roles" || route.target === "role") {
        const row = route.target === "roles" ? result.body[0] : result.body;
        expect(row).toEqual({
          id: role.id,
          revision: 7,
          key: role.key,
          name: role.name,
          description: null,
          isSystem: false,
          permissions: [JSON.parse(JSON.stringify(permission))],
          userCount: 2,
          createdAt: permission.createdAt.toISOString(),
          updatedAt: permission.updatedAt.toISOString(),
        });
      }
    },
  );
  it.each(paths)(
    "keeps missing capability as403 before $path content lookup",
    async (route) => {
      grants = [];
      failTarget(route.target);
      await get(route.path).expect(403);
      expect(content[route.target]).not.toHaveBeenCalled();
    },
  );
  it.each(paths.filter((p) => ["role", "user", "revision"].includes(p.target)))(
    "preserves authoritative missing404 for $path",
    async (route) => {
      content[route.target].mockResolvedValueOnce(null);
      await get(route.path).expect(404);
    },
  );
  it.each(paths)(
    "keeps unknown content failure500 for $path",
    async (route) => {
      failTarget(route.target, new Error(privateFailure));
      const result = await get(route.path).expect(500);
      expect(result.body).not.toHaveProperty(
        "code",
        "READ_DEPENDENCY_UNAVAILABLE",
      );
      expect(JSON.stringify(result.body)).not.toContain(privateFailure);
    },
  );
  it.each(["P2002", "P2028", "P2034"])(
    "does not relabel non-availability %s as read unavailability",
    async (code) => {
      failTarget("permissions", known(code));
      expect((await get(paths[0].path).expect(500)).body).not.toHaveProperty(
        "code",
        "READ_DEPENDENCY_UNAVAILABLE",
      );
    },
  );
  it("preserves an existing HttpException", async () => {
    failTarget("permissions", new NotFoundException("Synthetic missing scope"));
    expect((await get(paths[0].path).expect(404)).body.message).toBe(
      "Synthetic missing scope",
    );
  });
  it.each(["P1001", "P2028", "P2034"])(
    "preserves mutation outcome semantics for %s in both nested role readers",
    async (code) => {
      const status = code === "P1001" ? 500 : code === "P2028" ? 503 : 409;
      failTarget("role", known(code));
      const roleWrite = await request(app.getHttpServer())
        .put("/authorization/roles/synthetic-role/permissions")
        .set("Authorization", "Bearer synthetic-access")
        .set("If-Match", '"7"')
        .send({ permissionKeys: [] })
        .expect(status);
      expect(roleWrite.body).not.toHaveProperty(
        "code",
        "READ_DEPENDENCY_UNAVAILABLE",
      );
      if (code === "P2028")
        expect(roleWrite.body.code).toBe("OPERATION_OUTCOME_UNKNOWN");
      failTarget("user", known(code));
      const userWrite = await request(app.getHttpServer())
        .put("/authorization/users/synthetic-target/roles")
        .set("Authorization", "Bearer synthetic-access")
        .set("If-Match", '"7"')
        .send({ roleIds: ["00000000-0000-4000-8000-000000000001"] })
        .expect(status);
      expect(userWrite.body).not.toHaveProperty(
        "code",
        "READ_DEPENDENCY_UNAVAILABLE",
      );
      if (code === "P2028")
        expect(userWrite.body.code).toBe("OPERATION_OUTCOME_UNKNOWN");
      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.userRoleAssignment.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    },
  );
  it("does not wrap getRole when a caller provides its mutation transaction", async () => {
    const error = known("P1001");
    failTarget("role", error);
    await expect(
      service.getRole("synthetic-workspace", "synthetic-role", prisma),
    ).rejects.toBe(error);
  });
  it("documents post-authentication read availability on all five GETs", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, "access-token").build(),
    );
    for (const route of [
      "/authorization/permissions",
      "/authorization/roles",
      "/authorization/revision",
      "/authorization/roles/{id}/edit",
      "/authorization/users/{userId}/roles",
    ]) {
      const response = document.paths[route]?.get?.responses["503"] as any;
      expect(response.description).toContain("READ_DEPENDENCY_UNAVAILABLE");
    }
  });
});
