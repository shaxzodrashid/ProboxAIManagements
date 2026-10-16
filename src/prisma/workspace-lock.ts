import { Prisma } from "@prisma/client";
// All department lifecycle/home/default writes and project creation share this lock.
// Ordinary isolation plus row locks avoids replaying filesystem side effects.
export async function lockWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
}
