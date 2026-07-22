-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER');
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "SessionStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'ARCHIVED');
CREATE TYPE "TurnStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "telegramUserId" BIGINT,
    "telegramChatId" BIGINT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuthOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthOtp_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SessionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionToken_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "criteria" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "creatorId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProboxAiSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'QUEUED',
    "cwd" TEXT NOT NULL,
    "sandbox" TEXT NOT NULL,
    "model" TEXT,
    "codexThreadId" TEXT,
    "processId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProboxAiSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProboxAiTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "codexTurnId" TEXT,
    "prompt" TEXT NOT NULL,
    "status" "TurnStatus" NOT NULL DEFAULT 'RUNNING',
    "inputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "outputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "ProboxAiTurn_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnId" TEXT,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "itemType" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SessionArtifact" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionArtifact_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAction" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");
CREATE UNIQUE INDEX "User_workspaceId_phoneNumber_key" ON "User"("workspaceId", "phoneNumber");
CREATE INDEX "AuthOtp_userId_expiresAt_idx" ON "AuthOtp"("userId", "expiresAt");
CREATE UNIQUE INDEX "SessionToken_tokenHash_key" ON "SessionToken"("tokenHash");
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");
CREATE INDEX "Task_managerId_status_idx" ON "Task"("managerId", "status");
CREATE UNIQUE INDEX "ProboxAiSession_codexThreadId_key" ON "ProboxAiSession"("codexThreadId");
CREATE INDEX "ProboxAiSession_taskId_createdAt_idx" ON "ProboxAiSession"("taskId", "createdAt");
CREATE INDEX "ProboxAiSession_status_createdAt_idx" ON "ProboxAiSession"("status", "createdAt");
CREATE INDEX "ProboxAiTurn_sessionId_startedAt_idx" ON "ProboxAiTurn"("sessionId", "startedAt");
CREATE INDEX "SessionEvent_sessionId_createdAt_idx" ON "SessionEvent"("sessionId", "createdAt");
CREATE UNIQUE INDEX "SessionEvent_sessionId_sequence_key" ON "SessionEvent"("sessionId", "sequence");
CREATE INDEX "SessionArtifact_sessionId_createdAt_idx" ON "SessionArtifact"("sessionId", "createdAt");
CREATE INDEX "ApprovalRequest_sessionId_status_idx" ON "ApprovalRequest"("sessionId", "status");
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthOtp" ADD CONSTRAINT "AuthOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionToken" ADD CONSTRAINT "SessionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProboxAiSession" ADD CONSTRAINT "ProboxAiSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProboxAiSession" ADD CONSTRAINT "ProboxAiSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProboxAiSession" ADD CONSTRAINT "ProboxAiSession_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProboxAiTurn" ADD CONSTRAINT "ProboxAiTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProboxAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProboxAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionArtifact" ADD CONSTRAINT "SessionArtifact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProboxAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProboxAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
