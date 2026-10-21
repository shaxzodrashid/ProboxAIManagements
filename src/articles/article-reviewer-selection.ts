import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { operationError } from "../openapi/operation-errors";
// Caller holds Workspace lock and has verified current project-owner authority.
export async function eligibleArticleReviewers(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  projectId: string,
  ownerId: string,
  ids: string[],
  missing: () => Error,
  action: string,
) {
  const voterIds = ids.map((id) => id.toLowerCase());
  if (
    !voterIds.length ||
    voterIds.length > 100 ||
    new Set(voterIds).size !== voterIds.length
  )
    throw operationError(
      400,
      "ARTICLE_VOTERS_INVALID",
      "Select between one and 100 distinct voters",
      action,
    );
  const eligible = await tx.user.count({
    where: {
      id: { in: voterIds },
      workspaceId: actor.workspaceId,
      status: "OPEN",
      OR: [{ id: ownerId }, { projectMemberships: { some: { projectId } } }],
      roleAssignments: {
        some: {
          role: { permissions: { some: { permissionKey: "projects.read" } } },
        },
      },
    },
  });
  if (eligible !== voterIds.length) throw missing();
  return voterIds;
}
