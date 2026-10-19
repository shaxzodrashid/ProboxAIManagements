import {
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, ProfileAvatarAsset } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { createHash, randomUUID } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { operationError } from "../openapi/operation-errors";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { AVATAR_STAGE_TTL_MS } from "./profile-avatar-domain";
import { AvatarUploadDto } from "./profile-avatar.dto";
import { normalizeAvatar } from "./profile-avatar-image";
import {
  avatarStorageUnavailable,
  ProfileAvatarStorage,
} from "./profile-avatar-storage";
import { ProfilePrivacyService } from "./profile-privacy.service";

const missing = () => new NotFoundException("Avatar not available");
const fail = (status: number, code: string, message: string) =>
  operationError(status, code, message, "profileAvatar");
@Injectable()
export class ProfileAvatarService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProfileAvatarStorage,
    private readonly privacy: ProfilePrivacyService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () => void this.cleanup().catch(() => undefined),
      60_000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async dependency<T>(action: () => PromiseLike<T>): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw fail(
        503,
        "PROFILE_AVATAR_UNAVAILABLE",
        "Avatar operation is temporarily unavailable; reconcile the original request",
      );
    }
  }
  private transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.dependency(() => this.prisma.$transaction(fn));
  }
  private async owner(
    tx: Pick<Prisma.TransactionClient, "user">,
    actor: AuthenticatedUser,
  ) {
    if (actor.type !== undefined && actor.type !== "access")
      throw fail(403, "PROFILE_AVATAR_DENIED", "Human self access required");
    if (
      actor.accessExpiresAt !== undefined &&
      actor.accessExpiresAt <= Date.now()
    )
      throw new UnauthorizedException("Invalid or expired access token");
    const row = await this.dependency(() =>
      tx.user.findFirst({
        where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
        select: { id: true, avatarAssetId: true },
      }),
    );
    if (!row) throw missing();
    return row;
  }
  private receipt(asset: ProfileAvatarAsset) {
    const ready =
      asset.state === "ACTIVE" ||
      (asset.state === "STAGED" && asset.expiresAt.getTime() > Date.now());
    return {
      requestId: asset.requestId,
      assetId: asset.id,
      state: asset.state === "STAGED" && !ready ? "EXPIRED" : asset.state,
      expiresAt: asset.expiresAt.toISOString(),
      width: asset.width,
      height: asset.height,
      previewUrl: ready
        ? `/api/v1/users/me/avatar-uploads/${asset.id}/content`
        : null,
    };
  }
  async stage(actor: AuthenticatedUser, input: AvatarUploadDto, file: Buffer) {
    const dto = plainToInstance(AvatarUploadDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      throw fail(400, "PROFILE_AVATAR_INPUT", "Invalid upload request or crop");
    await this.owner(this.prisma, actor);
    const image = await normalizeAvatar(file, dto);
    const inputHash = createHash("sha256")
      .update(file)
      .update(
        JSON.stringify([
          dto.cropX ?? null,
          dto.cropY ?? null,
          dto.cropSize ?? null,
        ]),
      )
      .digest("hex");
    const allocated = await this.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      await this.owner(tx, actor);
      const prior = await tx.profileAvatarAsset.findUnique({
        where: {
          ownerId_requestId: { ownerId: actor.id, requestId: dto.requestId },
        },
      });
      if (prior) {
        if (prior.inputHash !== inputHash)
          throw fail(
            409,
            "PROFILE_AVATAR_REQUEST_CONFLICT",
            "Upload identity already belongs to different bytes or crop",
          );
        return { asset: prior, fresh: false };
      }
      const id = randomUUID();
      const asset = await tx.profileAvatarAsset.create({
        data: {
          id,
          ownerId: actor.id,
          requestId: dto.requestId,
          inputHash,
          objectKey: `accounts/${actor.id}/avatars/${id}.png`,
          sha256: image.sha256,
          size: image.bytes.length,
          width: image.width,
          height: image.height,
          expiresAt: new Date(Date.now() + AVATAR_STAGE_TTL_MS),
        },
      });
      return { asset, fresh: true };
    });
    if (allocated.fresh) {
      try {
        await this.storage.put(
          allocated.asset.objectKey,
          image.bytes,
          image.sha256,
        );
      } catch {
        throw fail(
          503,
          "PROFILE_AVATAR_UPLOAD_UNCERTAIN",
          "Upload outcome is uncertain; read the same upload request instead of replacing its identity",
        );
      }
    }
    return this.readback(actor, dto.requestId);
  }
  private async reconcile(asset: ProfileAvatarAsset) {
    if (asset.state !== "UPLOADING") return asset;
    // One immutable key, one put (transport retries disabled). Matching visible
    // object evidence proves a completed put without replaying the write.
    let evidence: Awaited<ReturnType<ProfileAvatarStorage["head"]>>;
    try {
      evidence = await this.storage.head(asset.objectKey);
    } catch {
      throw avatarStorageUnavailable();
    }
    if (!evidence) return asset;
    if (evidence.size !== asset.size || evidence.sha256 !== asset.sha256)
      throw avatarStorageUnavailable();
    return this.transaction(async (tx) => {
      const scope = await tx.user.findUnique({
        where: { id: asset.ownerId },
        select: { workspaceId: true },
      });
      if (!scope) throw missing();
      await lockWorkspace(tx, scope.workspaceId);
      await tx.$queryRaw`SELECT "id" FROM "ProfileAvatarAsset" WHERE "id" = ${asset.id} FOR UPDATE`;
      await tx.profileAvatarAsset.updateMany({
        where: { id: asset.id, state: "UPLOADING" },
        data: { state: "STAGED", uploadedAt: new Date() },
      });
      return tx.profileAvatarAsset.findUniqueOrThrow({
        where: { id: asset.id },
      });
    });
  }
  async readback(actor: AuthenticatedUser, requestId: string) {
    await this.owner(this.prisma, actor);
    const asset = await this.dependency(() =>
      this.prisma.profileAvatarAsset.findUnique({
        where: {
          ownerId_requestId: {
            ownerId: actor.id,
            requestId: requestId.toLowerCase(),
          },
        },
      }),
    );
    if (!asset) throw missing();
    const current = await this.reconcile(asset);
    await this.owner(this.prisma, actor);
    return this.receipt(current);
  }
  async discard(actor: AuthenticatedUser, assetId: string) {
    return this.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      await this.owner(tx, actor);
      const asset = await tx.profileAvatarAsset.findFirst({
        where: { id: assetId, ownerId: actor.id },
      });
      if (!asset) throw missing();
      if (asset.state === "ACTIVE" || asset.state === "UPLOADING")
        throw fail(
          409,
          "PROFILE_AVATAR_DISCARD_CONFLICT",
          "Active photos use main Profile Save; uncertain uploads require readback first",
        );
      await tx.profileAvatarAsset.updateMany({
        where: { id: asset.id, state: "STAGED" },
        data: { state: "DELETE_PENDING", nextAttemptAt: new Date() },
      });
      return { discarded: true as const };
    });
  }
  private async verifiedBytes(asset: ProfileAvatarAsset) {
    try {
      const bytes = await this.storage.get(asset.objectKey);
      if (
        bytes.length !== asset.size ||
        createHash("sha256").update(bytes).digest("hex") !== asset.sha256
      )
        throw avatarStorageUnavailable();
      return bytes;
    } catch {
      throw avatarStorageUnavailable();
    }
  }
  private async previewAccess(actor: AuthenticatedUser, assetId: string) {
    const owner = await this.owner(this.prisma, actor);
    const asset = await this.dependency(() =>
      this.prisma.profileAvatarAsset.findFirst({
        where: { id: assetId, ownerId: actor.id },
      }),
    );
    if (
      !asset ||
      !(
        (asset.state === "ACTIVE" && owner.avatarAssetId === asset.id) ||
        (asset.state === "STAGED" && asset.expiresAt.getTime() > Date.now())
      )
    )
      throw missing();
    return asset;
  }
  async preview(actor: AuthenticatedUser, assetId: string) {
    const asset = await this.previewAccess(actor, assetId);
    const bytes = await this.verifiedBytes(asset);
    await this.previewAccess(actor, assetId);
    return bytes;
  }
  private async publicAccess(
    accountId: string,
    assetId: string,
    actor?: AuthenticatedUser,
  ) {
    if (actor) await this.owner(this.prisma, actor);
    const profile = await this.privacy
      .publicProfile({ id: accountId }, actor?.id)
      .catch((error: unknown) => {
        if (error instanceof HttpException && error.getStatus() === 404)
          throw missing();
        throw error;
      });
    if (!profile.avatar || profile.avatar.assetId !== assetId) throw missing();
    const asset = await this.dependency(() =>
      this.prisma.profileAvatarAsset.findFirst({
        where: { id: assetId, ownerId: profile.id, state: "ACTIVE" },
      }),
    );
    if (!asset) throw missing();
    return asset;
  }
  async publicContent(
    accountId: string,
    assetId: string,
    actor?: AuthenticatedUser,
  ) {
    const asset = await this.publicAccess(accountId, assetId, actor);
    const bytes = await this.verifiedBytes(asset);
    await this.publicAccess(accountId, assetId, actor);
    return bytes;
  }
  async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const due = await this.prisma.profileAvatarAsset.findMany({
        where: {
          nextAttemptAt: { lte: new Date() },
          OR: [
            { state: { in: ["DELETE_PENDING", "DELETING"] } },
            {
              state: { in: ["UPLOADING", "STAGED"] },
              expiresAt: { lte: new Date() },
            },
          ],
        },
        orderBy: { nextAttemptAt: "asc" },
        take: 20,
      });
      for (let asset of due) {
        try {
          if (asset.state === "UPLOADING") {
            asset = await this.reconcile(asset);
            if (asset.state === "UPLOADING") {
              await this.prisma.profileAvatarAsset.updateMany({
                where: { id: asset.id, state: "UPLOADING" },
                data: { nextAttemptAt: new Date(Date.now() + 3600_000) },
              });
              continue;
            }
          }
          const claimed = await this.transaction(async (tx) => {
            const scope = await tx.user.findUnique({
              where: { id: asset.ownerId },
              select: { workspaceId: true },
            });
            if (!scope) return false;
            await lockWorkspace(tx, scope.workspaceId);
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${asset.ownerId} FOR UPDATE`;
            const owner = await tx.user.findUnique({
              where: { id: asset.ownerId },
              select: { workspaceId: true },
            });
            if (owner?.workspaceId !== scope.workspaceId) return false;
            await tx.$queryRaw`SELECT "id" FROM "ProfileAvatarAsset" WHERE "id" = ${asset.id} FOR UPDATE`;
            const current = await tx.profileAvatarAsset.findUniqueOrThrow({
              where: { id: asset.id },
            });
            if (await tx.user.count({ where: { avatarAssetId: asset.id } }))
              return false;
            if (!(
              current.state === "DELETE_PENDING" ||
              current.state === "DELETING" ||
              (current.state === "STAGED" &&
                current.expiresAt.getTime() <= Date.now())
            ))
              return false;
            await tx.profileAvatarAsset.update({
              where: { id: asset.id },
              data: { state: "DELETING" },
            });
            return true;
          });
          if (!claimed) continue;
          await this.storage.delete(asset.objectKey);
          await this.prisma.profileAvatarAsset.updateMany({
            where: { id: asset.id, state: "DELETING" },
            data: { state: "DELETED", lastErrorCode: null },
          });
        } catch {
          const attempts = asset.attempts + 1;
          await this.prisma.profileAvatarAsset
            .updateMany({
              where: {
                id: asset.id,
                state: {
                  in: ["UPLOADING", "STAGED", "DELETE_PENDING", "DELETING"],
                },
              },
              data: {
                attempts,
                lastErrorCode: "AVATAR_CLEANUP_UNAVAILABLE",
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.min(86400_000, 2 ** Math.min(attempts, 16) * 60_000),
                ),
              },
            })
            .catch(() => undefined);
        }
      }
    } finally {
      this.cleaning = false;
    }
  }
}
