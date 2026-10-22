BEGIN;
-- AlterTable
ALTER TABLE "ArticleProposalCandidate" ADD COLUMN     "coordinationReason" TEXT,
ADD COLUMN     "coordinationRejectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ArticleResolutionReview" ADD COLUMN     "combinedComparison" JSONB;

ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT article_coordination_state_valid CHECK (("coordinationRejectedAt" IS NULL AND "coordinationReason" IS NULL) OR ("coordinationRejectedAt" IS NOT NULL AND "coordinationReason" IN ('AUTHOR_LIMIT','VERSION_LIMIT') AND revision=3 AND "submittedAt" IS NOT NULL AND "submittedSequence" IS NOT NULL AND "resolutionReviewId" IS NULL AND "reachedReviewersAt" IS NULL));
CREATE TRIGGER article_coordination_rejection_immutable BEFORE UPDATE ON "ArticleProposalCandidate" FOR EACH ROW WHEN (OLD."coordinationRejectedAt" IS NOT NULL) EXECUTE FUNCTION proboxai_article_immutable_snapshot();
CREATE TRIGGER article_combined_preview_immutable BEFORE UPDATE OF "combinedComparison" ON "ArticleResolutionReview" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
COMMIT;
