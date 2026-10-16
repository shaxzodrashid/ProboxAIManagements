-- Additive migration: keep legacy fullName verbatim; do not guess name components.
ALTER TABLE "User"
  ADD COLUMN "firstName" VARCHAR(120),
  ADD COLUMN "lastName" VARCHAR(120),
  ADD COLUMN "bio" VARCHAR(1000);
