import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { assertCurrentManagement } from "../prisma/current-management";
import { lockWorkspace } from "../prisma/workspace-lock";
import { lockProjectLifecycle } from "./project-lifecycle-lock";

@Injectable()
export class ProjectArchiveService {
  constructor(private readonly prisma: PrismaService) {}
  async archive(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
    expectedRevision: number,
  ) {
    projectId = projectId.toLowerCase();
    requestId = requestId.toLowerCase();
    return this.prisma.$transaction(
      async (tx) => {
        await lockProjectLifecycle(tx, projectId);
        await lockWorkspace(tx, actor.workspaceId);
        await assertCurrentManagement(
          tx,
          actor.workspaceId,
          actor.id,
          Permissions.PROJECTS_ARCHIVE,
        );
        const project = await tx.project.findFirst({
          where: { id: projectId, workspaceId: actor.workspaceId },
        });
        if (!project) throw new NotFoundException("Project not found");
        if (project.creatorId !== actor.id)
          throw new ForbiddenException("Only the project owner may archive it");
        const prior = await tx.projectArchiveOperation.findUnique({
          where: { projectId_requestId: { projectId, requestId } },
        });
        if (prior) {
          if (
            prior.actorId !== actor.id ||
            prior.revision !== expectedRevision + 1
          )
            throw new ConflictException("Archive request identity was reused");
          return prior;
        }
        if (project.archiveRevision !== expectedRevision)
          throw new ConflictException(
            "Project archive revision changed; reread before retrying",
          );
        if (project.archivedAt)
          throw new ConflictException("Project is already archived");
        if (expectedRevision >= 2147483647)
          throw new ConflictException(
            "Project archive revision cannot advance",
          );
        if (
          await tx.projectLifecycleExecution.count({
            where: { projectId, finishedAt: null },
          })
        )
          throw new ConflictException(
            "Project filesystem execution has not been proven settled",
          );
        if (project.status === "INITIALIZING" || project.status === "DELETING")
          throw new ConflictException(
            "Project lifecycle work must finish before archival",
          );
        if (
          await tx.projectInitialization.count({
            where: {
              projectId,
              OR: [
                {
                  status: { in: ["QUEUED", "RUNNING", "CANCELLED", "FAILED"] },
                },
                { leaseOwner: { not: null } },
              ],
            },
          })
        )
          throw new ConflictException(
            "Project initialization must finish before archival",
          );
        if (
          await tx.projectDeletionRequest.count({
            where: {
              projectId,
              status: {
                in: [
                  "PENDING_OWNER_APPROVAL",
                  "AWAITING_ACTIVE_SESSIONS",
                  "AWAITING_TOKEN",
                  "DELETING",
                ],
              },
            },
          })
        )
          throw new ConflictException(
            "Cancel the pending deletion request before archival",
          );
        // Existing sessions may have legacy cwd-only context. Avoid inferring a
        // project relationship: conservatively wait for all workspace execution.
        if (
          await tx.proboxAiSession.count({
            where: {
              workspaceId: actor.workspaceId,
              OR: [
                { status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
                { stopConfirmation: "STOP_UNCONFIRMED" },
                { runOwner: { not: null } },
              ],
            },
          })
        )
          throw new ConflictException(
            "Workspace execution must stop before archival; legacy context is uncertain",
          );
        if (
          await tx.projectFileOperation.count({
            where: {
              projectId,
              state: {
                in: ["PREPARED", "NEEDS_REPAIR", "AWAITING_CONFIRMATION"],
              },
            },
          })
        )
          throw new ConflictException(
            "Resolve pending file operations before archival",
          );
        const archivedAt = new Date();
        const revision = expectedRevision + 1;
        await tx.project.update({
          where: { id: projectId },
          data: { archivedAt, archiveRevision: revision },
        });
        return tx.projectArchiveOperation.create({
          data: {
            projectId,
            requestId,
            actorId: actor.id,
            revision,
            archivedAt,
          },
        });
      },
      { timeout: 120000, maxWait: 10000 },
    );
  }
}
