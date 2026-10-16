import { Prisma } from "@prisma/client";
import { ExplicitGrantPermissionKeys } from "../src/authorization/permission.catalog";

/** Preserve explicitly assigned new capabilities; seed never grants them. */
export async function applyBootstrapRolePermissions(
  tx: Prisma.TransactionClient,
  roleId: string,
  defaults: readonly string[],
) {
  await tx.rolePermission.deleteMany({
    where: {
      roleId,
      permissionKey: { notIn: [...ExplicitGrantPermissionKeys] },
    },
  });
  await tx.rolePermission.createMany({
    data: defaults.map((permissionKey) => ({ roleId, permissionKey })),
    skipDuplicates: true,
  });
}
