import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import { ArticleReviewsService } from "../src/articles/article-reviews.service";
import { ArticlesService } from "../src/articles/articles.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
} from "./support/frontend-session-harness";

const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "reviewed article publication isolated HTTP/persistence",
  () => {
    let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
    let author: string, authorRole: string, readerRole: string, owner: string;
    let voters: string[],
      tokens: Map<string, string>,
      articleId: string,
      privateId: string;
    const base = () => `/projects/${f.manifest.projectId}`;
    const actor = (id: string): AuthenticatedUser => ({
      id,
      workspaceId: f.manifest.workspaceId,
      roles: [],
      permissions: [],
      type: "access",
    });
    const service = () => f.app.get(ArticleReviewsService);
    const call = (
      path: string,
      user = author,
      method = "GET",
      body?: unknown,
      revision?: number,
    ) =>
      fetch(f.manifest.baseUrl + base() + path, {
        method,
        headers: {
          Authorization: `Bearer ${tokens.get(user)}`,
          "Content-Type": "application/json",
          ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const submit = (
      id = randomUUID(),
      sourceRevision = 2,
      user = author,
      draft = articleId,
    ) =>
      call(
        "/article-reviews",
        user,
        "POST",
        { id, articleId: draft },
        sourceRevision,
      );
    const selected = async (count = 5) => {
      const response = await submit();
      expect(response.status).toBe(201);
      const r = await response.json();
      const selection = await call(
        `/article-reviews/${r.id}/voters`,
        owner,
        "PUT",
        { voterIds: voters.slice(0, count) },
        0,
      );
      expect(selection.status).toBe(200);
      return selection.json();
    };
    const vote = (
      id: string,
      user: string,
      approved: boolean,
      revision: number,
    ) =>
      call(
        `/article-reviews/${id}/votes`,
        user,
        "POST",
        { approved },
        revision,
      );
    const clean = async () => {
      await f.prisma.articleReviewVoter.deleteMany({
        where: { review: { projectId: f.manifest.projectId } },
      });
      await f.prisma.articleReview.deleteMany({
        where: { projectId: f.manifest.projectId },
      });
      await f.prisma.articleDraftRevision.deleteMany({
        where: { projectId: f.manifest.projectId },
      });
      await f.prisma.articleDraftSpace.deleteMany({
        where: { projectId: f.manifest.projectId },
      });
    };
    beforeAll(async () => {
      f = await createFrontendSessionHarness(fixtureDatabaseUrl);
      f.sessions.onModuleDestroy();
      owner = f.manifest.userId;
      for (const key of ["articles.create", "articles.edit"])
        await f.prisma.permission.upsert({
          where: { key },
          create: {
            key,
            name: key,
            description: "Synthetic review fixture",
            category: "Articles",
          },
          update: {},
        });
      authorRole = (
        await f.prisma.role.create({
          data: {
            workspaceId: f.manifest.workspaceId,
            key: randomUUID(),
            name: "Synthetic author",
            permissions: {
              create: ["projects.read", "articles.create", "articles.edit"].map(
                (permissionKey) => ({ permissionKey }),
              ),
            },
          },
        })
      ).id;
      readerRole = (
        await f.prisma.role.create({
          data: {
            workspaceId: f.manifest.workspaceId,
            key: randomUUID(),
            name: "Synthetic voter",
            permissions: { create: [{ permissionKey: "projects.read" }] },
          },
        })
      ).id;
      const member = async (roleId: string) =>
        (
          await f.prisma.user.create({
            data: {
              workspaceId: f.manifest.workspaceId,
              status: "OPEN",
              fullName: "Synthetic review participant",
              phoneNumber: randomUUID(),
              roleAssignments: { create: { roleId } },
              projectMemberships: {
                create: { projectId: f.manifest.projectId },
              },
            },
          })
        ).id;
      author = await member(authorRole);
      voters = [];
      for (let i = 0; i < 6; i++) voters.push(await member(readerRole));
      tokens = new Map(
        [owner, author, ...voters].map((id) => [
          id,
          f.app
            .get(JwtService)
            .sign({ id, workspaceId: f.manifest.workspaceId, type: "access" }),
        ]),
      );
    }, 30000);
    beforeEach(async () => {
      jest.restoreAllMocks();
      await clean();
      await f.prisma.project.update({
        where: { id: f.manifest.projectId },
        data: { creatorId: owner, archivedAt: null, status: "READY" },
      });
      await f.prisma.user.updateMany({
        where: { id: { in: [author, ...voters] } },
        data: { status: "OPEN", workspaceId: f.manifest.workspaceId },
      });
      for (const userId of [author, ...voters]) {
        await f.prisma.projectMember.upsert({
          where: {
            projectId_userId: { projectId: f.manifest.projectId, userId },
          },
          create: { projectId: f.manifest.projectId, userId },
          update: {},
        });
        const roleId = userId === author ? authorRole : readerRole;
        await f.prisma.userRoleAssignment.upsert({
          where: { userId_roleId: { userId, roleId } },
          create: { userId, roleId, workspaceId: f.manifest.workspaceId },
          update: {},
        });
      }
      for (const permissionKey of [
        "projects.read",
        "articles.create",
        "articles.edit",
      ])
        await f.prisma.rolePermission.upsert({
          where: {
            roleId_permissionKey: { roleId: authorRole, permissionKey },
          },
          create: { roleId: authorRole, permissionKey },
          update: {},
        });
      articleId = randomUUID();
      privateId = randomUUID();
      for (const [i, id] of [articleId, privateId].entries()) {
        const r = await call(
          "/article-drafts",
          author,
          "POST",
          {
            id,
            title: i ? "Unrelated private title" : "Submitted title",
            text: i ? "Unrelated private secret" : "Submitted synthetic text",
          },
          i,
        );
        expect(r.status).toBe(201);
      }
    });
    afterAll(async () => {
      jest.restoreAllMocks();
      if (f) {
        await clean();
        await f.close();
      }
    }, 30000);
    it("submits exact content without publishing or sharing unrelated drafts", async () => {
      const r = await (await submit()).json();
      expect(r).toEqual({
        id: r.id,
        articleId,
        sourceRevision: 2,
        revision: 0,
        state: "WAITING_VOTERS",
        article: {
          format: 1,
          id: articleId,
          title: "Submitted title",
          text: "Submitted synthetic text",
        },
        voters: [],
      });
      expect(JSON.stringify(r)).not.toContain("Unrelated");
      expect((await call(`/article-reviews/${r.id}`, owner)).status).toBe(200);
      expect((await call(`/article-reviews/${r.id}`, voters[0]!)).status).toBe(
        404,
      );
      expect(await (await call("/article-reviews", voters[0]!)).json()).toEqual(
        {
          items: [],
          nextAfter: null,
        },
      );
      expect(
        (await call(`/article-publications/${r.id}`, voters[0]!)).status,
      ).toBe(404);
      expect(
        await (await call("/article-publications", voters[0]!)).json(),
      ).toEqual({ items: [], nextAfter: null });
      expect((await call(`/article-drafts/${articleId}`, owner)).status).toBe(
        404,
      );
      expect((await call(`/article-drafts/${privateId}`, owner)).status).toBe(
        404,
      );
    });
    it("requires edit to submit while create alone remains insufficient", async () => {
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: authorRole,
            permissionKey: "articles.edit",
          },
        },
      });
      expect((await submit()).status).toBe(403);
      await expect(
        service().submit(actor(author), f.manifest.projectId, 2, {
          id: randomUUID(),
          articleId,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await f.prisma.articleReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
    });
    it("does not require create for an editor's existing draft submission", async () => {
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: authorRole,
            permissionKey: "articles.create",
          },
        },
      });
      expect((await submit()).status).toBe(201);
    });
    it("requires current source revision and own draft identity", async () => {
      expect((await submit(randomUUID(), 1)).status).toBe(409);
      expect((await submit(randomUUID(), 2, author, randomUUID())).status).toBe(
        404,
      );
      expect((await submit(randomUUID(), 0, owner)).status).toBe(403);
    });
    it("requires If-Match, strict UUIDs/bodies and bounded distinct nonempty voters", async () => {
      expect(
        (
          await call("/article-reviews", author, "POST", {
            id: randomUUID(),
            articleId,
          })
        ).status,
      ).toBe(428);
      expect(
        (
          await call(
            "/article-reviews",
            author,
            "POST",
            { id: randomUUID(), articleId, publish: true },
            2,
          )
        ).status,
      ).toBe(400);
      const r = await (await submit()).json();
      for (const voterIds of [
        [],
        [voters[0]!, voters[0]!],
        [voters[0]!, voters[0]!.toUpperCase()],
        Array.from({ length: 101 }, () => randomUUID()),
        ["not-uuid"],
        [1],
        [null],
        [{}],
      ])
        expect(
          (
            await call(
              `/article-reviews/${r.id}/voters`,
              owner,
              "PUT",
              { voterIds },
              0,
            )
          ).status,
        ).toBe(400);
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[0]!], force: true },
            0,
          )
        ).status,
      ).toBe(400);
      expect((await call("/article-reviews?after=bad", owner)).status).toBe(
        400,
      );
    });
    it("only current owner chooses voters; owner gets no automatic vote", async () => {
      const r = await (await submit()).json();
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            author,
            "PUT",
            { voterIds: voters.slice(0, 1) },
            0,
          )
        ).status,
      ).toBe(404);
      const selection = await call(
        `/article-reviews/${r.id}/voters`,
        owner,
        "PUT",
        { voterIds: voters.slice(0, 1) },
        0,
      );
      expect(selection.status).toBe(200);
      expect((await vote(r.id, owner, true, 1)).status).toBe(404);
      expect((await call(`/article-reviews/${r.id}`, voters[1]!)).status).toBe(
        404,
      );
    });
    it("owner may explicitly select self, without overriding any listed voter", async () => {
      const r = await (await submit()).json();
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [owner, voters[0]!] },
            0,
          )
        ).status,
      ).toBe(200);
      expect((await (await vote(r.id, owner, true, 1)).json()).state).toBe(
        "PENDING",
      );
      expect(
        (await (await vote(r.id, voters[0]!, false, 2)).json()).state,
      ).toBe("REJECTED");
    });
    it("rejects unknown, foreign or currently ineligible voters atomically", async () => {
      const r = await (await submit()).json();
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [randomUUID()] },
            0,
          )
        ).status,
      ).toBe(404);
      await f.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: voters[0]!,
          },
        },
      });
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[0]!] },
            0,
          )
        ).status,
      ).toBe(404);
      await f.prisma.user.update({
        where: { id: voters[1]! },
        data: { status: "BANNED" },
      });
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[1]!] },
            0,
          )
        ).status,
      ).toBe(404);
      await f.prisma.userRoleAssignment.delete({
        where: { userId_roleId: { userId: voters[2]!, roleId: readerRole } },
      });
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[2]!] },
            0,
          )
        ).status,
      ).toBe(404);
      expect(
        (await (await call(`/article-reviews/${r.id}`, owner)).json()).state,
      ).toBe("WAITING_VOTERS");
      expect(
        await f.prisma.articleReviewVoter.count({ where: { reviewId: r.id } }),
      ).toBe(0);
    });
    it("freezes the selected list, rejecting replacements and stale selection", async () => {
      const r = await selected(1);
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[1]!] },
            0,
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[1]!] },
            1,
          )
        ).status,
      ).toBe(409);
      expect((await call(`/article-reviews/${r.id}`, voters[1]!)).status).toBe(
        404,
      );
    });
    it("waits for every vote even after reaching60%, then approves exact3/5", async () => {
      const r = await selected();
      for (let i = 0; i < 5; i++) {
        const response = await vote(r.id, voters[i]!, i < 3, i + 1);
        expect(response.status).toBe(201);
        const result = await response.json();
        expect(result.state).toBe(i < 4 ? "PENDING" : "APPROVED");
        if (i < 4)
          expect(
            (await call(`/article-publications/${r.id}`, voters[5]!)).status,
          ).toBe(404);
      }
      const publication = await call(
        `/article-publications/${r.id}`,
        voters[5]!,
      );
      expect(publication.status).toBe(200);
      expect(publication.headers.get("cache-control")).toBe("no-store");
      expect(await publication.json()).toEqual({
        reviewId: r.id,
        sourceRevision: 2,
        article: r.article,
      });
      expect((await call(`/article-reviews/${r.id}`, voters[5]!)).status).toBe(
        404,
      );
      expect(
        await (await call("/article-publications", voters[5]!)).json(),
      ).toEqual({
        items: [{ reviewId: r.id, articleId, sourceRevision: 2 }],
        nextAfter: null,
      });
      expect(
        (await call(`/article-drafts/${privateId}`, voters[5]!)).status,
      ).toBe(404);
    });
    it("stays pending when failure is already mathematically certain; rejects only on complete2/5", async () => {
      const r = await selected();
      for (let i = 0; i < 5; i++)
        expect(
          (await (await vote(r.id, voters[i]!, i < 2, i + 1)).json()).state,
        ).toBe(i < 4 ? "PENDING" : "REJECTED");
      expect((await call(`/article-publications/${r.id}`, author)).status).toBe(
        404,
      );
      expect((await vote(r.id, voters[4]!, true, 6)).status).toBe(409);
    });
    it("does not round2/3 down to a60% rejection", async () => {
      const r = await selected(3);
      for (let i = 0; i < 3; i++)
        expect(
          (await (await vote(r.id, voters[i]!, i < 2, i + 1)).json()).state,
        ).toBe(i < 2 ? "PENDING" : "APPROVED");
    });
    it("supports an explicitly selected one-person electorate", async () => {
      const r = await selected(1);
      expect((await (await vote(r.id, voters[0]!, true, 1)).json()).state).toBe(
        "APPROVED",
      );
    });
    it("repeated and changed votes fail without modifying stored votes", async () => {
      const r = await selected(2);
      expect((await vote(r.id, voters[0]!, true, 1)).status).toBe(201);
      for (const revision of [1, 2])
        for (const approval of [true, false])
          expect(
            (await vote(r.id, voters[0]!, approval, revision)).status,
          ).toBe(409);
      expect(
        (await (await call(`/article-reviews/${r.id}`, owner)).json()).revision,
      ).toBe(2);
      expect(
        await f.prisma.articleReviewVoter.findUnique({
          where: { reviewId_userId: { reviewId: r.id, userId: voters[0]! } },
        }),
      ).toMatchObject({ approved: true });
    });
    it("later draft edits do not change reviewed or published bytes, or expose other drafts", async () => {
      const r = await selected(1);
      expect(
        (
          await call(
            `/article-drafts/${articleId}`,
            author,
            "PUT",
            { title: "Later private edit", text: "Unreviewed private content" },
            2,
          )
        ).status,
      ).toBe(200);
      expect(
        (await (await vote(r.id, voters[0]!, true, 1)).json()).article,
      ).toEqual(r.article);
      const p = await (
        await call(`/article-publications/${r.id}`, voters[5]!)
      ).json();
      expect(p.article).toEqual(r.article);
      expect(JSON.stringify(p)).not.toMatch(
        /Later|Unreviewed|Unrelated|parentId|readingOrder/,
      );
      const newer = await submit(randomUUID(), 3);
      expect(newer.status).toBe(201);
      expect((await newer.json()).state).toBe("WAITING_VOTERS");
    });
    it("retains one immutable review identity per submitted draft/revision", async () => {
      const id = randomUUID();
      expect((await submit(id)).status).toBe(201);
      expect((await submit(id)).status).toBe(409);
      expect((await submit()).status).toBe(409);
      expect(
        await f.prisma.articleReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(1);
    });
    it("current membership, capability and account revocation block stale voter actors without shrinking electorate", async () => {
      const r = await selected(3);
      await f.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: voters[0]!,
          },
        },
      });
      await expect(
        service().vote(actor(voters[0]!), f.manifest.projectId, r.id, 1, true),
      ).rejects.toMatchObject({ status: 404 });
      await f.prisma.userRoleAssignment.delete({
        where: { userId_roleId: { userId: voters[1]!, roleId: readerRole } },
      });
      await expect(
        service().vote(actor(voters[1]!), f.manifest.projectId, r.id, 1, true),
      ).rejects.toMatchObject({ status: 403 });
      await f.prisma.user.update({
        where: { id: voters[2]! },
        data: { status: "BANNED" },
      });
      await expect(
        service().vote(actor(voters[2]!), f.manifest.projectId, r.id, 1, true),
      ).rejects.toMatchObject({ status: 403 });
      const result = await (
        await call(`/article-reviews/${r.id}`, owner)
      ).json();
      expect(result.state).toBe("PENDING");
      expect(result.voters).toHaveLength(3);
      expect(result.revision).toBe(1);
    });
    it("rechecks owner transfer, without allowing the previous owner to choose voters", async () => {
      const r = await (await submit()).json();
      await f.prisma.project.update({
        where: { id: f.manifest.projectId },
        data: { creatorId: voters[5]! },
      });
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[0]!] },
            0,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            voters[5]!,
            "PUT",
            { voterIds: [voters[0]!] },
            0,
          )
        ).status,
      ).toBe(200);
    });
    it("archival preserves reads while blocking submission, selection and votes", async () => {
      const r = await selected(1);
      await f.prisma.project.update({
        where: { id: f.manifest.projectId },
        data: { archivedAt: new Date() },
      });
      expect((await call(`/article-reviews/${r.id}`, owner)).status).toBe(200);
      expect((await vote(r.id, voters[0]!, true, 1)).status).toBe(409);
      expect((await submit()).status).toBe(409);
      expect(
        (
          await call(
            `/article-reviews/${r.id}/voters`,
            owner,
            "PUT",
            { voterIds: [voters[0]!] },
            1,
          )
        ).status,
      ).toBe(409);
    });
    it("keeps project outsiders and other workspace actors outside published reads", async () => {
      const r = await selected(1);
      await vote(r.id, voters[0]!, true, 1);
      await f.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: voters[5]!,
          },
        },
      });
      expect(
        (await call(`/article-publications/${r.id}`, voters[5]!)).status,
      ).toBe(404);
      await expect(
        service().publication(
          { ...actor(voters[0]!), workspaceId: randomUUID() },
          f.manifest.projectId,
          r.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("rejects malformed retained snapshots without rewriting or exposing them", async () => {
      const r = await selected(1);
      const snapshot = {
        ...r.article,
        futureInternal: "Synthetic retained future field",
      };
      await f.prisma.articleReview.update({
        where: { id: r.id },
        data: { snapshot },
      });
      const result = await call(`/article-reviews/${r.id}`, owner);
      expect(result.status).toBe(409);
      expect(JSON.stringify(await result.json())).not.toContain(
        "futureInternal",
      );
      expect((await vote(r.id, voters[0]!, true, 1)).status).toBe(409);
      expect(
        (
          await f.prisma.articleReview.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).snapshot,
      ).toEqual(snapshot);
    });
    it("does not disclose unsupported draft future fields during submission", async () => {
      const space = await f.prisma.articleDraftSpace.findUniqueOrThrow({
        where: {
          projectId_ownerId: {
            projectId: f.manifest.projectId,
            ownerId: author,
          },
        },
      });
      await f.prisma.articleDraftSpace.update({
        where: {
          projectId_ownerId: {
            projectId: f.manifest.projectId,
            ownerId: author,
          },
        },
        data: {
          forest: {
            ...(space.forest as Prisma.JsonObject),
            future: "retained",
          },
        },
      });
      expect((await submit()).status).toBe(409);
      expect(
        await f.prisma.articleReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
    });
    it("serializes competing selections from separate clients with one winner", async () => {
      const r = await (await submit()).json();
      const peer = new PrismaClient({
        datasources: { db: { url: fixtureDatabaseUrl } },
      });
      try {
        const outcomes = await Promise.allSettled([
          service().selectVoters(actor(owner), f.manifest.projectId, r.id, 0, [
            voters[0]!,
          ]),
          new ArticleReviewsService(peer as PrismaService).selectVoters(
            actor(owner),
            f.manifest.projectId,
            r.id,
            0,
            [voters[1]!],
          ),
        ]);
        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(
          1,
        );
        expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
        expect(
          await f.prisma.articleReviewVoter.count({
            where: { reviewId: r.id },
          }),
        ).toBe(1);
      } finally {
        await peer.$disconnect();
      }
    });
    it("serializes simultaneous distinct votes; stale loser reconciles before final decision", async () => {
      const r = await selected(2),
        peer = new PrismaClient({
          datasources: { db: { url: fixtureDatabaseUrl } },
        });
      try {
        const outcomes = await Promise.allSettled([
          service().vote(
            actor(voters[0]!),
            f.manifest.projectId,
            r.id,
            1,
            true,
          ),
          new ArticleReviewsService(peer as PrismaService).vote(
            actor(voters[1]!),
            f.manifest.projectId,
            r.id,
            1,
            true,
          ),
        ]);
        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(
          1,
        );
        expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
        const pending = await service().read(
          actor(owner),
          f.manifest.projectId,
          r.id,
        );
        expect(pending.state).toBe("PENDING");
        const missingVoter = pending.voters.find(
          (v) => v.approved === null,
        )!.userId;
        expect(
          (
            await service().vote(
              actor(missingVoter),
              f.manifest.projectId,
              r.id,
              2,
              true,
            )
          ).state,
        ).toBe("APPROVED");
        expect(
          await f.prisma.articleReviewVoter.count({
            where: { reviewId: r.id, approved: true },
          }),
        ).toBe(2);
      } finally {
        await peer.$disconnect();
      }
    });
    it("serializes competing yes/no from the same final voter with exactly one decision", async () => {
      const r = await selected(1),
        peer = new PrismaClient({
          datasources: { db: { url: fixtureDatabaseUrl } },
        });
      try {
        const results = await Promise.allSettled([
          service().vote(
            actor(voters[0]!),
            f.manifest.projectId,
            r.id,
            1,
            true,
          ),
          new ArticleReviewsService(peer as PrismaService).vote(
            actor(voters[0]!),
            f.manifest.projectId,
            r.id,
            1,
            false,
          ),
        ]);
        expect(results.filter((o) => o.status === "fulfilled")).toHaveLength(1);
        const stored = await service().read(
          actor(owner),
          f.manifest.projectId,
          r.id,
        );
        expect(stored.revision).toBe(2);
        expect(stored.state).toBe(
          stored.voters[0]!.approved ? "APPROVED" : "REJECTED",
        );
      } finally {
        await peer.$disconnect();
      }
    });
    it("submission/edit race binds either the complete old snapshot or a stale conflict", async () => {
      const peer = new PrismaClient({
        datasources: { db: { url: fixtureDatabaseUrl } },
      });
      try {
        const id = randomUUID();
        const results = await Promise.allSettled([
          service().submit(actor(author), f.manifest.projectId, 2, {
            id,
            articleId,
          }),
          new ArticlesService(peer as PrismaService).edit(
            actor(author),
            f.manifest.projectId,
            articleId,
            2,
            { title: "Race edit", text: "new" },
          ),
        ]);
        expect(results[1].status).toBe("fulfilled");
        const review = await f.prisma.articleReview.findUnique({
          where: { id },
        });
        if (results[0].status === "fulfilled")
          expect(review?.snapshot).toEqual({
            format: 1,
            id: articleId,
            title: "Submitted title",
            text: "Submitted synthetic text",
          });
        else {
          expect(results[0].reason).toMatchObject({ status: 409 });
          expect(review).toBeNull();
        }
      } finally {
        await peer.$disconnect();
      }
    });
    it("rolls back a vote if atomic review decision persistence fails", async () => {
      const r = await selected(1);
      const prisma = f.prisma,
        original = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, "$transaction").mockImplementation(((
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        original(async (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === "articleReview")
                  return new Proxy(target.articleReview, {
                    get(model, method) {
                      if (method === "update")
                        return () => {
                          throw new Error(
                            "Synthetic decision persistence failure",
                          );
                        };
                      const value = Reflect.get(model, method);
                      return typeof value === "function"
                        ? value.bind(model)
                        : value;
                    },
                  });
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        )) as typeof prisma.$transaction);
      await expect(
        service().vote(actor(voters[0]!), f.manifest.projectId, r.id, 1, true),
      ).rejects.toThrow("Synthetic decision persistence failure");
      spy.mockRestore();
      const unchanged = await service().read(
        actor(owner),
        f.manifest.projectId,
        r.id,
      );
      expect(unchanged.revision).toBe(1);
      expect(unchanged.state).toBe("PENDING");
      expect(unchanged.voters[0]!.approved).toBeNull();
    });
    it("preserves read503 versus uncertain mutation semantics with sanitized errors", async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        "Synthetic connection metadata must not leak",
        { code: "P1001", clientVersion: "synthetic" },
      );
      const spy = jest.spyOn(f.prisma, "$transaction").mockRejectedValue(error);
      await expect(
        service().list(actor(owner), f.manifest.projectId),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        service().submit(actor(author), f.manifest.projectId, 2, {
          id: randomUUID(),
          articleId,
        }),
      ).rejects.toBe(error);
      spy.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          "Synthetic uncertain transaction",
          { code: "P2028", clientVersion: "synthetic" },
        ),
      );
      await expect(
        service().vote(
          actor(voters[0]!),
          f.manifest.projectId,
          randomUUID(),
          1,
          true,
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: "OPERATION_OUTCOME_UNKNOWN" },
      });
      spy.mockRestore();
    });
    it("keeps a committed final vote when its acknowledgement is lost; retries cannot change it", async () => {
      const r = await selected(1);
      const original = f.prisma.$transaction.bind(f.prisma);
      const spy = jest
        .spyOn(f.prisma, "$transaction")
        .mockImplementationOnce((async (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) => {
          await original(work);
          throw new Prisma.PrismaClientKnownRequestError(
            "Synthetic acknowledgement loss",
            { code: "P2028", clientVersion: "synthetic" },
          );
        }) as unknown as typeof f.prisma.$transaction);
      await expect(
        service().vote(actor(voters[0]!), f.manifest.projectId, r.id, 1, true),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: "OPERATION_OUTCOME_UNKNOWN" },
      });
      spy.mockRestore();
      const stored = await service().read(
        actor(owner),
        f.manifest.projectId,
        r.id,
      );
      expect(stored.state).toBe("APPROVED");
      expect(stored.revision).toBe(2);
      expect((await vote(r.id, voters[0]!, false, 2)).status).toBe(409);
      expect(
        (await call(`/article-publications/${r.id}`, voters[5]!)).status,
      ).toBe(200);
    });
    it("does not discard completed votes after a listed voter loses membership", async () => {
      const r = await selected(2);
      expect((await vote(r.id, voters[0]!, true, 1)).status).toBe(201);
      await f.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: voters[0]!,
          },
        },
      });
      expect((await (await vote(r.id, voters[1]!, true, 2)).json()).state).toBe(
        "APPROVED",
      );
      expect((await call(`/article-reviews/${r.id}`, voters[0]!)).status).toBe(
        404,
      );
      expect(
        (await call(`/article-publications/${r.id}`, voters[0]!)).status,
      ).toBe(404);
    });
    it("bounds review pages at50 without leaking hidden submitted rows", async () => {
      const data = Array.from({ length: 51 }, () => {
        const id = randomUUID(),
          article = randomUUID();
        return {
          id,
          projectId: f.manifest.projectId,
          projectRefId: f.manifest.projectId,
          authorId: author,
          articleId: article,
          sourceRevision: 2,
          snapshot: {
            format: 1,
            id: article,
            title: "Synthetic pagination",
            text: "Synthetic retained submission",
          },
        };
      });
      await f.prisma.articleReview.createMany({ data });
      const page = await (await call("/article-reviews", owner)).json();
      expect(page.items).toHaveLength(50);
      expect(page.nextAfter).toBe(page.items[49].id);
      const tail = await (
        await call(`/article-reviews?after=${page.nextAfter}`, owner)
      ).json();
      expect(tail.items).toHaveLength(1);
      expect(tail.nextAfter).toBeNull();
      expect(
        new Set([...page.items, ...tail.items].map((r: { id: string }) => r.id))
          .size,
      ).toBe(51);
      expect(await (await call("/article-reviews", voters[5]!)).json()).toEqual(
        { items: [], nextAfter: null },
      );
      expect(
        await (await call("/article-publications", voters[5]!)).json(),
      ).toEqual({ items: [], nextAfter: null });
    });
    it("pages only admitted review metadata, with strict allowlisted projections", async () => {
      const r = await selected(1);
      const listed = await call("/article-reviews", owner);
      expect(listed.headers.get("cache-control")).toBe("no-store");
      expect(await listed.json()).toEqual({
        items: [
          {
            id: r.id,
            articleId,
            sourceRevision: 2,
            revision: 1,
            state: "PENDING",
          },
        ],
        nextAfter: null,
      });
      expect(
        await (await call(`/article-reviews?after=${r.id}`, owner)).json(),
      ).toEqual({ items: [], nextAfter: null });
      expect(await (await call("/article-reviews", voters[5]!)).json()).toEqual(
        {
          items: [],
          nextAfter: null,
        },
      );
    });
  },
);
