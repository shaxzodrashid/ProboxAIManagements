import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { ProjectMemberPickerController } from "../src/projects/project-member-picker.controller";
import { ProjectMemberPickerService } from "../src/projects/project-member-picker.service";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { PrismaService } from "../src/prisma/prisma.service";
const request = require("supertest");
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "55439" ||
    parsed.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
(url ? describe : describe.skip)(
  "permitted project member picker HTTP and PostgreSQL",
  () => {
    const manage = "projects.members.manage",
      manageAll = "projects.manage-all";
    let db: PrismaClient,
      app: INestApplication,
      picker: ProjectMemberPickerService;
    let w: string,
      fw: string,
      dept: string,
      fdept: string,
      project: string,
      otherProject: string,
      foreignProject: string;
    let a: string,
      b: string,
      member: string,
      stranger: string,
      all: string,
      reader: string,
      outsider: string,
      banned: string,
      aRole: string;
    const roles: string[] = [],
      accounts: string[] = [];
    const needle = "Picker" + randomUUID().replace(/-/g, "");
    const actor = () => ({
      id: a,
      workspaceId: w,
      roles: [],
      permissions: [manage],
    });
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      w = (
        await db.workspace.create({
          data: { slug: "member-picker-" + randomUUID() },
        })
      ).id;
      fw = (
        await db.workspace.create({
          data: { slug: "member-picker-foreign-" + randomUUID() },
        })
      ).id;
      await db.permission.createMany({
        data: [manage, manageAll, "users.read", "projects.read-all"].map(
          (key) => ({ key, name: key, description: key, category: "test" }),
        ),
        skipDuplicates: true,
      });
      const user = async (
        workspaceId: string,
        keys: string[] = [],
        status: "OPEN" | "PENDING" | "BANNED" | "DELETED" = "OPEN",
      ) => {
        const role = await db.role.create({
          data: {
            workspaceId,
            key: randomUUID(),
            name: "ADMIN",
            permissions: {
              create: keys.map((permissionKey) => ({ permissionKey })),
            },
          },
        });
        roles.push(role.id);
        const u = await db.user.create({
          data: {
            workspaceId,
            phoneNumber: "member-picker-" + randomUUID(),
            fullName: "Legacy public name",
            status,
            bio: "PRIVATE biography",
            birthDate: new Date("2000-01-01"),
            roleAssignments: { create: { roleId: role.id } },
          },
        });
        accounts.push(u.id);
        return { id: u.id, roleId: role.id };
      };
      const owner = await user(w, [manage]);
      a = owner.id;
      aRole = owner.roleId;
      b = (await user(w)).id;
      member = (await user(w)).id;
      stranger = (await user(w, [manage])).id;
      all = (await user(w, [manage, manageAll])).id;
      reader = (await user(w, ["users.read", "projects.read-all", manageAll]))
        .id;
      outsider = (await user(fw, [manage, manageAll])).id;
      await user(w, [], "PENDING");
      banned = (await user(w, [], "BANNED")).id;
      await user(w, [], "DELETED");
      await db.user.update({
        where: { id: b },
        data: {
          fullName: "Old name",
          firstName: needle,
          lastName: "Independent",
          username: "candidate_" + needle.toLowerCase(),
        },
      });
      dept = (
        await db.department.create({
          data: {
            workspaceId: w,
            name: "Picker",
            slug: "picker",
            homePath: tmpdir(),
          },
        })
      ).id;
      fdept = (
        await db.department.create({
          data: {
            workspaceId: fw,
            name: "Foreign picker",
            slug: "picker",
            homePath: tmpdir(),
          },
        })
      ).id;
      const createProject = async (
        workspaceId: string,
        departmentId: string,
        creatorId: string,
      ) =>
        (
          await db.project.create({
            data: {
              workspaceId,
              departmentId,
              creatorId,
              name: "Scoped picker",
              directoryName: randomUUID(),
              readAccessEnabled: true,
            },
          })
        ).id;
      project = await createProject(w, dept, a);
      otherProject = await createProject(w, dept, a);
      foreignProject = await createProject(fw, fdept, outsider);
      await db.projectMember.createMany({
        data: [
          { projectId: project, userId: a },
          { projectId: project, userId: member },
          { projectId: project, userId: banned },
        ],
      });
      const projects = new ProjectsService(
        db as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const module = await Test.createTestingModule({
        controllers: [ProjectMemberPickerController, ProjectsController],
        providers: [
          ProjectMemberPickerService,
          { provide: ProjectsService, useValue: projects },
          { provide: PrismaService, useValue: db },
          {
            provide: JwtService,
            useValue: {
              verify: (id: string) => ({
                id,
                type: "access",
                workspaceId: "stale",
              }),
            },
          },
        ],
      }).compile();
      picker = module.get(ProjectMemberPickerService);
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
      await db.userRoleAssignment.deleteMany({ where: { userId: a } });
      await db.user.update({
        where: { id: a },
        data: { workspaceId: w, status: "OPEN" },
      });
      await db.userRoleAssignment.create({
        data: { userId: a, roleId: aRole, workspaceId: w },
      });
      await db.rolePermission.deleteMany({ where: { roleId: aRole } });
      await db.rolePermission.create({
        data: { roleId: aRole, permissionKey: manage },
      });
      await db.project.update({
        where: { id: project },
        data: { archivedAt: null, status: "READY" },
      });
      await db.projectMember.upsert({
        where: { projectId_userId: { projectId: project, userId: a } },
        create: { projectId: project, userId: a },
        update: {},
      });
      await db.user.update({
        where: { id: b },
        data: { status: "OPEN", workspaceId: w },
      });
      await db.projectMember.deleteMany({
        where: { projectId: project, userId: b },
      });
    });
    afterAll(async () => {
      await app?.close();
      if (db) {
        await db.project.deleteMany({
          where: { id: { in: [project, otherProject, foreignProject] } },
        });
        await db.profileContact.deleteMany({
          where: { ownerId: { in: accounts } },
        });
        await db.user.deleteMany({ where: { id: { in: accounts } } });
        await db.role.deleteMany({ where: { id: { in: roles } } });
        await db.department.deleteMany({
          where: { id: { in: [dept, fdept] } },
        });
        await db.workspace.deleteMany({ where: { id: { in: [w, fw] } } });
        await db.$disconnect();
      }
    });
    const call = () => request(app.getHttpServer());
    const read = (
      query: Record<string, unknown> = {},
      user = a,
      id = project,
    ) =>
      call()
        .get(`/projects/${id}/member-candidates`)
        .set("Authorization", "Bearer " + user)
        .query(query);
    const add = (id: string) =>
      call()
        .post(`/projects/${project}/members`)
        .set("Authorization", "Bearer " + a)
        .send({ userId: id });
    it("allows membership manager without users.read and projects.read; returns only minimal current-workspace identities", async () => {
      const result = await read().expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(result.body).sort()).toEqual([
        "items",
        "nextCursor",
        "total",
      ]);
      expect(result.body.total).toBe(6);
      const expected = [a, b, member, stranger, all, reader].sort();
      expect(result.body.items.map((item: any) => item.id)).toEqual(expected);
      result.body.items.forEach((item: any) =>
        expect(Object.keys(item).sort()).toEqual([
          "displayName",
          "firstName",
          "id",
          "isMember",
          "lastName",
          "username",
        ]),
      );
      expect(
        result.body.items.find((item: any) => item.id === member).isMember,
      ).toBe(true);
      expect(
        result.body.items.find((item: any) => item.id === b),
      ).toMatchObject({
        displayName: needle + " Independent",
        firstName: needle,
        lastName: "Independent",
        isMember: false,
      });
      expect(JSON.stringify(result.body)).not.toMatch(
        /PRIVATE|phoneNumber|birthDate|roleAssignments|workspaceId|passwordHash/,
      );
    });
    it("selects a real discovered account through existing add-member route and refreshes isMember", async () => {
      const candidates = await read({ q: needle }).expect(200);
      expect(candidates.body.items.map((item: any) => item.id)).toEqual([b]);
      expect(candidates.body.items[0].isMember).toBe(false);
      await add(b).expect(201);
      await add(b).expect(201);
      expect(
        await db.projectMember.count({
          where: { projectId: project, userId: b },
        }),
      ).toBe(1);
      expect(
        (await read({ q: needle }).expect(200)).body.items[0].isMember,
      ).toBe(true);
    });
    it("flags membership only for this project, without granting membership from discovery", async () => {
      await db.projectMember.create({
        data: { projectId: otherProject, userId: b },
      });
      try {
        expect(
          (await read({ q: needle }).expect(200)).body.items[0].isMember,
        ).toBe(false);
        expect(
          await db.projectMember.count({
            where: { projectId: project, userId: b },
          }),
        ).toBe(0);
      } finally {
        await db.projectMember.delete({
          where: { projectId_userId: { projectId: otherProject, userId: b } },
        });
      }
    });
    it.each(["PENDING", "BANNED", "DELETED"] as const)(
      "excludes %s candidates and rejects later assignment, preserving historical membership",
      async (status) => {
        await db.user.update({ where: { id: b }, data: { status } });
        expect((await read({ q: needle }).expect(200)).body.items).toEqual([]);
        await add(b).expect(404);
        expect(
          await db.projectMember.count({
            where: { projectId: project, userId: banned },
          }),
        ).toBe(1);
        expect(
          (await read().expect(200)).body.items.map((item: any) => item.id),
        ).not.toContain(banned);
      },
    );
    it("rechecks target membership after discovery when the candidate leaves the workspace", async () => {
      await read({ q: needle }).expect(200);
      await db.userRoleAssignment.deleteMany({ where: { userId: b } });
      await db.user.update({ where: { id: b }, data: { workspaceId: fw } });
      expect((await read({ q: needle }).expect(200)).body.items).toEqual([]);
      await add(b).expect(404);
    });
    it("rejects foreign account assignment and foreign project discovery even with manage-all", async () => {
      await add(outsider).expect(404);
      await read({}, a, foreignProject).expect(404);
      await read({}, outsider).expect(404);
      expect(
        (await read({}, all).expect(200)).body.items.map(
          (item: any) => item.id,
        ),
      ).not.toContain(outsider);
    });
    it("denies plain members, directory/read-all permissions and manager without project scope; manage-all needs member-manage", async () => {
      await read({}, member).expect(403);
      await read({}, reader).expect(403);
      await read({}, stranger).expect(403);
      await read({}, all).expect(200);
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: project, userId: a } },
      });
      await read().expect(403);
    });
    it("does not infer scope from creator ownership or a workspace ADMIN label", async () => {
      await read({}, a, otherProject).expect(403);
      await db.rolePermission.deleteMany({ where: { roleId: aRole } });
      await read().expect(403);
    });
    it.each(["PENDING", "BANNED", "DELETED"] as const)(
      "rejects %s caller authentication",
      async (status) => {
        await db.user.update({ where: { id: a }, data: { status } });
        await read().expect(401);
      },
    );
    it("rechecks persisted permission, membership and workspace after guard authorization", async () => {
      await db.rolePermission.deleteMany({ where: { roleId: aRole } });
      await expect(
        picker.read(actor(), project, { q: "", limit: 50 }),
      ).rejects.toMatchObject({ status: 403 });
      await db.rolePermission.create({
        data: { roleId: aRole, permissionKey: manage },
      });
      await db.projectMember.delete({
        where: { projectId_userId: { projectId: project, userId: a } },
      });
      await expect(
        picker.read(actor(), project, { q: "", limit: 50 }),
      ).rejects.toMatchObject({ status: 403 });
      await db.userRoleAssignment.deleteMany({ where: { userId: a } });
      await db.user.update({ where: { id: a }, data: { workspaceId: fw } });
      await expect(
        picker.read(actor(), project, { q: "", limit: 50 }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it.each(["ARCHIVED", "DELETING"])(
      "rejects %s project picker scope",
      async (state) => {
        await db.project.update({
          where: { id: project },
          data:
            state === "ARCHIVED"
              ? { archivedAt: new Date() }
              : { status: "DELETING" },
        });
        await read().expect(409);
      },
    );
    it("supports literal case-insensitive structured and legacy public name/username search", async () => {
      expect(
        (await read({ q: needle.toLowerCase() }).expect(200)).body.items.map(
          (item: any) => item.id,
        ),
      ).toEqual([b]);
      const username = (await db.user.findUniqueOrThrow({ where: { id: b } }))
        .username;
      expect(
        (await read({ q: "@" + username }).expect(200)).body.items.map(
          (item: any) => item.id,
        ),
      ).toEqual([b]);
      expect(
        (await read({ q: "Legacy public name" }).expect(200)).body.items.length,
      ).toBe(5);
      for (const q of ["%", "_", "\\", "' OR true --", "PRIVATE biography"]) {
        const result = await read({ q }).expect(200);
        if (q === "_")
          expect(result.body.items.map((item: any) => item.id)).toEqual([b]);
        else expect(result.body.items).toEqual([]);
      }
    });
    it("does not search or expose requesting manager's private contact alias", async () => {
      const alias = "PRIVATE_ALIAS_" + randomUUID();
      await db.profileContact.create({
        data: { ownerId: a, contactAccountId: b, alias },
      });
      try {
        expect((await read({ q: alias }).expect(200)).body.items).toEqual([]);
      } finally {
        await db.profileContact.delete({
          where: {
            ownerId_contactAccountId: { ownerId: a, contactAccountId: b },
          },
        });
      }
    });
    it("pages deterministically without duplicates and binds continuation to actor/project/query", async () => {
      const allRows = (await read().expect(200)).body.items;
      const first = await read({ limit: 2 }).expect(200);
      const second = await read({
        limit: 2,
        cursor: first.body.nextCursor,
      }).expect(200);
      const third = await read({
        limit: 2,
        cursor: second.body.nextCursor,
      }).expect(200);
      expect([
        ...first.body.items,
        ...second.body.items,
        ...third.body.items,
      ]).toEqual(allRows);
      expect(third.body.nextCursor).toBeNull();
      await read({ cursor: first.body.nextCursor }, all).expect(400);
      await read({ cursor: first.body.nextCursor }, a, otherProject).expect(
        400,
      );
      await read({ cursor: first.body.nextCursor, q: needle }).expect(400);
      await read({ cursor: "bad" }).expect(400);
    });
    it("does not allow a valid cursor to bypass subsequently revoked permission", async () => {
      const first = await read({ limit: 1 }).expect(200);
      await db.rolePermission.deleteMany({ where: { roleId: aRole } });
      await read({ cursor: first.body.nextCursor }).expect(403);
    });
    it("rejects anonymous, invalid IDs and unapproved query selectors", async () => {
      await call().get(`/projects/${project}/member-candidates`).expect(401);
      await read({}, randomUUID()).expect(401);
      await read({}, a, "bad").expect(400);
      await read({}, a, randomUUID()).expect(404);
      for (const query of [
        { workspaceId: fw },
        { ownerId: a },
        { status: "BANNED" },
        { role: "ADMIN" },
        { limit: 0 },
        { limit: 101 },
        { limit: 1.1 },
        { q: "x".repeat(201) },
        { cursor: "x".repeat(2049) },
      ])
        await read(query).expect(400);
      expect((await read({ q: "  " }).expect(200)).body.items.length).toBe(6);
    });
    it("sanitizes discovery dependency failures", async () => {
      const failure = jest
        .spyOn(db, "$transaction")
        .mockRejectedValueOnce(new Error("PRIVATE DB credential"));
      try {
        const result = await read().expect(503);
        expect(JSON.stringify(result.body)).not.toContain("PRIVATE");
      } finally {
        failure.mockRestore();
      }
    });
    it("filters existing membership with counts from exactly the eligible scope", async () => {
      const members = await read({ membership: "members" }).expect(200);
      expect(members.body.total).toBe(2);
      expect(members.body.items.map((row: any) => row.id).sort()).toEqual(
        [a, member].sort(),
      );
      const candidates = await read({
        membership: "nonmembers",
        limit: 1,
      }).expect(200);
      expect(candidates.body.total).toBe(4);
      expect(candidates.body.items).toHaveLength(1);
      expect(candidates.body.items[0].isMember).toBe(false);
      expect(
        (await read({ membership: "members", q: needle }).expect(200)).body
          .total,
      ).toBe(0);
      expect(
        (await read({ membership: "nonmembers", q: needle }).expect(200)).body
          .total,
      ).toBe(1);
      await read({ membership: "BANNED" }).expect(400);
      await read({
        membership: "members",
        cursor: candidates.body.nextCursor,
      }).expect(400);
    });
    it.each(["id", "-id", "name", "-name", "username", "-username"])(
      "supports validated %s sorting and matching bounded continuation",
      async (sort) => {
        const full = await read({ sort }).expect(200);
        const pages: any[] = [];
        let cursor: string | undefined;
        do {
          const page = await read({
            sort,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          }).expect(200);
          pages.push(...page.body.items);
          cursor = page.body.nextCursor ?? undefined;
          expect(page.body.total).toBe(full.body.total);
        } while (cursor);
        expect(pages).toEqual(full.body.items);
        if (sort.includes("username")) expect(pages[0].id).toBe(b);
        if (sort === "-id")
          expect(pages.map((row) => row.id)).toEqual(
            [a, b, member, stranger, all, reader].sort().reverse(),
          );
        if (sort === "name" || sort === "-name") {
          const names = pages.map((row) => row.displayName.toLowerCase());
          expect(names).toEqual(
            [...names]
              .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
              .slice()
              .sort((left, right) =>
                sort.startsWith("-")
                  ? left < right
                    ? 1
                    : left > right
                      ? -1
                      : 0
                  : left < right
                    ? -1
                    : left > right
                      ? 1
                      : 0,
              ),
          );
        }
      },
    );
    it("rejects sort injection and cursor sort changes", async () => {
      await read({ sort: "name; DROP TABLE User" }).expect(400);
      const first = await read({ sort: "name", limit: 1 }).expect(200);
      await read({ sort: "-name", cursor: first.body.nextCursor }).expect(400);
    });
    it("publishes explicit minimal DTOs, bounded query and authorization OpenAPI", () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const route = doc.paths["/projects/{projectId}/member-candidates"]?.get;
      expect(route?.responses["200"]).toBeDefined();
      expect(route?.description).toContain("users.read is not needed");
      expect(
        Object.keys(
          (doc.components?.schemas?.ProjectMemberCandidateDto as SchemaObject)
            ?.properties ?? {},
        ).sort(),
      ).toEqual([
        "displayName",
        "firstName",
        "id",
        "isMember",
        "lastName",
        "username",
      ]);
      expect(
        Object.keys(
          (
            doc.components?.schemas
              ?.ProjectMemberPickerResponseDto as SchemaObject
          )?.properties ?? {},
        ).sort(),
      ).toEqual(["items", "nextCursor", "total"]);
    });
  },
);
