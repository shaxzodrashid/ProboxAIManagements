import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { ArticleResolutionService } from "../src/articles/article-resolution.service";
import { ArticleComparison } from "../src/articles/article-comparison";
import { materializeArticleChanges } from "../src/articles/article-materialization";
describe("reviewer resolution phase without publication decisions", () => {
  const projectId = randomUUID(),
    documentId = randomUUID(),
    reviewId = randomUUID(),
    ownerId = randomUUID(),
    authorId = randomUUID(),
    reviewerId = randomUUID(),
    otherId = randomUUID(),
    workspaceId = randomUUID();
  const actor = (id = ownerId): AuthenticatedUser => ({
    id,
    workspaceId,
    roles: [],
    permissions: [],
    type: "access",
  });
  const before = {
    format: 1 as const,
    article: null,
    forest: { format: 1 as const, articles: [], readingOrder: [] },
  };
  const c = (id: string, text: string, sequence: number) => ({
    id,
    projectId,
    documentId,
    authorId,
    sequence,
    submittedAt: new Date(),
    submittedSequence: sequence,
    revision: 1,
    resolutionReviewId: null as string | null,
    reachedReviewersAt: null as Date | null,
    contributionId: id,
    contribution: {
      id,
      documentId,
      authorId,
      sourceArticleId: randomUUID(),
      sourceRevision: 1,
      comparison: {
        format: 1,
        before,
        after: {
          format: 1,
          article: { id: documentId, title: "Title", text },
          forest: {
            format: 1,
            articles: [{ id: documentId, parentId: null }],
            readingOrder: [documentId],
          },
        },
      } as ArticleComparison,
    },
  });
  let tx: any,
    db: any,
    service: ArticleResolutionService,
    candidates: ReturnType<typeof c>[],
    bundle: any,
    history: any[];
  beforeEach(() => {
    candidates = [c(randomUUID(), "A", 2), c(randomUUID(), "B", 4)];
    history = [];
    const materialization = materializeArticleChanges(
      documentId,
      before,
      candidates.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        sourceArticleId: c.contribution.sourceArticleId,
        sourceRevision: 1,
        sequence: c.submittedSequence,
        comparison: c.contribution.comparison,
      })),
    );
    bundle = {
      id: reviewId,
      projectId,
      documentId,
      phase: "RESOLVING",
      before,
      materialization,
      headSequence: 2,
      reviewers: [
        { userId: reviewerId, choiceVersion: 0 },
        { userId: otherId, choiceVersion: 0 },
      ],
      candidates: candidates.map((c) => ({
        ...c,
        revision: 2,
        resolutionReviewId: reviewId,
        reachedReviewersAt: new Date(),
      })),
    };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: ownerId }),
        count: jest.fn().mockResolvedValue(2),
      },
      project: {
        findFirst: jest.fn().mockResolvedValue({
          creatorId: ownerId,
          archivedAt: null,
          status: "READY",
        }),
      },
      articleDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: documentId,
          projectId,
          headVersionId: null,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      articlePublicationSpace: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 0,
          nextSequence: 4,
          forest: before.forest,
        }),
      },
      articleReview: { findUnique: jest.fn().mockResolvedValue(null) },
      articleProposalCandidate: {
        findFirst: jest.fn().mockResolvedValue(candidates[0]),
        findMany: jest.fn().mockResolvedValue(candidates),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      articleResolutionReview: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(bundle),
        findMany: jest.fn().mockResolvedValue([]),
      },
      articleResolutionChoice: {
        findUnique: jest
          .fn()
          .mockImplementation(
            async ({ where }: any) =>
              history.find(
                (r) =>
                  r.userId === where.reviewId_userId_version.userId &&
                  r.version === where.reviewId_userId_version.version,
              ) ?? null,
          ),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          history.push(data);
          return data;
        }),
      },
      articleResolutionReviewer: {
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const v = bundle.reviewers.find(
            (v: any) => v.userId === where.reviewId_userId.userId,
          );
          Object.assign(v, data);
          return v;
        }),
      },
    };
    db = { $transaction: jest.fn((fn: any) => fn(tx)) };
    service = new ArticleResolutionService(db as PrismaService);
  });
  const dispatch = () =>
    service.dispatch(actor(), projectId, candidates[0]!.id, 1, {
      id: reviewId,
      voterIds: [reviewerId, otherId],
    });
  const load = () =>
    tx.articleResolutionReview.findFirst.mockResolvedValue(bundle);
  const choices = (index = 0) =>
    bundle.materialization.conflicts.map((c: any) => ({
      conflictId: c.id,
      alternativeId: c.alternatives[index].id,
    }));
  it("atomically selects the fixed reviewers and freezes all submitted same-document contributions", async () => {
    const r = await dispatch();
    expect(r!.phase).toBe("RESOLVING");
    expect(r!.finalVotingAvailable).toBe(false);
    expect(r!.materialization.conflicts[0]!.alternatives).toHaveLength(2);
    expect(r!.myChoiceVersion).toBeNull();
    expect(
      tx.articleResolutionReview.create.mock.calls[0][0].data.reviewers.create,
    ).toEqual([{ userId: reviewerId }, { userId: otherId }]);
    expect(
      tx.articleProposalCandidate.updateMany.mock.calls[0][0].data,
    ).toMatchObject({ resolutionReviewId: reviewId, revision: 2 });
    expect(tx.articleReview).not.toHaveProperty("create");
  });
  it("does not give dispatch authority to an ordinary selected reviewer or author", async () => {
    await expect(
      service.dispatch(actor(reviewerId), projectId, candidates[0]!.id, 1, {
        id: reviewId,
        voterIds: [reviewerId, otherId],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.articleResolutionReview.create).not.toHaveBeenCalled();
  });
  it("refuses unsubmitted staging, younger submissions and an existing active review", async () => {
    tx.articleProposalCandidate.findFirst.mockResolvedValue({
      ...candidates[0],
      submittedAt: null,
    });
    await expect(dispatch()).rejects.toMatchObject({ status: 409 });
    tx.articleProposalCandidate.findFirst.mockResolvedValue(candidates[1]);
    await expect(
      service.dispatch(actor(), projectId, candidates[1]!.id, 1, {
        id: reviewId,
        voterIds: [reviewerId, otherId],
      }),
    ).rejects.toMatchObject({ status: 409 });
    tx.articleProposalCandidate.findFirst.mockResolvedValue(candidates[0]);
    tx.articleResolutionReview.findFirst.mockResolvedValue(bundle);
    await expect(dispatch()).rejects.toMatchObject({ status: 409 });
  });
  it("requires eligible fixed reviewers and rolls back if the freeze CAS count changed", async () => {
    tx.user.count.mockResolvedValue(1);
    await expect(dispatch()).rejects.toMatchObject({ status: 404 });
    expect(tx.articleResolutionReview.create).not.toHaveBeenCalled();
    tx.user.count.mockResolvedValue(2);
    tx.articleProposalCandidate.updateMany.mockResolvedValue({ count: 1 });
    await expect(dispatch()).rejects.toMatchObject({ status: 409 });
  });
  it("records a selected reviewer's choice, retains revisions and never elects a winner", async () => {
    load();
    const first = await service.choose(
      actor(reviewerId),
      projectId,
      reviewId,
      0,
      { choices: choices() },
    );
    expect(first!.choiceVersion).toBe(1);
    expect(
      (await service.choose(actor(reviewerId), projectId, reviewId, 1, {
        choices: choices(),
      }))!.choiceVersion,
    ).toBe(1);
    expect(history).toHaveLength(1);
    expect(
      (await service.choose(actor(reviewerId), projectId, reviewId, 1, {
        choices: choices(1),
      }))!.choiceVersion,
    ).toBe(2);
    expect(history).toHaveLength(2);
    expect(history[0].choices).not.toEqual(history[1].choices);
    expect(
      (await service.read(actor(reviewerId), projectId, reviewId))
        .finalVotingAvailable,
    ).toBe(false);
    expect(bundle.phase).toBe("RESOLVING");
    expect(tx.articleReview).not.toHaveProperty("create");
  });
  it("allows different reviewer choices without first-reviewer-wins, owner override or implicit threshold", async () => {
    load();
    await service.choose(actor(reviewerId), projectId, reviewId, 0, {
      choices: choices(),
    });
    await service.choose(actor(otherId), projectId, reviewId, 0, {
      choices: choices(1),
    });
    const a = await service.read(actor(reviewerId), projectId, reviewId);
    expect(a.myChoices).toEqual(choices());
    expect(a).not.toHaveProperty("otherChoices");
    expect(a.finalVotingAvailable).toBe(false);
    await expect(
      service.choose(actor(ownerId), projectId, reviewId, 0, {
        choices: choices(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("does not expose other reviewers' current choices to the owner", async () => {
    load();
    await service.choose(actor(reviewerId), projectId, reviewId, 0, {
      choices: choices(),
    });
    const r = await service.read(actor(), projectId, reviewId);
    expect(r.myChoices).toBeNull();
    expect(r.myChoiceVersion).toBeNull();
  });
  it("rejects stale own choice versions and nonexistent alternatives without changing history", async () => {
    load();
    await service.choose(actor(reviewerId), projectId, reviewId, 0, {
      choices: choices(),
    });
    await expect(
      service.choose(actor(reviewerId), projectId, reviewId, 0, {
        choices: choices(1),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.choose(actor(reviewerId), projectId, reviewId, 1, {
        choices: [{ ...choices()[0], alternativeId: "0".repeat(64) }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(history).toHaveLength(1);
  });
  it("reauthorizes OPEN account, project membership and archived write lifecycle", async () => {
    tx.user.findFirst.mockResolvedValue(null);
    await expect(dispatch()).rejects.toMatchObject({ status: 403 });
    tx.user.findFirst.mockResolvedValue({ id: ownerId });
    tx.project.findFirst.mockResolvedValue(null);
    await expect(dispatch()).rejects.toMatchObject({ status: 404 });
    tx.project.findFirst.mockResolvedValue({
      creatorId: ownerId,
      archivedAt: new Date(),
      status: "READY",
    });
    await expect(dispatch()).rejects.toMatchObject({ status: 409 });
  });
  it("uses selected-reviewer predicates and hides raw ordinals in discovery", async () => {
    await service.list(actor(reviewerId), projectId);
    expect(
      tx.articleResolutionReview.findMany.mock.calls[0][0].where.reviewers,
    ).toEqual({ some: { userId: reviewerId } });
    expect(tx.articleResolutionReview.findMany.mock.calls[0][0].select).toEqual(
      { id: true, documentId: true, phase: true },
    );
    tx.articleResolutionReview.findFirst.mockResolvedValue(null);
    await expect(
      service.read(actor(authorId), projectId, reviewId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("fails closed on a modified frozen bundle or unsupported phase", async () => {
    load();
    bundle.materialization = { ...bundle.materialization, format: 2 };
    await expect(
      service.read(actor(), projectId, reviewId),
    ).rejects.toMatchObject({ status: 409 });
    bundle.phase = "VOTING";
    await expect(
      service.read(actor(), projectId, reviewId),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("preserves sanitized read and uncertain write classifiers", async () => {
    const err = (code: string) =>
      new Prisma.PrismaClientKnownRequestError("Private fixture detail", {
        code,
        clientVersion: "fixture",
      });
    db.$transaction.mockRejectedValueOnce(err("P1001"));
    await expect(
      service.read(actor(), projectId, reviewId),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "READ_DEPENDENCY_UNAVAILABLE" },
    });
    db.$transaction.mockRejectedValueOnce(err("P2028"));
    await expect(dispatch()).rejects.toMatchObject({
      status: 503,
      response: { code: "OPERATION_OUTCOME_UNKNOWN" },
    });
  });
  it("retains immutable own four-option ballots, waits for every reviewer and permits identical retries only", async () => {
    load();
    tx.articleResolutionBallot = {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const v = bundle.reviewers.find((v: any) => v.userId === data.userId);
        (v.ballots ??= []).push(data);
        return data;
      }),
    };
    tx.articleResolutionReview.update = jest
      .fn()
      .mockImplementation(async ({ data }: any) => Object.assign(bundle, data));
    const first = await service.vote(
      actor(reviewerId),
      projectId,
      reviewId,
      0,
      { option: "KEEP_BOTH" },
    );
    expect(first!.conflictVoting).toMatchObject({
      available: true,
      state: "PENDING",
      winner: null,
      publicationAvailable: false,
    });
    await service.vote(actor(reviewerId), projectId, reviewId, 0, {
      option: "KEEP_BOTH",
    });
    expect(tx.articleResolutionBallot.create).toHaveBeenCalledTimes(1);
    await expect(
      service.vote(actor(reviewerId), projectId, reviewId, 0, {
        option: "PUBLISH_A",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.choose(actor(otherId), projectId, reviewId, 0, {
        choices: choices(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const last = await service.vote(actor(otherId), projectId, reviewId, 0, {
      option: "KEEP_BOTH",
    });
    expect(last!.conflictVoting).toMatchObject({
      state: "DECIDED",
      winner: "KEEP_BOTH",
      publicationAvailable: false,
    });
    expect(last!.materialization.conflicts).toHaveLength(1);
    expect(bundle.phase).toBe("DECIDED");
    await expect(
      service.vote(actor(ownerId), projectId, reviewId, 0, {
        option: "KEEP_BOTH",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
