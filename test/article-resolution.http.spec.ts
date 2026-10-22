import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { ArticleProposalsService } from "../src/articles/article-proposals.service";
import { ArticleReviewsService } from "../src/articles/article-reviews.service";
import { ArticleResolutionService } from "../src/articles/article-resolution.service";
import { ArticleCanonicalService } from "../src/articles/article-canonical.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
} from "./support/frontend-session-harness";

const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "reviewer alternative resolution isolated HTTP/persistence",
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
      await f.prisma.articleDocument.updateMany({
        where: { projectId },
        data: { headVersionId: null },
      });
      await f.prisma.articlePublishedVersion.deleteMany({
        where: { document: { projectId } },
      });
      await f.prisma.articleResolutionApproval.deleteMany({
        where: { reviewer: { review: { projectId } } },
      });
      await f.prisma.articleResolutionBallot.deleteMany({
        where: { reviewer: { review: { projectId } } },
      });
      await f.prisma.articleResolutionChoice.deleteMany({
        where: { reviewer: { review: { projectId } } },
      });
      await f.prisma.articleResolutionReviewer.deleteMany({
        where: { review: { projectId } },
      });
      await f.prisma.articleProposalCandidate.deleteMany({
        where: { projectId },
      });
      await f.prisma.articleResolutionReview.deleteMany({
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
        where: { userId: { in: [owner, ...voters] }, roleId: authorRole },
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
    const push = (id: string, user = author, revision = 0) =>
      call(
        `/article-proposal-candidates/${id}/submit`,
        user,
        "POST",
        {},
        revision,
      );
    const dispatch = (id: string, reviewId = randomUUID(), user = owner) =>
      call(
        `/article-proposal-candidates/${id}/reviewer-resolution`,
        user,
        "POST",
        { id: reviewId, voterIds: [voters[0], voters[2]] },
        1,
      );
    const read = (id: string, user = voters[0]!) =>
      call(`/article-resolution-reviews/${id}`, user);
    const choose = (
      id: string,
      choices: unknown[],
      user = voters[0]!,
      revision = 0,
    ) =>
      call(
        `/article-resolution-reviews/${id}/choices`,
        user,
        "PUT",
        { choices },
        revision,
      );
    const prepare = async () => {
      const candidate = await (await stage()).json();
      expect((await push(candidate.id)).status).toBe(201);
      return candidate;
    };
    const conflictReview = async (count = 5) => {
      const a = await prepare(),
        b = await (
          await stage({ ...input(), sourceArticleId: privateId })
        ).json();
      expect((await push(b.id)).status).toBe(201);
      const response = await call(
        `/article-proposal-candidates/${a.id}/reviewer-resolution`,
        owner,
        "POST",
        { id: randomUUID(), voterIds: voters.slice(0, count) },
        1,
      );
      expect(response.status).toBe(201);
      return response.json();
    };
    const ballot = (id: string, option: string, user: string, round = 1) =>
      call(
        `/article-resolution-reviews/${id}/ballot`,
        user,
        "POST",
        { option, round },
        0,
      );
    const approval = (id: string, approved: boolean, user: string) =>
      call(
        `/article-resolution-reviews/${id}/approval`,
        user,
        "POST",
        { approved },
        0,
      );
    const canonical = (id = documentId, user = voters[5]!) =>
      call(`/article-documents/${id}/publication`, user);
    const reviewStage = async (body = input(), revision = 2) => {
      const candidate = await (await stage(body, revision)).json();
      expect((await push(candidate.id)).status).toBe(201);
      const response = await call(
        `/article-proposal-candidates/${candidate.id}/reviewer-resolution`,
        owner,
        "POST",
        { id: randomUUID(), voterIds: voters.slice(0, 5) },
        1,
      );
      expect(response.status).toBe(201);
      return response.json();
    };
    const approveAll = async (id: string) => {
      let result: any;
      for (let i = 0; i < 5; i++) {
        const response = await approval(id, true, voters[i]!);
        expect(response.status).toBe(201);
        result = await response.json();
      }
      return result;
    };
    const threeAuthors = async () => {
      const published = await seedPublishedBase(),
        people = [author, voters[3]!, voters[4]!],
        sources = [privateId, randomUUID(), randomUUID()];
      for (let i = 1; i < 3; i++) {
        await f.prisma.userRoleAssignment.create({
          data: {
            userId: people[i]!,
            roleId: authorRole,
            workspaceId: f.manifest.workspaceId,
          },
        });
        expect(
          (
            await call(
              "/article-drafts",
              people[i]!,
              "POST",
              {
                id: sources[i]!,
                title: "Submitted title",
                text: `Private contribution ${i}`,
              },
              0,
            )
          ).status,
        ).toBe(201);
      }
      const candidates = [];
      for (let i = 0; i < 3; i++) {
        const response = await stage(
          {
            ...input(),
            sourceArticleId: sources[i]!,
            baseVersionId: published.version.id,
            baseForestRevision: 1,
          },
          i ? 1 : 2,
          people[i]!,
        );
        expect(response.status).toBe(201);
        candidates.push(await response.json());
      }
      return { published, people, sources, candidates };
    };
    it("warns about submitted opponents and rejects only the third-author pending batch without deleting work", async () => {
      const x = await threeAuthors(),
        [a, b, c] = x.candidates;
      const unrelatedId = randomUUID();
      expect(
        (await call("/article-documents", author, "POST", { id: unrelatedId }))
          .status,
      ).toBe(201);
      const unrelated = await (
        await stage({
          ...input(),
          documentId: unrelatedId,
          sourceArticleId: privateId,
          baseForestRevision: 1,
          positions: [
            { id: documentId, parentId: null },
            { id: unrelatedId, parentId: null },
          ],
          readingOrder: [documentId, unrelatedId],
        })
      ).json();
      expect((await push(unrelated.id)).status).toBe(201);
      expect((await push(a.id, x.people[0]!)).status).toBe(201);
      const warning = await (await get(b.id, x.people[1]!)).json();
      expect(warning.opponentWarning).toMatchObject({
        competing: true,
        otherAuthorCount: 1,
      });
      expect(JSON.stringify(warning.opponentWarning)).not.toContain(
        x.people[0],
      );
      expect((await push(b.id, x.people[1]!)).status).toBe(201);
      const rejected = await push(c.id, x.people[2]!);
      expect(rejected.status).toBe(201);
      expect(await rejected.json()).toMatchObject({
        state: "REJECTED_FOR_COORDINATION",
        revision: 3,
        opponentWarning: { otherAuthorCount: 2 },
        coordination: { reason: "AUTHOR_LIMIT" },
      });
      for (let i = 0; i < 3; i++) {
        expect(
          (await (await get(x.candidates[i]!.id, x.people[i]!)).json()).state,
        ).toBe("REJECTED_FOR_COORDINATION");
        expect(
          (await call(`/article-drafts/${x.sources[i]}`, x.people[i]!)).status,
        ).toBe(200);
      }
      expect((await (await get(unrelated.id)).json()).state).toBe(
        "QUEUED_FOR_REVIEW",
      );
      expect(
        await f.prisma.articleProposalContribution.count({
          where: { documentId },
        }),
      ).toBe(3);
      expect(
        (
          await f.prisma.articleDocument.findUniqueOrThrow({
            where: { id: documentId },
          })
        ).headVersionId,
      ).toBe(x.published.version.id);
      await expect(
        f.prisma.articleProposalCandidate.update({
          where: { id: a.id },
          data: {
            revision: 1,
            coordinationRejectedAt: null,
            coordinationReason: null,
          },
        }),
      ).rejects.toThrow();
      expect(
        (
          await call(
            `/article-drafts/${privateId}`,
            author,
            "PUT",
            {
              title: "Coordinated",
              text: "One combined document after discussion",
            },
            2,
          )
        ).status,
      ).toBe(200);
      const fresh = await (
        await stage(
          {
            ...input(),
            sourceArticleId: privateId,
            baseVersionId: x.published.version.id,
            baseForestRevision: 1,
          },
          3,
        )
      ).json();
      expect((await push(fresh.id)).status).toBe(201);
      expect((await (await get(fresh.id)).json()).state).toBe(
        "QUEUED_FOR_REVIEW",
      );
    });
    it("rolls back a failed third-author rejection and reconciles a committed lost acknowledgement without replay", async () => {
      const x = await threeAuthors(),
        [a, b, c] = x.candidates,
        original = f.prisma.$transaction.bind(f.prisma);
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id, x.people[1]!)).status).toBe(201);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
        callback: any,
      ) =>
        original(async (tx) => {
          jest
            .spyOn(tx.articleProposalCandidate, "updateMany")
            .mockRejectedValueOnce(new Error("Synthetic rejection failure"));
          return callback(tx);
        })) as typeof f.prisma.$transaction);
      expect((await push(c.id, x.people[2]!)).status).toBe(500);
      expect((await (await get(a.id)).json()).state).toBe("QUEUED_FOR_REVIEW");
      expect((await (await get(c.id, x.people[2]!)).json()).state).toBe(
        "PRE_REVIEW",
      );
      jest.restoreAllMocks();
      let attempts = 0;
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce((async (
        callback: any,
      ) => {
        attempts++;
        await original(callback);
        throw new Prisma.PrismaClientKnownRequestError(
          "Synthetic rejection acknowledgement",
          { code: "P2028", clientVersion: "synthetic" },
        );
      }) as typeof f.prisma.$transaction);
      const response = await push(c.id, x.people[2]!);
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("OPERATION_OUTCOME_UNKNOWN");
      expect(attempts).toBe(1);
      expect((await push(c.id, x.people[2]!)).status).toBe(409);
      for (let i = 0; i < 3; i++)
        expect(
          (await (await get(x.candidates[i]!.id, x.people[i]!)).json()).state,
        ).toBe("REJECTED_FOR_COORDINATION");
      expect(
        await f.prisma.articleProposalContribution.count({
          where: { documentId },
        }),
      ).toBe(3);
    });
    it("rejects three active versions even from one author, preserving all captured snapshots", async () => {
      const a = await (await stage()).json(),
        b = await (
          await stage({ ...input(), sourceArticleId: privateId })
        ).json();
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id)).status).toBe(201);
      const source = randomUUID();
      expect(
        (
          await call(
            "/article-drafts",
            author,
            "POST",
            {
              id: source,
              title: "Third version",
              text: "Third distinct source",
            },
            2,
          )
        ).status,
      ).toBe(201);
      const c = await (
        await stage({ ...input(), sourceArticleId: source }, 3)
      ).json();
      const result = await push(c.id);
      expect(result.status).toBe(201);
      expect(await result.json()).toMatchObject({
        state: "REJECTED_FOR_COORDINATION",
        coordination: { reason: "VERSION_LIMIT" },
      });
      expect(
        await f.prisma.articleProposalContribution.count({
          where: { documentId },
        }),
      ).toBe(3);
      for (const candidate of [a, b, c])
        expect((await (await get(candidate.id)).json()).comparison).toEqual(
          candidate.comparison,
        );
    });
    it("supersedes only a newer revision of its own source while preserving two-author provenance and preview", async () => {
      const x = await threeAuthors(),
        a = x.candidates[0],
        b = x.candidates[1];
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id, x.people[1]!)).status).toBe(201);
      expect(
        (
          await call(
            `/article-drafts/${privateId}`,
            author,
            "PUT",
            { title: "Submitted title", text: "Intro\nnew A\nFooter\n" },
            2,
          )
        ).status,
      ).toBe(200);
      const next = await (
        await stage(
          {
            ...input(),
            sourceArticleId: privateId,
            baseVersionId: x.published.version.id,
            baseForestRevision: 1,
          },
          3,
        )
      ).json();
      const response = await push(next.id);
      expect(response.status).toBe(201);
      expect((await response.json()).state).toBe("QUEUED_FOR_REVIEW");
      const frozen = await dispatch(a.id);
      expect(frozen.status).toBe(201);
      const r = await frozen.json();
      expect(r.materialization.contributionIds).toEqual([a.id, b.id, next.id]);
      expect(r.materialization.supersededContributionIds).toEqual([a.id]);
      expect(r.combinedComparison).not.toBeNull();
      expect(
        (await (await get(x.candidates[2].id, x.people[2]!)).json()).state,
      ).toBe("PRE_REVIEW");
    });
    it("serializes the third-author push against reviewer visibility without changing a frozen review", async () => {
      const x = await threeAuthors(),
        [a, b, c] = x.candidates;
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id, x.people[1]!)).status).toBe(201);
      const [submitted, frozen] = await Promise.all([
        push(c.id, x.people[2]!),
        dispatch(a.id),
      ]);
      expect(submitted.status).toBe(201);
      if (frozen.status === 201) {
        const r = await frozen.json();
        expect(r.materialization.contributionIds).toEqual([a.id, b.id]);
        expect((await (await get(c.id, x.people[2]!)).json()).state).toBe(
          "QUEUED_FOR_REVIEW",
        );
        expect((await (await read(r.id)).json()).combinedComparison).toEqual(
          r.combinedComparison,
        );
      } else {
        expect(frozen.status).toBe(409);
        for (let i = 0; i < 3; i++)
          expect(
            (await (await get(x.candidates[i]!.id, x.people[i]!)).json()).state,
          ).toBe("REJECTED_FOR_COORDINATION");
      }
    });
    it("exposes and freezes one combined preview with common content once before keep-both voting", async () => {
      expect(
        (
          await call(
            `/article-drafts/${articleId}`,
            author,
            "PUT",
            { title: "Shared title", text: "Intro\nA chunk\nFooter\n" },
            2,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            `/article-drafts/${privateId}`,
            author,
            "PUT",
            { title: "Shared title", text: "Intro\nB chunk\nFooter\n" },
            3,
          )
        ).status,
      ).toBe(200);
      const a = await (await stage(input(), 4)).json(),
        b = await (
          await stage({ ...input(), sourceArticleId: privateId }, 4)
        ).json();
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id)).status).toBe(201);
      const response = await dispatch(a.id);
      expect(response.status).toBe(201);
      const r = await response.json();
      expect(r.combinedComparison.after.article).toEqual({
        id: documentId,
        title: "Shared title",
        text: "Intro\nA chunk\nB chunk\nFooter\n",
      });
      await expect(
        f.prisma.articleResolutionReview.update({
          where: { id: r.id },
          data: { combinedComparison: {} },
        }),
      ).rejects.toThrow();
      expect(
        (
          await call(
            `/article-drafts/${articleId}`,
            author,
            "PUT",
            { title: "Later private", text: "Not reviewed" },
            4,
          )
        ).status,
      ).toBe(200);
      expect((await (await read(r.id)).json()).combinedComparison).toEqual(
        r.combinedComparison,
      );
      for (const voter of [voters[0]!, voters[2]!])
        expect((await ballot(r.id, "KEEP_BOTH", voter)).status).toBe(201);
      expect((await (await canonical()).json()).article).toEqual(
        r.combinedComparison.after.article,
      );
      const version = await f.prisma.articlePublishedVersion.findUniqueOrThrow({
        where: { resolutionReviewId: r.id },
      });
      expect(version.provenance).toMatchObject({
        format: 2,
        outcome: "KEEP_BOTH",
        contributionIds: [a.id, b.id],
      });
    });
    it("does not freeze an invalid oversized combined title or silently choose one title", async () => {
      expect(
        (
          await call(
            `/article-drafts/${articleId}`,
            author,
            "PUT",
            { title: "A".repeat(120), text: "A" },
            2,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            `/article-drafts/${privateId}`,
            author,
            "PUT",
            { title: "B".repeat(120), text: "B" },
            3,
          )
        ).status,
      ).toBe(200);
      const a = await (await stage(input(), 4)).json(),
        b = await (
          await stage({ ...input(), sourceArticleId: privateId }, 4)
        ).json();
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id)).status).toBe(201);
      const response = await dispatch(a.id);
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe(
        "ARTICLE_COMBINED_RESULT_INVALID",
      );
      expect(
        await f.prisma.articleResolutionReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
      expect((await (await get(a.id)).json()).state).toBe("QUEUED_FOR_REVIEW");
    });
    it("reviews exact conflict-free bytes and forest, publishing at3/5 only after everyone votes", async () => {
      const r = await reviewStage();
      expect((await canonical()).status).toBe(404);
      for (const user of [owner, author])
        expect((await approval(r.id, true, user)).status).toBe(404);
      for (let i = 0; i < 5; i++) {
        const response = await approval(r.id, i < 3, voters[i]!);
        expect(response.status).toBe(201);
        expect((await response.json()).phase).toBe(
          i === 4 ? "APPROVED" : "RESOLVING",
        );
      }
      const response = await canonical();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const published = await response.json();
      expect(published.article).toEqual(
        r.materialization.comparison.after.article,
      );
      expect(JSON.stringify(published)).not.toMatch(
        /Unrelated private secret|sourceArticleId|contributionIds|reviewerIds|approvalVoting|authorId/,
      );
      expect((await read(r.id, voters[5]!)).status).toBe(404);
      const version = await f.prisma.articlePublishedVersion.findUniqueOrThrow({
        where: { id: published.versionId },
      });
      expect(version.reviewId).toBeNull();
      expect(version.resolutionReviewId).toBe(r.id);
      expect(version.provenance).toMatchObject({
        format: 2,
        outcome: "APPROVE",
        round: 0,
      });
      expect((await approval(r.id, true, voters[0]!)).status).toBe(201);
      expect((await approval(r.id, false, voters[0]!)).status).toBe(409);
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(1);
    });
    it("rejects a completed sub60 conflict-free review without publishing", async () => {
      const r = await reviewStage();
      for (let i = 0; i < 5; i++)
        expect((await approval(r.id, i < 2, voters[i]!)).status).toBe(201);
      expect((await (await read(r.id)).json()).phase).toBe("REJECTED");
      expect((await canonical()).status).toBe(404);
      expect(
        await f.prisma.articleResolutionApproval.count({
          where: { reviewId: r.id },
        }),
      ).toBe(5);
    });
    it("publishes separate roots and reviewed navigation, preserving old versions across reorder", async () => {
      const first = await reviewStage(),
        firstDone = await approveAll(first.id),
        old = await f.prisma.articlePublishedVersion.findUniqueOrThrow({
          where: { id: firstDone.publication.versionId },
        });
      const secondId = randomUUID();
      expect(
        (await call("/article-documents", author, "POST", { id: secondId }))
          .status,
      ).toBe(201);
      const second = await reviewStage({
        ...input(),
        documentId: secondId,
        sourceArticleId: privateId,
        baseForestRevision: 1,
        positions: [
          { id: documentId, parentId: null },
          { id: secondId, parentId: null },
        ],
        readingOrder: [secondId, documentId],
      });
      await approveAll(second.id);
      expect((await (await canonical(secondId)).json()).nextId).toBe(
        documentId,
      );
      expect((await (await canonical()).json()).previousId).toBe(secondId);
      const reordered = await reviewStage({
        ...input(),
        baseVersionId: old.id,
        baseForestRevision: 2,
        positions: [
          { id: documentId, parentId: null },
          { id: secondId, parentId: null },
        ],
        readingOrder: [documentId, secondId],
      });
      await approveAll(reordered.id);
      expect(await (await canonical()).json()).toMatchObject({
        number: 2,
        previousId: null,
        nextId: secondId,
      });
      expect(
        (await (await call("/article-tree", voters[5]!)).json()).forest
          .readingOrder,
      ).toEqual([documentId, secondId]);
      expect(
        await f.prisma.articlePublishedVersion.findUniqueOrThrow({
          where: { id: old.id },
        }),
      ).toEqual(old);
    });
    it("preserves an approved decision and another publication on concurrent forest mismatch", async () => {
      const first = await reviewStage(),
        secondId = randomUUID();
      expect(
        (await call("/article-documents", author, "POST", { id: secondId }))
          .status,
      ).toBe(201);
      const second = await reviewStage({
          ...input(),
          documentId: secondId,
          sourceArticleId: privateId,
          positions: [{ id: secondId, parentId: null }],
          readingOrder: [secondId],
        }),
        done = await approveAll(second.id);
      const blocked = await approveAll(first.id);
      expect(blocked.phase).toBe("DECIDED");
      expect(blocked.publication.state).toBe("PENDING_COMPATIBILITY");
      const retry = await call(
        `/article-resolution-reviews/${first.id}/publication`,
        owner,
        "POST",
        {},
      );
      expect(retry.status).toBe(201);
      expect((await retry.json()).publication.reason).toBe(
        "PUBLISHED_BASE_MISMATCH",
      );
      expect((await canonical()).status).toBe(404);
      expect((await (await canonical(secondId)).json()).versionId).toBe(
        done.publication.versionId,
      );
      expect(
        (await (await call("/article-tree", voters[5]!)).json()).forest
          .readingOrder,
      ).toEqual([secondId]);
      expect(
        await f.prisma.articleResolutionApproval.count({
          where: { reviewId: first.id },
        }),
      ).toBe(5);
    });
    it("preserves approved bytes across private edits and releases FIFO after promotion", async () => {
      const first = await reviewStage(),
        done = await approveAll(first.id),
        old = await f.prisma.articlePublishedVersion.findUniqueOrThrow({
          where: { id: done.publication.versionId },
        });
      expect(
        (
          await call(
            `/article-drafts/${articleId}`,
            author,
            "PUT",
            { title: "Later private edit", text: "Later unpublished secret" },
            2,
          )
        ).status,
      ).toBe(200);
      expect((await (await canonical()).json()).article).toEqual(
        first.materialization.comparison.after.article,
      );
      const next = await reviewStage(
        { ...input(), baseVersionId: old.id, baseForestRevision: 1 },
        3,
      );
      expect((await approveAll(next.id)).publication.number).toBe(2);
      expect(
        await f.prisma.articlePublishedVersion.findUniqueOrThrow({
          where: { id: old.id },
        }),
      ).toEqual(old);
    });
    it("rolls back final approval, version and head if forest promotion fails", async () => {
      const r = await reviewStage(),
        original = f.prisma.$transaction.bind(f.prisma);
      for (let i = 0; i < 4; i++)
        expect((await approval(r.id, true, voters[i]!)).status).toBe(201);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
        callback: any,
      ) =>
        original(async (tx) => {
          jest
            .spyOn(tx.articlePublicationSpace, "upsert")
            .mockRejectedValueOnce(new Error("Synthetic forest failure"));
          return callback(tx);
        })) as typeof f.prisma.$transaction);
      expect((await approval(r.id, true, voters[4]!)).status).toBe(500);
      expect(
        await f.prisma.articleResolutionApproval.count({
          where: { reviewId: r.id },
        }),
      ).toBe(4);
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(0);
      expect((await (await read(r.id)).json()).phase).toBe("RESOLVING");
      expect((await canonical()).status).toBe(404);
    });
    it("reconciles a committed lost approval acknowledgement without another version", async () => {
      const r = await reviewStage(),
        original = f.prisma.$transaction.bind(f.prisma);
      for (let i = 0; i < 4; i++)
        expect((await approval(r.id, true, voters[i]!)).status).toBe(201);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce((async (
        callback: any,
      ) => {
        await original(callback);
        throw new Prisma.PrismaClientKnownRequestError(
          "Synthetic acknowledgement",
          { code: "P2028", clientVersion: "synthetic" },
        );
      }) as typeof f.prisma.$transaction);
      expect((await approval(r.id, true, voters[4]!)).status).toBe(503);
      const published = await (await canonical()).json();
      expect((await approval(r.id, true, voters[4]!)).status).toBe(201);
      for (let i = 0; i < 2; i++) {
        const retry = await call(
          `/article-resolution-reviews/${r.id}/publication`,
          owner,
          "POST",
          {},
        );
        expect(retry.status).toBe(201);
        expect((await retry.json()).publication.versionId).toBe(
          published.versionId,
        );
      }
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(1);
    });
    it("serializes concurrent final approvals and publication reconciliation", async () => {
      const r = await reviewStage();
      for (let i = 0; i < 3; i++)
        expect((await approval(r.id, true, voters[i]!)).status).toBe(201);
      const responses = await Promise.all([
        approval(r.id, true, voters[3]!),
        approval(r.id, true, voters[4]!),
        approval(r.id, true, voters[4]!),
      ]);
      expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
      const retries = await Promise.all([
        call(
          `/article-resolution-reviews/${r.id}/publication`,
          owner,
          "POST",
          {},
        ),
        call(
          `/article-resolution-reviews/${r.id}/publication`,
          voters[0]!,
          "POST",
          {},
        ),
      ]);
      expect(retries.map((r) => r.status)).toEqual([201, 201]);
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(1);
    });
    it.each(["membership", "account"])(
      "reauthorizes %s before approval and canonical reads",
      async (kind) => {
        const r = await reviewStage();
        beforeAdmission(() =>
          kind === "membership"
            ? f.prisma.projectMember.delete({
                where: {
                  projectId_userId: {
                    projectId: f.manifest.projectId,
                    userId: voters[0]!,
                  },
                },
              })
            : f.prisma.user.update({
                where: { id: voters[0]! },
                data: { status: "BANNED" },
              }),
        );
        expect((await approval(r.id, true, voters[0]!)).status).toBe(
          kind === "membership" ? 404 : 403,
        );
        expect(
          await f.prisma.articleResolutionApproval.count({
            where: { reviewId: r.id },
          }),
        ).toBe(0);
        // The account is already banned when this new request authenticates.
        expect((await call("/article-tree", voters[0]!)).status).toBe(
          kind === "membership" ? 404 : 401,
        );
      },
    );
    it("preserves sanitized canonical read availability errors", async () => {
      jest
        .spyOn(f.prisma, "$transaction")
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError(
            "Synthetic private dependency",
            { code: "P1001", clientVersion: "synthetic" },
          ),
        );
      await expect(
        f.app
          .get(ArticleCanonicalService)
          .tree(actor(voters[5]!), f.manifest.projectId),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: "READ_DEPENDENCY_UNAVAILABLE" },
      });
    });
    it("publishes only the frozen combined keep-both result without a second approval", async () => {
      const r = await conflictReview();
      expect((await approval(r.id, true, voters[0]!)).status).toBe(409);
      for (let i = 0; i < 5; i++)
        expect((await ballot(r.id, "KEEP_BOTH", voters[i]!)).status).toBe(201);
      const retry = await call(
        `/article-resolution-reviews/${r.id}/publication`,
        owner,
        "POST",
        {},
      );
      expect(retry.status).toBe(201);
      expect((await retry.json()).publication.state).toBe("PUBLISHED");
      const published = await canonical();
      expect(published.status).toBe(200);
      expect((await published.json()).article).toEqual(
        r.combinedComparison.after.article,
      );
    });
    it.each(["KEEP_BOTH", "PUBLISH_A", "PUBLISH_B", "REJECT_BOTH"])(
      "selects %s at inclusive60 only after every fixed reviewer votes",
      async (option) => {
        const r = await conflictReview();
        expect(r.conflictVoting.alternatives.map((a: any) => a.label)).toEqual([
          "A",
          "B",
        ]);
        expect((await ballot(r.id, option, owner)).status).toBe(404);
        for (let i = 0; i < 5; i++) {
          const response = await ballot(
            r.id,
            i < 3
              ? option
              : option === "REJECT_BOTH"
                ? "KEEP_BOTH"
                : "REJECT_BOTH",
            voters[i]!,
          );
          expect(response.status).toBe(201);
          const current = await response.json();
          expect(current.conflictVoting.state).toBe(
            i === 4 ? "DECIDED" : "PENDING",
          );
          expect(current.conflictVoting.winner).toBe(i === 4 ? option : null);
          expect(current.conflictVoting.publicationAvailable).toBe(
            i === 4 && ["KEEP_BOTH", "PUBLISH_A", "PUBLISH_B"].includes(option),
          );
        }
        expect((await ballot(r.id, option, voters[0]!)).status).toBe(201);
        expect(
          (
            await ballot(
              r.id,
              option === "KEEP_BOTH" ? "PUBLISH_A" : "KEEP_BOTH",
              voters[0]!,
            )
          ).status,
        ).toBe(409);
        expect(
          await f.prisma.articleResolutionBallot.count({
            where: { reviewId: r.id },
          }),
        ).toBe(5);
        const publishedHead = (
          await f.prisma.articleDocument.findUniqueOrThrow({
            where: { id: documentId },
          })
        ).headVersionId;
        if (["KEEP_BOTH", "PUBLISH_A", "PUBLISH_B"].includes(option))
          expect(publishedHead).not.toBeNull();
        else expect(publishedHead).toBeNull();
        expect((await (await read(r.id)).json()).materialization).toEqual(
          r.materialization,
        );
      },
    );
    it("freezes round1 and opens a single runoff for tied first-place A/B then waits for all voters", async () => {
      const r = await conflictReview();
      expect((await ballot(r.id, "PUBLISH_A", voters[0]!, 2)).status).toBe(409);
      for (let i = 0; i < 5; i++)
        expect(
          (
            await ballot(
              r.id,
              i < 2 ? "PUBLISH_A" : i < 4 ? "PUBLISH_B" : "KEEP_BOTH",
              voters[i]!,
            )
          ).status,
        ).toBe(201);
      const runoff = await (await read(r.id)).json();
      expect(runoff.conflictVoting).toMatchObject({
        state: "RUNOFF_PENDING",
        round: 2,
        allowedOptions: ["PUBLISH_A", "PUBLISH_B"],
      });
      expect((await ballot(r.id, "KEEP_BOTH", voters[0]!, 2)).status).toBe(409);
      for (let i = 0; i < 5; i++) {
        const current = await (
          await ballot(r.id, i < 3 ? "PUBLISH_A" : "PUBLISH_B", voters[i]!, 2)
        ).json();
        expect(current.conflictVoting.state).toBe(
          i === 4 ? "DECIDED" : "RUNOFF_PENDING",
        );
      }
      const final = await (await read(r.id)).json();
      expect(final.myBallots).toHaveLength(2);
      expect(final.conflictVoting.winner).toBe("PUBLISH_A");
      expect(
        await f.prisma.articleResolutionBallot.count({
          where: { reviewId: r.id },
        }),
      ).toBe(10);
      await expect(
        f.prisma.articleResolutionBallot.update({
          where: {
            reviewId_userId_round: {
              reviewId: r.id,
              userId: voters[0]!,
              round: 1,
            },
          },
          data: { option: "PUBLISH_B" },
        }),
      ).rejects.toThrow();
    });
    it("returns for revision without a runoff on a tied cutoff and permits the next FIFO submission", async () => {
      const r = await conflictReview();
      for (let i = 0; i < 5; i++)
        expect(
          (
            await ballot(
              r.id,
              [
                "PUBLISH_A",
                "PUBLISH_A",
                "PUBLISH_B",
                "KEEP_BOTH",
                "REJECT_BOTH",
              ][i]!,
              voters[i]!,
            )
          ).status,
        ).toBe(201);
      const returned = await (await read(r.id)).json();
      expect(returned.phase).toBe("RETURNED_FOR_REVISION");
      expect(returned.conflictVoting).toMatchObject({
        state: "FOR_REVISION",
        reason: "TIED_RUNOFF_CUTOFF",
      });
      expect((await ballot(r.id, "PUBLISH_A", voters[0]!, 2)).status).toBe(409);
      expect(
        (
          await call(
            `/article-drafts/${privateId}`,
            author,
            "PUT",
            { title: "Revised", text: "New proposed revision" },
            2,
          )
        ).status,
      ).toBe(200);
      const next = await (
        await stage({ ...input(), sourceArticleId: privateId }, 3)
      ).json();
      expect((await push(next.id)).status).toBe(201);
      expect((await dispatch(next.id)).status).toBe(201);
      expect(
        await f.prisma.articleResolutionBallot.count({
          where: { reviewId: r.id },
        }),
      ).toBe(5);
    });
    it("returns for revision after a sub60 runoff with no third round or plurality", async () => {
      const r = await conflictReview(6);
      for (let i = 0; i < 6; i++)
        expect(
          (
            await ballot(
              r.id,
              [
                "PUBLISH_A",
                "PUBLISH_A",
                "PUBLISH_B",
                "PUBLISH_B",
                "KEEP_BOTH",
                "REJECT_BOTH",
              ][i]!,
              voters[i]!,
            )
          ).status,
        ).toBe(201);
      for (let i = 0; i < 6; i++)
        expect(
          (await ballot(r.id, i < 3 ? "PUBLISH_A" : "PUBLISH_B", voters[i]!, 2))
            .status,
        ).toBe(201);
      expect((await (await read(r.id)).json()).conflictVoting).toMatchObject({
        state: "FOR_REVISION",
        reason: "RUNOFF_BELOW_THRESHOLD",
        winner: null,
      });
      expect((await ballot(r.id, "PUBLISH_A", voters[0]!, 3)).status).toBe(400);
      expect(
        await f.prisma.articleResolutionBallot.count({
          where: { reviewId: r.id },
        }),
      ).toBe(12);
    });
    it("only an explicit author push discloses a stage and starts submission FIFO", async () => {
      const a = await (await stage()).json();
      await f.prisma.userRoleAssignment.create({
        data: {
          userId: owner,
          roleId: authorRole,
          workspaceId: f.manifest.workspaceId,
        },
      });
      expect((await push(a.id, owner)).status).toBe(404);
      expect((await dispatch(a.id)).status).toBe(409);
      expect((await push(a.id)).status).toBe(201);
      expect((await push(a.id)).status).toBe(409);
      expect((await dispatch(a.id)).status).toBe(201);
      expect((await get(a.id)).status).toBe(200);
      expect((await (await get(a.id)).json()).state).toBe(
        "REVIEWER_RESOLUTION",
      );
    });
    it("orders by accepted pushes and excludes unsubmitted private candidates", async () => {
      const a = await (await stage()).json();
      const b = await (
        await stage({ ...input(), sourceArticleId: privateId })
      ).json();
      expect((await push(b.id)).status).toBe(201);
      const response = await dispatch(b.id);
      expect(response.status).toBe(201);
      const r = await response.json();
      expect(r.materialization.contributionIds).toEqual([b.id]);
      expect(JSON.stringify(r)).not.toContain(a.id);
      expect((await push(a.id)).status).toBe(201);
      expect((await dispatch(a.id)).status).toBe(409);
    });
    it("retains both alternatives, keeps reviewer choices independent, and never publishes", async () => {
      const a = await prepare();
      const b = await (
        await stage({ ...input(), sourceArticleId: privateId })
      ).json();
      expect((await push(b.id)).status).toBe(201);
      expect((await dispatch(b.id)).status).toBe(409);
      const r = await (await dispatch(a.id)).json();
      expect(r.finalVotingAvailable).toBe(false);
      expect(r.materialization.comparison).toBeNull();
      const choices = r.materialization.conflicts
        .map((c: any) => ({
          conflictId: c.id,
          alternativeId: c.alternatives[0].id,
        }))
        .sort((a: any, b: any) => a.conflictId.localeCompare(b.conflictId));
      const other = r.materialization.conflicts
        .map((c: any) => ({
          conflictId: c.id,
          alternativeId: c.alternatives[1].id,
        }))
        .sort((a: any, b: any) => a.conflictId.localeCompare(b.conflictId));
      expect((await choose(r.id, choices)).status).toBe(200);
      expect((await choose(r.id, other, voters[2]!)).status).toBe(200);
      expect((await choose(r.id, other, owner)).status).toBe(404);
      expect((await (await read(r.id)).json()).myChoices).toEqual(choices);
      expect((await (await read(r.id, voters[2]!)).json()).myChoices).toEqual(
        other,
      );
      expect((await (await read(r.id, owner)).json()).myChoices).toBeNull();
      expect(
        await f.prisma.articleResolutionChoice.count({
          where: { reviewId: r.id },
        }),
      ).toBe(2);
      expect(
        await f.prisma.articleReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
      expect(
        await f.prisma.articlePublishedVersion.count({ where: { documentId } }),
      ).toBe(0);
      const head = (
        await f.prisma.articleDocument.findUniqueOrThrow({
          where: { id: documentId },
        })
      ).headVersionId;
      expect(head).toBeNull();
    });
    it("does not give contributors or unrelated members aggregate review access", async () => {
      const a = await prepare(),
        r = await (await dispatch(a.id)).json();
      for (const user of [author, voters[1]!]) {
        expect((await read(r.id, user)).status).toBe(404);
        expect(
          (await (await call("/article-resolution-reviews", user)).json())
            .items,
        ).toEqual([]);
        expect(
          (await call(`/article-resolution-reviews?after=${r.id}`, user))
            .status,
        ).toBe(404);
      }
      expect(
        (await (await call("/article-resolution-reviews", voters[0]!)).json())
          .items,
      ).toHaveLength(1);
      expect((await (await read(r.id)).json()).myChoiceVersion).toBe(0);
    });
    it("serializes duplicate submissions and reviewer preference retries", async () => {
      const a = await (await stage()).json();
      const pushes = await Promise.all([push(a.id), push(a.id)]);
      expect(pushes.map((r) => r.status).sort()).toEqual([201, 409]);
      const r = await (await dispatch(a.id)).json();
      const writes = await Promise.all([choose(r.id, []), choose(r.id, [])]);
      expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await choose(r.id, [], voters[0]!, 1)).status).toBe(200);
      expect(
        await f.prisma.articleResolutionChoice.count({
          where: { reviewId: r.id },
        }),
      ).toBe(1);
    });
    it("blocks revoked reviewers and preserves frozen content while newer submissions wait", async () => {
      const a = await prepare(),
        r = await (await dispatch(a.id)).json();
      const b = await (
        await stage({ ...input(), sourceArticleId: privateId })
      ).json();
      expect((await push(b.id)).status).toBe(201);
      expect((await dispatch(b.id)).status).toBe(409);
      await f.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: f.manifest.projectId,
            userId: voters[0]!,
          },
        },
      });
      expect((await read(r.id)).status).toBe(404);
      expect((await choose(r.id, [])).status).toBe(404);
      expect(
        (await (await read(r.id, voters[2]!)).json()).materialization,
      ).toEqual(r.materialization);
    });
    it("preserves approved bytes and the canonical head during review and choices", async () => {
      const published = await seedPublishedBase();
      const a = await (
        await stage({
          ...input(),
          sourceArticleId: privateId,
          baseVersionId: published.version.id,
          baseForestRevision: 1,
        })
      ).json();
      expect((await push(a.id)).status).toBe(201);
      const response = await dispatch(a.id);
      expect(response.status).toBe(201);
      const r = await response.json();
      expect(r.materialization.before).toEqual(published.after);
      expect((await choose(r.id, [])).status).toBe(200);
      expect(
        (
          await f.prisma.articleDocument.findUniqueOrThrow({
            where: { id: documentId },
          })
        ).headVersionId,
      ).toBe(published.version.id);
      expect(
        await f.prisma.articlePublishedVersion.findUniqueOrThrow({
          where: { id: published.version.id },
        }),
      ).toEqual(published.version);
    });
    it("retains different authors' overlapping contributions with exact provenance", async () => {
      const published = await seedPublishedBase(),
        secondAuthor = voters[1]!,
        secondSource = randomUUID();
      await f.prisma.userRoleAssignment.create({
        data: {
          userId: secondAuthor,
          roleId: authorRole,
          workspaceId: f.manifest.workspaceId,
        },
      });
      expect(
        (
          await call(
            "/article-drafts",
            secondAuthor,
            "POST",
            {
              id: secondSource,
              title: "Another title",
              text: "Another author contribution",
            },
            0,
          )
        ).status,
      ).toBe(201);
      const a = await (
        await stage({
          ...input(),
          sourceArticleId: privateId,
          baseVersionId: published.version.id,
          baseForestRevision: 1,
        })
      ).json();
      const b = await (
        await stage(
          {
            ...input(),
            sourceArticleId: secondSource,
            baseVersionId: published.version.id,
            baseForestRevision: 1,
          },
          1,
          secondAuthor,
        )
      ).json();
      expect((await push(a.id)).status).toBe(201);
      expect((await push(b.id, secondAuthor)).status).toBe(201);
      const response = await dispatch(a.id);
      expect(response.status).toBe(201);
      const r = await response.json();
      expect(r.materialization.contributionIds).toEqual([a.id, b.id]);
      expect(r.materialization.supersededContributionIds).toEqual([]);
      expect(
        r.materialization.conflicts.find((c: any) => c.field === "text")
          .alternatives,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: "Unrelated private secret",
            contributionIds: [a.id],
          }),
          expect.objectContaining({
            value: "Another author contribution",
            contributionIds: [b.id],
          }),
        ]),
      );
      expect((await read(r.id, secondAuthor)).status).toBe(404);
    });
    it("rejects updates to frozen materialization and historical reviewer choices", async () => {
      const a = await prepare(),
        r = await (await dispatch(a.id)).json();
      expect((await choose(r.id, [])).status).toBe(200);
      await expect(
        f.prisma.articleResolutionReview.update({
          where: { id: r.id },
          data: { materialization: {} },
        }),
      ).rejects.toThrow();
      await expect(
        f.prisma.articleResolutionChoice.update({
          where: {
            reviewId_userId_version: {
              reviewId: r.id,
              userId: voters[0]!,
              version: 1,
            },
          },
          data: { choices: [] },
        }),
      ).rejects.toThrow();
      expect((await (await read(r.id)).json()).materialization).toEqual(
        r.materialization,
      );
    });
    it("atomically includes a racing push or leaves it queued after the visibility cutoff", async () => {
      const a = await prepare(),
        b = await (
          await stage({ ...input(), sourceArticleId: privateId })
        ).json();
      const [pushed, dispatched] = await Promise.all([
        push(b.id),
        dispatch(a.id),
      ]);
      expect(pushed.status).toBe(201);
      expect(dispatched.status).toBe(201);
      const review = await dispatched.json(),
        stored = await f.prisma.articleProposalCandidate.findUniqueOrThrow({
          where: { id: b.id },
        });
      if (stored.resolutionReviewId === review.id) {
        expect(stored.revision).toBe(2);
        expect(review.materialization.contributionIds).toContain(b.id);
      } else {
        expect(stored.resolutionReviewId).toBeNull();
        expect(stored.revision).toBe(1);
        expect(review.materialization.contributionIds).not.toContain(b.id);
      }
    });
    it("rolls back review and reviewer visibility together if freezing fails", async () => {
      const a = await prepare(),
        original = f.prisma.$transaction.bind(f.prisma);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
        callback: any,
      ) =>
        original(async (tx) => {
          jest
            .spyOn(tx.articleProposalCandidate, "updateMany")
            .mockRejectedValueOnce(new Error("Synthetic freeze failure"));
          return callback(tx);
        })) as typeof f.prisma.$transaction);
      const response = await dispatch(a.id);
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain(
        "Synthetic freeze failure",
      );
      expect(
        await f.prisma.articleResolutionReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
      expect(
        (
          await f.prisma.articleProposalCandidate.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).resolutionReviewId,
      ).toBeNull();
    });
    it("retains a committed bundle after a lost dispatch acknowledgement without replay", async () => {
      const a = await prepare(),
        reviewId = randomUUID(),
        original = f.prisma.$transaction.bind(f.prisma);
      let attempts = 0;
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce((async (
        callback: any,
      ) => {
        attempts++;
        await original(callback);
        throw new Prisma.PrismaClientKnownRequestError(
          "Synthetic private acknowledgement",
          { code: "P2028", clientVersion: "synthetic" },
        );
      }) as typeof f.prisma.$transaction);
      const response = await dispatch(a.id, reviewId);
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("OPERATION_OUTCOME_UNKNOWN");
      expect(attempts).toBe(1);
      expect((await read(reviewId)).status).toBe(200);
      expect((await dispatch(a.id, reviewId)).status).toBe(409);
      expect(
        await f.prisma.articleResolutionReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(1);
    });
    it("rolls back the last ballot with its decision then reconciles committed acknowledgement loss", async () => {
      const r = await conflictReview(),
        original = f.prisma.$transaction.bind(f.prisma);
      for (let i = 0; i < 4; i++)
        expect((await ballot(r.id, "PUBLISH_A", voters[i]!)).status).toBe(201);
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce(((
        callback: any,
      ) =>
        original(async (tx) => {
          jest
            .spyOn(tx.articleResolutionReview, "update")
            .mockRejectedValueOnce(new Error("Synthetic decision failure"));
          return callback(tx);
        })) as typeof f.prisma.$transaction);
      expect((await ballot(r.id, "PUBLISH_A", voters[4]!)).status).toBe(500);
      expect(
        await f.prisma.articleResolutionBallot.count({
          where: { reviewId: r.id },
        }),
      ).toBe(4);
      expect((await (await read(r.id)).json()).phase).toBe("RESOLVING");
      jest.restoreAllMocks();
      jest.spyOn(f.prisma, "$transaction").mockImplementationOnce((async (
        callback: any,
      ) => {
        await original(callback);
        throw new Prisma.PrismaClientKnownRequestError(
          "Synthetic acknowledgement",
          { code: "P2028", clientVersion: "synthetic" },
        );
      }) as typeof f.prisma.$transaction);
      expect((await ballot(r.id, "PUBLISH_A", voters[4]!)).status).toBe(503);
      expect((await (await read(r.id)).json()).phase).toBe("APPROVED");
      expect((await ballot(r.id, "PUBLISH_A", voters[4]!)).status).toBe(201);
      expect(
        await f.prisma.articleResolutionBallot.count({
          where: { reviewId: r.id },
        }),
      ).toBe(5);
    });
    it("serializes simultaneous final ballots and duplicate retries without replacing any ballot", async () => {
      const r = await conflictReview(2);
      const responses = await Promise.all([
        ballot(r.id, "PUBLISH_B", voters[0]!),
        ballot(r.id, "PUBLISH_B", voters[1]!),
        ballot(r.id, "PUBLISH_B", voters[0]!),
        ballot(r.id, "PUBLISH_B", voters[1]!),
      ]);
      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(
        await f.prisma.articleResolutionBallot.count({
          where: { reviewId: r.id },
        }),
      ).toBe(2);
      expect((await (await read(r.id)).json()).conflictVoting).toMatchObject({
        state: "DECIDED",
        winner: "PUBLISH_B",
      });
      expect((await choose(r.id, [])).status).toBe(409);
    });
    it("reevaluates current authorization at dispatch and rolls back failed admission", async () => {
      const a = await prepare();
      beforeAdmission(() =>
        f.prisma.project.update({
          where: { id: f.manifest.projectId },
          data: { archivedAt: new Date() },
        }),
      );
      await expect(
        f.app
          .get(ArticleResolutionService)
          .dispatch(actor(owner), f.manifest.projectId, a.id, 1, {
            id: randomUUID(),
            voterIds: [voters[0]!],
          }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await f.prisma.articleResolutionReview.count({
          where: { projectId: f.manifest.projectId },
        }),
      ).toBe(0);
      expect(
        (
          await f.prisma.articleProposalCandidate.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).revision,
      ).toBe(1);
    });
    it("returns sanitized read availability and leaves private candidates untouched", async () => {
      const a = await prepare();
      jest
        .spyOn(f.prisma, "$transaction")
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError(
            "synthetic private dependency text",
            { code: "P1001", clientVersion: "synthetic" },
          ),
        );
      await expect(
        f.app
          .get(ArticleResolutionService)
          .list(actor(owner), f.manifest.projectId),
      ).rejects.toMatchObject({ status: 503 });
      jest.restoreAllMocks();
      expect(
        (await proposals().read(actor(author), f.manifest.projectId, a.id))
          .state,
      ).toBe("QUEUED_FOR_REVIEW");
    });
  },
);
