BEGIN;
-- Additive: no historical membership cutoff, topic or message order is fabricated.
ALTER TABLE "ChatGroupMessage" ADD COLUMN "topicId" UUID;
CREATE INDEX "ChatGroupMessage_groupId_topicId_sequence_idx" ON "ChatGroupMessage"("groupId", "topicId", "sequence");
ALTER TABLE "ChatGroupMembership" ADD COLUMN "historyEpoch" TEXT, ADD COLUMN "historyCutoffSequence" INTEGER;
CREATE TABLE "ChatGroupHistoryBoundary" (
  "groupId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "topicKey" TEXT NOT NULL,
  "firstSequence" INTEGER NOT NULL,
  CONSTRAINT "ChatGroupHistoryBoundary_pkey" PRIMARY KEY ("groupId", "accountId", "topicKey"),
  CONSTRAINT "ChatGroupHistoryBoundary_groupId_accountId_fkey" FOREIGN KEY ("groupId", "accountId") REFERENCES "ChatGroupMembership"("groupId", "accountId") ON DELETE CASCADE ON UPDATE CASCADE
);
COMMIT;
