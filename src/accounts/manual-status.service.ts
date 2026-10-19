import { HttpException, Injectable } from "@nestjs/common";
import {
  ManualAvailability,
  ManualProfileStatusMutation,
  Prisma,
} from "@prisma/client";
import { isUUID } from "class-validator";
import { AuthenticatedUser } from "../auth/auth.types";
import { operationError } from "../openapi/operation-errors";
import { lockWorkspace } from "../prisma/workspace-lock";
import { PrismaService } from "../prisma/prisma.service";
import { SetManualStatusDto } from "./manual-status.dto";
import { resolveProfileAccountId } from "./profile-account-lookup";

const fail = (status: number, code: string, message: string) =>
  operationError(status, code, message, "manualStatus");
@Injectable()
export class ManualStatusService {
  constructor(private readonly prisma: PrismaService) {}
  private transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    write = false,
  ) {
    return this.prisma
      .$transaction(
        action,
        write
          ? undefined
          : { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        throw fail(
          503,
          "MANUAL_STATUS_UNAVAILABLE",
          "Manual status is temporarily unavailable; reconcile an uncertain write with the same request identity",
        );
      });
  }
  async owner(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    // Human access-token subjects only. No agent identity, caller selector or role bypass.
    if (actor.type !== undefined && actor.type !== "access")
      throw fail(
        403,
        "MANUAL_STATUS_DENIED",
        "Self status access is unavailable",
      );
    if (
      !(await tx.user.findFirst({
        where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
        select: { id: true },
      }))
    )
      throw fail(404, "RESOURCE_NOT_FOUND", "Account not found");
  }
  self(actor: AuthenticatedUser) {
    return this.transaction(async (tx) => {
      await this.owner(tx, actor);
      const row = await tx.manualProfileStatus.findUnique({
        where: { ownerId: actor.id },
      });
      return {
        availability: row?.availability ?? null,
        revision: row?.revision ?? 0,
      };
    });
  }
  publicStatus(accountId: string) {
    return this.transaction(async (tx) => {
      const id = await resolveProfileAccountId(tx, accountId);
      if (!id) throw fail(404, "RESOURCE_NOT_FOUND", "Profile not found");
      const user = await tx.user.findFirst({
        where: { id, status: "OPEN" },
        select: {
          id: true,
          manualProfileStatus: { select: { availability: true } },
        },
      });
      if (!user) throw fail(404, "RESOURCE_NOT_FOUND", "Profile not found");
      return {
        accountId: user.id,
        availability: user.manualProfileStatus?.availability ?? null,
      };
    });
  }
  private outcome(row: ManualProfileStatusMutation) {
    return {
      requestId: row.requestId,
      availability: row.availability,
      revision: row.revision,
      actor: { kind: "EMPLOYEE" as const, id: row.actorId },
      createdAt: row.createdAt.toISOString(),
    };
  }
  readback(actor: AuthenticatedUser, requestId: string) {
    return this.transaction(async (tx) => {
      await this.owner(tx, actor);
      const row = await tx.manualProfileStatusMutation.findUnique({
        where: {
          ownerId_requestId: {
            ownerId: actor.id,
            requestId: requestId.toLowerCase(),
          },
        },
      });
      if (!row)
        throw fail(404, "RESOURCE_NOT_FOUND", "Status operation not found");
      return this.outcome(row);
    });
  }
  set(
    actor: AuthenticatedUser,
    expectedRevision: number,
    dto: SetManualStatusDto,
  ) {
    if (
      !dto ||
      Object.keys(dto).some(
        (key) => !["requestId", "availability"].includes(key),
      ) ||
      !isUUID(dto.requestId, "4") ||
      (dto.availability !== null &&
        !Object.values(ManualAvailability).includes(dto.availability)) ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > 2147483646
    )
      throw fail(
        400,
        "MANUAL_STATUS_INPUT",
        "Supply a request UUID, current revision and an allowed availability or null",
      );
    return this.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      await this.owner(tx, actor);
      return this.applyInTransaction(tx, actor, expectedRevision, dto);
    }, true);
  }
  async applyInTransaction(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    expectedRevision: number,
    dto: SetManualStatusDto,
  ) {
    const requestId = dto.requestId.toLowerCase();
    const prior = await tx.manualProfileStatusMutation.findUnique({
      where: { ownerId_requestId: { ownerId: actor.id, requestId } },
    });
    if (prior) {
      if (
        prior.expectedRevision !== expectedRevision ||
        prior.availability !== dto.availability
      )
        throw fail(
          409,
          "MANUAL_STATUS_REQUEST_CONFLICT",
          "Request identity was already used for a different status change",
        );
      return this.outcome(prior);
    }
    const current = await tx.manualProfileStatus.findUnique({
      where: { ownerId: actor.id },
    });
    if ((current?.revision ?? 0) !== expectedRevision)
      throw fail(
        409,
        "MANUAL_STATUS_REVISION_CONFLICT",
        "Manual status changed; reread before saving",
      );
    if (current) {
      const updated = await tx.manualProfileStatus.updateMany({
        where: { ownerId: actor.id, revision: expectedRevision },
        data: { availability: dto.availability, revision: { increment: 1 } },
      });
      if (!updated.count)
        throw fail(
          409,
          "MANUAL_STATUS_REVISION_CONFLICT",
          "Manual status changed; reread before saving",
        );
    } else
      await tx.manualProfileStatus.create({
        data: {
          ownerId: actor.id,
          availability: dto.availability,
          revision: 1,
        },
      });
    const receipt = await tx.manualProfileStatusMutation.create({
      data: {
        ownerId: actor.id,
        workspaceId: actor.workspaceId,
        actorId: actor.id,
        requestId,
        expectedRevision,
        revision: expectedRevision + 1,
        before: current?.availability ?? null,
        availability: dto.availability,
      },
    });
    return this.outcome(receipt);
  }
}
