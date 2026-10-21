BEGIN;
-- CreateTable
CREATE TABLE "ArticleDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "headVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticlePublishedVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "reviewId" TEXT NOT NULL,
    "comparison" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticlePublishedVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticlePublicationSpace" (
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "forest" JSONB NOT NULL,

    CONSTRAINT "ArticlePublicationSpace_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ArticleProposalContribution" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sourceArticleId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "baseForestRevision" INTEGER NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "comparison" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleProposalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleProposalCandidate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "contributionId" TEXT NOT NULL,
    "reachedReviewersAt" TIMESTAMP(3),

    CONSTRAINT "ArticleProposalCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleDocument_projectId_id_idx" ON "ArticleDocument"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleDocument_id_headVersionId_key" ON "ArticleDocument"("id", "headVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleDocument_projectId_id_key" ON "ArticleDocument"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePublishedVersion_reviewId_key" ON "ArticlePublishedVersion"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePublishedVersion_documentId_id_key" ON "ArticlePublishedVersion"("documentId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePublishedVersion_documentId_number_key" ON "ArticlePublishedVersion"("documentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProposalContribution_documentId_authorId_inputHash_key" ON "ArticleProposalContribution"("documentId", "authorId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProposalCandidate_contributionId_key" ON "ArticleProposalCandidate"("contributionId");

-- CreateIndex
CREATE INDEX "ArticleProposalCandidate_documentId_sequence_idx" ON "ArticleProposalCandidate"("documentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProposalCandidate_projectId_sequence_key" ON "ArticleProposalCandidate"("projectId", "sequence");

-- AddForeignKey
ALTER TABLE "ArticleDocument" ADD CONSTRAINT "ArticleDocument_id_headVersionId_fkey" FOREIGN KEY ("id", "headVersionId") REFERENCES "ArticlePublishedVersion"("documentId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ArticlePublishedVersion" ADD CONSTRAINT "ArticlePublishedVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ArticleDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticlePublishedVersion" ADD CONSTRAINT "ArticlePublishedVersion_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ArticleReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleProposalContribution" ADD CONSTRAINT "ArticleProposalContribution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ArticleDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT "ArticleProposalCandidate_projectId_documentId_fkey" FOREIGN KEY ("projectId", "documentId") REFERENCES "ArticleDocument"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT "ArticleProposalCandidate_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "ArticleProposalContribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ArticlePublishedVersion" ADD CONSTRAINT article_published_version_positive CHECK (number > 0);
ALTER TABLE "ArticleProposalContribution" ADD CONSTRAINT article_contribution_revision_valid CHECK ("sourceRevision" > 0 AND "baseForestRevision" >= 0);
ALTER TABLE "ArticleProposalCandidate" ADD CONSTRAINT article_candidate_sequence_valid CHECK (sequence > 0 AND revision >= 0);
ALTER TABLE "ArticlePublicationSpace" ADD CONSTRAINT article_publication_space_counter_valid CHECK (revision >= 0 AND "nextSequence" >= 0);
CREATE FUNCTION proboxai_article_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable article snapshot cannot be updated' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER article_published_version_immutable BEFORE UPDATE ON "ArticlePublishedVersion" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
CREATE TRIGGER article_contribution_immutable BEFORE UPDATE ON "ArticleProposalContribution" FOR EACH ROW EXECUTE FUNCTION proboxai_article_immutable_snapshot();
COMMIT;
