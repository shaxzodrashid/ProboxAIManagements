BEGIN;
-- Additive only: no messages, admission boundaries, permissions or reactions are backfilled.
CREATE TABLE "ChatGroupMessageReaction" (
  "messageId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "emoji" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatGroupMessageReaction_pkey" PRIMARY KEY ("messageId", "accountId", "emoji")
);
CREATE INDEX "ChatGroupMessageReaction_messageId_emoji_idx" ON "ChatGroupMessageReaction"("messageId", "emoji");
ALTER TABLE "ChatGroupMessageReaction" ADD CONSTRAINT "ChatGroupMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatGroupMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatGroupMessageReaction" ADD CONSTRAINT "ChatGroupMessageReaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
