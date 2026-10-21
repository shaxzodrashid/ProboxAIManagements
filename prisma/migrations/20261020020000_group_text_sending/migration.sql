-- Existing admitted members retain normal participation by default.
ALTER TABLE "ChatGroup"
  ADD COLUMN "membersCanSend" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sendingRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastMessageSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ChatGroupMessage" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "text" VARCHAR(4000) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatGroupMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatGroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatGroupMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatGroupMessage_groupId_authorId_requestId_key" ON "ChatGroupMessage"("groupId", "authorId", "requestId");
CREATE UNIQUE INDEX "ChatGroupMessage_groupId_sequence_key" ON "ChatGroupMessage"("groupId", "sequence");

CREATE TABLE "ChatGroupSendingAudit" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "membersCanSend" BOOLEAN NOT NULL,
  "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatGroupSendingAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatGroupSendingAudit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatGroupSendingAudit_groupId_revision_key" ON "ChatGroupSendingAudit"("groupId", "revision");
