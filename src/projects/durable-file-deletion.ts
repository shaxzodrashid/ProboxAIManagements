import { Prisma, ProjectFileOperation } from "@prisma/client";
import { promises as fs, createReadStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import * as path from "node:path";
import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { operationError } from "../openapi/operation-errors";

type Paths = { source: () => Promise<string>; trash: () => Promise<string> };
export async function fileEvidence(target: string) {
  const root = await fs.lstat(target, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT")
      throw operationError(
        404,
        "FILE_NOT_FOUND",
        "File or folder not found",
        "inspectFile",
      );
    throw error;
  });
  const identity = `${root.dev}:${root.ino}:${root.birthtimeNs}:${root.isDirectory() ? "d" : "f"}`;
  const hash = createHash("sha256");
  const extensions = new Set<string>();
  async function visit(current: string, relative: string) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw operationError(
        400,
        "FILE_KIND_UNSUPPORTED",
        "Only regular files and directories are supported",
        "inspectFile",
      );
    hash.update(
      JSON.stringify([relative, stat.isDirectory() ? "d" : "f"]) + "\n",
    );
    if (stat.isDirectory()) {
      for (const child of (await fs.readdir(current)).sort())
        await visit(
          path.join(current, child),
          path.posix.join(relative, child),
        );
    } else {
      const name = path.basename(current).toLowerCase();
      extensions.add(
        name.startsWith(".") && !name.slice(1).includes(".")
          ? name
          : path.extname(name),
      );
      const bytes = createHash("sha256");
      for await (const chunk of createReadStream(current)) bytes.update(chunk);
      hash.update(bytes.digest("hex") + "\n");
    }
  }
  await visit(target, "");
  const after = await fs.lstat(target, { bigint: true });
  if (
    root.dev !== after.dev ||
    root.ino !== after.ino ||
    root.birthtimeNs !== after.birthtimeNs
  )
    throw operationError(
      409,
      "FILE_IDENTITY_CHANGED",
      "File identity changed during inspection",
      "inspectFile",
    );
  return {
    identity,
    extensions,
    hash: hash.digest("hex"),
    isDirectory: root.isDirectory(),
  };
}
export function fileOperationResponse(op: ProjectFileOperation) {
  return {
    id: op.id,
    projectId: op.projectId,
    kind: "DELETE" as const,
    path: op.originalPath,
    state: op.state,
    result: op.result,
    errorCode: op.errorCode,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
  };
}
function unresolved(op: ProjectFileOperation) {
  return new ConflictException({
    statusCode: 409,
    error: "Conflict",
    code:
      op.state === "FAILED"
        ? "FILE_OPERATION_FAILED"
        : "FILE_OPERATION_UNRESOLVED",
    message:
      "Read and reconcile this operation; do not replay the path with a new identity",
    operationId: op.id,
    action: "deleteFile",
  });
}
function comparisonPath(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
const activeStates = ["PREPARED", "NEEDS_REPAIR", "AWAITING_CONFIRMATION"];
/** Legacy mixed-case UUID rows remain readable; ambiguous aliases fail closed. */
export async function findFileOperation(
  database: Prisma.TransactionClient | PrismaService,
  projectId: string,
  id: string,
) {
  const rows = await database.projectFileOperation.findMany({
    where: { projectId, id: { equals: id.toLowerCase(), mode: "insensitive" } },
    take: 2,
  });
  if (rows.length > 1)
    throw operationError(
      409,
      "FILE_OPERATION_ID_REUSED",
      "Operation identity has ambiguous legacy records; reconcile before retry",
      "deleteFile",
      "operationId",
    );
  return rows[0] ?? null;
}
function assertOperationIdentity(
  op: ProjectFileOperation,
  originalPath: string,
  actorId: string,
) {
  if (op.originalPath !== originalPath || op.actorId !== actorId)
    throw operationError(
      409,
      "FILE_OPERATION_ID_REUSED",
      "Operation identity belongs to a different request",
      "deleteFile",
      "operationId",
    );
}
export class DurableFileDeletion {
  constructor(private readonly prisma: PrismaService) {}
  async prior(
    projectId: string,
    id: string,
    originalPath: string,
    actorId: string,
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id ?? "",
      )
    )
      throw operationError(
        400,
        "FILE_OPERATION_ID_REQUIRED",
        "A client-generated UUID operationId is required",
        "deleteFile",
        "operationId",
      );
    const op = await findFileOperation(this.prisma, projectId, id);
    if (op) assertOperationIdentity(op, originalPath, actorId);
    return op;
  }
  result(op: ProjectFileOperation) {
    if (op.state === "COMPLETED" || op.state === "AWAITING_CONFIRMATION")
      return op.result;
    throw unresolved(op);
  }
  async prepare(
    projectId: string,
    actorId: string,
    originalPath: string,
    id: string,
    paths: Paths,
    protectedExtensions: Set<string>,
  ) {
    const prior = await this.prior(projectId, id, originalPath, actorId);
    if (prior) return { op: prior, created: false };
    id = id.toLowerCase();
    const evidence = await fileEvidence(await paths.source());
    const protectedFingerprint = [...evidence.extensions].some((extension) =>
      protectedExtensions.has(extension),
    )
      ? evidence.hash
      : undefined;
    const op = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      const existing = await findFileOperation(tx, projectId, id);
      if (existing) {
        assertOperationIdentity(existing, originalPath, actorId);
        return { op: existing, created: false };
      }
      const busy = await tx.projectFileOperation.findMany({
        where: { projectId, state: { in: activeStates } },
      });
      if (
        busy.some(
          (other) =>
            other.sourceIdentity === evidence.identity ||
            comparisonPath(other.originalPath) ===
              comparisonPath(originalPath) ||
            comparisonPath(other.originalPath).startsWith(
              comparisonPath(originalPath) + "/",
            ) ||
            comparisonPath(originalPath).startsWith(
              comparisonPath(other.originalPath) + "/",
            ),
        )
      )
        throw operationError(
          409,
          "FILE_PATH_BUSY",
          "An unresolved deletion overlaps this path; reconcile it first",
          "deleteFile",
          "path",
        );
      let confirmationId: string | undefined;
      let trashId: string | undefined;
      let result: Prisma.InputJsonValue | undefined;
      if (protectedFingerprint) {
        const confirmation = await tx.projectFileDeletionConfirmation.create({
          data: {
            projectId,
            targetPath: originalPath,
            fingerprint: protectedFingerprint,
            requestedById: actorId,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
        confirmationId = confirmation.id;
        result = {
          confirmationRequired: true,
          confirmationId,
          operationId: id,
          expiresAt: confirmation.expiresAt.toISOString(),
        };
      } else {
        trashId = (
          await tx.projectFileTrashItem.create({
            data: {
              projectId,
              originalPath,
              trashPath: randomBytes(16).toString("hex"),
              isDirectory: evidence.isDirectory,
              deletedById: actorId,
              status: "PREPARED",
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
            },
          })
        ).id;
      }
      return {
        created: true,
        op: await tx.projectFileOperation.create({
          data: {
            id,
            projectId,
            actorId,
            originalPath,
            executionTracked: true,
            sourceIdentity: evidence.identity,
            contentHash: evidence.hash,
            isDirectory: evidence.isDirectory,
            state: protectedFingerprint ? "AWAITING_CONFIRMATION" : "PREPARED",
            confirmationId,
            trashId,
            result,
          },
        }),
      };
    });
    if (op.op.originalPath !== originalPath || op.op.actorId !== actorId)
      throw operationError(
        409,
        "FILE_OPERATION_ID_REUSED",
        "Operation identity belongs to a different request",
        "deleteFile",
        "operationId",
      );
    return op;
  }
  async rejectConfirmation(op: ProjectFileOperation, code: string) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.projectFileOperation.updateMany({
        where: {
          projectId: op.projectId,
          id: op.id,
          state: "AWAITING_CONFIRMATION",
        },
        data: { state: "FAILED", errorCode: code },
      });
      if (claimed.count)
        await tx.projectFileDeletionConfirmation.update({
          where: { id: op.confirmationId! },
          data: { status: "EXPIRED" },
        });
    });
  }
  async claimConfirmation(op: ProjectFileOperation, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.projectFileOperation.updateMany({
        where: {
          projectId: op.projectId,
          id: op.id,
          state: "AWAITING_CONFIRMATION",
        },
        data: { state: "PREPARED" },
      });
      if (!claimed.count)
        return {
          created: false,
          op: await tx.projectFileOperation.findUniqueOrThrow({
            where: { projectId_id: { projectId: op.projectId, id: op.id } },
          }),
        };
      const trash = await tx.projectFileTrashItem.create({
        data: {
          projectId: op.projectId,
          originalPath: op.originalPath,
          trashPath: randomBytes(16).toString("hex"),
          isDirectory: op.isDirectory,
          deletedById: actorId,
          status: "PREPARED",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        },
      });
      return {
        created: true,
        op: await tx.projectFileOperation.update({
          where: { projectId_id: { projectId: op.projectId, id: op.id } },
          data: { trashId: trash.id },
        }),
      };
    });
  }
  async execute(op: ProjectFileOperation, paths: Paths) {
    // CAS commits ownership before any asynchronous filesystem action.
    const claimed = await this.prisma.projectFileOperation.updateMany({
      where: {
        projectId: op.projectId,
        id: op.id,
        state: "PREPARED",
        executionTracked: true,
        executionStartedAt: null,
      },
      data: { executionStartedAt: new Date() },
    });
    if (!claimed.count) throw unresolved(op);
    let entered = false;
    let finished!: () => void;
    const filesystemSettled = new Promise<void>((resolve) => {
      finished = resolve;
    });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          entered = true;
          try {
            await tx.$queryRaw`SELECT "id" FROM "ProjectFileOperation" WHERE "projectId" = ${op.projectId} AND "id" = ${op.id} FOR UPDATE`;
            op = await tx.projectFileOperation.findUniqueOrThrow({
              where: { projectId_id: { projectId: op.projectId, id: op.id } },
            });
            if (op.state !== "PREPARED") return this.result(op);
            const source = await paths.source();
            const current = await fileEvidence(source);
            if (
              current.identity !== op.sourceIdentity ||
              current.hash !== op.contentHash
            )
              throw operationError(
                409,
                "FILE_IDENTITY_CHANGED",
                "File changed before deletion; reconcile the operation",
                "deleteFile",
              );
            const trash = await tx.projectFileTrashItem.findUniqueOrThrow({
              where: { id: op.trashId! },
            });
            const directory = await paths.trash();
            await fs.mkdir(directory, { recursive: true });
            // The private key was durably recorded before rename. Never compensate onto the live path.
            const destination = path.join(directory, trash.trashPath);
            try {
              await fs.lstat(destination);
              throw new Error("Private destination occupied");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            // Reject an expired interactive transaction before issuing a filesystem call.
            await tx.projectFileOperation.findUniqueOrThrow({
              where: { projectId_id: { projectId: op.projectId, id: op.id } },
            });
            await fs.rename(source, destination);
            const moved = await fileEvidence(destination);
            if (
              moved.identity !== op.sourceIdentity ||
              moved.hash !== op.contentHash
            )
              throw new Error("Moved identity requires repair");
            return await this.complete(op, trash.expiresAt, tx);
          } finally {
            finished();
          }
        },
        { timeout: 60000 },
      );
    } catch {
      // PREPARED itself remains observable even if the acknowledgement/state update fails.
      throw operationError(
        503,
        "FILE_OPERATION_UNRESOLVED",
        "Deletion outcome requires operation readback and reconciliation",
        "deleteFile",
      );
    } finally {
      // A transaction timeout alone is not completion proof. Wait for its callback.
      if (entered) {
        await filesystemSettled;
        await this.prisma.projectFileOperation
          .updateMany({
            where: {
              projectId: op.projectId,
              id: op.id,
              executionTracked: true,
            },
            data: { executionFinishedAt: new Date() },
          })
          .catch(() => undefined); // Failed proof persistence retains the fence.
      }
    }
  }
  private async complete(
    op: ProjectFileOperation,
    expiresAt: Date,
    tx: Prisma.TransactionClient,
  ) {
    const claimed = await tx.projectFileOperation.updateMany({
      where: {
        projectId: op.projectId,
        id: op.id,
        state: { in: ["PREPARED", "NEEDS_REPAIR"] },
      },
      data: { state: "COMPLETED", errorCode: null },
    });
    if (!claimed.count)
      return (
        await tx.projectFileOperation.findUniqueOrThrow({
          where: { projectId_id: { projectId: op.projectId, id: op.id } },
        })
      ).result;
    const result = {
      trashed: true,
      trashId: op.trashId!,
      operationId: op.id,
      path: op.originalPath,
      expiresAt: expiresAt.toISOString(),
    };
    await tx.projectFileTrashItem.update({
      where: { id: op.trashId! },
      data: { status: "ACTIVE" },
    });
    if (op.confirmationId)
      await tx.projectFileDeletionConfirmation.update({
        where: { id: op.confirmationId },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
    await tx.projectFileOperation.update({
      where: { projectId_id: { projectId: op.projectId, id: op.id } },
      data: { result },
    });
    return result;
  }
  async reconcile(op: ProjectFileOperation, paths: Paths) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ProjectFileOperation" WHERE "projectId" = ${op.projectId} AND "id" = ${op.id} FOR UPDATE`;
        op = await tx.projectFileOperation.findUniqueOrThrow({
          where: { projectId_id: { projectId: op.projectId, id: op.id } },
        });
        if (op.state === "COMPLETED" || op.state === "FAILED")
          return fileOperationResponse(op);
        if (op.state === "AWAITING_CONFIRMATION") {
          const confirmation =
            await tx.projectFileDeletionConfirmation.findUnique({
              where: { id: op.confirmationId! },
            });
          if (confirmation && confirmation.expiresAt > new Date())
            return fileOperationResponse(op);
          return fileOperationResponse(
            await tx.projectFileOperation.update({
              where: { projectId_id: { projectId: op.projectId, id: op.id } },
              data: { state: "FAILED", errorCode: "FILE_CONFIRMATION_EXPIRED" },
            }),
          );
        }
        const trash = await tx.projectFileTrashItem.findUnique({
          where: { id: op.trashId! },
        });
        const destination = trash
          ? path.join(await paths.trash(), trash.trashPath)
          : undefined;
        let privateEvidence:
          Awaited<ReturnType<typeof fileEvidence>> | undefined;

        try {
          if (destination) privateEvidence = await fileEvidence(destination);
        } catch (error) {
          void error; // An absent destination cannot prove a timed-out executor stopped.
        }
        if (
          privateEvidence?.identity === op.sourceIdentity &&
          privateEvidence.hash === op.contentHash &&
          trash
        ) {
          await this.complete(op, trash.expiresAt, tx);
        } else {
          let noMove = false;
          if (
            op.executionTracked &&
            (!op.executionStartedAt || op.executionFinishedAt) &&
            destination
          ) {
            try {
              await fs.lstat(destination);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                try {
                  const original = await fileEvidence(await paths.source());
                  noMove =
                    original.identity === op.sourceIdentity &&
                    original.hash === op.contentHash;
                } catch {
                  /* An unverifiable source remains fenced. */
                }
              }
            }
          }
          {
            const claimed = await tx.projectFileOperation.updateMany({
              where: {
                projectId: op.projectId,
                id: op.id,
                state: { in: ["PREPARED", "NEEDS_REPAIR"] },
              },
              data: {
                state: noMove ? "FAILED" : "NEEDS_REPAIR",
                errorCode: noMove
                  ? "FILE_NOT_MOVED"
                  : "FILE_IDENTITY_UNRESOLVED",
              },
            });
            if (claimed.count && trash)
              await tx.projectFileTrashItem.update({
                where: { id: trash.id },
                data: { status: noMove ? "FAILED" : "NEEDS_REPAIR" },
              });
          }
        }
        return fileOperationResponse(
          await tx.projectFileOperation.findUniqueOrThrow({
            where: { projectId_id: { projectId: op.projectId, id: op.id } },
          }),
        );
      },
      { timeout: 60000 },
    );
  }
}
