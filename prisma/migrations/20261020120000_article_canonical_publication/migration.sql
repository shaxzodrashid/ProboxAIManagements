BEGIN;
-- AlterTable
ALTER TABLE "ArticlePublishedVersion" ADD COLUMN     "resolutionReviewId" TEXT,
ALTER COLUMN "reviewId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ArticleResolutionReview" ADD COLUMN     "baseForestRevision" INTEGER,
ADD COLUMN     "baseVersionId" TEXT;

-- CreateTable
CREATE TABLE "ArticleResolutionApproval" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleResolutionApproval_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePublishedVersion_resolutionReviewId_key" ON "ArticlePublishedVersion"("resolutionReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePublishedVersion_documentId_resolutionReviewId_key" ON "ArticlePublishedVersion"("documentId", "resolutionReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleResolutionReview_documentId_id_key" ON "ArticleResolutionReview"("documentId", "id");

-- AddForeignKey
ALTER TABLE "ArticlePublishedVersion" ADD CONSTRAINT "ArticlePublishedVersion_documentId_resolutionReviewId_fkey" FOREIGN KEY ("documentId", "resolutionReviewId") REFERENCES "ArticleResolutionReview"("documentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleResolutionApproval" ADD CONSTRAINT "ArticleResolutionApproval_reviewId_userId_fkey" FOREIGN KEY ("reviewId", "userId") REFERENCES "ArticleResolutionReviewer"("reviewId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ArticlePublishedVersion" ADD CONSTRAINT article_version_exactly_one_origin CHECK (("reviewId" IS NOT NULL) <> ("resolutionReviewId" IS NOT NULL));
ALTER TABLE "ArticleResolutionReview" ADD CONSTRAINT article_resolution_base_revision_valid CHECK ("baseForestRevision" IS NULL OR "baseForestRevision" >= 0);
CREATE TRIGGER article_resolution_base_immutable BEFORE UPDATE OF "baseVersionId", "baseForestRevision" ON "ArticleResolutionReview" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
CREATE TRIGGER article_resolution_approval_immutable BEFORE UPDATE ON "ArticleResolutionApproval" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
COMMIT;
