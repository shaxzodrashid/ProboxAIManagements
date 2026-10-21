import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import { ArticleProposalsService } from "../src/articles/article-proposals.service";
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
  "private article proposal foundation isolated HTTP/persistence",
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
    const clean = async () => {
      const projectId = f.manifest.projectId;
      await f.prisma.articleProposalCandidate.deleteMany({
        where: { projectId },
      });
      await f.prisma.articleProposalContribution.deleteMany({
        where: { document: { projectId } },
      });
      await f.prisma.articleDocument.updateMany({
        where: { projectId },
        data: { headVersionId: null },
      });
      await f.prisma.articlePublishedVersion.deleteMany({
        where: { document: { projectId } },
      });
      await f.prisma.articleDocument.deleteMany({ where: { projectId } });
      await f.prisma.articlePublicationSpace.deleteMany({
        where: { projectId },
      });

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
      await f.prisma.userRoleAssignment.deleteMany({
        where: { userId: { in: voters }, roleId: authorRole },
      });
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
    let documentId: string;
    const proposals = () => f.app.get(ArticleProposalsService);
    const input = (id = randomUUID()) => ({
      id,
      documentId,
      sourceArticleId: articleId,
      baseVersionId: null as string | null,
      baseForestRevision: 0,
      positions: [{ id: documentId, parentId: null as string | null }],
      readingOrder: [documentId],
    });
    const stage = (body = input(), revision = 2, user = author) =>
      call("/article-proposal-candidates", user, "POST", body, revision);
    const get = (id: string, user = author) =>
      call(`/article-proposal-candidates/${id}`, user);
    beforeEach(async () => {
      documentId = randomUUID();
      expect(
        (await call("/article-documents", author, "POST", { id: documentId }))
          .status,
      ).toBe(201);
    });
    const seedPublishedBase = async () => {
      // Synthetic persistence setup only; there is no new publication/promotion API.
      const review = await service().submit(
        actor(author),
        f.manifest.projectId,
        2,
        { id: randomUUID(), articleId },
      );
      const selected = await service().selectVoters(
        actor(owner),
        f.manifest.projectId,
        review.id,
        0,
        [voters[0]!],
      );
      await service().vote(
        actor(voters[0]!),
        f.manifest.projectId,
        review.id,
        selected.revision,
        true,
      );
      const forest = {
        format: 1,
        articles: [{ id: documentId, parentId: null }],
        readingOrder: [documentId],
      };
      const after = {
        format: 1,
        article: {
          id: documentId,
          title: review.article.title,
          text: review.article.text,
        },
        forest,
      };
      const version = await f.prisma.articlePublishedVersion.create({
        data: {
          id: randomUUID(),
          documentId,
          number: 1,
          reviewId: review.id,
          comparison: {
            format: 1,
            before: {
              format: 1,
              article: null,
              forest: { format: 1, articles: [], readingOrder: [] },
            },
            after,
          },
          provenance: {
            format: 1,
            reviewId: review.id,
            contributionIds: [randomUUID()],
          },
        },
      });
      await f.prisma.articleDocument.update({
        where: { id: documentId },
        data: { headVersionId: version.id },
      });
      await f.prisma.articlePublicationSpace.create({
        data: { projectId: f.manifest.projectId, revision: 1, forest },
      });
      return { version, review, forest, after };
    };
    const beforeAdmission = (mutate: () => Promise<unknown>) => {
      const original = f.prisma.$transaction.bind(f.prisma);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce((async (
        callback: any,
        options: any,
      ) => {
        await mutate();
        return original(callback, options);
      }) as typeof f.prisma.$transaction);
    };
    it("reserves identity without copying drafts, adopting reviews or publishing anything", async () => {
      const doc = await f.prisma.articleDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      expect(doc.headVersionId).toBeNull();
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(0);
      expect(
        await f.prisma.articleReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
      expect(
        (await (await call("/article-publications", voters[0]!)).json()).items,
      ).toEqual([]);
      expect(
        (await call("/article-documents", author, "POST", { id: documentId }))
          .status,
      ).toBe(409);
    });
    it("keeps create separate from edit for reservations and private staging", async () => {
      const key = (permissionKey: string) => ({
        roleId_permissionKey: { roleId: authorRole, permissionKey },
      });
      await f.prisma.rolePermission.delete({ where: key("articles.edit") });
      expect((await stage()).status).toBe(403);
      expect(
        (await call("/article-documents", author, "POST", { id: randomUUID() }))
          .status,
      ).toBe(201);
      await f.prisma.rolePermission.create({
        data: { roleId: authorRole, permissionKey: "articles.edit" },
      });
      await f.prisma.rolePermission.delete({ where: key("articles.create") });
      expect((await stage()).status).toBe(201);
      expect(
        (await call("/article-documents", author, "POST", { id: randomUUID() }))
          .status,
      ).toBe(403);
    });
    it("captures exact selected text and explicit forest while excluding other drafts", async () => {
      const response = await stage();
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const r = await response.json();
      expect(r).toMatchObject({
        documentId,
        state: "PRE_REVIEW",
        revision: 0,
        dispatchAvailable: false,
        sourceArticleId: articleId,
        sourceRevision: 2,
      });
      expect(r.comparison.before).toEqual({
        format: 1,
        article: null,
        forest: { format: 1, articles: [], readingOrder: [] },
      });
      expect(r.comparison.after.article).toEqual({
        id: documentId,
        title: "Submitted title",
        text: "Submitted synthetic text",
      });
      expect(JSON.stringify(r)).not.toMatch(
        /Unrelated|secret|sequence|inputHash|authorId/,
      );
      expect(r.comparison.after.forest).toEqual({
        format: 1,
        articles: input().positions,
        readingOrder: [documentId],
      });
      expect((await get(r.id, owner)).status).toBe(200);
    });
    it("preserves immutable source comparison after later private edits and arrangements", async () => {
      const r = await (await stage()).json();
      expect(
        (
          await call(
            `/article-drafts/${articleId}`,
            author,
            "PUT",
            { title: "Later draft", text: "Later 👩‍💻\r\nprivate text" },
            2,
          )
        ).status,
      ).toBe(200);
      expect((await (await get(r.id)).json()).comparison).toEqual(r.comparison);
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(0);
    });
    it("keeps candidates private from unrelated readers, other editors and selected legacy voters", async () => {
      const r = await (await stage()).json();
      await f.prisma.userRoleAssignment.create({
        data: {
          userId: voters[1]!,
          roleId: authorRole,
          workspaceId: f.manifest.workspaceId,
        },
      });
      for (const id of [voters[0]!, voters[1]!]) {
        expect((await get(r.id, id)).status).toBe(404);
        expect(
          (await (await call("/article-proposal-candidates", id)).json()).items,
        ).toEqual([]);
      }
      const legacy = await service().submit(
        actor(author),
        f.manifest.projectId,
        2,
        { id: randomUUID(), articleId },
      );
      await service().selectVoters(
        actor(owner),
        f.manifest.projectId,
        legacy.id,
        0,
        [voters[0]!],
      );
      expect((await get(r.id, voters[0]!)).status).toBe(404);
      expect(
        (await call(`/article-reviews/${legacy.id}`, voters[0]!)).status,
      ).toBe(200);
    });
    it("does not expose an unpublished reserved identity to another member with edit permission", async () => {
      const id = voters[1]!;
      await f.prisma.userRoleAssignment.create({
        data: {
          userId: id,
          roleId: authorRole,
          workspaceId: f.manifest.workspaceId,
        },
      });
      await new ArticlesService(f.prisma as PrismaService).create(
        actor(id),
        f.manifest.projectId,
        0,
        { id: randomUUID(), title: "Other private", text: "Text" },
      );
      expect((await stage(input(), 1, id)).status).toBe(404);
    });
    it("preserves current approved bytes and head while capturing a published-base comparison", async () => {
      const base = await seedPublishedBase();
      await new ArticlesService(f.prisma as PrismaService).edit(
        actor(author),
        f.manifest.projectId,
        articleId,
        2,
        { title: "Proposed title", text: "Proposed 👩‍💻\r\n" },
      );
      const body = {
        ...input(),
        baseVersionId: base.version.id,
        baseForestRevision: 1,
      };
      const r = await (await stage(body, 3)).json();
      expect(r.comparison.before).toEqual(base.after);
      expect(r.comparison.after.article.text).toBe("Proposed 👩‍💻\r\n");
      expect(
        (
          await f.prisma.articleDocument.findUniqueOrThrow({
            where: { id: documentId },
          })
        ).headVersionId,
      ).toBe(base.version.id);
      expect(
        (
          await f.prisma.articlePublicationSpace.findUniqueOrThrow({
            where: { projectId: f.manifest.projectId },
          })
        ).forest,
      ).toEqual(base.forest);
      expect(
        (
          await (
            await call(`/article-publications/${base.review.id}`, voters[5]!)
          ).json()
        ).article,
      ).toEqual(base.review.article);
    });
    it("allows another editor's own private contribution to an already published identity", async () => {
      const base = await seedPublishedBase(),
        id = voters[1]!,
        source = randomUUID();
      await f.prisma.userRoleAssignment.create({
        data: {
          userId: id,
          roleId: authorRole,
          workspaceId: f.manifest.workspaceId,
        },
      });
      await new ArticlesService(f.prisma as PrismaService).create(
        actor(id),
        f.manifest.projectId,
        0,
        {
          id: source,
          title: "Other authored change",
          text: "Own proposed bytes",
        },
      );
      const body = {
        ...input(),
        sourceArticleId: source,
        baseVersionId: base.version.id,
        baseForestRevision: 1,
      };
      const response = await stage(body, 1, id);
      expect(response.status).toBe(201);
      const r = await response.json();
      expect(r.comparison.before).toEqual(base.after);
      expect((await get(r.id)).status).toBe(404);
      expect((await get(r.id, owner)).status).toBe(200);
    });
    it("protects contribution and version bytes/provenance with the real database update guards", async () => {
      const base = await seedPublishedBase(),
        body = {
          ...input(),
          baseVersionId: base.version.id,
          baseForestRevision: 1,
        };
      const r = await (await stage(body)).json();
      const before =
        await f.prisma.articleProposalContribution.findUniqueOrThrow({
          where: { id: r.id },
        });
      await expect(
        f.prisma.articleProposalContribution.update({
          where: { id: r.id },
          data: { comparison: { format: 99 } },
        }),
      ).rejects.toThrow();
      await expect(
        f.prisma.articlePublishedVersion.update({
          where: { id: base.version.id },
          data: { provenance: { format: 99 } },
        }),
      ).rejects.toThrow();
      expect(
        await f.prisma.articleProposalContribution.findUniqueOrThrow({
          where: { id: r.id },
        }),
      ).toEqual(before);
      expect(
        await f.prisma.articlePublishedVersion.findUniqueOrThrow({
          where: { id: base.version.id },
        }),
      ).toEqual(base.version);
    });
    it("enforces own-document head and project/document candidate foreign keys", async () => {
      const base = await seedPublishedBase(),
        other = randomUUID();
      await f.prisma.articleDocument.create({
        data: { id: other, projectId: f.manifest.projectId, creatorId: author },
      });
      await expect(
        f.prisma.articleDocument.update({
          where: { id: other },
          data: { headVersionId: base.version.id },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
      const r = await (
        await stage({
          ...input(),
          baseVersionId: base.version.id,
          baseForestRevision: 1,
        })
      ).json();
      await expect(
        f.prisma.articleProposalCandidate.update({
          where: { id: r.id },
          data: { projectId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    });
    it("deduplicates concurrent exact sources from separate clients without consuming extra FIFO positions", async () => {
      const peer = new PrismaClient({ datasources: { db: { url } } });
      try {
        const results = await Promise.allSettled([
          proposals().stage(actor(author), f.manifest.projectId, 2, input()),
          new ArticleProposalsService(peer as PrismaService).stage(
            actor(author),
            f.manifest.projectId,
            2,
            input(),
          ),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
        expect(
          await f.prisma.articleProposalCandidate.count({
            where: { projectId: f.manifest.projectId },
          }),
        ).toBe(1);
        expect(
          (
            await f.prisma.articlePublicationSpace.findUniqueOrThrow({
              where: { projectId: f.manifest.projectId },
            })
          ).nextSequence,
        ).toBe(1);
      } finally {
        await peer.$disconnect();
      }
    });
    it("orders later private source revisions by accepted FIFO rather than random review ID", async () => {
      const first = await (
        await stage(input("ffffffff-ffff-4fff-8fff-ffffffffffff"))
      ).json();
      await new ArticlesService(f.prisma as PrismaService).edit(
        actor(author),
        f.manifest.projectId,
        articleId,
        2,
        { title: "Next", text: "Next" },
      );
      const second = await (
        await stage(input("00000000-0000-4000-8000-000000000001"), 3)
      ).json();
      expect(
        (await (await call("/article-proposal-candidates")).json()).items.map(
          (r: any) => r.id,
        ),
      ).toEqual([first.id, second.id]);
      expect(
        (await (await get(first.id)).json()).comparison.after.article.title,
      ).toBe("Submitted title");
      expect(
        (await (await get(second.id)).json()).comparison.after.article.title,
      ).toBe("Next");
    });
    it("does not activate reviewer or promotion routes for a staged candidate", async () => {
      const r = await (await stage()).json();
      for (const tail of ["review", "dispatch", "merge", "votes", "promote"]) {
        expect(
          (
            await call(
              `/article-proposal-candidates/${r.id}/${tail}`,
              owner,
              "POST",
              {},
            )
          ).status,
        ).toBe(404);
      }
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
        await f.prisma.articleReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
    });
    it.each(["draft", "version", "forest"])(
      "rejects stale %s during capture without mutating the queue",
      async (kind) => {
        const body = input();
        if (kind === "version") body.baseVersionId = randomUUID();
        if (kind === "forest") body.baseForestRevision = 1;
        expect((await stage(body, kind === "draft" ? 1 : 2)).status).toBe(409);
        expect(
          await f.prisma.articleProposalCandidate.count({
            where: { projectId: f.manifest.projectId },
          }),
        ).toBe(0);
        expect(
          await f.prisma.articlePublicationSpace.findUnique({
            where: { projectId: f.manifest.projectId },
          }),
        ).toBeNull();
      },
    );
    it("rejects private/missing/cyclic placements and malformed or spoofed DTO fields", async () => {
      const bodies = [
        {
          ...input(),
          positions: [{ id: privateId, parentId: null }],
          readingOrder: [privateId],
        },
        { ...input(), positions: [{ id: documentId, parentId: documentId }] },
        { ...input(), readingOrder: [] },
        { ...input(), authorId: owner },
        {
          ...input(),
          positions: [{ id: documentId, parentId: null, secret: true }],
        },
        { ...input(), baseVersionId: undefined },
      ];
      for (const body of bodies)
        expect(
          (await call("/article-proposal-candidates", author, "POST", body, 2))
            .status,
        ).toBe(400);
      expect(
        (
          await call(
            "/article-proposal-candidates?unknown=x",
            author,
            "POST",
            input(),
            2,
          )
        ).status,
      ).toBe(400);
      expect(
        (await call("/article-proposal-candidates", author, "POST", input()))
          .status,
      ).toBe(428);
    });
    it.each(["membership", "capability", "account"])(
      "rechecks %s revoked after authentication",
      async (kind) => {
        beforeAdmission(() =>
          kind === "membership"
            ? f.prisma.projectMember.delete({
                where: {
                  projectId_userId: {
                    projectId: f.manifest.projectId,
                    userId: author,
                  },
                },
              })
            : kind === "capability"
              ? f.prisma.rolePermission.delete({
                  where: {
                    roleId_permissionKey: {
                      roleId: authorRole,
                      permissionKey: "articles.edit",
                    },
                  },
                })
              : f.prisma.user.update({
                  where: { id: author },
                  data: { status: "BANNED" },
                }),
        );
        expect((await stage()).status).toBe(kind === "membership" ? 404 : 403);
        expect(
          await f.prisma.articleProposalCandidate.count({
            where: { projectId: f.manifest.projectId },
          }),
        ).toBe(0);
      },
    );
    it("blocks archived writes while preserving authorized private reads", async () => {
      const r = await (await stage()).json();
      await f.prisma.project.update({
        where: { id: f.manifest.projectId },
        data: { archivedAt: new Date() },
      });
      expect((await get(r.id)).status).toBe(200);
      expect((await stage()).status).toBe(409);
      expect(
        (await call("/article-documents", author, "POST", { id: randomUUID() }))
          .status,
      ).toBe(409);
    });
    it("serializes source edit/capture to either an exact complete source or a stale conflict", async () => {
      const peer = new PrismaClient({ datasources: { db: { url } } }),
        body = input();
      try {
        const [captured] = await Promise.allSettled([
          proposals().stage(actor(author), f.manifest.projectId, 2, body),
          new ArticlesService(peer as PrismaService).edit(
            actor(author),
            f.manifest.projectId,
            articleId,
            2,
            { title: "Raced", text: "Whole new text" },
          ),
        ]);
        if (captured.status === "fulfilled")
          expect(captured.value!.comparison.after.article).toEqual({
            id: documentId,
            title: "Submitted title",
            text: "Submitted synthetic text",
          });
        else expect(captured.reason).toMatchObject({ status: 409 });
      } finally {
        await peer.$disconnect();
      }
    });
    it("rolls back contribution and FIFO counter if candidate insertion fails", async () => {
      const original = f.prisma.$transaction.bind(f.prisma);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
        callback: any,
      ) =>
        original(async (tx) => {
          jest
            .spyOn(tx.articleProposalCandidate, "create")
            .mockRejectedValueOnce(new Error("Synthetic insert failure"));
          return callback(tx);
        })) as typeof f.prisma.$transaction);
      expect((await stage()).status).toBe(500);
      expect(
        await f.prisma.articleProposalContribution.count({
          where: { documentId },
        }),
      ).toBe(0);
      expect(
        await f.prisma.articlePublicationSpace.findUnique({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBeNull();
    });
    it("retains a committed candidate after a lost acknowledgement without automatic retry", async () => {
      const original = f.prisma.$transaction.bind(f.prisma),
        body = input();
      let calls = 0;
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce((async (
        callback: any,
      ) => {
        calls++;
        await original(callback);
        throw new Prisma.PrismaClientKnownRequestError(
          "Synthetic private detail",
          { code: "P2028", clientVersion: "fixture" },
        );
      }) as typeof f.prisma.$transaction);
      const response = await stage(body);
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("OPERATION_OUTCOME_UNKNOWN");
      expect(calls).toBe(1);
      expect((await get(body.id)).status).toBe(200);
      expect((await stage(body)).status).toBe(409);
      expect(
        await f.prisma.articleProposalCandidate.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(1);
      expect(
        (
          await f.prisma.articlePublicationSpace.findUniqueOrThrow({
            where: { projectId: f.manifest.projectId },
          })
        ).nextSequence,
      ).toBe(1);
    });
    it("sanitizes read outages while preserving unknown-error behavior", async () => {
      const original = f.prisma.$transaction.bind(f.prisma);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
        callback: any,
      ) =>
        original(async (tx) => {
          jest
            .spyOn(tx.articleProposalCandidate, "findMany")
            .mockRejectedValueOnce(
              new Prisma.PrismaClientKnownRequestError(
                "Synthetic private detail",
                { code: "P1001", clientVersion: "fixture" },
              ),
            );
          return callback(tx);
        })) as typeof f.prisma.$transaction);
      const response = await call("/article-proposal-candidates");
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("Synthetic private detail");
      jest
        .spyOn(f.prisma, "$transaction")
        .mockRejectedValueOnce(new Error("Synthetic unknown"));
      expect((await call("/article-proposal-candidates")).status).toBe(500);
    });
    it("bounds real FIFO pages and refuses another author's cursor without revealing hidden ordinals", async () => {
      const first = await (await stage()).json(),
        hiddenId = randomUUID();
      const rows = Array.from({ length: 51 }, (_, i) => ({
        id: randomUUID(),
        sequence: i + 2,
        authorId: author,
      }));
      rows.splice(3, 0, { id: hiddenId, sequence: 53, authorId: voters[1]! });
      for (const [i, row] of rows.entries()) {
        await f.prisma.articleProposalContribution.create({
          data: {
            id: row.id,
            documentId,
            authorId: row.authorId,
            sourceArticleId: articleId,
            sourceRevision: 2,
            baseForestRevision: 0,
            inputHash: i.toString(16).padStart(64, "0"),
            comparison: first.comparison,
          },
        });
        await f.prisma.articleProposalCandidate.create({
          data: {
            id: row.id,
            projectId: f.manifest.projectId,
            documentId,
            authorId: row.authorId,
            sequence: row.sequence,
            contributionId: row.id,
          },
        });
      }
      await f.prisma.articlePublicationSpace.update({
        where: { projectId: f.manifest.projectId },
        data: { nextSequence: 53 },
      });
      const page = await (await call("/article-proposal-candidates")).json();
      expect(page.items).toHaveLength(50);
      expect(page.nextAfter).toBe(page.items[49].id);
      expect(JSON.stringify(page)).not.toMatch(
        /sequence|position|total|sourceRevision|comparison/,
      );
      expect(page.items.some((r: any) => r.id === hiddenId)).toBe(false);
      const last = await (
        await call(`/article-proposal-candidates?after=${page.nextAfter}`)
      ).json();
      expect(last.items).toHaveLength(2);
      expect(last.nextAfter).toBeNull();
      expect(
        (await call(`/article-proposal-candidates?after=${hiddenId}`)).status,
      ).toBe(404);
      expect(
        (await call(`/article-proposal-candidates?after=${randomUUID()}`))
          .status,
      ).toBe(404);
    });
    it.each(["membership", "capability", "account"])(
      "reauthorizes private comparison reads after %s changes",
      async (kind) => {
        const r = await (await stage()).json();
        beforeAdmission(() =>
          kind === "membership"
            ? f.prisma.projectMember.delete({
                where: {
                  projectId_userId: {
                    projectId: f.manifest.projectId,
                    userId: author,
                  },
                },
              })
            : kind === "capability"
              ? f.prisma.rolePermission.delete({
                  where: {
                    roleId_permissionKey: {
                      roleId: authorRole,
                      permissionKey: "projects.read",
                    },
                  },
                })
              : f.prisma.user.update({
                  where: { id: author },
                  data: { status: "BANNED" },
                }),
        );
        expect((await get(r.id)).status).toBe(
          kind === "membership" ? 404 : 403,
        );
      },
    );
    it("changes owner inspection authority immediately without sharing candidates with other members", async () => {
      const r = await (await stage()).json(),
        nextOwner = voters[5]!;
      await f.prisma.project.update({
        where: { id: f.manifest.projectId },
        data: { creatorId: nextOwner },
      });
      expect((await get(r.id, owner)).status).toBe(404);
      expect((await get(r.id, nextOwner)).status).toBe(200);
      expect((await get(r.id, voters[4]!)).status).toBe(404);
    });
    it("rejects a persisted workspace change between authentication and staging", async () => {
      const foreign = await f.prisma.workspace.create({
        data: { slug: "proposal-synthetic-" + randomUUID() },
      });
      try {
        beforeAdmission(async () => {
          await f.prisma.userRoleAssignment.deleteMany({
            where: { userId: author },
          });
          return f.prisma.user.update({
            where: { id: author },
            data: { workspaceId: foreign.id },
          });
        });
        expect((await stage()).status).toBe(403);
        expect(
          await f.prisma.articleProposalCandidate.count({
            where: { projectId: f.manifest.projectId },
          }),
        ).toBe(0);
      } finally {
        await f.prisma.user.update({
          where: { id: author },
          data: { workspaceId: f.manifest.workspaceId },
        });
        await f.prisma.userRoleAssignment.upsert({
          where: { userId_roleId: { userId: author, roleId: authorRole } },
          create: {
            userId: author,
            roleId: authorRole,
            workspaceId: f.manifest.workspaceId,
          },
          update: {},
        });
        await f.prisma.workspace.delete({ where: { id: foreign.id } });
      }
    });
    it("fails closed on unsupported retained snapshot/lifecycle state without rewriting it", async () => {
      const r = await (await stage()).json();
      await f.prisma.articleProposalCandidate.update({
        where: { id: r.id },
        data: { reachedReviewersAt: new Date() },
      });
      expect((await get(r.id)).status).toBe(409);
      expect(
        (
          await f.prisma.articleProposalContribution.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).comparison,
      ).toEqual(r.comparison);
    });
  },
);
