import { Permissions } from "../authorization/permission.catalog";

export const catalogManagementPermission = Permissions.SETTINGS_MANAGE;

export function isCatalogOperator(userId: string | undefined) {
  return (
    !!userId &&
    (process.env.PROBOXAI_MODEL_CATALOG_ADMIN_IDS ?? "")
      .split(",")
      .some((id) => id.trim() === userId)
  );
}
