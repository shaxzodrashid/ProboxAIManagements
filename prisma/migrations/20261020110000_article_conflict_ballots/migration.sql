BEGIN;
-- CreateTable
CREATE TABLE "ArticleResolutionBallot" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "option" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleResolutionBallot_pkey" PRIMARY KEY ("reviewId","userId","round")
);

-- AddForeignKey
ALTER TABLE "ArticleResolutionBallot" ADD CONSTRAINT "ArticleResolutionBallot_reviewId_userId_fkey" FOREIGN KEY ("reviewId", "userId") REFERENCES "ArticleResolutionReviewer"("reviewId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ArticleResolutionBallot" ADD CONSTRAINT article_conflict_ballot_round_valid CHECK (round IN (1, 2));
ALTER TABLE "ArticleResolutionBallot" ADD CONSTRAINT article_conflict_ballot_option_valid CHECK (option IN ('KEEP_BOTH','PUBLISH_A','PUBLISH_B','REJECT_BOTH'));
CREATE TRIGGER article_resolution_ballot_immutable BEFORE UPDATE ON "ArticleResolutionBallot" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
COMMIT;
