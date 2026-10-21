BEGIN;
-- Additive only: no backfill, grant or publication of existing content.
-- CreateEnum
CREATE TYPE "ArticleReviewState" AS ENUM ('WAITING_VOTERS', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ArticleReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectRefId" TEXT,
    "authorId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "state" "ArticleReviewState" NOT NULL DEFAULT 'WAITING_VOTERS',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "selectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ArticleReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleReviewVoter" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approved" BOOLEAN,
    "votedAt" TIMESTAMP(3),

    CONSTRAINT "ArticleReviewVoter_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateIndex
CREATE INDEX "ArticleReview_projectId_id_idx" ON "ArticleReview"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleReview_projectId_authorId_articleId_sourceRevision_key" ON "ArticleReview"("projectId", "authorId", "articleId", "sourceRevision");

-- AddForeignKey
ALTER TABLE "ArticleReview" ADD CONSTRAINT "ArticleReview_projectRefId_fkey" FOREIGN KEY ("projectRefId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReviewVoter" ADD CONSTRAINT "ArticleReviewVoter_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ArticleReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
