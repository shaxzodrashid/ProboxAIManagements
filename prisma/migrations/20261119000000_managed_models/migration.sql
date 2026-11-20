CREATE TABLE "ManagedModel" (
    "providerId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE,
    "sunsetAt" TIMESTAMPTZ(3),
    "defaultReasoningEffort" TEXT NOT NULL,
    "supportedReasoningEfforts" TEXT[] NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL CHECK ("maxOutputTokens" > 0),
    "thinkingBudgets" JSONB,
    PRIMARY KEY ("providerId", "id"),
    CHECK ("defaultReasoningEffort" = ANY ("supportedReasoningEfforts"))
);
