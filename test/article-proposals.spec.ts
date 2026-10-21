import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ArticleProposalsService } from "../src/articles/article-proposals.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
describe("private article FIFO staging service without database", () => {
  let tx: any, db: any, service: ArticleProposalsService;
  const actor: AuthenticatedUser = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    roles: [],
    permissions: [],
    type: "access",
  };
  const owner = randomUUID(),
    projectId = randomUUID(),
    documentId = randomUUID(),
    sourceId = randomUUID(),
    privateId = randomUUID();
  const dto = () => ({
    id: randomUUID(),
    documentId,
    sourceArticleId: sourceId,
    baseVersionId: null,
    baseForestRevision: 0,
    positions: [{ id: documentId, parentId: null }],
    readingOrder: [documentId],
  });
  const candidate = (id = randomUUID(), authorId = actor.id, sequence = 1) => ({
    id,
    projectId,
    documentId,
    authorId,
    sequence,
    revision: 0,
    reachedReviewersAt: null,
    contribution: {
      id,
      documentId,
      authorId,
      sourceArticleId: sourceId,
      sourceRevision: 2,
      baseVersionId: null,
      baseForestRevision: 0,
      comparison: {
        format: 1,
        before: {
          format: 1,
          article: null,
          forest: { format: 1, articles: [], readingOrder: [] },
        },
        after: {
          format: 1,
          article: { id: documentId, title: "Selected", text: "Selected text" },
          forest: {
            format: 1,
            articles: [{ id: documentId, parentId: null }],
            readingOrder: [documentId],
          },
        },
      },
    },
  });
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findFirst: jest.fn().mockResolvedValue({ id: actor.id }) },
      project: {
        findFirst: jest.fn().mockResolvedValue({
          creatorId: owner,
          archivedAt: null,
          status: "READY",
        }),
      },
      articleDocument: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          headVersionId: null,
        })),
        findFirst: jest.fn().mockResolvedValue({
          id: documentId,
          projectId,
          creatorId: actor.id,
          headVersionId: null,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      articleDraftSpace: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 2,
          forest: {
            format: 1,
            articles: [
              {
                id: sourceId,
                title: "Selected",
                text: "Selected text",
                parentId: null,
              },
              {
                id: privateId,
                title: "Unrelated secret",
                text: "Private",
                parentId: null,
              },
            ],
            readingOrder: [privateId, sourceId],
          },
        }),
      },
      articlePublicationSpace: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      articleProposalContribution: {
        create: jest.fn().mockImplementation(async ({ data }: any) => data),
      },
      articleProposalCandidate: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          revision: 0,
          reachedReviewersAt: null,
          contribution:
            tx.articleProposalContribution.create.mock.calls.at(-1)[0].data,
        })),
        findFirst: jest.fn().mockResolvedValue(candidate()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      articlePublishedVersion: { findUnique: jest.fn() },
      articleReview: { findUnique: jest.fn() },
    };
    db = { $transaction: jest.fn((fn: any) => fn(tx)) };
    service = new ArticleProposalsService(db as PrismaService);
  });
  it("reserves a stable identity using create only, without touching drafts or publication", async () => {
    expect(
      await service.reserve(actor, projectId, documentId.toUpperCase()),
    ).toEqual({ id: documentId, headVersionId: null });
    expect(
      tx.user.findFirst.mock.calls[0][0].where.roleAssignments.some.role
        .permissions.some.permissionKey,
    ).toBe("articles.create");
    expect(tx.articleDraftSpace.findUnique).not.toHaveBeenCalled();
    expect(tx.articlePublicationSpace.upsert).not.toHaveBeenCalled();
  });
  const setupSubmission = () => {
    const r = {
      ...candidate(),
      submittedAt: null,
      submittedSequence: null,
      resolutionReviewId: null,
    };
    tx.articleProposalCandidate.findFirst.mockResolvedValue(r);
    tx.articlePublicationSpace.findUnique.mockResolvedValue({
      nextSequence: 7,
    });
    tx.articlePublicationSpace.update = jest.fn();
    tx.articleProposalCandidate.update = jest
      .fn()
      .mockImplementation(async ({ data }: any) => ({ ...r, ...data }));
    return r;
  };
  it("requires an author-scoped explicit submit and allocates accepted FIFO separately from staging", async () => {
    const r = setupSubmission();
    const result = await service.submit(
      actor,
      projectId,
      r.id.toUpperCase(),
      0,
    );
    expect(result).toMatchObject({
      revision: 1,
      state: "QUEUED_FOR_REVIEW",
      comparison: r.contribution.comparison,
    });
    expect(
      tx.articleProposalCandidate.findFirst.mock.calls[0][0].where,
    ).toEqual({ id: r.id, projectId, authorId: actor.id });
    expect(
      tx.user.findFirst.mock.calls[0][0].where.roleAssignments.some.role
        .permissions.some.permissionKey,
    ).toBe("articles.edit");
    expect(
      tx.articlePublicationSpace.update.mock.calls[0][0].data.nextSequence,
    ).toBe(8);
    expect(tx.articleDraftSpace.findUnique).not.toHaveBeenCalled();
    expect(tx.articleProposalContribution.create).not.toHaveBeenCalled();
  });
  it("rejects stale, duplicate or unavailable submission counters before queue changes", async () => {
    const r = setupSubmission();
    await expect(
      service.submit(actor, projectId, r.id, 1),
    ).rejects.toMatchObject({ status: 409 });
    tx.articlePublicationSpace.findUnique.mockResolvedValue({
      nextSequence: 2147483646,
    });
    await expect(
      service.submit(actor, projectId, r.id, 0),
    ).rejects.toMatchObject({ status: 409 });
    tx.articleProposalCandidate.findFirst.mockResolvedValue({
      ...r,
      submittedAt: new Date(),
      submittedSequence: 8,
      revision: 1,
    });
    await expect(
      service.submit(actor, projectId, r.id, 1),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.articleProposalCandidate.update).not.toHaveBeenCalled();
  });
  it("stages exact selected content, explicit placement, provenance and unavailable dispatch", async () => {
    const r = await service.stage(actor, projectId, 2, dto());
    expect(r).toMatchObject({
      documentId,
      state: "PRE_REVIEW",
      dispatchAvailable: false,
      sourceArticleId: sourceId,
      sourceRevision: 2,
      baseVersionId: null,
      baseForestRevision: 0,
    });
    expect(r!.comparison.after.article).toEqual({
      id: documentId,
      title: "Selected",
      text: "Selected text",
    });
    expect(JSON.stringify(r)).not.toMatch(
      /Unrelated secret|Private|sequence|inputHash|authorId/,
    );
    expect(
      tx.user.findFirst.mock.calls[0][0].where.roleAssignments.some.role
        .permissions.some.permissionKey,
    ).toBe("articles.edit");
    expect(
      tx.articleProposalCandidate.create.mock.calls[0][0].data.sequence,
    ).toBe(1);
    expect(tx.articlePublicationSpace.upsert.mock.calls[0][0].update).toEqual({
      nextSequence: 1,
    });
  });
  it("captures exact approved version content and current forest as the before state for another editor", async () => {
    const versionId = randomUUID(),
      reviewId = randomUUID();
    const forest = {
      format: 1,
      articles: [{ id: documentId, parentId: null }],
      readingOrder: [documentId],
    };
    const snapshot = {
      format: 1,
      article: {
        id: documentId,
        title: "Approved title",
        text: "Retained approved bytes\r\n",
      },
      forest,
    };
    tx.articleDocument.findFirst.mockResolvedValue({
      id: documentId,
      projectId,
      creatorId: randomUUID(),
      headVersionId: versionId,
    });
    tx.articleDocument.count.mockResolvedValue(1);
    tx.articlePublicationSpace.findUnique.mockResolvedValue({
      revision: 4,
      nextSequence: 7,
      forest,
    });
    tx.articlePublishedVersion.findUnique.mockResolvedValue({
      id: versionId,
      documentId,
      number: 1,
      reviewId,
      comparison: {
        format: 1,
        before: {
          format: 1,
          article: null,
          forest: { format: 1, articles: [], readingOrder: [] },
        },
        after: snapshot,
      },
      provenance: { format: 1, reviewId, contributionIds: [randomUUID()] },
    });
    tx.articleReview.findUnique.mockResolvedValue({
      id: reviewId,
      projectId,
      state: "APPROVED",
      snapshot: {
        format: 1,
        title: snapshot.article.title,
        text: snapshot.article.text,
      },
    });
    const r = await service.stage(actor, projectId, 2, {
      ...dto(),
      baseVersionId: versionId,
      baseForestRevision: 4,
    });
    expect(r!.comparison.before).toEqual(snapshot);
    expect(r!.comparison.after.article!.text).toBe("Selected text");
    expect(tx.articlePublicationSpace.upsert.mock.calls[0][0].update).toEqual({
      nextSequence: 8,
    });
    expect(tx.articleDocument).not.toHaveProperty("update");
    expect(tx.articlePublishedVersion).not.toHaveProperty("create");
  });
  it("allocates the next FIFO ordinal without using UUID or wall-clock order", async () => {
    tx.articlePublicationSpace.findUnique.mockResolvedValue({
      revision: 0,
      nextSequence: 17,
      forest: { format: 1, articles: [], readingOrder: [] },
    });
    await service.stage(actor, projectId, 2, dto());
    expect(
      tx.articleProposalCandidate.create.mock.calls[0][0].data.sequence,
    ).toBe(18);
  });
  it("does not combine candidates or mutate an earlier candidate when another contribution arrives", async () => {
    await service.stage(actor, projectId, 2, dto());
    await service.stage(actor, projectId, 2, { ...dto() });
    expect(tx.articleProposalCandidate.create).toHaveBeenCalledTimes(2);
    expect(tx.articleProposalContribution.create).toHaveBeenCalledTimes(2);
  });
  it.each(["source", "version", "forest"])(
    "rejects a stale %s before candidate allocation",
    async (kind) => {
      const input = dto();
      if (kind === "version")
        Object.assign(input, { baseVersionId: randomUUID() });
      if (kind === "forest") input.baseForestRevision = 1;
      await expect(
        service.stage(actor, projectId, kind === "source" ? 1 : 2, input),
      ).rejects.toMatchObject({ status: 409 });
      expect(tx.articlePublicationSpace.upsert).not.toHaveBeenCalled();
    },
  );
  it("does not authorize another member's unpublished identity from knowledge of its UUID", async () => {
    tx.articleDocument.findFirst.mockResolvedValue({
      id: documentId,
      projectId,
      creatorId: randomUUID(),
      headVersionId: null,
    });
    await expect(
      service.stage(actor, projectId, 2, dto()),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.articleDraftSpace.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { creatorId: owner, archivedAt: new Date(), status: "READY" },
    { creatorId: owner, archivedAt: null, status: "DELETING" },
  ])("rechecks project scope/lifecycle before staging %p", async (project) => {
    tx.project.findFirst.mockResolvedValue(project);
    await expect(
      service.stage(actor, projectId, 2, dto()),
    ).rejects.toMatchObject({ status: project ? 409 : 404 });
    expect(tx.articleDocument.findFirst).not.toHaveBeenCalled();
  });
  it("rechecks persisted account/capability and rejects non-human actors", async () => {
    tx.user.findFirst.mockResolvedValue(null);
    await expect(
      service.stage(actor, projectId, 2, dto()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.reserve(
        { ...actor, type: "agent" as any },
        projectId,
        documentId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.articleDocument.create).not.toHaveBeenCalled();
  });
  it.each(["parent", "order", "source"])(
    "rejects invalid selected %s without importing the private forest",
    async (kind) => {
      const input = dto();
      if (kind === "parent") input.positions[0]!.parentId = documentId as any;
      if (kind === "order") input.readingOrder = [documentId, privateId];
      if (kind === "source") input.sourceArticleId = randomUUID();
      await expect(
        service.stage(actor, projectId, 2, input),
      ).rejects.toMatchObject({ status: kind === "source" ? 404 : 400 });
      expect(tx.articleProposalContribution.create).not.toHaveBeenCalled();
    },
  );
  it("keeps other authors outside both detail and listing predicates", async () => {
    tx.articleProposalCandidate.findFirst.mockResolvedValue(null);
    await expect(
      service.read(actor, projectId, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await service.list(actor, projectId);
    expect(
      tx.articleProposalCandidate.findFirst.mock.calls[0][0].where.authorId,
    ).toBe(actor.id);
    expect(
      tx.articleProposalCandidate.findMany.mock.calls[0][0].where.authorId,
    ).toBe(actor.id);
  });
  it("allows the current owner to inspect submitted contributions without granting edit/create", async () => {
    tx.project.findFirst.mockResolvedValue({
      creatorId: actor.id,
      archivedAt: null,
      status: "READY",
    });
    expect((await service.read(actor, projectId, randomUUID())).state).toBe(
      "PRE_REVIEW",
    );
    expect(
      tx.articleProposalCandidate.findFirst.mock.calls[0][0].where,
    ).not.toHaveProperty("authorId");
    expect(
      tx.user.findFirst.mock.calls[0][0].where.roleAssignments.some.role
        .permissions.some.permissionKey,
    ).toBe("projects.read");
  });
  it("uses only an accessible cursor and hides raw ordinals and hidden queue totals", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      candidate(randomUUID(), actor.id, i + 1),
    );
    tx.articleProposalCandidate.findFirst.mockResolvedValue({
      ...candidate(),
      sequence: 10,
    });
    tx.articleProposalCandidate.findMany.mockResolvedValue(rows);
    const r = await service.list(actor, projectId, randomUUID());
    expect(r.items).toHaveLength(50);
    expect(r.nextAfter).toBe(rows[49]!.id);
    expect(JSON.stringify(r)).not.toMatch(
      /sequence|count|sourceRevision|comparison|authorId/,
    );
    expect(tx.articleProposalCandidate.findMany.mock.calls[0][0]).toMatchObject(
      {
        where: { sequence: { gt: 10 } },
        orderBy: { sequence: "asc" },
        take: 51,
      },
    );
    tx.articleProposalCandidate.findFirst.mockResolvedValue(null);
    await expect(
      service.list(actor, projectId, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("fails closed on future candidate lifecycle or retained content", async () => {
    tx.articleProposalCandidate.findFirst.mockResolvedValue({
      ...candidate(),
      reachedReviewersAt: new Date(),
    });
    await expect(
      service.read(actor, projectId, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    const r = candidate();
    (r.contribution.comparison as any).format = 2;
    tx.articleProposalCandidate.findFirst.mockResolvedValue(r);
    await expect(
      service.read(actor, projectId, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("fails closed on malformed publication space and exhausted FIFO capacity", async () => {
    tx.articlePublicationSpace.findUnique.mockResolvedValue({
      revision: 0,
      nextSequence: 2147483646,
      forest: { format: 1, articles: [], readingOrder: [] },
    });
    await expect(
      service.stage(actor, projectId, 2, dto()),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.articlePublicationSpace.upsert).not.toHaveBeenCalled();
    tx.articlePublicationSpace.findUnique.mockResolvedValue({
      revision: 0,
      nextSequence: 0,
      forest: { format: 2 },
    });
    await expect(
      service.stage(actor, projectId, 2, dto()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("preserves sanitized read outages, unknown errors and uncertain mutation responses", async () => {
    const error = (code: string) =>
      new Prisma.PrismaClientKnownRequestError(
        "Synthetic private database detail",
        { code, clientVersion: "fixture" },
      );
    db.$transaction.mockRejectedValueOnce(error("P1001"));
    await expect(service.list(actor, projectId)).rejects.toMatchObject({
      status: 503,
      response: { code: "READ_DEPENDENCY_UNAVAILABLE" },
    });
    db.$transaction.mockRejectedValueOnce(error("P2028"));
    await expect(
      service.stage(actor, projectId, 2, dto()),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "OPERATION_OUTCOME_UNKNOWN" },
    });
    db.$transaction.mockRejectedValueOnce(error("P2002"));
    await expect(
      service.reserve(actor, projectId, documentId),
    ).rejects.toMatchObject({ status: 409 });
    const unknown = new Error("Synthetic unknown");
    db.$transaction.mockRejectedValueOnce(unknown);
    await expect(service.list(actor, projectId)).rejects.toBe(unknown);
  });
});
