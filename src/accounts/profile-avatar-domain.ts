import { Prisma, ProfileAvatarAsset } from "@prisma/client";
import { ApiProperty } from "@nestjs/swagger";
import { operationError } from "../openapi/operation-errors";

export const AVATAR_UPLOAD_LIMIT = 5 * 1024 * 1024;
export const AVATAR_OUTPUT_LIMIT = 2 * 1024 * 1024;
export const AVATAR_STAGE_TTL_MS = 24 * 60 * 60_000;
export const avatarSelect = {
  id: true,
  width: true,
  height: true,
  state: true,
} as const;
export class ProfileAvatarResponseDto {
  @ApiProperty({ format: "uuid" }) assetId!: string;
  @ApiProperty({ maximum: 512, minimum: 1 }) width!: number;
  @ApiProperty({ maximum: 512, minimum: 1 }) height!: number;
  @ApiProperty({
    description:
      "Relative application route, never a bucket URL. Use authenticated fetch for a private preview or restricted audience.",
  })
  url!: string;
}
export function avatarMetadata(
  asset:
    | Pick<ProfileAvatarAsset, "id" | "width" | "height" | "state">
    | null
    | undefined,
  ownerId?: string,
) {
  if (!asset || asset.state !== "ACTIVE") return null;
  return {
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    url: ownerId
      ? `/api/v1/profiles/${ownerId}/avatar/${asset.id}`
      : `/api/v1/users/me/avatar-uploads/${asset.id}/content`,
  };
}
/** Caller owns the workspace and owner locks. No storage I/O in this transaction. */
export async function applyProfileAvatar(
  tx: Prisma.TransactionClient,
  ownerId: string,
  next: string | null,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { avatarAssetId: true },
  });
  if (next !== null) {
    await tx.$queryRaw`SELECT "id" FROM "ProfileAvatarAsset" WHERE "id" = ${next} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const asset = await tx.profileAvatarAsset.findFirst({
      where: { id: next, ownerId },
    });
    if (
      !asset ||
      !(
        (asset.state === "STAGED" && asset.expiresAt.getTime() > Date.now()) ||
        (asset.state === "ACTIVE" && user.avatarAssetId === next)
      )
    )
      throw operationError(
        409,
        "PROFILE_AVATAR_UNAVAILABLE",
        "Avatar draft is unavailable; preserve the current photo and reupload if necessary",
        "profileSave",
        "avatarAssetId",
      );
    await tx.profileAvatarAsset.update({
      where: { id: next },
      data: { state: "ACTIVE" },
    });
  }
  await tx.user.update({
    where: { id: ownerId },
    data: { avatarAssetId: next },
  });
  if (user.avatarAssetId && user.avatarAssetId !== next)
    await tx.profileAvatarAsset.updateMany({
      where: { id: user.avatarAssetId, ownerId, state: "ACTIVE" },
      data: { state: "DELETE_PENDING", nextAttemptAt: new Date() },
    });
}
