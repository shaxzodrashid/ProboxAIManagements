CREATE TABLE "TelegramConversation" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "sessionId" TEXT,
  "providerId" TEXT NOT NULL DEFAULT 'openai',
  "model" TEXT,
  "reasoningEffort" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "TelegramUpdate" (
  "updateId" BIGINT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "TelegramSession" (
  "sessionId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "projectId" TEXT NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "toolMessageId" INTEGER,
  "toolState" JSONB NOT NULL DEFAULT '{}',
  "finished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProboxAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TelegramSession_finished_createdAt_idx" ON "TelegramSession"("finished", "createdAt");
CREATE INDEX "TelegramSession_userId_projectId_idx" ON "TelegramSession"("userId", "projectId");
