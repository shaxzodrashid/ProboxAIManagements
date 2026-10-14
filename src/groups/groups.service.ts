import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import { CreateChatGroupDto } from "./groups.dto";

const projection = {
  id: true,
  name: true,
  creatorId: true,
  ownerId: true,
  createdAt: true,
} as const;
@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private async active(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    const current = await tx.user.findUnique({
      where: { id: actor.id },
      select: { workspaceId: true, status: true },
    });
    if (
      !current ||
      current.status !== "OPEN" ||
      current.workspaceId !== actor.workspaceId
    )
      throw new UnauthorizedException("Current active account required");
  }

  async create(actor: AuthenticatedUser, dto: CreateChatGroupDto) {
    const requestId = dto.requestId.toLowerCase();
    const name = dto.name.trim();
    const inputHash = createHash("sha256")
      .update(JSON.stringify({ name }))
      .digest("hex");
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, actor.workspaceId);
          await this.active(tx, actor);
          // Immutable creator/request scope also serializes retries after a workspace move.
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"chat-group-create:" + actor.id + ":" + requestId}, 0))`;
          const prior = await tx.chatGroupCreation.findUnique({
            where: { creatorId_requestId: { creatorId: actor.id, requestId } },
          });
          if (prior) {
            if (prior.inputHash !== inputHash)
              throw operationError(
                409,
                "GROUP_REQUEST_CONFLICT",
                "This request ID already has different input",
                "groups.create",
                "requestId",
              );
            return this.outcome(prior);
          }
          const group = await tx.chatGroup.create({
            data: { name, creatorId: actor.id, ownerId: actor.id },
            select: projection,
          });
          const receipt = await tx.chatGroupCreation.create({
            data: {
              creatorId: actor.id,
              requestId,
              inputHash,
              groupId: group.id,
              initialName: name,
              initialOwnerId: actor.id,
              createdAt: group.createdAt,
            },
          });
          return this.outcome(receipt);
        },
        { timeout: 10000, maxWait: 2000 },
      );
    } catch (error) {
      databaseOperationError(error, "groups.create");
    }
  }

  private outcome(receipt: {
    creatorId: string;
    requestId: string;
    groupId: string;
    initialName: string;
    initialOwnerId: string;
    createdAt: Date;
  }) {
    return {
      requestId: receipt.requestId,
      group: {
        id: receipt.groupId,
        name: receipt.initialName,
        creatorId: receipt.creatorId,
        ownerId: receipt.initialOwnerId,
        createdAt: receipt.createdAt,
      },
    };
  }

  async read(actor: AuthenticatedUser, id: string, submission = false) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.active(tx, actor);
          if (submission) {
            const receipt = await tx.chatGroupCreation.findUnique({
              where: {
                creatorId_requestId: {
                  creatorId: actor.id,
                  requestId: id.toLowerCase(),
                },
              },
            });
            if (!receipt)
              throw operationError(
                404,
                "GROUP_NOT_FOUND",
                "Group creation not found",
                "groups.read",
              );
            return this.outcome(receipt);
          }
          const group = await tx.chatGroup.findFirst({
            where: { id: id.toLowerCase(), creatorId: actor.id },
            select: projection,
          });
          if (!group)
            throw operationError(
              404,
              "GROUP_NOT_FOUND",
              "Group not found",
              "groups.read",
            );
          return group;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 10000,
          maxWait: 2000,
        },
      );
    } catch (error) {
      databaseOperationError(error, "groups.read");
    }
  }
}
