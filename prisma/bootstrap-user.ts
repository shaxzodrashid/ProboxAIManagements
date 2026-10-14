import { PrismaClient, Prisma, UserStatus } from "@prisma/client";

export async function upsertBootstrapUser(
  prisma: PrismaClient,
  input: { workspaceId: string; phoneNumber: string; fullName: string },
  tx?: Prisma.TransactionClient,
): Promise<{ id: string }> {
  if (!tx)
    return prisma.$transaction((db) => upsertBootstrapUser(prisma, input, db));
  const user = await tx.user.upsert({
    where: { phoneNumber: input.phoneNumber },
    update: {},
    create: { ...input, status: UserStatus.PENDING },
    select: { id: true },
  });
  // Preserve structured profile edits. Legacy seed renaming remains supported.
  await tx.user.updateMany({
    where: { id: user.id, firstName: null, lastName: null },
    data: { fullName: input.fullName },
  });
  return user;
}
