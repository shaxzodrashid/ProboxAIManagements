import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { materializeArticleChanges } from "../src/articles/article-materialization";
import { promoteReviewedArticle } from "../src/articles/article-promotion";
import { validatePublishedVersion } from "../src/articles/article-version-validation";
import { ArticleCanonicalService } from "../src/articles/article-canonical.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
describe("exact reviewed canonical promotion and authorized reads without database", () => {
  const projectId = randomUUID(),
    documentId = randomUUID(),
    reviewId = randomUUID(),
    authorId = randomUUID(),
    voterId = randomUUID(),
    sourceId = randomUUID(),
    workspaceId = randomUUID();
  const actor: AuthenticatedUser = {
    id: voterId,
    workspaceId,
    roles: [],
    permissions: [],
    type: "access",
  };
  let r: any, tx: any, db: any, version: any, document: any, space: any;
  beforeEach(() => {
    version = null;
    const before = {
        format: 1 as const,
        article: null,
        forest: { format: 1 as const, articles: [], readingOrder: [] },
      },
      comparison = {
        format: 1 as const,
        before,
        after: {
          format: 1 as const,
          article: {
            id: documentId,
            title: "Reviewed 👩‍💻 title",
            text: "Reviewed exact\r\nbytes",
          },
          forest: {
            format: 1 as const,
            articles: [{ id: documentId, parentId: null }],
            readingOrder: [documentId],
          },
        },
      };
    const id = randomUUID(),
      change = {
        id,
        authorId,
        sourceArticleId: sourceId,
        sourceRevision: 1,
        sequence: 2,
        comparison,
      };
    r = {
      id: reviewId,
      projectId,
      documentId,
      phase: "DECIDED",
      baseVersionId: null,
      baseForestRevision: 0,
      before,
      reviewers: [
        {
          userId: voterId,
          choiceVersion: 0,
          ballots: [],
          approval: { approved: true },
        },
      ],
      candidates: [
        {
          id,
          projectId,
          documentId,
          authorId,
          resolutionReviewId: reviewId,
          revision: 2,
          submittedAt: new Date(),
          submittedSequence: 2,
          reachedReviewersAt: new Date(),
          contributionId: id,
          contribution: { ...change, documentId },
        },
      ],
      materialization: materializeArticleChanges(documentId, before, [change]),
    };
    document = { id: documentId, projectId, headVersionId: null };
    space = { projectId, revision: 0, nextSequence: 2, forest: before.forest };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findFirst: jest.fn().mockResolvedValue({ id: voterId }) },
      project: { findFirst: jest.fn().mockResolvedValue({ id: projectId }) },
      articleDocument: {
        findFirst: jest.fn().mockResolvedValue(document),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest
          .fn()
          .mockImplementation(async () =>
            version ? [{ ...document, head: version }] : [],
          ),
        update: jest
          .fn()
          .mockImplementation(async ({ data }: any) =>
            Object.assign(document, data),
          ),
      },
      articlePublicationSpace: {
        findUnique: jest.fn().mockImplementation(async () => space),
        upsert: jest.fn().mockImplementation(async ({ update }: any) =>
          Object.assign(space, {
            forest: update.forest,
            revision: space.revision + 1,
          }),
        ),
      },
      articlePublishedVersion: {
        findUnique: jest.fn().mockImplementation(async () => version),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: null } }),
        create: jest
          .fn()
          .mockImplementation(
            async ({ data }: any) =>
              (version = { ...data, reviewId: null, createdAt: new Date() }),
          ),
      },
      articleResolutionReview: {
        findUnique: jest.fn().mockImplementation(async () => r),
        update: jest
          .fn()
          .mockImplementation(async ({ data }: any) => Object.assign(r, data)),
      },
      articleReview: { findUnique: jest.fn() },
    };
    db = { $transaction: jest.fn((fn: any) => fn(tx)) };
  });
  it("promotes exact bytes and forest with resolution provenance once and preserves retry identity", async () => {
    const result = await promoteReviewedArticle(tx, r);
    expect(result).toMatchObject({ state: "PUBLISHED", number: 1 });
    expect(version.comparison).toEqual(r.materialization.comparison);
    expect(version.provenance).toEqual({
      format: 2,
      resolutionReviewId: reviewId,
      outcome: "APPROVE",
      round: 0,
      contributionIds: r.materialization.contributionIds,
    });
    expect(document.headVersionId).toBe(version.id);
    expect(space.revision).toBe(1);
    expect(space.nextSequence).toBe(2);
    expect(space.forest).toEqual(r.materialization.comparison.after.forest);
    expect(r.phase).toBe("APPROVED");
    expect(await promoteReviewedArticle(tx, r)).toEqual(result);
    expect(tx.articlePublishedVersion.create).toHaveBeenCalledTimes(1);
  });
  it.each(["head", "forest-revision", "unknown-old-base"])(
    "preserves decision without writes at %s mismatch",
    async (kind) => {
      if (kind === "head") document.headVersionId = randomUUID();
      if (kind === "forest-revision") space.revision = 1;
      if (kind === "unknown-old-base") r.baseForestRevision = null;
      expect(await promoteReviewedArticle(tx, r)).toEqual({
        state: "BLOCKED",
        reason: "PUBLISHED_BASE_MISMATCH",
      });
      expect(r.phase).toBe("DECIDED");
      expect(tx.articlePublishedVersion.create).not.toHaveBeenCalled();
      expect(tx.articleDocument.update).not.toHaveBeenCalled();
    },
  );
  it("appends after retained history rather than reusing an existing version number", async () => {
    tx.articlePublishedVersion.aggregate.mockResolvedValue({
      _max: { number: 7 },
    });
    expect(await promoteReviewedArticle(tx, r)).toMatchObject({ number: 8 });
  });
  it("does not promote an incomplete or rejected electorate", async () => {
    r.reviewers[0].approval = null;
    expect(await promoteReviewedArticle(tx, r)).toMatchObject({
      state: "CLOSED",
    });
    r.reviewers[0].approval = { approved: false };
    expect(await promoteReviewedArticle(tx, r)).toMatchObject({
      state: "CLOSED",
    });
    expect(tx.articlePublishedVersion.create).not.toHaveBeenCalled();
  });
  it("preserves a completed decision on unsupported current published data, without hiding database failure", async () => {
    tx.articleDocument.count.mockResolvedValue(1);
    expect(await promoteReviewedArticle(tx, r)).toEqual({
      state: "BLOCKED",
      reason: "PUBLISHED_BASE_UNAVAILABLE",
    });
    expect(r.phase).toBe("DECIDED");
    expect(tx.articlePublishedVersion.create).not.toHaveBeenCalled();
    const failure = new Prisma.PrismaClientKnownRequestError(
      "Synthetic unavailable database",
      { code: "P1001", clientVersion: "synthetic" },
    );
    tx.articleDocument.count.mockRejectedValueOnce(failure);
    await expect(promoteReviewedArticle(tx, r)).rejects.toBe(failure);
  });
  it("validates exact resolution origin, project, decision and immutable provenance", async () => {
    await promoteReviewedArticle(tx, r);
    expect(await validatePublishedVersion(tx, version, projectId)).toEqual(
      r.materialization.comparison,
    );
    await expect(
      validatePublishedVersion(
        tx,
        { ...version, reviewId: randomUUID() },
        projectId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      validatePublishedVersion(tx, version, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      validatePublishedVersion(
        tx,
        {
          ...version,
          provenance: { ...version.provenance, outcome: "PUBLISH_A" },
        },
        projectId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    r.reviewers[0].approval = { approved: false };
    await expect(
      validatePublishedVersion(tx, version, projectId),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("retains explicit legacy review origin validation without adopting a resolution", async () => {
    const legacyId = randomUUID(),
      comparison = r.materialization.comparison;
    tx.articleReview.findUnique.mockResolvedValue({
      projectId,
      state: "APPROVED",
      snapshot: {
        format: 1,
        title: comparison.after.article.title,
        text: comparison.after.article.text,
      },
    });
    const legacy = {
      id: randomUUID(),
      documentId,
      number: 1,
      reviewId: legacyId,
      resolutionReviewId: null,
      comparison,
      provenance: {
        format: 1,
        reviewId: legacyId,
        contributionIds: [randomUUID()],
      },
    };
    expect(
      await validatePublishedVersion(tx, legacy as any, projectId),
    ).toEqual(comparison);
    expect(tx.articleResolutionReview.findUnique).not.toHaveBeenCalled();
  });
  it("returns only current canonical content and navigation to a current authorized member", async () => {
    await promoteReviewedArticle(tx, r);
    const canonical = new ArticleCanonicalService(db);
    const result = await canonical.read(
      actor,
      projectId,
      documentId.toUpperCase(),
    );
    expect(result).toMatchObject({
      documentId,
      versionId: version.id,
      number: 1,
      forestRevision: 1,
      article: r.materialization.comparison.after.article,
      previousId: null,
      nextId: null,
    });
    expect(result).not.toHaveProperty("provenance");
    expect(result).not.toHaveProperty("reviewerIds");
    expect(tx.project.findFirst.mock.calls[0][0].where).toMatchObject({
      workspaceId,
      OR: [{ creatorId: voterId }, { members: { some: { userId: voterId } } }],
    });
    await expect(
      canonical.read(actor, projectId, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("reauthorizes revoked scope and preserves sanitized dependency failures", async () => {
    const canonical = new ArticleCanonicalService(db);
    tx.user.findFirst.mockResolvedValue(null);
    await expect(canonical.tree(actor, projectId)).rejects.toMatchObject({
      status: 403,
    });
    tx.user.findFirst.mockResolvedValue({ id: voterId });
    tx.project.findFirst.mockResolvedValue(null);
    await expect(canonical.tree(actor, projectId)).rejects.toMatchObject({
      status: 404,
    });
    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        "Synthetic private database detail",
        { code: "P1001", clientVersion: "synthetic" },
      ),
    );
    await expect(
      canonical.read(actor, projectId, documentId),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "READ_DEPENDENCY_UNAVAILABLE" },
    });
  });
});
