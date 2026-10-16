BEGIN;
CREATE TYPE "TaskPriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');
ALTER TABLE "TaskHumanState" ADD COLUMN "priority" "TaskPriority";
COMMIT;
