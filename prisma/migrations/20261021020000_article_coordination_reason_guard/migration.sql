BEGIN;
ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT article_coordination_reason_present CHECK ("coordinationRejectedAt" IS NULL OR "coordinationReason" IS NOT NULL);
COMMIT;