import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { parsePhoneNumber } from "libphonenumber-js";

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
  await prisma.user.upsert({
    where: { phoneNumber: parsePhoneNumber(phone).number },
    update: {
      role: UserRole.ADMIN,
      fullName: name,
    },
    create: {
      workspaceId: workspace.id,
      phoneNumber: parsePhoneNumber(phone).number,
      fullName: name,
      role: UserRole.ADMIN,
      status: UserStatus.PENDING,
    },
  });
}
main().finally(() => prisma.$disconnect());
