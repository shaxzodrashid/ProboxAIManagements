-- CreateEnum
CREATE TYPE "ProfileAudienceField" AS ENUM ('AVATAR', 'BIO', 'STATUS', 'BIRTHDAY_DAY_MONTH', 'BIRTHDAY_YEAR');

-- CreateEnum
CREATE TYPE "ProfileAudienceMode" AS ENUM ('NO_ONE', 'EVERYONE', 'CONTACTS', 'CUSTOM');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthDate" DATE;

-- CreateTable
CREATE TABLE "ProfileAudiencePolicy" (
    "ownerId" TEXT NOT NULL,
    "field" "ProfileAudienceField" NOT NULL,
    "mode" "ProfileAudienceMode" NOT NULL DEFAULT 'NO_ONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileAudiencePolicy_pkey" PRIMARY KEY ("ownerId","field")
);

-- CreateTable
CREATE TABLE "ProfileAudienceAccountRecipient" (
    "ownerId" TEXT NOT NULL,
    "field" "ProfileAudienceField" NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "ProfileAudienceAccountRecipient_pkey" PRIMARY KEY ("ownerId","field","accountId")
);

-- CreateTable
CREATE TABLE "ProfileAudienceWorkspaceRecipient" (
    "ownerId" TEXT NOT NULL,
    "field" "ProfileAudienceField" NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "ProfileAudienceWorkspaceRecipient_pkey" PRIMARY KEY ("ownerId","field","workspaceId")
);

-- CreateTable
CREATE TABLE "ProfileContact" (
    "ownerId" TEXT NOT NULL,
    "contactAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileContact_pkey" PRIMARY KEY ("ownerId","contactAccountId")
);

-- CreateIndex
CREATE INDEX "ProfileAudienceAccountRecipient_accountId_idx" ON "ProfileAudienceAccountRecipient"("accountId");

-- CreateIndex
CREATE INDEX "ProfileAudienceWorkspaceRecipient_workspaceId_idx" ON "ProfileAudienceWorkspaceRecipient"("workspaceId");

-- CreateIndex
CREATE INDEX "ProfileContact_contactAccountId_idx" ON "ProfileContact"("contactAccountId");

-- AddForeignKey
ALTER TABLE "ProfileAudiencePolicy" ADD CONSTRAINT "ProfileAudiencePolicy_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAudienceAccountRecipient" ADD CONSTRAINT "ProfileAudienceAccountRecipient_ownerId_field_fkey" FOREIGN KEY ("ownerId", "field") REFERENCES "ProfileAudiencePolicy"("ownerId", "field") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAudienceAccountRecipient" ADD CONSTRAINT "ProfileAudienceAccountRecipient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAudienceWorkspaceRecipient" ADD CONSTRAINT "ProfileAudienceWorkspaceRecipient_ownerId_field_fkey" FOREIGN KEY ("ownerId", "field") REFERENCES "ProfileAudiencePolicy"("ownerId", "field") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAudienceWorkspaceRecipient" ADD CONSTRAINT "ProfileAudienceWorkspaceRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileContact" ADD CONSTRAINT "ProfileContact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileContact" ADD CONSTRAINT "ProfileContact_contactAccountId_fkey" FOREIGN KEY ("contactAccountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
