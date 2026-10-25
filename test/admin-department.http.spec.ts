import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthorizationController } from "../src/authorization/authorization.controller";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { DepartmentsController } from "../src/departments/departments.controller";
import { DepartmentsService } from "../src/departments/departments.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
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
(databaseUrl ? describe : describe.skip)(
  "admin/department HTTP with PostgreSQL and local provisioning",
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let adminId: string;
    let readerId: string;
    let manageOnlyId: string;
    let authorizationOnlyId: string;
    let memberId: string;
    let foreignId: string;
    let adminRoleId: string;
    let roleId: string;
    let foreignRoleId: string;
    let defaultId: string;
    let archivedId: string;
    let foreignDepartmentId: string;
    let tempRoot: string;
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    const priorMode = process.env.PROBOXAI_HOME_DIRECTORY_MODE;
    const grants = [
      "authorization.read",
      "authorization.manage",
      "users.read",
      "users.manage",
      "departments.read",
      "departments.manage",
    ];
    const departmentKeys = [
      "revision",
      "id",
      "workspaceId",
      "name",
      "slug",
      "homePath",
      "isDefault",
      "status",
      "createdAt",
      "updatedAt",
    ].sort();
    const roleKeys = [
      "revision",
      "id",
      "key",
      "name",
      "description",
      "isSystem",
      "permissions",
      "userCount",
      "createdAt",
      "updatedAt",
    ].sort();
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "proboxai-admin-dept-test-"),
      );
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = tempRoot;
      process.env.PROBOXAI_HOME_DIRECTORY_MODE = "0750";
      workspaceId = (
        await prisma.workspace.create({
          data: { slug: "admin-department-http" },
        })
      ).id;
      otherWorkspaceId = (
        await prisma.workspace.create({
          data: { slug: "admin-department-http-other" },
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
      async function user(
        workspace: string,
        phone: string,
        permissions: string[],
        isSystem = false,
      ) {
        const role = await prisma.role.create({
          data: {
            workspaceId: workspace,
            key: phone,
            name: "Test role",
            isSystem,
            permissions: {
              create: permissions.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        const user = await prisma.user.create({
          data: {
            workspaceId: workspace,
            phoneNumber: phone,
            fullName: "Test user",
            status: "OPEN",
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        return { id: user.id, roleId: role.id };
      }
      const admin = await user(workspaceId, "+998908000001", grants, true);
      adminId = admin.id;
      adminRoleId = admin.roleId;
      readerId = (
        await user(workspaceId, "+998908000002", [
          "authorization.read",
          "users.read",
          "departments.read",
        ])
      ).id;
      manageOnlyId = (
        await user(workspaceId, "+998908009999", ["departments.manage"])
      ).id;
      authorizationOnlyId = (
        await user(workspaceId, "+998908009998", ["authorization.manage"])
      ).id;
      memberId = (await user(workspaceId, "+998908000003", [])).id;
      const foreign = await user(otherWorkspaceId, "+998908000004", grants);
      foreignId = foreign.id;
      foreignRoleId = foreign.roleId;
      defaultId = (
        await prisma.department.create({
          data: {
            workspaceId,
            name: "Default",
            slug: "default",
            homePath: tempRoot,
            isDefault: true,
          },
        })
      ).id;
      archivedId = (
        await prisma.department.create({
          data: {
            workspaceId,
            name: "Archived",
            slug: "archived",
            homePath: tempRoot,
            status: "ARCHIVED",
          },
        })
      ).id;
      foreignDepartmentId = (
        await prisma.department.create({
          data: {
            workspaceId: otherWorkspaceId,
            name: "Foreign",
            slug: "foreign",
            homePath: tempRoot,
          },
        })
      ).id;
      const module = await Test.createTestingModule({
        controllers: [
          AuthorizationController,
          AccountsController,
          DepartmentsController,
        ],
        providers: [
          AuthorizationService,
          AccountsService,
          DepartmentsService,
          WorkspacePathPolicy,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                iat: Math.floor(Date.now() / 1000),
                id,
                workspaceId: "stale",
                type: "access",
              }),
            },
          },
          { provide: TelegramService, useValue: {} },
          { provide: TelegramBotService, useValue: {} },
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
    afterAll(async () => {
      await app?.close();
      if (prisma) {
        await prisma.project.deleteMany({ where: { workspaceId } });
        await prisma.department.deleteMany({
          where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
        });
        await prisma.user.deleteMany({
          where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
        });
        await prisma.role.deleteMany({
          where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
        });
        await prisma.workspace.deleteMany({
          where: { id: { in: [workspaceId, otherWorkspaceId] } },
        });
        await prisma.$disconnect();
      }
      if (priorRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoots;
      if (priorMode === undefined)
        delete process.env.PROBOXAI_HOME_DIRECTORY_MODE;
      else process.env.PROBOXAI_HOME_DIRECTORY_MODE = priorMode;
      if (
        tempRoot &&
        path.dirname(tempRoot) === os.tmpdir() &&
        path.basename(tempRoot).startsWith("proboxai-admin-dept-test-")
      )
        await fs.rm(tempRoot, { recursive: true, force: true });
    });
    const call = (method: string, route: string, actor = adminId) => {
      const req = request(app.getHttpServer())
        [method](route)
        .set("Authorization", "Bearer " + actor);
      const originalThen = req.then.bind(req);
      req.then = async (resolve: any, reject: any) => {
        if (method !== "get") {
          if (
            method === "put" &&
            /^\/authorization\/(roles\/[^/]+\/permissions|users\/[^/]+\/roles)$/.test(
              route,
            )
          ) {
            const snapshotPath = route.includes("/permissions")
              ? route.replace("/permissions", "/edit")
              : route;
            let snapshot = await request(app.getHttpServer())
              .get(snapshotPath)
              .set("Authorization", "Bearer " + actor);
            if (snapshot.status === 404)
              snapshot = await request(app.getHttpServer())
                .get("/authorization/revision")
                .set("Authorization", "Bearer " + actor);
            req.set("If-Match", '"' + (snapshot.body.revision ?? 0) + '"');
          }
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
    it("does not cache any authorization read and reloads self grants after a real role edit", async () => {
      for (const route of [
        "/authorization/me",
        "/authorization/revision",
        `/authorization/roles/${adminRoleId}/edit`,
        `/authorization/users/${memberId}/roles`,
        "/authorization/permissions",
        "/authorization/roles",
      ]) {
        expect(
          (await call("get", route).expect(200)).headers["cache-control"],
        ).toBe("no-store");
      }
      const before = (
        await call("get", "/authorization/me", memberId).expect(200)
      ).body;
      expect(before.permissions).toEqual([]);
      const memberRole = before.roles[0];
      try {
        await prisma.rolePermission.create({
          data: { roleId: memberRole.id, permissionKey: "authorization.read" },
        });
        await prisma.role.update({
          where: { id: memberRole.id },
          data: { name: "Current role display" },
        });
        const current = (
          await call("get", "/authorization/me", memberId).expect(200)
        ).body;
        expect(current.permissions).toEqual(["authorization.read"]);
        expect(current.roles).toEqual([
          { ...memberRole, name: "Current role display" },
        ]);
        expect(Object.keys(current).sort()).toEqual([
          "id",
          "permissions",
          "roles",
          "workspaceId",
        ]);
        await call("get", "/authorization/permissions", memberId).expect(200);
      } finally {
        await prisma.rolePermission.deleteMany({
          where: { roleId: memberRole.id, permissionKey: "authorization.read" },
        });
        await prisma.role.update({
          where: { id: memberRole.id },
          data: { name: memberRole.name },
        });
      }
      expect(
        (await call("get", "/authorization/me", memberId).expect(200)).body,
      ).toEqual(before);
      await call("get", "/authorization/permissions", memberId).expect(403);
    });
    it("lets manage-only callers read narrow revisions and preserves stale protection", async () => {
      const read = (id = defaultId, actor = manageOnlyId) =>
        request(app.getHttpServer())
          .get("/departments/" + id + "/revision")
          .set("Authorization", "Bearer " + actor);
      await call("get", "/departments/" + defaultId, manageOnlyId).expect(403);
      const baseline = await read().expect(200);
      expect(Object.keys(baseline.body)).toEqual(["revision"]);
      await read(defaultId, readerId).expect(403);
      await read(foreignDepartmentId).expect(404);
      const edit = () =>
        request(app.getHttpServer())
          .patch("/departments/" + defaultId)
          .set("Authorization", "Bearer " + manageOnlyId)
          .set("If-Match", '"' + baseline.body.revision + '"');
      const saved = await edit()
        .send({ name: "Managed department" })
        .expect(200);
      expect(saved.body.revision).toBe(baseline.body.revision + 1);
      const stale = await edit().send({ name: "Stale department" }).expect(409);
      expect(stale.body.code).toBe("STALE_REVISION");
      expect((await read().expect(200)).body.revision).toBe(
        saved.body.revision,
      );
      await request(app.getHttpServer())
        .patch("/departments/" + defaultId)
        .set("Authorization", "Bearer " + manageOnlyId)
        .set("If-Match", '"' + saved.body.revision + '"')
        .send({ name: "Default" })
        .expect(200);
    });
    it("supports manage-only authorization edit snapshots, explicit stale tokens and required headers", async () => {
      const raw = (method: string, route: string) =>
        request(app.getHttpServer())
          [method](route)
          .set("Authorization", "Bearer " + authorizationOnlyId);
      await raw("get", "/authorization/roles").expect(403);
      const created = await raw("post", "/authorization/roles")
        .send({
          key: "manage-only-edit",
          name: "Edit test",
          permissionKeys: [],
        })
        .expect(201);
      const route = "/authorization/roles/" + created.body.id;
      const snapshot = await raw("get", route + "/edit").expect(200);
      expect(snapshot.body.revision).toBe(created.body.revision);
      await raw("put", route + "/permissions")
        .send({ permissionKeys: [] })
        .expect(428);
      await raw("put", route + "/permissions")
        .set("If-Match", "*")
        .send({ permissionKeys: [] })
        .expect(400);
      const saved = await raw("put", route + "/permissions")
        .set("If-Match", '"' + snapshot.body.revision + '"')
        .send({ permissionKeys: ["users.read"] })
        .expect(200);
      const stale = await raw("put", route + "/permissions")
        .set("If-Match", '"' + snapshot.body.revision + '"')
        .send({ permissionKeys: [] })
        .expect(409);
      expect(stale.body.code).toBe("STALE_REVISION");
      const current = await raw("get", route + "/edit").expect(200);
      expect(current.body.permissions.map((p: any) => p.key)).toEqual([
        "users.read",
      ]);
      expect(current.body.revision).toBe(saved.body.revision);
      const userSnapshot = await raw(
        "get",
        "/authorization/users/" + memberId + "/roles",
      ).expect(200);
      await raw("put", "/authorization/users/" + memberId + "/roles")
        .send({ roleIds: [created.body.id] })
        .expect(428);
      await raw("put", "/authorization/users/" + memberId + "/roles")
        .set("If-Match", '"' + (userSnapshot.body.revision - 1) + '"')
        .send({ roleIds: [created.body.id] })
        .expect(409);
      await raw("get", "/authorization/users/" + foreignId + "/roles").expect(
        404,
      );
      await raw(
        "get",
        "/authorization/roles/" + foreignRoleId + "/edit",
      ).expect(404);
      await raw("delete", route).expect(200);
      const transaction = prisma.$transaction.bind(prisma);
      const intercepted = jest
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(async (work: any, options: any) => {
          // The HTTP guard has already read this actor; revoke before the mutation locks/rechecks.
          await transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
            await tx.userRoleAssignment.deleteMany({
              where: { userId: authorizationOnlyId },
            });
            await tx.workspace.update({
              where: { id: workspaceId },
              data: { authorizationRevision: { increment: 1 } },
            });
          });
          return transaction(work, options);
        });
      try {
        const revoked = await raw("post", "/authorization/roles")
          .send({ key: "revoked-edit", name: "Denied", permissionKeys: [] })
          .expect(403);
        expect(revoked.body).toMatchObject({
          statusCode: 403,
          error: "Forbidden",
          code: "MANAGEMENT_ACCESS_CHANGED",
        });
        expect(
          await prisma.role.count({
            where: { workspaceId, key: "revoked-edit" },
          }),
        ).toBe(0);
      } finally {
        intercepted.mockRestore();
      }
    });
    it("enforces authentication and existing management grants", async () => {
      await request(app.getHttpServer()).get("/departments").expect(401);
      await call("post", "/departments", readerId)
        .send({ name: "Denied", homePath: tempRoot })
        .expect(403);
      await call("post", "/authorization/roles", readerId)
        .send({ key: "denied", name: "Denied", permissionKeys: [] })
        .expect(403);
      await call("post", `/users/${memberId}/ban`, readerId).expect(403);
    });
    it("returns exact department scalars, active-only lists and known archived detail", async () => {
      const list = await call(
        "get",
        "/departments?includeArchived=true",
        readerId,
      ).expect(200);
      expect(list.body.map((d: any) => d.id)).toEqual([defaultId]);
      expect(Object.keys(list.body[0]).sort()).toEqual(departmentKeys);
      const archived = await call(
        "get",
        `/departments/${archivedId}`,
        readerId,
      ).expect(200);
      expect(archived.body.status).toBe("ARCHIVED");
      expect(Object.keys(archived.body).sort()).toEqual(departmentKeys);
      const all = await call("get", "/departments?includeArchived=true").expect(
        200,
      );
      expect(all.body.map((d: any) => d.id)).toContain(archivedId);
    });
    it.each(["get", "patch"])(
      "hides foreign department on %s",
      async (method) => {
        const result = await call(method, `/departments/${foreignDepartmentId}`)
          .send({})
          .expect(404);
        expect(result.body).toMatchObject({
          code: "RESOURCE_NOT_FOUND",
          message: "Department not found",
        });
        expect(JSON.stringify(result.body)).not.toContain(otherWorkspaceId);
      },
    );
    it("provisions create/edit homes and preserves scalar 201 default/archive", async () => {
      const home = path.join(tempRoot, "new-home");
      const result = await call("post", "/departments")
        .send({ name: "New Team", homePath: home })
        .expect(201);
      expect(Object.keys(result.body).sort()).toEqual(
        [...departmentKeys, "homeCreated"].sort(),
      );
      expect(result.body.homeCreated).toBe(true);
      expect((await fs.stat(home)).isDirectory()).toBe(true);
      const id = result.body.id;
      const changed = await call("patch", `/departments/${id}`)
        .send({ name: "Renamed Team", homePath: tempRoot })
        .expect(200);
      expect(changed.body).toMatchObject({
        homeCreated: false,
        slug: "renamed-team",
        homePath: tempRoot,
      });
      const empty = await call("patch", `/departments/${id}`)
        .send({})
        .expect(200);
      expect(empty.body.homeCreated).toBe(false);
      const madeDefault = await call(
        "post",
        `/departments/${id}/default`,
      ).expect(201);
      expect(Object.keys(madeDefault.body).sort()).toEqual(departmentKeys);
      expect(madeDefault.body.isDefault).toBe(true);
      await call("post", `/departments/${defaultId}/default`).expect(201);
      const archived = await call("post", `/departments/${id}/archive`).expect(
        201,
      );
      expect(Object.keys(archived.body).sort()).toEqual(departmentKeys);
      expect(archived.body.status).toBe("ARCHIVED");
    });
    it("distinguishes slug collisions from home-path and state failures", async () => {
      const duplicate = await call("post", "/departments")
        .send({ name: "Default", homePath: tempRoot })
        .expect(409);
      expect(duplicate.body).toMatchObject({
        code: "DEPARTMENT_SLUG_CONFLICT",
        field: "name",
        action: "createDepartment",
      });
      const invalid = await call("post", "/departments")
        .send({ name: "Invalid Home", homePath: "relative" })
        .expect(400);
      expect(invalid.body).toMatchObject({
        code: "HOME_PATH_INVALID",
        field: "homePath",
        action: "provisionHome",
      });
      const archived = await call(
        "post",
        `/departments/${archivedId}/default`,
      ).expect(409);
      expect(archived.body.code).toBe("DEPARTMENT_ARCHIVED");
      const current = await call(
        "post",
        `/departments/${defaultId}/archive`,
      ).expect(409);
      expect(current.body.code).toBe("DEPARTMENT_IS_DEFAULT");
    });
    it("reports provisioning configuration failure before any database mutation", async () => {
      process.env.PROBOXAI_HOME_DIRECTORY_MODE = "invalid";
      try {
        const result = await call("post", "/departments")
          .send({ name: "Bad Mode", homePath: path.join(tempRoot, "bad-mode") })
          .expect(503);
        expect(result.body).toMatchObject({
          code: "HOME_CONFIGURATION_INVALID",
          field: "homePath",
          action: "provisionHome",
        });
        expect(
          await prisma.department.count({
            where: { workspaceId, slug: "bad-mode" },
          }),
        ).toBe(0);
        expect(JSON.stringify(result.body)).not.toContain(tempRoot);
      } finally {
        process.env.PROBOXAI_HOME_DIRECTORY_MODE = "0750";
      }
    });
    it("blocks moving a home used by projects", async () => {
      await prisma.project.create({
        data: {
          workspaceId,
          departmentId: defaultId,
          creatorId: memberId,
          name: "Owned",
          directoryName: "Owned",
        },
      });
      const result = await call("patch", `/departments/${defaultId}`)
        .send({ homePath: path.join(tempRoot, "blocked") })
        .expect(409);
      expect(result.body).toMatchObject({
        code: "DEPARTMENT_HOME_IN_USE",
        field: "homePath",
      });
    });
    it("returns allowlisted permission/role metadata and precise role operation shapes", async () => {
      const permissions = await call(
        "get",
        "/authorization/permissions",
      ).expect(200);
      expect(Object.keys(permissions.body[0]).sort()).toEqual(
        [
          "key",
          "name",
          "description",
          "category",
          "createdAt",
          "updatedAt",
        ].sort(),
      );
      const created = await call("post", "/authorization/roles")
        .send({ key: "custom", name: "Custom", permissionKeys: ["users.read"] })
        .expect(201);
      roleId = created.body.id;
      expect(Object.keys(created.body).sort()).toEqual(roleKeys);
      expect(created.body.permissions[0].createdAt).toEqual(expect.any(String));
      const updated = await call("patch", `/authorization/roles/${roleId}`)
        .send({ name: "Renamed", description: null })
        .expect(200);
      expect(Object.keys(updated.body).sort()).toEqual(roleKeys);
      const replaced = await call(
        "put",
        `/authorization/roles/${roleId}/permissions`,
      )
        .send({ permissionKeys: [] })
        .expect(200);
      expect(replaced.body.permissions).toEqual([]);
      const list = await call("get", "/authorization/roles").expect(200);
      expect(
        list.body.every(
          (r: any) => Object.keys(r).sort().join() === roleKeys.join(),
        ),
      ).toBe(true);
      const assigned = await call(
        "put",
        `/authorization/users/${memberId}/roles`,
      )
        .send({ roleIds: [roleId] })
        .expect(200);
      expect(assigned.body).toEqual({
        revision: expect.any(Number),
        id: memberId,
        roles: [{ id: roleId, key: "custom", name: "Renamed" }],
      });
      const blocked = await call(
        "delete",
        `/authorization/roles/${roleId}`,
      ).expect(409);
      expect(blocked.body.code).toBe("ROLE_ASSIGNED");
      await prisma.userRoleAssignment.deleteMany({
        where: { userId: memberId },
      });
      const deleted = await call(
        "delete",
        `/authorization/roles/${roleId}`,
      ).expect(200);
      expect(Object.keys(deleted.body).sort()).toEqual(
        [
          "revision",
          "id",
          "workspaceId",
          "key",
          "name",
          "description",
          "isSystem",
          "createdAt",
          "updatedAt",
        ].sort(),
      );
    });
    it("classifies role key/catalog errors and rejects metadata null/unknown fields", async () => {
      const duplicate = await call("post", "/authorization/roles")
        .send({ key: "+998908000001", name: "Invalid key", permissionKeys: [] })
        .expect(400);
      expect(duplicate.body.error).toBe("Bad Request");
      await call("post", "/authorization/roles")
        .send({ key: "duplicate", name: "Duplicate", permissionKeys: [] })
        .expect(201);
      const conflict = await call("post", "/authorization/roles")
        .send({ key: "duplicate", name: "Duplicate", permissionKeys: [] })
        .expect(409);
      expect(conflict.body).toMatchObject({
        code: "ROLE_KEY_CONFLICT",
        field: "key",
      });
      const unknown = await call("post", "/authorization/roles")
        .send({
          key: "unknown",
          name: "Unknown",
          permissionKeys: ["no.such.permission"],
        })
        .expect(400);
      expect(unknown.body).toMatchObject({
        code: "PERMISSION_KEYS_UNKNOWN",
        field: "permissionKeys",
      });
      await call("patch", `/authorization/roles/${adminRoleId}`)
        .send({ name: null })
        .expect(400);
      await call("patch", `/authorization/roles/${adminRoleId}`)
        .send({ workspaceId: otherWorkspaceId })
        .expect(400);
    });
    it.each(["patch", "delete"])(
      "does not disclose foreign roles through %s",
      async (method) => {
        const result = await call(
          method,
          `/authorization/roles/${foreignRoleId}`,
        )
          .send({})
          .expect(404);
        expect(result.body.message).toBe("Role not found");
      },
    );
    it("keeps self/system safeguards and generic foreign role/user errors", async () => {
      expect(
        (
          await call("delete", `/authorization/roles/${adminRoleId}`).expect(
            400,
          )
        ).body.code,
      ).toBe("ROLE_SYSTEM_PROTECTED");
      const self = await call("put", `/authorization/users/${adminId}/roles`)
        .send({ roleIds: [foreignRoleId] })
        .expect(400);
      expect(self.body).toMatchObject({
        code: "ROLE_IDS_INVALID",
        field: "roleIds",
      });
      expect(JSON.stringify(self.body)).not.toContain(foreignRoleId);
      await call("put", `/authorization/users/${foreignId}/roles`)
        .send({ roleIds: [adminRoleId] })
        .expect(404);
      const remove = await call(
        "put",
        `/authorization/roles/${adminRoleId}/permissions`,
      )
        .send({ permissionKeys: [] })
        .expect(400);
      expect(remove.body.code).toBe("SELF_MANAGEMENT_PROTECTED");
    });
    it("creates pending users and reports global phone conflicts without identity disclosure", async () => {
      const created = await call("post", "/users")
        .send({
          firstName: "New",
          phoneNumber: "+998908000005",
          roleIds: [adminRoleId],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        firstName: "New",
        lastName: null,
        fullName: "New",
        status: "PENDING",
      });
      expect(
        await prisma.userRoleAssignment.findUnique({
          where: {
            userId_roleId: { userId: created.body.id, roleId: adminRoleId },
          },
        }),
      ).toMatchObject({
        workspaceId,
        roleId: adminRoleId,
        assignedById: adminId,
      });
      for (const phoneNumber of ["+998908000001", "+998908000004"]) {
        const result = await call("post", "/users")
          .send({ fullName: "Duplicate", phoneNumber, roleIds: [adminRoleId] })
          .expect(409);
        expect(result.body).toEqual({
          statusCode: 409,
          error: "Conflict",
          message: "A user with this phone number already exists",
          code: "USER_PHONE_CONFLICT",
          action: "createUser",
          field: "phoneNumber",
        });
      }
    });
    it("classifies self protection and owner blockers without foreign user disclosure", async () => {
      for (const method of ["post", "delete"]) {
        const suffix = method === "post" ? "/ban" : "";
        expect(
          (await call(method, `/users/${adminId}${suffix}`).expect(400)).body
            .code,
        ).toBe("SELF_USER_PROTECTED");
        expect(
          (await call(method, `/users/${memberId}${suffix}`).expect(409)).body
            .code,
        ).toBe("USER_OWNS_PROJECTS");
        const foreign = await call(
          method,
          `/users/${foreignId}${suffix}`,
        ).expect(404);
        expect(foreign.body.message).toBe("User not found");
        expect(JSON.stringify(foreign.body)).not.toContain(otherWorkspaceId);
      }
    });
    it("preserves ban 201 and delete 200 scalars with token revocation", async () => {
      const user = await prisma.user.create({
        data: {
          workspaceId,
          fullName: "Ban target",
          phoneNumber: "+998908000006",
          status: "OPEN",
        },
      });
      await prisma.sessionToken.create({
        data: {
          userId: user.id,
          tokenHash: "admin-test-token",
          purpose: "REFRESH",
          expiresAt: new Date("2030-01-01"),
        },
      });
      const banned = await call("post", `/users/${user.id}/ban`).expect(201);
      expect(banned.body.status).toBe("BANNED");
      expect(banned.body).not.toHaveProperty("workspaceId");
      expect(banned.body).not.toHaveProperty("bio");
      expect(
        (await prisma.sessionToken.findFirst({ where: { userId: user.id } }))
          ?.revokedAt,
      ).not.toBeNull();
      const deleted = await call("delete", `/users/${user.id}`).expect(200);
      expect(deleted.body.status).toBe("DELETED");
      expect(Object.keys(deleted.body).sort()).toEqual(
        Object.keys(banned.body).sort(),
      );
    });
  },
);
