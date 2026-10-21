BEGIN;
-- AlterTable
ALTER TABLE "ArticleProposalCandidate" ADD COLUMN     "resolutionReviewId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedSequence" INTEGER;

-- CreateTable
CREATE TABLE "ArticleResolutionReview" (
    "headSequence" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'RESOLVING',
    "before" JSONB NOT NULL,
    "materialization" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleResolutionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleResolutionReviewer" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choiceVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArticleResolutionReviewer_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateTable
CREATE TABLE "ArticleResolutionChoice" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "choices" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleResolutionChoice_pkey" PRIMARY KEY ("reviewId","userId","version")
);

-- CreateIndex
CREATE INDEX "ArticleResolutionReview_projectId_documentId_idx" ON "ArticleResolutionReview"("projectId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleResolutionReview_projectId_headSequence_key" ON "ArticleResolutionReview"("projectId", "headSequence");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProposalCandidate_projectId_submittedSequence_key" ON "ArticleProposalCandidate"("projectId", "submittedSequence");

-- AddForeignKey
ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT "ArticleProposalCandidate_resolutionReviewId_fkey" FOREIGN KEY ("resolutionReviewId") REFERENCES "ArticleResolutionReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleResolutionReview" ADD CONSTRAINT "ArticleResolutionReview_projectId_documentId_fkey" FOREIGN KEY ("projectId", "documentId") REFERENCES "ArticleDocument"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleResolutionReviewer" ADD CONSTRAINT "ArticleResolutionReviewer_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ArticleResolutionReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleResolutionChoice" ADD CONSTRAINT "ArticleResolutionChoice_reviewId_userId_fkey" FOREIGN KEY ("reviewId", "userId") REFERENCES "ArticleResolutionReviewer"("reviewId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT article_candidate_submission_positive CHECK ("submittedSequence" IS NULL OR "submittedSequence" > 0);
ALTER TABLE "ArticleResolutionReview" ADD CONSTRAINT article_resolution_head_positive CHECK ("headSequence" > 0);
ALTER TABLE "ArticleResolutionReviewer" ADD CONSTRAINT article_resolution_choice_version_valid CHECK ("choiceVersion" >= 0);
ALTER TABLE "ArticleResolutionChoice" ADD CONSTRAINT article_resolution_choice_positive CHECK (version > 0);
CREATE TRIGGER article_resolution_snapshot_immutable BEFORE UPDATE OF "id", "projectId", "documentId", "selectedById", "before", "materialization", "createdAt", "headSequence" ON "ArticleResolutionReview" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
CREATE TRIGGER article_resolution_choice_immutable BEFORE UPDATE ON "ArticleResolutionChoice" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
COMMIT;
