import { Prisma } from "@prisma/client";
import { operationError } from "../openapi/operation-errors";
// Call only after the shared workspace lock; guards alone are an earlier snapshot.
export async function assertCurrentManagement(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  permissionKey: string,
) {
  const actor = await tx.user.findFirst({
    where: {
      id: actorId,
      workspaceId,
      status: "OPEN",
      roleAssignments: {
        some: { role: { permissions: { some: { permissionKey } } } },
      },
    },
    select: { id: true },
  });
  if (!actor)
    throw operationError(
      403,
      "MANAGEMENT_ACCESS_CHANGED",
      "Management access is no longer available; refresh authorization",
      "checkManagement",
    );
}
