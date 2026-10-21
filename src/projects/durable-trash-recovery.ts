import { ProjectFileTrashItem } from "@prisma/client";
import { HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { PrismaService } from "../prisma/prisma.service";
import { operationError } from "../openapi/operation-errors";
import { fileEvidence } from "./durable-file-deletion";
import {
  DirectoryRestorePublisher,
  WindowsDirectoryRestore,
} from "./windows-directory-restore";

/** Claims never expire. A missing acknowledgement is not permission to replay. */
export class DurableTrashRecovery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryRestorePublisher = new WindowsDirectoryRestore(),
  ) {}

  private unknown() {
    return operationError(
      409,
      "FILE_TRASH_OUTCOME_UNKNOWN",
      "Read the trash item outcome; an existing execution requires review before retry",
      "restoreTrash",
    );
  }

  async read(projectId: string, trashId: string) {
    const item = await this.prisma.projectFileTrashItem.findFirst({
      where: { projectId, id: trashId },
      include: { recoveries: { orderBy: { createdAt: "asc" } } },
    });
    if (!item)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Recoverable trash item not found",
        "restoreTrash",
      );
    return {
      id: item.id,
      projectId: item.projectId,
      originalPath: item.originalPath,
      status: item.status,
      expiresAt: item.expiresAt,
      restoredAt: item.restoredAt,
      purgedAt: item.purgedAt,
      nextAction:
        (item.recoveryToken ||
          item.leaseOwner ||
          item.leaseExpiresAt ||
          item.status === "PURGE_FAILED") &&
        !["RESTORED", "PURGED"].includes(item.status)
          ? "REVIEW_OUTCOME"
          : "NONE",
      executions: item.recoveries.map((execution) => ({
        id: execution.id,
        action: execution.action,
        state: execution.state,
        errorCode: execution.errorCode,
        createdAt: execution.createdAt,
        finishedAt: execution.finishedAt,
      })),
    };
  }

  private async claim(item: ProjectFileTrashItem, action: "RESTORE" | "PURGE") {
    const id = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Evaluate retention after lock acquisition, not before an arbitrary
        // row-lock wait that may cross the expiry boundary.
        await tx.$queryRaw`SELECT "id" FROM "ProjectFileTrashItem" WHERE "id" = ${item.id} AND "projectId" = ${item.projectId} FOR UPDATE`;
        const claimed = await tx.projectFileTrashItem.updateMany({
          where: {
            id: item.id,
            projectId: item.projectId,
            status: "ACTIVE",
            recoveryToken: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            expiresAt:
              action === "RESTORE" ? { gt: new Date() } : { lte: new Date() },
          },
          data: { recoveryToken: id },
        });
        if (!claimed.count) return null;
        await tx.projectFileTrashRecovery.create({
          data: { id, trashId: item.id, action },
        });
        return id;
      });
    } catch {
      // The transaction may have committed; no filesystem call follows a lost ack.
      throw operationError(
        503,
        "FILE_TRASH_OUTCOME_UNKNOWN",
        "Claim outcome requires trash item readback",
        "restoreTrash",
      );
    }
  }

  private async finish(
    item: ProjectFileTrashItem,
    id: string,
    state: "RESTORED" | "PURGED" | "REJECTED",
    errorCode?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectFileTrashItem.updateMany({
        where: { id: item.id, recoveryToken: id, status: "ACTIVE" },
        data:
          state === "REJECTED"
            ? { recoveryToken: null }
            : {
                status: state,
                ...(state === "RESTORED"
                  ? { restoredAt: new Date() }
                  : { purgedAt: new Date() }),
              },
      });
      if (result.count !== 1) throw new Error("Trash claim changed");
      await tx.projectFileTrashRecovery.update({
        where: { id },
        data: { state, errorCode, finishedAt: new Date() },
      });
    });
  }

  private async retainUnknown(id: string) {
    await this.prisma.projectFileTrashRecovery
      .updateMany({
        where: { id, state: "STARTED" },
        data: {
          state: "UNKNOWN",
          errorCode: "FILE_TRASH_OUTCOME_UNKNOWN",
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined); // STARTED plus its durable claim is already a fence.
  }

  async restore(item: ProjectFileTrashItem, source: string, target: string) {
    if (item.recoveryToken || item.leaseOwner || item.leaseExpiresAt)
      throw this.unknown();
    if (item.status !== "ACTIVE" || item.expiresAt <= new Date())
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Recoverable trash item not found",
        "restoreTrash",
      );
    // Node rename is never a publication primitive. Directory support is vetted
    // separately before the durable claim; regular-file handling is unchanged.
    if (!item.isDirectory && !["linux", "win32"].includes(process.platform))
      throw operationError(
        409,
        "FILE_RESTORE_UNSUPPORTED",
        "Atomic no-overwrite publication is unavailable for this item",
        "restoreTrash",
      );
    if (item.isDirectory) await this.directory.prepare(source, target);
    const evidence = await fileEvidence(source);
    if (evidence.isDirectory !== item.isDirectory)
      throw operationError(
        409,
        "FILE_RESTORE_UNSUPPORTED",
        "Atomic no-overwrite publication is unavailable for this item",
        "restoreTrash",
      );
    const id = await this.claim(item, "RESTORE");
    if (!id) throw this.unknown();
    try {
      await this.prisma.projectFileTrashRecovery.update({
        where: { id },
        data: { sourceIdentity: evidence.identity, contentHash: evidence.hash },
      });
      try {
        // Directories use vetted no-overwrite MoveFileW; regular files retain
        // link(2)/CreateHardLink. Neither path has a copy/replace fallback.
        if (item.isDirectory) await this.directory.move(source, target);
        else await fs.link(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          await this.finish(item, id, "REJECTED", "FILE_RESTORE_COLLISION");
          throw operationError(
            409,
            "FILE_RESTORE_COLLISION",
            "A file or folder already exists at the restore path",
            "restoreTrash",
          );
        }
        throw error;
      }
      const published = await fileEvidence(target);
      if (
        published.identity !== evidence.identity ||
        published.hash !== evidence.hash
      )
        throw new Error("Published identity changed");
      // File links retain their private alias. A successful directory move consumes
      // the source name; never compensate by deleting/moving either name on doubt.
      await this.finish(item, id, "RESTORED");
      return { restored: true as const, path: item.originalPath };
    } catch (error) {
      await this.retainUnknown(id);
      if (
        error instanceof HttpException &&
        (error.getResponse() as { code?: string })?.code ===
          "FILE_RESTORE_COLLISION"
      )
        throw error;
      throw operationError(
        503,
        "FILE_TRASH_OUTCOME_UNKNOWN",
        "Restore outcome requires trash item readback; do not replay",
        "restoreTrash",
      );
    }
  }

  async purge(item: ProjectFileTrashItem, source: () => Promise<string>) {
    const id = await this.claim(item, "PURGE");
    if (!id) return;
    try {
      await fs.rm(await source(), { recursive: true, force: true });
      await this.finish(item, id, "PURGED");
    } catch {
      await this.retainUnknown(id);
      // Partial removal or failed completion is never retried by an expiry timer.
    }
  }
}
