import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { ArticlesService } from "../src/articles/articles.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
} from "./support/frontend-session-harness";

const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "private article drafts real HTTP and persistence",
  () => {
    let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
      roleId: string,
      token: string,
      otherToken: string,
      otherId: string;
    const base = () => `/projects/${f.manifest.projectId}/article-drafts`;
    const call = (
      path: string,
      method = "GET",
      body?: unknown,
      revision?: number,
      bearer = token,
    ) =>
      fetch(f.manifest.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const create = (revision = 0) =>
      call(
        base(),
        "POST",
        {
          id: randomUUID(),
          title: "Synthetic private draft",
          text: "Synthetic private plain text",
        },
        revision,
      );
    beforeAll(async () => {
      f = await createFrontendSessionHarness(fixtureDatabaseUrl);
      f.sessions.onModuleDestroy();
      roleId = (
        await f.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: f.manifest.userId },
        })
      ).roleId;
      for (const key of ["articles.create", "articles.edit"])
        await f.prisma.permission.upsert({
          where: { key },
          create: {
            key,
            name: key,
            description: "Synthetic fixture",
            category: "Articles",
          },
          update: {},
        });
      otherId = (
        await f.prisma.user.create({
          data: {
            workspaceId: f.manifest.workspaceId,
            status: "OPEN",
            fullName: "Synthetic draft peer",
            phoneNumber: randomUUID(),
            roleAssignments: { create: { roleId } },
          },
        })
      ).id;
      await f.prisma.projectMember.create({
        data: { projectId: f.manifest.projectId, userId: otherId },
      });
      const jwt = f.app.get(JwtService);
      token = jwt.sign({
        id: f.manifest.userId,
        workspaceId: f.manifest.workspaceId,
        type: "access",
      });
      otherToken = jwt.sign({
        id: otherId,
        workspaceId: f.manifest.workspaceId,
        type: "access",
      });
    }, 30000);
    beforeEach(async () => {
      await f.prisma.articleDraftRevision.deleteMany({
        where: { projectId: f.manifest.projectId },
      });
      await f.prisma.articleDraftSpace.deleteMany({
        where: { projectId: f.manifest.projectId },
      });
      for (const permissionKey of ["articles.create", "articles.edit"])
        await f.prisma.rolePermission.upsert({
          where: { roleId_permissionKey: { roleId, permissionKey } },
          create: { roleId, permissionKey },
          update: {},
        });
      await f.prisma.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: otherId,
          },
        },
        create: { projectId: f.manifest.projectId, userId: otherId },
        update: {},
      });
    });
    afterAll(async () => {
      if (f) {
        await f.prisma.articleDraftRevision.deleteMany({
          where: { projectId: f.manifest.projectId },
        });
        await f.prisma.articleDraftSpace.deleteMany({
          where: { projectId: f.manifest.projectId },
        });
        await f.close();
      }
    }, 30000);
    it("reads old projects without backfill and creates no draft until requested", async () => {
      const response = await call(base());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        format: 1,
        revision: 0,
        articles: [],
        readingOrder: [],
      });
      expect(
        await f.prisma.articleDraftSpace.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
    });
    it("keeps another current member's list, detail and edit isolated", async () => {
      const response = await create();
      expect(response.status).toBe(201);
      const space = await response.json(),
        id = space.articles[0].id;
      const peer = await call(base(), "GET", undefined, undefined, otherToken);
      expect(peer.status).toBe(200);
      expect((await peer.json()).articles).toEqual([]);
      expect(
        (await call(base() + "/" + id, "GET", undefined, undefined, otherToken))
          .status,
      ).toBe(404);
      expect(
        (
          await call(
            base() + "/" + id,
            "PUT",
            { title: "Changed", text: "" },
            0,
            otherToken,
          )
        ).status,
      ).toBe(404);
    });
    it("separates create and edit without automatically extending either grant", async () => {
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "articles.edit" },
        },
      });
      const response = await create();
      expect(response.status).toBe(201);
      const id = (await response.json()).articles[0].id;
      expect(
        (
          await call(
            base() + "/" + id,
            "PUT",
            { title: "Changed", text: "" },
            1,
          )
        ).status,
      ).toBe(403);
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "articles.create" },
        },
      });
      await f.prisma.rolePermission.create({
        data: { roleId, permissionKey: "articles.edit" },
      });
      expect((await create(1)).status).toBe(403);
      expect(
        (
          await call(
            base() + "/" + id,
            "PUT",
            { title: "Changed", text: "" },
            1,
          )
        ).status,
      ).toBe(200);
    });
    it("validates DTOs, mandatory revisions and fail-closed unfinished endpoints", async () => {
      expect(
        (
          await call(base(), "POST", {
            id: randomUUID(),
            title: "Draft",
            text: "",
          })
        ).status,
      ).toBe(428);
      expect(
        (
          await call(
            base(),
            "POST",
            { id: randomUUID(), title: "Draft", text: "", published: true },
            0,
          )
        ).status,
      ).toBe(400);
      for (const suffix of ["publish", "review", "restore", "media"])
        expect(
          (
            await call(
              base() + "/" + randomUUID() + "/" + suffix,
              "POST",
              {},
              0,
            )
          ).status,
        ).toBe(404);
    });
    it("persists multiple roots, independent navigation, and retained old text", async () => {
      const a = (await (await create()).json()).articles[0],
        b = (await (await create(1)).json()).articles[1];
      const arranged = await call(
        base(),
        "PUT",
        {
          articles: [
            { id: a.id, parentId: b.id },
            { id: b.id, parentId: null },
          ],
          readingOrder: [b.id, a.id],
        },
        2,
      );
      expect(arranged.status).toBe(200);
      const detail = await (await call(base() + "/" + a.id)).json();
      expect(detail).toMatchObject({
        previousId: b.id,
        nextId: null,
        revision: 3,
        parentId: b.id,
      });
      expect(
        (
          await call(
            base() + "/" + a.id,
            "PUT",
            { title: "New", text: "New text" },
            3,
          )
        ).status,
      ).toBe(200);
      const old = await f.prisma.articleDraftRevision.findUniqueOrThrow({
        where: {
          projectId_ownerId_revision: {
            projectId: f.manifest.projectId,
            ownerId: f.manifest.userId,
            revision: 1,
          },
        },
      });
      expect(JSON.stringify(old.forest)).toContain(
        "Synthetic private plain text",
      );
    });
    it("rejects cycles and omission atomically", async () => {
      const space = await (await create()).json(),
        id = space.articles[0].id;
      expect(
        (
          await call(
            base(),
            "PUT",
            { articles: [{ id, parentId: id }], readingOrder: [id] },
            1,
          )
        ).status,
      ).toBe(400);
      expect(
        (await call(base(), "PUT", { articles: [], readingOrder: [] }, 1))
          .status,
      ).toBe(400);
      expect(await (await call(base())).json()).toEqual(space);
      expect(
        await f.prisma.articleDraftRevision.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(1);
    });
    it("rechecks revoked capability and membership despite a stale actor snapshot", async () => {
      const actor: AuthenticatedUser = {
        id: otherId,
        workspaceId: f.manifest.workspaceId,
        roles: [],
        permissions: ["articles.create"],
        type: "access",
      };
      const service = f.app.get(ArticlesService);
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "articles.create" },
        },
      });
      await expect(
        service.create(actor, f.manifest.projectId, 0, {
          id: randomUUID(),
          title: "Draft",
          text: "",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await f.prisma.rolePermission.create({
        data: { roleId, permissionKey: "articles.create" },
      });
      await f.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: otherId,
          },
        },
      });
      await expect(
        service.create(actor, f.manifest.projectId, 0, {
          id: randomUUID(),
          title: "Draft",
          text: "",
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("has one winner for competing revisions from separate PostgreSQL clients", async () => {
      const s = await (await create()).json(),
        id = s.articles[0].id;
      const peer = new PrismaClient({
        datasources: { db: { url: fixtureDatabaseUrl } },
      });
      try {
        const service = new ArticlesService(peer as PrismaService),
          actor: AuthenticatedUser = {
            id: f.manifest.userId,
            workspaceId: f.manifest.workspaceId,
            roles: [],
            permissions: ["articles.edit"],
            type: "access",
          };
        const outcomes = await Promise.allSettled([
          f.app.get(ArticlesService).edit(actor, f.manifest.projectId, id, 1, {
            title: "One",
            text: "one",
          }),
          service.edit(actor, f.manifest.projectId, id, 1, {
            title: "Two",
            text: "two",
          }),
        ]);
        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(
          1,
        );
        expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
        expect(
          await f.prisma.articleDraftRevision.count({
            where: { projectId: f.manifest.projectId },
          }),
        ).toBe(2);
      } finally {
        await peer.$disconnect();
      }
    });
  },
);
