import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { operationError } from "../openapi/operation-errors";
import {
  AuthoredArticleChange,
  materializeArticleChanges,
} from "./article-materialization";
import {
  binaryConflictAlternatives,
  conflictVotingProgress,
} from "./article-conflict-vote";
import { articleReviewDecision } from "./article-review-decision";
import { keepBothComparison } from "./article-keep-both";
import { decodeArticleComparison } from "./article-comparison";
export const resolutionInclude = {
  publishedVersion: { select: { id: true, number: true } },
  reviewers: {
    orderBy: { userId: "asc" as const },
    include: {
      approval: true,
      ballots: { orderBy: { round: "asc" as const } },
    },
  },
  candidates: {
    orderBy: { submittedSequence: "asc" as const },
    include: { contribution: true },
  },
} as const;
export type ResolutionBundle = Prisma.ArticleResolutionReviewGetPayload<{
  include: typeof resolutionInclude;
}>;
export const resolutionUnavailable = () =>
  operationError(
    409,
    "ARTICLE_RESOLUTION_FORMAT_UNAVAILABLE",
    "Stored reviewer resolution requires compatible handling; all content preserved",
    "articleResolution",
  );
export function resolutionMaterialization(r: ResolutionBundle) {
  if (
    ![
      "RESOLVING",
      "DECIDED",
      "RETURNED_FOR_REVISION",
      "REJECTED",
      "APPROVED",
    ].includes(r.phase) ||
    !r.reviewers.length ||
    r.reviewers.length > 100 ||
    !r.candidates.length ||
    r.candidates.length > 100 ||
    r.reviewers.some((v) => v.choiceVersion < 0)
  )
    throw resolutionUnavailable();
  const changes: AuthoredArticleChange[] = r.candidates.map((c) => {
    if (
      c.projectId !== r.projectId ||
      c.documentId !== r.documentId ||
      c.resolutionReviewId !== r.id ||
      c.revision !== 2 ||
      !c.submittedAt ||
      !c.submittedSequence ||
      !c.reachedReviewersAt ||
      c.contribution.documentId !== r.documentId ||
      c.contribution.authorId !== c.authorId
    )
      throw resolutionUnavailable();
    return {
      id: c.contributionId,
      authorId: c.authorId,
      sourceArticleId: c.contribution.sourceArticleId,
      sourceRevision: c.contribution.sourceRevision,
      sequence: c.submittedSequence,
      comparison: c.contribution
        .comparison as unknown as AuthoredArticleChange["comparison"],
    };
  });
  const computed = materializeArticleChanges(r.documentId, r.before, changes);
  if (!isDeepStrictEqual(computed, r.materialization))
    throw resolutionUnavailable();
  if (r.combinedComparison != null) {
    const binary = binaryConflictAlternatives(computed);
    if (!binary.available) throw resolutionUnavailable();
    let expected;
    try {
      expected = keepBothComparison(
        binary.alternatives[0]!.comparison,
        binary.alternatives[1]!.comparison,
        r.documentId,
      );
    } catch {
      throw resolutionUnavailable();
    }
    if (!isDeepStrictEqual(expected, r.combinedComparison))
      throw resolutionUnavailable();
  }
  return computed;
}
export function resolutionDecision(r: ResolutionBundle) {
  const materialization = resolutionMaterialization(r);
  const conflictBallots = r.reviewers.flatMap((v) =>
    (v.ballots ?? []).map((b) => ({
      userId: v.userId,
      option: b.option,
      round: b.round,
    })),
  );
  if (!materialization.conflicts.length) {
    if (conflictBallots.length || !materialization.comparison)
      throw resolutionUnavailable();
    const state = articleReviewDecision(
      r.reviewers.map((v) => v.approval?.approved ?? null),
    );
    return {
      state,
      outcome: state === "APPROVED" ? ("APPROVE" as const) : null,
      round: 0,
      comparison: state === "APPROVED" ? materialization.comparison : null,
      materialization,
    };
  }
  if (r.reviewers.some((v) => v.approval)) throw resolutionUnavailable();
  const alternatives = binaryConflictAlternatives(materialization);
  if (!alternatives.available) {
    if (conflictBallots.length) throw resolutionUnavailable();
    return {
      state: "UNSUPPORTED",
      outcome: null,
      round: 0,
      comparison: null,
      materialization,
    } as const;
  }
  let progress;
  try {
    progress = conflictVotingProgress(
      r.reviewers.map((v) => v.userId),
      conflictBallots,
    );
  } catch {
    throw resolutionUnavailable();
  }
  const outcome = progress.winner;
  const comparison =
    outcome === "PUBLISH_A" || outcome === "PUBLISH_B"
      ? alternatives.alternatives.find(
          (a) => a.label === (outcome === "PUBLISH_A" ? "A" : "B"),
        )!.comparison
      : outcome === "KEEP_BOTH" && r.combinedComparison != null
        ? decodeArticleComparison(r.combinedComparison, r.documentId)
        : null;
  return {
    state: comparison
      ? "APPROVED"
      : outcome === "REJECT_BOTH"
        ? "REJECTED"
        : progress.state,
    outcome,
    round: progress.round,
    comparison,
    materialization,
  };
}
