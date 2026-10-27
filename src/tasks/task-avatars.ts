import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { audienceAllows } from "../accounts/profile-audience";
import {
  avatarMetadata,
  avatarSelect,
} from "../accounts/profile-avatar-domain";
/** Fresh caller-specific metadata only; never persist in receipts or history. */
export async function projectTaskAvatars(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  items: Array<{ assigneeIdentities: Array<{ id: string }> }>,
) {
  const ids = [
    ...new Set(items.flatMap((i) => i.assigneeIdentities.map((u) => u.id))),
  ];
  if (!ids.length) return;
  const users = await tx.user.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId, status: "OPEN" },
    select: {
      id: true,
      avatarAsset: { select: avatarSelect },
      audiencePolicies: {
        where: { field: "AVATAR" },
        select: {
          mode: true,
          accountRecipients: {
            where: { accountId: actor.id },
            select: { accountId: true },
          },
          workspaceRecipients: {
            where: { workspaceId: actor.workspaceId },
            select: { workspaceId: true },
          },
        },
      },
      contactsOwned: {
        where: { contactAccountId: actor.id },
        select: { ownerId: true },
      },
    },
  });
  const avatars = new Map(
    users.map((u) => [
      u.id,
      audienceAllows(u.audiencePolicies[0], actor, u.contactsOwned.length > 0)
        ? avatarMetadata(u.avatarAsset, u.id)
        : null,
    ]),
  );
  for (const item of items)
    for (const identity of item.assigneeIdentities)
      Object.assign(identity, { avatar: avatars.get(identity.id) ?? null });
}
