import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { currentArticlePublicationBase } from "./article-publication-base";
import {
  ResolutionBundle,
  resolutionDecision,
  resolutionUnavailable,
} from "./article-resolution-state";
import { validatePublishedVersion } from "./article-version-validation";
// Caller holds the Workspace lock and current resource/lifecycle authority.
export async function promoteReviewedArticle(
  tx: Prisma.TransactionClient,
  review: ResolutionBundle,
) {
  if (review.phase !== "DECIDED" && review.phase !== "APPROVED")
    return {
      state: "CLOSED",
      reason: "NO_SUPPORTED_APPROVED_SNAPSHOT",
    } as const;
  const decision = resolutionDecision(review);
  if (decision.state !== "APPROVED" || !decision.comparison)
    return {
      state: "CLOSED",
      reason: "NO_SUPPORTED_APPROVED_SNAPSHOT",
    } as const;
  const existing = await tx.articlePublishedVersion.findUnique({
    where: { resolutionReviewId: review.id },
  });
  if (existing) {
    await validatePublishedVersion(tx, existing, review.projectId);
    return {
      state: "PUBLISHED",
      versionId: existing.id,
      number: existing.number,
    } as const;
  }
  const document = await tx.articleDocument.findFirst({
    where: { id: review.documentId, projectId: review.projectId },
  });
  if (!document) throw resolutionUnavailable();
  const space = await tx.articlePublicationSpace.findUnique({
    where: { projectId: review.projectId },
  });
  if (
    review.baseForestRevision == null ||
    document.headVersionId !== review.baseVersionId ||
    (space?.revision ?? 0) !== review.baseForestRevision
  )
    return { state: "BLOCKED", reason: "PUBLISHED_BASE_MISMATCH" } as const;
  let current;
  try {
    current = await currentArticlePublicationBase(
      tx,
      document,
      review.projectId,
    );
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === 409)
      return {
        state: "BLOCKED",
        reason: "PUBLISHED_BASE_UNAVAILABLE",
      } as const;
    throw error;
  }
  if (!isDeepStrictEqual(current, decision.comparison.before))
    return { state: "BLOCKED", reason: "PUBLISHED_BASE_MISMATCH" } as const;
  const history = await tx.articlePublishedVersion.aggregate({
    where: { documentId: document.id },
    _max: { number: true },
  });
  const number = (history._max.number ?? 0) + 1;
  if (number >= 2147483647 || (space?.revision ?? 0) >= 2147483646)
    return { state: "BLOCKED", reason: "PUBLICATION_CAPACITY" } as const;
  const version = await tx.articlePublishedVersion.create({
    data: {
      id: randomUUID(),
      documentId: document.id,
      number,
      resolutionReviewId: review.id,
      comparison: decision.comparison as unknown as Prisma.InputJsonValue,
      provenance: {
        format: 2,
        resolutionReviewId: review.id,
        outcome: decision.outcome!,
        round: decision.round,
        contributionIds: decision.materialization.contributionIds,
      },
    },
  });
  await tx.articleDocument.update({
    where: { id: document.id },
    data: { headVersionId: version.id },
  });
  await tx.articlePublicationSpace.upsert({
    where: { projectId: review.projectId },
    create: {
      projectId: review.projectId,
      forest: decision.comparison.after
        .forest as unknown as Prisma.InputJsonValue,
      revision: 1,
    },
    update: {
      forest: decision.comparison.after
        .forest as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
    },
  });
  await tx.articleResolutionReview.update({
    where: { id: review.id },
    data: { phase: "APPROVED" },
  });
  review.phase = "APPROVED";
  return { state: "PUBLISHED", versionId: version.id, number } as const;
}
