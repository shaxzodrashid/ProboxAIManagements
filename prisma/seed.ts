import { PrismaClient, UserStatus } from "@prisma/client";
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
  await prisma.department.upsert({
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
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: permission,
      create: permission,
    });
  }
  for (const definition of SystemRoleDefinitions) {
    const role = await prisma.role.upsert({
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
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: definition.permissions.map((permissionKey) => ({
          roleId: role.id,
          permissionKey,
        })),
        skipDuplicates: true,
      }),
    ]);
  }
  const user = await prisma.user.upsert({
    where: { phoneNumber: parsePhoneNumber(phone).number },
    update: {
      fullName: name,
    },
    create: {
      workspaceId: workspace.id,
      phoneNumber: parsePhoneNumber(phone).number,
      fullName: name,
      status: UserStatus.PENDING,
    },
  });
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: {
      workspaceId_key: {
        workspaceId: workspace.id,
        key: SystemRoleKeys.ADMIN,
      },
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: {
      userId: user.id,
      roleId: adminRole.id,
      workspaceId: workspace.id,
    },
  });
}
main().finally(() => prisma.$disconnect());
