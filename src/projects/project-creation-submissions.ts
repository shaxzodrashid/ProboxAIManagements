import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, ProjectCreationSubmission } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import * as path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { assertCurrentManagement } from "../prisma/current-management";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  WorkspacePathPolicy,
  isWithin,
} from "../storage/workspace-path-policy.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { SubmitProjectCreationDto } from "./project-creation-submission.dto";

export type CreationExecution = {
  submission: ProjectCreationSubmission;
  callbackSettled: () => void;
};
export function creationTarget(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved
        .split(path.sep)
        .map((s) => s.replace(/[ .]+$/, ""))
        .join(path.sep)
        .toLowerCase()
    : resolved;
}
export async function assertCreationNamespace(
  tx: Prisma.TransactionClient,
  target: string,
  action?: string,
) {
  const registered = await tx.project.findMany({
    select: { directoryName: true, department: { select: { homePath: true } } },
  });
  const key = creationTarget(target);
  if (
    registered.some((p) => {
      const other = creationTarget(
        path.join(p.department.homePath, p.directoryName),
      );
      return other === key || (action === "CLEAR" && isWithin(key, other));
    })
  )
    throw new ConflictException(
      "Project directory overlaps existing managed project data",
    );
}
/** All project creation paths share this operation-specific exclusion; external writers are not controlled. */
export async function lockCreationTarget(
  tx: Prisma.TransactionClient,
  target: string,
  request?: { workspaceId: string; requestId: string },
) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('project-creation-namespace', 0))`;
  const unfinished = await tx.projectCreationSubmission.findMany({
    where: { state: "UNRESOLVED", executionFinishedAt: null },
    select: { workspaceId: true, requestId: true, targetPath: true },
  });
  const key = creationTarget(target);
  if (
    unfinished.some(
      (s) =>
        !(
          s.workspaceId === request?.workspaceId &&
          s.requestId === request?.requestId
        ) &&
        (isWithin(creationTarget(s.targetPath), key) ||
          isWithin(key, creationTarget(s.targetPath))),
    )
  )
    throw new ConflictException({
      code: "PROJECT_CREATION_UNRESOLVED",
      message:
        "An overlapping creation outcome is unresolved; inspect its known submission before new work",
    });
}
export function creationOutcome(s: ProjectCreationSubmission) {
  return {
    requestId: s.requestId,
    state: s.state,
    projectId: s.projectId,
    initializationId: s.initializationId,
    departmentId: s.departmentId,
    templateVersionId: s.templateVersionId,
    failureCode: s.failureCode,
    executionFinished: !!s.executionFinishedAt,
    willReplay: false,
    createdAt: s.createdAt,
  };
}
export class ProjectCreationSubmissions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paths: WorkspacePathPolicy,
  ) {}
  async read(actor: AuthenticatedUser, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertCurrentManagement(
        tx,
        actor.workspaceId,
        actor.id,
        "projects.create",
      );
      const s = await tx.projectCreationSubmission.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: actor.workspaceId,
            requestId: requestId.toLowerCase(),
          },
        },
      });
      if (!s || s.actorId !== actor.id)
        throw new NotFoundException("Creation submission not found");
      return creationOutcome(s);
    });
  }
  async submit(
    actor: AuthenticatedUser,
    dto: SubmitProjectCreationDto,
    execute: (context: CreationExecution) => Promise<unknown>,
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        dto.requestId,
      )
    )
      throw new BadRequestException("UUIDv4 submission identity required");
    const requestId = dto.requestId.toLowerCase();
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          readAccessEnabled: dto.readAccessEnabled ?? false,
          departmentId: dto.departmentId ?? null,
          configurationTemplateId: dto.configurationTemplateId ?? null,
          existingDirectoryAction: dto.existingDirectoryAction ?? null,
        }),
      )
      .digest("hex");
    let reservation: {
      created: boolean;
      submission: ProjectCreationSubmission;
    };
    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, actor.workspaceId);
        await assertCurrentManagement(
          tx,
          actor.workspaceId,
          actor.id,
          "projects.create",
        );
        const prior = await tx.projectCreationSubmission.findUnique({
          where: {
            workspaceId_requestId: {
              workspaceId: actor.workspaceId,
              requestId,
            },
          },
        });
        if (prior) {
          if (prior.actorId !== actor.id)
            throw new NotFoundException("Creation submission not found");
          if (prior.inputHash !== hash)
            throw new ConflictException({
              code: "PROJECT_CREATION_ID_REUSED",
              message: "Submission identity is bound to different inputs",
            });
          return { created: false, submission: prior };
        }
        const department = await tx.department.findFirst({
          where: {
            workspaceId: actor.workspaceId,
            ...(dto.departmentId
              ? { id: dto.departmentId }
              : { isDefault: true, status: "ACTIVE" }),
          },
        });
        if (!department)
          throw new ConflictException(
            "Selected or active default department not found",
          );
        if (department.status !== "ACTIVE")
          throw new ConflictException(
            "Projects cannot be created in an archived department",
          );
        const name = dto.name.trim();
        if (
          !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/.test(name) ||
          (process.platform === "win32" && /[ .]$/.test(name))
        )
          throw new BadRequestException("Invalid project name");
        const targetPath = path.join(
          this.paths.validateDepartmentHome(department.homePath),
          name,
        );
        await lockCreationTarget(tx, targetPath);
        await assertCreationNamespace(
          tx,
          targetPath,
          dto.existingDirectoryAction,
        );
        const version = dto.configurationTemplateId
          ? await tx.configurationTemplateVersion.findFirst({
              where: {
                templateId: dto.configurationTemplateId,
                status: "PUBLISHED",
                template: {
                  workspaceId: actor.workspaceId,
                  departmentId: department.id,
                  status: "ACTIVE",
                },
              },
              orderBy: { version: "desc" },
              select: { id: true },
            })
          : null;
        if (dto.configurationTemplateId && !version)
          throw new ConflictException(
            "The selected department has no matching published template",
          );
        const submission = await tx.projectCreationSubmission.create({
          data: {
            workspaceId: actor.workspaceId,
            requestId,
            actorId: actor.id,
            inputHash: hash,
            departmentId: department.id,
            templateVersionId: version?.id ?? null,
            targetPath,
            executorId: randomUUID(),
          },
        });
        return { created: true, submission };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: "PROJECT_CREATION_OUTCOME_UNKNOWN",
        message:
          "Read the same submission identity; do not automatically repeat creation",
        requestId,
      });
    }
    if (!reservation.created) return creationOutcome(reservation.submission);
    let settle!: () => void;
    const callbackDone = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const s = reservation.submission;
    try {
      await execute({ submission: s, callbackSettled: settle });
    } catch (error) {
      const body = error instanceof HttpException ? error.getResponse() : null;
      const failureCode =
        body &&
        typeof body === "object" &&
        "code" in body &&
        body.code === "PROJECT_DIRECTORY_EXISTS"
          ? "PROJECT_DIRECTORY_EXISTS"
          : error instanceof HttpException && error.getStatus() < 500
            ? "CREATE_REJECTED"
            : "CREATION_OUTCOME_UNKNOWN";
      await this.prisma.projectCreationSubmission
        .updateMany({
          where: {
            workspaceId: s.workspaceId,
            requestId: s.requestId,
            executorId: s.executorId,
            state: "UNRESOLVED",
          },
          data: { failureCode },
        })
        .catch(() => undefined);
    }
    // Outer transaction outcome has settled, but its callback may outlive a timeout.
    // No new execution can begin until every callback await has actually settled.
    void callbackDone
      .then(() =>
        this.prisma.projectCreationSubmission.updateMany({
          where: {
            workspaceId: s.workspaceId,
            requestId: s.requestId,
            executorId: s.executorId,
          },
          data: { executionFinishedAt: new Date() },
        }),
      )
      .catch(() => undefined);
    return this.read(actor, requestId);
  }
}
