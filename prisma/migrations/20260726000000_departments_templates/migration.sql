-- Department homes, immutable configuration templates, and project initialization jobs.
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ProjectStatus" AS ENUM ('INITIALIZING', 'READY', 'FAILED');
CREATE TYPE "ConfigurationTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ConfigurationTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "TemplateCommandStageMode" AS ENUM ('SEQUENTIAL', 'PARALLEL');
CREATE TYPE "TemplateCommandType" AS ENUM ('STRUCTURED', 'SHELL');
CREATE TYPE "ProjectInitializationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ProjectInitializationStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "TemplateObjectCleanupStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "Department" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "homePath" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Department" ("id", "workspaceId", "name", "slug", "homePath", "isDefault")
SELECT md5("id" || ':default-department')::uuid::text, "id", 'IT', 'it', COALESCE("projectsHomePath", '/opt/apps'), true
FROM "Workspace";
ALTER TABLE "Department" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Project" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Project" ADD COLUMN "status" "ProjectStatus" NOT NULL DEFAULT 'READY';
ALTER TABLE "Project" ADD COLUMN "appliedTemplateVersionId" TEXT;
UPDATE "Project" p SET "departmentId" = d."id" FROM "Department" d WHERE d."workspaceId" = p."workspaceId" AND d."isDefault" = true;
ALTER TABLE "Project" ALTER COLUMN "departmentId" SET NOT NULL;

CREATE TABLE "ConfigurationTemplate" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "departmentId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "description" TEXT,
  "status" "ConfigurationTemplateStatus" NOT NULL DEFAULT 'ACTIVE', "creatorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConfigurationTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConfigurationTemplateVersion" (
  "id" TEXT NOT NULL, "templateId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "status" "ConfigurationTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT', "creatorId" TEXT NOT NULL,
  "publishedById" TEXT, "publishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ConfigurationTemplateVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConfigurationTemplateFolder" (
  "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "path" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfigurationTemplateFolder_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConfigurationTemplateFile" (
  "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "destinationPath" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL, "originalName" TEXT NOT NULL, "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL, "sha256" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ConfigurationTemplateFile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConfigurationTemplateCommandStage" (
  "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "name" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "mode" "TemplateCommandStageMode" NOT NULL, "maxConcurrency" INTEGER NOT NULL DEFAULT 4,
  CONSTRAINT "ConfigurationTemplateCommandStage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConfigurationTemplateCommand" (
  "id" TEXT NOT NULL, "stageId" TEXT NOT NULL, "name" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "type" "TemplateCommandType" NOT NULL, "executable" TEXT, "arguments" JSONB, "script" TEXT,
  "workingDirectory" TEXT NOT NULL DEFAULT '', "timeoutSeconds" INTEGER NOT NULL DEFAULT 900,
  CONSTRAINT "ConfigurationTemplateCommand_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectInitialization" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "templateVersionId" TEXT NOT NULL, "attempt" INTEGER NOT NULL,
  "status" "ProjectInitializationStatus" NOT NULL DEFAULT 'QUEUED', "stagingPath" TEXT, "quarantinePath" TEXT,
  "leaseOwner" TEXT, "leaseExpiresAt" TIMESTAMP(3), "lastSequence" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  "startedAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProjectInitialization_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectInitializationStep" (
  "id" TEXT NOT NULL, "initializationId" TEXT NOT NULL, "commandId" TEXT, "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "position" INTEGER NOT NULL, "status" "ProjectInitializationStepStatus" NOT NULL DEFAULT 'PENDING',
  "stdout" TEXT, "stderr" TEXT, "outputTruncated" BOOLEAN NOT NULL DEFAULT false, "exitCode" INTEGER,
  "error" TEXT, "startedAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3),
  CONSTRAINT "ProjectInitializationStep_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectInitializationEvent" (
  "id" TEXT NOT NULL, "initializationId" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectInitializationEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TemplateObjectCleanup" (
  "id" TEXT NOT NULL, "objectKey" TEXT NOT NULL, "status" "TemplateObjectCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TemplateObjectCleanup_pkey" PRIMARY KEY ("id")
);

DROP INDEX "Project_workspaceId_directoryName_key";
CREATE UNIQUE INDEX "Department_workspaceId_slug_key" ON "Department"("workspaceId", "slug");
CREATE UNIQUE INDEX "Department_one_default_per_workspace" ON "Department"("workspaceId") WHERE "isDefault" = true;
CREATE INDEX "Department_workspaceId_status_name_idx" ON "Department"("workspaceId", "status", "name");
CREATE UNIQUE INDEX "Project_departmentId_directoryName_key" ON "Project"("departmentId", "directoryName");
CREATE INDEX "Project_departmentId_status_updatedAt_idx" ON "Project"("departmentId", "status", "updatedAt");
CREATE UNIQUE INDEX "ConfigurationTemplate_departmentId_slug_key" ON "ConfigurationTemplate"("departmentId", "slug");
CREATE INDEX "ConfigurationTemplate_workspaceId_status_name_idx" ON "ConfigurationTemplate"("workspaceId", "status", "name");
CREATE UNIQUE INDEX "ConfigurationTemplateVersion_templateId_version_key" ON "ConfigurationTemplateVersion"("templateId", "version");
CREATE INDEX "ConfigurationTemplateVersion_templateId_status_version_idx" ON "ConfigurationTemplateVersion"("templateId", "status", "version");
CREATE UNIQUE INDEX "ConfigurationTemplateFolder_versionId_path_key" ON "ConfigurationTemplateFolder"("versionId", "path");
CREATE UNIQUE INDEX "ConfigurationTemplateFile_versionId_destinationPath_key" ON "ConfigurationTemplateFile"("versionId", "destinationPath");
CREATE INDEX "ConfigurationTemplateFile_objectKey_idx" ON "ConfigurationTemplateFile"("objectKey");
CREATE UNIQUE INDEX "ConfigurationTemplateCommandStage_versionId_position_key" ON "ConfigurationTemplateCommandStage"("versionId", "position");
CREATE UNIQUE INDEX "ConfigurationTemplateCommand_stageId_position_key" ON "ConfigurationTemplateCommand"("stageId", "position");
CREATE UNIQUE INDEX "ProjectInitialization_projectId_attempt_key" ON "ProjectInitialization"("projectId", "attempt");
CREATE INDEX "ProjectInitialization_status_createdAt_idx" ON "ProjectInitialization"("status", "createdAt");
CREATE UNIQUE INDEX "ProjectInitializationStep_initializationId_key_key" ON "ProjectInitializationStep"("initializationId", "key");
CREATE INDEX "ProjectInitializationStep_initializationId_position_idx" ON "ProjectInitializationStep"("initializationId", "position");
CREATE UNIQUE INDEX "ProjectInitializationEvent_initializationId_sequence_key" ON "ProjectInitializationEvent"("initializationId", "sequence");
CREATE INDEX "ProjectInitializationEvent_initializationId_createdAt_idx" ON "ProjectInitializationEvent"("initializationId", "createdAt");
CREATE UNIQUE INDEX "TemplateObjectCleanup_objectKey_key" ON "TemplateObjectCleanup"("objectKey");
CREATE INDEX "TemplateObjectCleanup_status_nextAttemptAt_idx" ON "TemplateObjectCleanup"("status", "nextAttemptAt");

ALTER TABLE "Department" ADD CONSTRAINT "Department_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplate" ADD CONSTRAINT "ConfigurationTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplate" ADD CONSTRAINT "ConfigurationTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplate" ADD CONSTRAINT "ConfigurationTemplate_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateVersion" ADD CONSTRAINT "ConfigurationTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ConfigurationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateVersion" ADD CONSTRAINT "ConfigurationTemplateVersion_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateVersion" ADD CONSTRAINT "ConfigurationTemplateVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateFolder" ADD CONSTRAINT "ConfigurationTemplateFolder_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ConfigurationTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateFile" ADD CONSTRAINT "ConfigurationTemplateFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ConfigurationTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateCommandStage" ADD CONSTRAINT "ConfigurationTemplateCommandStage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ConfigurationTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfigurationTemplateCommand" ADD CONSTRAINT "ConfigurationTemplateCommand_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ConfigurationTemplateCommandStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_appliedTemplateVersionId_fkey" FOREIGN KEY ("appliedTemplateVersionId") REFERENCES "ConfigurationTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectInitialization" ADD CONSTRAINT "ProjectInitialization_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectInitialization" ADD CONSTRAINT "ProjectInitialization_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ConfigurationTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectInitializationStep" ADD CONSTRAINT "ProjectInitializationStep_initializationId_fkey" FOREIGN KEY ("initializationId") REFERENCES "ProjectInitialization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectInitializationStep" ADD CONSTRAINT "ProjectInitializationStep_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "ConfigurationTemplateCommand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectInitializationEvent" ADD CONSTRAINT "ProjectInitializationEvent_initializationId_fkey" FOREIGN KEY ("initializationId") REFERENCES "ProjectInitialization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
