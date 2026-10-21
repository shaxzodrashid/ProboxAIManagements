import { ArticlePublishedVersion, Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import {
  decodeArticleComparison,
  decodeArticleVersionProvenance,
} from "./article-comparison";
import {
  resolutionDecision,
  resolutionInclude,
  resolutionUnavailable,
} from "./article-resolution-state";
export async function validatePublishedVersion(
  tx: Prisma.TransactionClient,
  v: ArticlePublishedVersion,
  projectId: string,
) {
  if (v.number < 1) throw resolutionUnavailable();
  const comparison = decodeArticleComparison(v.comparison, v.documentId);
  if (v.reviewId && !v.resolutionReviewId) {
    decodeArticleVersionProvenance(v.provenance, v.reviewId);
    const review = await tx.articleReview.findUnique({
      where: { id: v.reviewId },
    });
    const snapshot = review?.snapshot as
      { format?: number; title?: unknown; text?: unknown } | undefined;
    if (
      !review ||
      review.projectId !== projectId ||
      review.state !== "APPROVED" ||
      snapshot?.format !== 1 ||
      snapshot.title !== comparison.after.article!.title ||
      snapshot.text !== comparison.after.article!.text
    )
      throw resolutionUnavailable();
    return comparison;
  }
  if (v.reviewId || !v.resolutionReviewId) throw resolutionUnavailable();
  const review = await tx.articleResolutionReview.findUnique({
    where: { id: v.resolutionReviewId },
    include: resolutionInclude,
  });
  if (
    !review ||
    review.phase !== "APPROVED" ||
    review.projectId !== projectId ||
    review.documentId !== v.documentId
  )
    throw resolutionUnavailable();
  const decision = resolutionDecision(review);
  if (
    decision.state !== "APPROVED" ||
    !decision.comparison ||
    !isDeepStrictEqual(decision.comparison, comparison) ||
    !isDeepStrictEqual(v.provenance, {
      format: 2,
      resolutionReviewId: review.id,
      outcome: decision.outcome,
      round: decision.round,
      contributionIds: decision.materialization.contributionIds,
    })
  )
    throw resolutionUnavailable();
  return comparison;
}
