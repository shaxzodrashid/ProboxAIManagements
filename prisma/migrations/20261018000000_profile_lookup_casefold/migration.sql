-- Nonunique by design: preserve distinct legacy TEXT IDs and their relationships.
-- Public profile UUID fallback uses equality on lower(id), never a full ILIKE scan.
CREATE INDEX "User_id_casefold_idx" ON "User" (lower("id"));
