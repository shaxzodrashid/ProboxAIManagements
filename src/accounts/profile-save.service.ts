import { HttpException, Injectable } from "@nestjs/common";
import { Prisma, ProfileSaveReceipt } from "@prisma/client";
import { validateSync } from "class-validator";
import { plainToInstance } from "class-transformer";
import { createHash, randomUUID } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { operationError } from "../openapi/operation-errors";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  AccountsService,
  selfProfileSelect,
  toSelfProfile,
} from "./accounts.service";
import { ManualStatusService } from "./manual-status.service";
import { ProfilePrivacyService } from "./profile-privacy.service";
import { CommitSelfProfileDto } from "./profile-save.dto";

const fail = (status: number, code: string, message: string) =>
  operationError(status, code, message, "profileSave");
@Injectable()
export class ProfileSaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly privacy: ProfilePrivacyService,
    private readonly status: ManualStatusService,
  ) {}
  private transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    write = false,
  ) {
    return this.prisma
      .$transaction(action, {
        // All runtime writers acquire workspace first. READ COMMITTED after that
        // lock lets concurrent exact retries see the committed receipt, not an old snapshot.
        isolationLevel: write
          ? Prisma.TransactionIsolationLevel.ReadCommitted
          : Prisma.TransactionIsolationLevel.RepeatableRead,
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        throw fail(
          503,
          "PROFILE_SAVE_UNAVAILABLE",
          "Profile Save is temporarily unavailable; reconcile with the same request identity",
        );
      });
  }
  private async owner(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    if (actor.type !== undefined && actor.type !== "access")
      throw fail(403, "PROFILE_SAVE_DENIED", "Human self access required");
    const user = await tx.user.findFirst({
      where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
      select: { ...selfProfileSelect, profileRevision: true },
    });
    if (!user) throw fail(404, "RESOURCE_NOT_FOUND", "Account not found");
    return user;
  }
  edit(actor: AuthenticatedUser) {
    return this.transaction(async (tx) => {
      const user = await this.owner(tx, actor);
      const rows = await tx.profileAudiencePolicy.findMany({
        where: { ownerId: actor.id },
        include: { accountRecipients: true, workspaceRecipients: true },
      });
      const current = await tx.manualProfileStatus.findUnique({
        where: { ownerId: actor.id },
      });
      return {
        profile: toSelfProfile(user),
        audiences: this.privacy.responses(rows),
        status: {
          availability: current?.availability ?? null,
          revision: current?.revision ?? 0,
        },
        revision: user.profileRevision,
      };
    });
  }
  private outcome(row: ProfileSaveReceipt) {
    return {
      requestId: row.requestId,
      expectedRevision: row.expectedRevision,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
    };
  }
  readback(actor: AuthenticatedUser, requestId: string) {
    return this.transaction(async (tx) => {
      await this.owner(tx, actor);
      const row = await tx.profileSaveReceipt.findUnique({
        where: {
          ownerId_requestId: {
            ownerId: actor.id,
            requestId: requestId.toLowerCase(),
          },
        },
      });
      if (!row || row.workspaceId !== actor.workspaceId)
        throw fail(404, "RESOURCE_NOT_FOUND", "Profile operation not found");
      return this.outcome(row);
    });
  }
  commit(actor: AuthenticatedUser, dto: CommitSelfProfileDto) {
    if (!dto) throw fail(400, "PROFILE_SAVE_INPUT", "Invalid profile Save");
    dto = plainToInstance(CommitSelfProfileDto, dto);
    // Validate internal callers as well as HTTP; never hash or persist unchecked input.
    if (
      !dto ||
      validateSync(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length
    )
      throw fail(400, "PROFILE_SAVE_INPUT", "Invalid profile Save");
    if (
      new Set(dto.audiences.map((p) => p.field)).size !== dto.audiences.length
    )
      throw fail(
        400,
        "PROFILE_SAVE_INPUT",
        "Each audience field may appear only once",
      );
    for (const p of dto.audiences) this.privacy.validateAudience(p.field, p);
    // Fixed property order, normalized set order, and omitted vs explicit null retained.
    const intent = {
      expectedRevision: dto.expectedRevision,
      ...Object.fromEntries(
        ["firstName", "lastName", "bio", "birthDate", "availability"]
          .filter((k) => dto[k as keyof CommitSelfProfileDto] !== undefined)
          .map((k) => [k, dto[k as keyof CommitSelfProfileDto]]),
      ),
      audiences: dto.audiences
        .map((p) => ({
          field: p.field,
          mode: p.mode,
          accountIds: [...p.accountIds].sort(),
          workspaceIds: [...p.workspaceIds].sort(),
        }))
        .sort((a, b) => a.field.localeCompare(b.field)),
    };
    const inputHash = createHash("sha256")
      .update(JSON.stringify(intent))
      .digest("hex");
    return this.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      // Hold owner row before dependent rows, including database-trigger revision writes.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      const user = await this.owner(tx, actor);
      const requestId = dto.requestId.toLowerCase();
      const prior = await tx.profileSaveReceipt.findUnique({
        where: { ownerId_requestId: { ownerId: actor.id, requestId } },
      });
      if (prior) {
        if (
          prior.workspaceId !== actor.workspaceId ||
          prior.inputHash !== inputHash
        )
          throw fail(
            409,
            "PROFILE_SAVE_REQUEST_CONFLICT",
            "Request identity was already used for different profile changes",
          );
        return this.outcome(prior);
      }
      if (user.profileRevision !== dto.expectedRevision)
        throw fail(
          409,
          "PROFILE_SAVE_REVISION_CONFLICT",
          "Profile changed; preserve the draft and reread before saving",
        );
      await this.accounts.updateSelfInTransaction(
        tx,
        actor.workspaceId,
        actor.id,
        dto,
      );
      for (const policy of dto.audiences)
        await this.privacy.replaceInTransaction(
          tx,
          actor.workspaceId,
          actor.id,
          policy.field,
          policy,
        );
      let statusRequestId: string | null = null;
      if (dto.availability !== undefined) {
        const current = await tx.manualProfileStatus.findUnique({
          where: { ownerId: actor.id },
        });
        statusRequestId = randomUUID();
        await this.status.applyInTransaction(
          tx,
          actor,
          current?.revision ?? 0,
          { requestId: statusRequestId, availability: dto.availability },
        );
      }
      // Explicit empty/equal-value human Saves are still commands. Revisions are
      // opaque generations: triggers may advance several times within one command.
      const updated = await tx.user.update({
        where: { id: actor.id },
        data: { profileRevision: { increment: 1 } },
        select: { profileRevision: true },
      });
      return this.outcome(
        await tx.profileSaveReceipt.create({
          data: {
            ownerId: actor.id,
            actorId: actor.id,
            workspaceId: actor.workspaceId,
            requestId,
            inputHash,
            expectedRevision: dto.expectedRevision,
            revision: updated.profileRevision,
            statusRequestId,
          },
        }),
      );
    }, true);
  }
}
