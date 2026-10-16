import { lockWorkspace } from "../src/prisma/workspace-lock";
import { PrismaClient } from "@prisma/client";
import { upsertBootstrapUser } from "./bootstrap-user";
import { applyBootstrapRolePermissions } from "./bootstrap-role-permissions";
import { parsePhoneNumber } from "libphonenumber-js";
import {
  PermissionDefinitions,
  SystemRoleDefinitions,
  SystemRoleKeys,
} from "../src/authorization/permission.catalog";

const prisma = new PrismaClient();
async function main() {
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? "ProboxAI Administrator";
  if (!phone) throw new Error("Set BOOTSTRAP_ADMIN_PHONE in E.164 format");
  const workspace = await prisma.workspace.upsert({
    where: { slug: "default" },
    update: {},
    create: { slug: "default" },
  });
  await prisma.$transaction(
    async (tx) => {
      await lockWorkspace(tx, workspace.id);
      await tx.department.upsert({
        where: {
          workspaceId_slug: { workspaceId: workspace.id, slug: "it" },
        },
        update: {},
        create: {
          workspaceId: workspace.id,
          name: "IT",
          slug: "it",
          homePath: process.env.PROBOXAI_PROJECTS_HOME ?? "/opt/apps",
          isDefault: true,
        },
      });
      for (const permission of PermissionDefinitions) {
        await tx.permission.upsert({
          where: { key: permission.key },
          update: permission,
          create: permission,
        });
      }
      for (const definition of SystemRoleDefinitions) {
        const role = await tx.role.upsert({
          where: {
            workspaceId_key: { workspaceId: workspace.id, key: definition.key },
          },
          update: {
            name: definition.name,
            description: definition.description,
            isSystem: true,
          },
          create: {
            workspaceId: workspace.id,
            key: definition.key,
            name: definition.name,
            description: definition.description,
            isSystem: true,
          },
        });

        await applyBootstrapRolePermissions(
          tx,
          role.id,
          definition.permissions,
        );
      }
      const user = await upsertBootstrapUser(
        prisma,
        {
          workspaceId: workspace.id,
          phoneNumber: parsePhoneNumber(phone).number,
          fullName: name,
        },
        tx,
      );
      const adminRole = await tx.role.findUniqueOrThrow({
        where: {
          workspaceId_key: {
            workspaceId: workspace.id,
            key: SystemRoleKeys.ADMIN,
          },
        },
      });
      await tx.userRoleAssignment.upsert({
        where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
        update: {},
        create: {
          userId: user.id,
          roleId: adminRole.id,
          workspaceId: workspace.id,
        },
      });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { authorizationRevision: { increment: 1 } },
      });
    },
    { timeout: 60000 },
  );
}
main().finally(() => prisma.$disconnect());
