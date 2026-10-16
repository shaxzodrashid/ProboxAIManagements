import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { AccountsService } from "../src/accounts/accounts.service";
import { ProjectsService } from "../src/projects/projects.service";
import { DepartmentsService } from "../src/departments/departments.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";

const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test database");
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const errorCode = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ? result.reason.getResponse().code : undefined;
(databaseUrl ? describe : describe.skip)(
  "atomic administrative invariants with PostgreSQL",
  () => {
    let prisma: PrismaClient;
    let workspaceId: string;
    let actorId: string;
    let targetId: string;
    let adminRoleId: string;
    let roleId: string;
    let departmentId: string;
    let root: string;
    let authorization: AuthorizationService;
    let accounts: AccountsService;
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-admin-races-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
    });
    beforeEach(async () => {
      workspaceId = (
        await prisma.workspace.create({ data: { slug: randomUUID() } })
      ).id;
      for (const key of [
        "authorization.manage",
        "users.manage",
        "projects.create",
        "projects.read",
      ])
        await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key, description: "Test", category: "test" },
        });
      adminRoleId = (
        await prisma.role.create({
          data: {
            workspaceId,
            key: "admin",
            name: "Admin",
            permissions: {
              create: [
                "authorization.manage",
                "users.manage",
                "projects.create",
              ].map((permissionKey) => ({ permissionKey })),
            },
          },
        })
      ).id;
      actorId = (
        await prisma.user.create({
          data: {
            workspaceId,
            fullName: "Admin",
            phoneNumber: randomUUID(),
            status: "OPEN",
            roleAssignments: { create: { roleId: adminRoleId } },
          },
        })
      ).id;
      targetId = (
        await prisma.user.create({
          data: {
            workspaceId,
            fullName: "Target",
            phoneNumber: randomUUID(),
            status: "OPEN",
            roleAssignments: { create: { roleId: adminRoleId } },
          },
        })
      ).id;
      roleId = (
        await prisma.role.create({
          data: {
            workspaceId,
            key: "reviewer",
            name: "Reviewer",
            permissions: { create: { permissionKey: "projects.read" } },
          },
        })
      ).id;
      departmentId = (
        await prisma.department.create({
          data: { workspaceId, name: "Test", slug: "test", homePath: root },
        })
      ).id;
      authorization = new AuthorizationService(prisma as any);
      accounts = new AccountsService(prisma as any, authorization);
    });
    afterEach(async () => {
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.department.deleteMany({ where: { workspaceId } });
      await prisma.user.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await prisma.$disconnect();
      if (priorRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoots;
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith("proboxai-admin-races-")
      )
        throw new Error("Unsafe temporary root");
      await fs.rm(root, { recursive: true, force: true });
    });
    const projects = (db: any = prisma) =>
      new ProjectsService(
        db,
        new DepartmentsService(db, new WorkspacePathPolicy()),
        new WorkspacePathPolicy(),
        {} as any,
      );
    const actor = () => ({
      id: targetId,
      workspaceId,
      roles: [],
      permissions: ["projects.create"],
    });
    it("allows exactly one concurrent complete permission replacement and exposes its set/token", async () => {
      const snapshot = await authorization.getRole(workspaceId, roleId);
      const results = await Promise.allSettled([
        authorization.setRolePermissions(
          workspaceId,
          actorId,
          roleId,
          ["projects.create"],
          snapshot.revision,
        ),
        authorization.setRolePermissions(
          workspaceId,
          actorId,
          roleId,
          ["users.manage"],
          snapshot.revision,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.map(errorCode)).toContain("STALE_REVISION");
      const current = await authorization.getRole(workspaceId, roleId);
      expect(current.revision).toBe(snapshot.revision + 1);
      expect(current.permissions).toHaveLength(1);
      const winner = results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>;
      expect(current.permissions).toEqual(winner.value.permissions);
    });
    it("rejects stale user-role whole sets and reads their coherent resulting snapshot", async () => {
      const snapshot = await authorization.getUserRoles(workspaceId, targetId);
      const results = await Promise.allSettled([
        authorization.setUserRoles(
          workspaceId,
          actorId,
          targetId,
          [roleId],
          snapshot.revision,
        ),
        authorization.setUserRoles(
          workspaceId,
          actorId,
          targetId,
          [adminRoleId, roleId],
          snapshot.revision,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.map(errorCode)).toContain("STALE_REVISION");
      const winner = results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>;
      expect(await authorization.getUserRoles(workspaceId, targetId)).toEqual(
        winner.value,
      );
    });
    it("retains self-management and blocks self-escalation without requiring a caller-subset grant policy", async () => {
      await expect(
        authorization.setUserRoles(workspaceId, actorId, actorId, [roleId], 0),
      ).rejects.toThrow("cannot grant yourself permissions");
      await expect(
        authorization.setRolePermissions(
          workspaceId,
          actorId,
          adminRoleId,
          ["users.manage"],
          0,
        ),
      ).rejects.toThrow("cannot remove your own authorization management");
      // Existing rule permits granting another user a permission the caller lacks.
      const granted = await authorization.setUserRoles(
        workspaceId,
        actorId,
        targetId,
        [roleId],
        0,
      );
      expect(granted.roles.map((r) => r.id)).toEqual([roleId]);
      expect((await authorization.revision(workspaceId)).revision).toBe(1);
    });
    it("invalidates a self edit when another role changes the dependent permission union", async () => {
      const snapshot = await authorization.getUserRoles(workspaceId, actorId);
      await authorization.setRolePermissions(
        workspaceId,
        targetId,
        roleId,
        ["projects.create"],
        snapshot.revision,
      );
      await expect(
        authorization.setUserRoles(
          workspaceId,
          actorId,
          actorId,
          [adminRoleId, roleId],
          snapshot.revision,
        ),
      ).rejects.toThrow("Authorization changed");
      expect(
        (await authorization.getUserRoles(workspaceId, actorId)).roles.map(
          (r) => r.id,
        ),
      ).toEqual([adminRoleId]);
    });
    it("serializes role deletion ahead of assignment and rejects the now-invalid requested role", async () => {
      const entered = deferred(),
        release = deferred();
      const db = prisma.$extends({
        query: {
          userRoleAssignment: {
            async count({ args, query }) {
              const count = await query(args);
              entered.resolve();
              await release.promise;
              return count;
            },
          },
        },
      });
      const deletion = new AuthorizationService(db as any).deleteRole(
        workspaceId,
        actorId,
        roleId,
      );
      await entered.promise;
      const assignment = authorization.setUserRoles(
        workspaceId,
        actorId,
        targetId,
        [roleId],
        0,
      );
      release.resolve();
      await deletion;
      await expect(assignment).rejects.toThrow("Authorization changed");
      expect(await prisma.userRoleAssignment.count({ where: { roleId } })).toBe(
        0,
      );
      await expect(
        authorization.setUserRoles(workspaceId, actorId, targetId, [roleId], 1),
      ).rejects.toThrow("do not belong");
    });
    it("serializes assignment ahead of deletion and preserves an assigned role", async () => {
      const entered = deferred(),
        release = deferred();
      const db = prisma.$extends({
        query: {
          userRoleAssignment: {
            async createMany({ args, query }) {
              entered.resolve();
              await release.promise;
              return query(args);
            },
          },
        },
      });
      const assignment = new AuthorizationService(db as any).setUserRoles(
        workspaceId,
        actorId,
        targetId,
        [roleId],
        0,
      );
      await entered.promise;
      const deletion = authorization.deleteRole(workspaceId, actorId, roleId);
      release.resolve();
      await assignment;
      await expect(deletion).rejects.toThrow("Remove this role");
      expect(await prisma.role.count({ where: { id: roleId } })).toBe(1);
    });
    it("rechecks revoked actor management after a waiting request acquires the lock", async () => {
      const entered = deferred(),
        release = deferred();
      const db = prisma.$extends({
        query: {
          userRoleAssignment: {
            async createMany({ args, query }) {
              entered.resolve();
              await release.promise;
              return query(args);
            },
          },
        },
      });
      const revocation = new AuthorizationService(db as any).setUserRoles(
        workspaceId,
        targetId,
        actorId,
        [roleId],
        0,
      );
      await entered.promise;
      const pending = authorization.setRolePermissions(
        workspaceId,
        actorId,
        roleId,
        ["users.manage"],
        0,
      );
      release.resolve();
      await revocation;
      await expect(pending).rejects.toThrow(
        "Management access is no longer available",
      );
    });
    it("a ban winning before project creation rejects before filesystem preparation", async () => {
      const entered = deferred(),
        release = deferred();
      const db = prisma.$extends({
        query: {
          user: {
            async update({ args, query }) {
              entered.resolve();
              await release.promise;
              return query(args);
            },
          },
        },
      });
      const ban = new AccountsService(
        db as any,
        new AuthorizationService(db as any),
      ).ban(workspaceId, actorId, targetId);
      await entered.promise;
      const directoryName = randomUUID();
      const creation = projects().create(actor(), {
        departmentId,
        name: directoryName,
      });
      release.resolve();
      await ban;
      await expect(creation).rejects.toThrow(
        "Management access is no longer available",
      );
      await expect(
        fs.stat(path.join(root, directoryName)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await prisma.project.count({ where: { creatorId: targetId } }),
      ).toBe(0);
    });
    it("a project winning first keeps its owner active and makes the ban recoverably conflict", async () => {
      const entered = deferred(),
        release = deferred();
      const db = prisma.$extends({
        query: {
          project: {
            async create({ args, query }) {
              entered.resolve();
              await release.promise;
              return query(args);
            },
          },
        },
      });
      const directoryName = randomUUID();
      const creation = projects(db).create(actor(), {
        departmentId,
        name: directoryName,
      });
      await entered.promise;
      const ban = accounts.ban(workspaceId, actorId, targetId);
      const banRejected = expect(ban).rejects.toThrow("owns project records");
      release.resolve();
      await creation;
      await banRejected;
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: targetId } }))
          .status,
      ).toBe("OPEN");
    });
    it("keeps account creation role validation and assigned-role deletion atomic", async () => {
      const entered = deferred(),
        release = deferred();
      const db = prisma.$extends({
        query: {
          user: {
            async create({ args, query }) {
              entered.resolve();
              await release.promise;
              return query(args);
            },
          },
        },
      });
      const creation = new AccountsService(
        db as any,
        new AuthorizationService(db as any),
      ).create(workspaceId, actorId, {
        fullName: "Created",
        phoneNumber:
          "+99890" +
          String(Math.floor(Math.random() * 10000000)).padStart(7, "0"),
        roleIds: [roleId],
      });
      await entered.promise;
      const deletion = authorization.deleteRole(workspaceId, actorId, roleId);
      const deletionRejected =
        expect(deletion).rejects.toThrow("Remove this role");
      release.resolve();
      const created = await creation;
      await deletionRejected;
      expect(created.roles.map((r: any) => r.id)).toEqual([roleId]);
    });
    it("reconciles an actual committed mutation after a lost acknowledgement and rejects replay", async () => {
      const db = new Proxy(prisma, {
        get(target, property) {
          if (property === "$transaction")
            return async (work: any) => {
              await target.$transaction(work);
              throw new Error("Lost acknowledgement");
            };
          return Reflect.get(target, property);
        },
      });
      await expect(
        new AuthorizationService(db as any).setRolePermissions(
          workspaceId,
          actorId,
          roleId,
          ["users.manage"],
          0,
        ),
      ).rejects.toThrow("Lost acknowledgement");
      const current = await authorization.getRole(workspaceId, roleId);
      expect(current.revision).toBe(1);
      expect(current.permissions.map((p: any) => p.key)).toEqual([
        "users.manage",
      ]);
      await expect(
        authorization.setRolePermissions(
          workspaceId,
          actorId,
          roleId,
          ["projects.read"],
          0,
        ),
      ).rejects.toThrow("Authorization changed");
    });
    it("rolls back the entire permission set and token on a real database insertion failure", async () => {
      const name = "admin_fault_" + randomUUID().replaceAll("-", "");
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."roleId" = '${roleId}' THEN RAISE EXCEPTION 'test fault'; END IF; RETURN NEW; END; $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${name}" BEFORE INSERT ON "RolePermission" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
      );
      try {
        await expect(
          authorization.setRolePermissions(
            workspaceId,
            actorId,
            roleId,
            ["users.manage"],
            0,
          ),
        ).rejects.toThrow();
        const snapshot = await authorization.getRole(workspaceId, roleId);
        expect(snapshot.revision).toBe(0);
        expect(snapshot.permissions.map((p: any) => p.key)).toEqual([
          "projects.read",
        ]);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER "${name}" ON "RolePermission"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
      }
    });
  },
);
