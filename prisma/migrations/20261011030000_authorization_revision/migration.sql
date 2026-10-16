-- Additive; zero is the initial workspace-wide authorization set token.
ALTER TABLE "Workspace" ADD COLUMN "authorizationRevision" INTEGER NOT NULL DEFAULT 0;
