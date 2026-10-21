-- CreateEnum
BEGIN;

CREATE TYPE "GroupHistoryAccess" AS ENUM ('NONE', 'LAST_100', 'LAST_300', 'ALL');

-- CreateEnum
CREATE TYPE "GroupInviteMode" AS ENUM ('DIRECT', 'APPROVABLE');

-- CreateEnum
CREATE TYPE "GroupInvitationStatus" AS ENUM ('PENDING', 'ADDED', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "ChatGroup" ADD COLUMN     "permissionRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ChatGroupMembership" (
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "historyAccess" "GroupHistoryAccess" NOT NULL DEFAULT 'NONE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitationId" TEXT,

    CONSTRAINT "ChatGroupMembership_pkey" PRIMARY KEY ("groupId","accountId")
);

-- CreateTable
CREATE TABLE "ChatGroupInvitationPermission" (
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "canInvite" BOOLEAN NOT NULL,
    "grantedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatGroupInvitationPermission_pkey" PRIMARY KEY ("groupId","accountId")
);

-- CreateTable
CREATE TABLE "ChatGroupPermissionAudit" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "canInvite" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatGroupPermissionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatGroupInvitation" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "initialGroupName" VARCHAR(120) NOT NULL,
    "inviterId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "mode" "GroupInviteMode" NOT NULL,
    "historyAccess" "GroupHistoryAccess" NOT NULL DEFAULT 'NONE',
    "status" "GroupInvitationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChatGroupInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanDirectConversation" (
    "id" TEXT NOT NULL,
    "lowerAccountId" TEXT NOT NULL,
    "upperAccountId" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanDirectConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectInvitationCard" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectInvitationCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroupMembership_invitationId_key" ON "ChatGroupMembership"("invitationId");

-- CreateIndex
CREATE INDEX "ChatGroupMembership_accountId_groupId_idx" ON "ChatGroupMembership"("accountId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroupPermissionAudit_groupId_revision_key" ON "ChatGroupPermissionAudit"("groupId", "revision");

-- CreateIndex
CREATE INDEX "ChatGroupInvitation_groupId_recipientId_status_idx" ON "ChatGroupInvitation"("groupId", "recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroupInvitation_inviterId_requestId_key" ON "ChatGroupInvitation"("inviterId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "HumanDirectConversation_lowerAccountId_upperAccountId_key" ON "HumanDirectConversation"("lowerAccountId", "upperAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectInvitationCard_invitationId_key" ON "DirectInvitationCard"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectInvitationCard_conversationId_sequence_key" ON "DirectInvitationCard"("conversationId", "sequence");

-- AddForeignKey
ALTER TABLE "ChatGroupMembership" ADD CONSTRAINT "ChatGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMembership" ADD CONSTRAINT "ChatGroupMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupInvitationPermission" ADD CONSTRAINT "ChatGroupInvitationPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupPermissionAudit" ADD CONSTRAINT "ChatGroupPermissionAudit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupInvitation" ADD CONSTRAINT "ChatGroupInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupInvitation" ADD CONSTRAINT "ChatGroupInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupInvitation" ADD CONSTRAINT "ChatGroupInvitation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanDirectConversation" ADD CONSTRAINT "HumanDirectConversation_lowerAccountId_fkey" FOREIGN KEY ("lowerAccountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanDirectConversation" ADD CONSTRAINT "HumanDirectConversation_upperAccountId_fkey" FOREIGN KEY ("upperAccountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectInvitationCard" ADD CONSTRAINT "DirectInvitationCard_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "HumanDirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectInvitationCard" ADD CONSTRAINT "DirectInvitationCard_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "ChatGroupInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Derive initial owner admission and invitation authority without inventing
-- additional participants, trusted admins, role grants or historical actions.
INSERT INTO "ChatGroupMembership" ("groupId", "accountId", "historyAccess", "joinedAt")
SELECT "id", "ownerId", 'NONE'::"GroupHistoryAccess", "createdAt" FROM "ChatGroup";
INSERT INTO "ChatGroupInvitationPermission" ("groupId", "accountId", "canInvite", "grantedById", "updatedAt")
SELECT "id", "ownerId", TRUE, "ownerId", "createdAt" FROM "ChatGroup";

CREATE UNIQUE INDEX "ChatGroupInvitation_one_pending" ON "ChatGroupInvitation" ("groupId", "recipientId") WHERE "status" = 'PENDING';
ALTER TABLE "HumanDirectConversation" ADD CONSTRAINT "HumanDirectConversation_distinct_ordered_accounts" CHECK ("lowerAccountId" < "upperAccountId");
COMMIT;
