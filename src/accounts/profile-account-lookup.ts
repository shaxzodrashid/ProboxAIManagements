import { Prisma } from "@prisma/client";

/** Read within the caller's snapshot; never merge legacy case-distinct TEXT keys. */
export async function resolveProfileAccountId(
  tx: Prisma.TransactionClient,
  input: string,
): Promise<string | null> {
  const exact = await tx.user.findUnique({
    where: { id: input },
    select: { id: true, status: true },
  });
  if (exact) return exact.status === "OPEN" ? exact.id : null;
  // Equality uses the nonunique lower(id) index, unlike an ILIKE miss. Include
  // inactive candidates in ambiguity detection, without returning their state.
  const matches = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT "id", "status" FROM "User" WHERE lower("id") = lower(${input}) LIMIT 2
  `;
  return matches.length === 1 && matches[0]!.status === "OPEN"
    ? matches[0]!.id
    : null;
}
