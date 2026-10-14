ALTER TABLE "ProfileContact" ADD COLUMN "alias" VARCHAR(120);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "User_public_fullName_search_idx" ON "User" USING gin (lower("fullName") gin_trgm_ops) WHERE status = 'OPEN';
CREATE INDEX "User_public_firstName_search_idx" ON "User" USING gin (lower("firstName") gin_trgm_ops) WHERE status = 'OPEN';
CREATE INDEX "User_public_lastName_search_idx" ON "User" USING gin (lower("lastName") gin_trgm_ops) WHERE status = 'OPEN';
CREATE INDEX "User_public_username_search_idx" ON "User" USING gin (lower(username) gin_trgm_ops) WHERE status = 'OPEN';
CREATE INDEX "ProfileContact_alias_search_idx" ON "ProfileContact" USING gin (lower(alias) gin_trgm_ops);
