import {
  deletionRequestResponse,
  deletionAuditResponse,
} from "./project-deletion-contracts";
import {
  DurableFileDeletion,
  fileEvidence,
  fileOperationResponse,
  findFileOperation,
} from "./durable-file-deletion";
import { assertCurrentManagement } from "../prisma/current-management";
import { lockWorkspace } from "../prisma/workspace-lock";
import {
  ActiveProjectMutation,
  lockProjectLifecycle,
  fencedProjectFilesystem,
  currentProjectExecutionId,
} from "./project-lifecycle-lock";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  ConfigurationTemplateVersionStatus,
  DepartmentStatus,
  ProjectStatus,
  ProjectFileTrashStatus,
  ProjectDeletionRequestStatus,
  SessionStatus,
} from "@prisma/client";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateProjectDto,
  ExistingProjectDirectoryAction,
  UpdateProjectDto,
} from "./projects.dto";
import { DepartmentsService } from "../departments/departments.service";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";
import { ProjectInitializationService } from "./project-initialization.service";
import { TelegramService } from "../telegram/telegram.service";
import { SessionsService } from "../sessions/sessions.service";
import { ProboxAiRunner } from "../sessions/proboxai-runner.service";
import { configuredUploadLimit } from "../storage/upload-limits";
import {
  ProjectCreationSubmissions,
  CreationExecution,
  lockCreationTarget,
  creationTarget,
  assertCreationNamespace,
} from "./project-creation-submissions";
import { SubmitProjectCreationDto } from "./project-creation-submission.dto";
import {
  hasPermission,
  Permissions,
  SystemRoleKeys,
} from "../authorization/permission.catalog";

type UploadedProjectFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
};

import { projectInitializationSummarySelect } from "./project-initialization-summary";
const projectMemberUserSelect = {
  id: true,
  fullName: true,
  roleAssignments: {
    select: { role: { select: { id: true, key: true, name: true } } },
    orderBy: { role: { name: "asc" as const } },
  },
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: DepartmentsService,
    private readonly pathPolicy: WorkspacePathPolicy,
    private readonly initializations: ProjectInitializationService,
    private readonly telegram?: TelegramService,
    private readonly runner?: ProboxAiRunner,
    @Optional() private readonly sessions?: SessionsService,
  ) {}

  onModuleInit() {
    void this.cleanupExpiredTrash().catch(() => undefined);
    const timer = setInterval(
      () => void this.cleanupExpiredTrash().catch(() => undefined),
      60 * 60_000,
    );
    timer.unref();
  }

  static maxUploadBytes() {
    return configuredUploadLimit(
      "PROBOXAI_PROJECT_UPLOAD_MAX_BYTES",
      100 * 1024 * 1024,
    );
  }

  async uploadConfiguration(actor: AuthenticatedUser, projectId: string) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    return {
      maxUploadBytes: ProjectsService.maxUploadBytes(),
      requestMode: "single-file" as const,
    };
  }

  async getProjectsHome(workspaceId: string) {
    const department = await this.departments.defaultForWorkspace(workspaceId);
    return {
      path: department.homePath,
      configured: true,
      departmentId: department.id,
      revision: department.revision,
    };
  }

  async taskDirectory(actor: AuthenticatedUser, projectId: string) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const directory = await this.resolveProjectPath(project, "", true);
    return { project, directory };
  }

  async setProjectsHome(
    workspaceId: string,
    requestedPath: string,
    expectedRevision: number,
    departmentId: string,
  ) {
    const department = await this.departments.defaultForWorkspace(workspaceId);
    if (department.id !== departmentId)
      throw new ConflictException(
        "Default department changed; reread before retrying",
      );
    const updated = await this.departments.update(
      workspaceId,
      department.id,
      { homePath: requestedPath },
      expectedRevision,
      true,
    );
    // Department.homePath is authoritative. The deprecated Workspace field is no
    // longer mirrored in a separate write which could fail after the actual update.
    return {
      path: updated.homePath,
      configured: true,
      departmentId: updated.id,
      revision: updated.revision,
      created: updated.homeCreated,
    };
  }

  async list(
    actor: AuthenticatedUser,
    lifecycle: "active" | "archived" = "active",
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        actor = await this.currentProjectReader(actor, tx);
        const projects = await tx.project.findMany({
          where: {
            workspaceId: actor.workspaceId,
            archivedAt: lifecycle === "archived" ? { not: null } : null,
            ...(hasPermission(actor, Permissions.PROJECTS_READ_ALL)
              ? {}
              : {
                  OR: [
                    { readAccessEnabled: true },
                    { members: { some: { userId: actor.id } } },
                  ],
                }),
          },
          include: {
            creator: { select: { id: true, fullName: true } },
            department: { select: { id: true, name: true, slug: true } },
            initializations: {
              orderBy: { attempt: "desc" },
              take: 1,
              select: projectInitializationSummarySelect,
            },
            _count: { select: { members: true } },
            members: { where: { userId: actor.id }, select: { userId: true } },
          },
          orderBy: { updatedAt: "desc" },
        });
        return projects.map(({ members, ...project }) => ({
          ...project,
          isMember: members.length > 0,
        }));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async creationOutcome(actor: AuthenticatedUser, requestId: string) {
    return new ProjectCreationSubmissions(this.prisma, this.pathPolicy).read(
      actor,
      requestId,
    );
  }
  async submitCreation(
    actor: AuthenticatedUser,
    dto: SubmitProjectCreationDto,
  ) {
    return new ProjectCreationSubmissions(this.prisma, this.pathPolicy).submit(
      actor,
      dto,
      (context) =>
        this.create(
          actor,
          { ...dto, departmentId: context.submission.departmentId },
          context,
        ),
    );
  }
  private async commitCreationOutcome(
    tx: Prisma.TransactionClient,
    context: CreationExecution | undefined,
    projectId: string,
    initializationId: string | null,
  ) {
    if (!context) return;
    const s = context.submission;
    const updated = await tx.projectCreationSubmission.updateMany({
      where: {
        workspaceId: s.workspaceId,
        requestId: s.requestId,
        actorId: s.actorId,
        executorId: s.executorId,
        state: "UNRESOLVED",
        executionFinishedAt: null,
      },
      data: {
        state: "COMPLETED",
        projectId,
        initializationId,
        failureCode: null,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException(
        "Creation submission is no longer executable",
      );
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateProjectDto,
    context?: CreationExecution,
  ) {
    if (!context) {
      if (dto.existingDirectoryAction === "CLEAR")
        throw operationError(
          428,
          "PROJECT_CREATION_ID_REQUIRED",
          "CLEAR requires POST /projects/creation-submissions with a client-generated requestId; legacy creation cannot safely distinguish a retry",
          "createProject",
          "existingDirectoryAction",
        );
      let result: any;
      let failed: unknown;
      const outcome = await new ProjectCreationSubmissions(
        this.prisma,
        this.pathPolicy,
      ).submit(
        actor,
        { ...dto, requestId: randomUUID() },
        async (execution) => {
          try {
            result = await this.create(
              actor,
              { ...dto, departmentId: execution.submission.departmentId },
              execution,
            );
            return result;
          } catch (error) {
            failed = error;
            throw error;
          }
        },
      );
      if (failed) throw failed;
      if (outcome.state !== "COMPLETED" || !result)
        throw new ServiceUnavailableException(
          "Project creation outcome is unresolved",
        );
      return result;
    }
    let callbackEntered = false;
    try {
      const project = await this.prisma
        .$transaction(
          async (tx) => {
            callbackEntered = true;
            try {
              await lockWorkspace(tx, actor.workspaceId);
              await assertCurrentManagement(
                tx,
                actor.workspaceId,
                actor.id,
                Permissions.PROJECTS_CREATE,
              );
              const department = await tx.department.findFirst({
                where: {
                  workspaceId: actor.workspaceId,
                  ...(dto.departmentId
                    ? { id: dto.departmentId }
                    : { isDefault: true, status: DepartmentStatus.ACTIVE }),
                },
              });
              if (!department)
                throw new ConflictException(
                  "Selected or active default department not found",
                );
              if (department.status !== DepartmentStatus.ACTIVE)
                throw new ConflictException(
                  "Projects cannot be created in an archived department",
                );
              const directoryName = validateProjectDirectoryName(dto.name);
              const target = path.join(
                this.pathPolicy.validateDepartmentHome(department.homePath),
                directoryName,
              );
              await lockCreationTarget(tx, target, context?.submission);
              if (
                context &&
                creationTarget(target) !==
                  creationTarget(context.submission.targetPath)
              )
                throw new ConflictException(
                  "Selected project setup changed; inspect the submission before creating again",
                );
              if (context) {
                const s = await tx.projectCreationSubmission.findUnique({
                  where: {
                    workspaceId_requestId: {
                      workspaceId: context.submission.workspaceId,
                      requestId: context.submission.requestId,
                    },
                  },
                });
                if (
                  !s ||
                  s.executorId !== context.submission.executorId ||
                  s.state !== "UNRESOLVED" ||
                  s.executionFinishedAt
                )
                  throw new ConflictException(
                    "Creation submission is no longer executable",
                  );
              }
              const existing = await tx.project.findFirst({
                where: { departmentId: department.id, directoryName },
                select: { id: true },
              });
              if (existing)
                throw new ConflictException("A project with this name exists");
              await assertCreationNamespace(
                tx,
                target,
                dto.existingDirectoryAction,
              );

              const projectDirectory = await this.projectDirectoryForDepartment(
                department.id,
                directoryName,
              );
              const existingDirectory =
                await existingDirectoryStatus(projectDirectory);
              let templateVersion: { id: string } | null = null;
              if (dto.configurationTemplateId) {
                templateVersion =
                  await tx.configurationTemplateVersion.findFirst({
                    where: {
                      templateId: dto.configurationTemplateId,
                      ...(context?.submission.templateVersionId
                        ? { id: context.submission.templateVersionId }
                        : {}),
                      status: ConfigurationTemplateVersionStatus.PUBLISHED,
                      template: {
                        workspaceId: actor.workspaceId,
                        departmentId: department.id,
                        status: "ACTIVE",
                      },
                    },
                    select: { id: true },
                    orderBy: { version: "desc" },
                  });
                if (!templateVersion)
                  throw new ConflictException(
                    "The selected department has no matching published template",
                  );
              }
              await tx.$queryRaw`SELECT 1`; // Recheck transaction liveness before any CLEAR/write.
              await this.prepareExistingDirectory(
                projectDirectory,
                existingDirectory,
                dto.existingDirectoryAction,
                Boolean(templateVersion),
                async () => {
                  await tx.$queryRaw`SELECT 1`;
                },
              );
              if (templateVersion) {
                const project = await tx.project.create({
                  data: {
                    workspaceId: actor.workspaceId,
                    departmentId: department.id,
                    creatorId: actor.id,
                    name: dto.name.trim(),
                    directoryName,
                    description: dto.description?.trim() || null,
                    readAccessEnabled: dto.readAccessEnabled ?? false,
                    status: ProjectStatus.INITIALIZING,
                    appliedTemplateVersionId: templateVersion.id,
                    members: { create: { userId: actor.id } },
                  },
                  include: {
                    creator: { select: { id: true, fullName: true } },
                    department: {
                      select: { id: true, name: true, slug: true },
                    },
                    members: {
                      include: {
                        user: { select: projectMemberUserSelect },
                      },
                    },
                  },
                });
                const initialization = await tx.projectInitialization.create({
                  select: projectInitializationSummarySelect,
                  data: {
                    projectId: project.id,
                    templateVersionId: templateVersion.id,
                    attempt: 1,
                  },
                });
                await this.commitCreationOutcome(
                  tx,
                  context,
                  project.id,
                  initialization.id,
                );
                return { ...project, initializations: [initialization] };
              }
              try {
                await tx.$queryRaw`SELECT 1`;
                if (!existingDirectory) await fs.mkdir(projectDirectory);
              } catch (error) {
                throw filesystemError(
                  error,
                  "Unable to create the project directory",
                );
              }

              // If the database write fails, deliberately keep the empty directory for an
              // operator to inspect; deleting it could race with a concurrent writer.
              const project = await tx.project.create({
                data: {
                  workspaceId: actor.workspaceId,
                  departmentId: department.id,
                  creatorId: actor.id,
                  name: dto.name.trim(),
                  directoryName,
                  description: dto.description?.trim() || null,
                  readAccessEnabled: dto.readAccessEnabled ?? false,
                  status: ProjectStatus.READY,
                  members: { create: { userId: actor.id } },
                },
                include: {
                  creator: { select: { id: true, fullName: true } },
                  department: { select: { id: true, name: true, slug: true } },
                  members: {
                    include: {
                      user: { select: projectMemberUserSelect },
                    },
                  },
                },
              });
              await this.commitCreationOutcome(tx, context, project.id, null);
              return project;
            } finally {
              context?.callbackSettled();
            }
          },
          { timeout: 60000 },
        )
        .catch((error) => databaseOperationError(error, "createProject"));
      return mapProjectMembers(project);
    } finally {
      if (!callbackEntered) context?.callbackSettled();
    }
  }

  async get(actor: AuthenticatedUser, projectId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        actor = await this.currentProjectReader(actor, tx);
        const project = await tx.project.findFirst({
          where: { id: projectId, workspaceId: actor.workspaceId },
          include: {
            creator: { select: { id: true, fullName: true } },
            department: { select: { id: true, name: true, slug: true } },
            initializations: {
              orderBy: { attempt: "desc" },
              take: 1,
              select: projectInitializationSummarySelect,
            },
            members: {
              include: {
                user: { select: projectMemberUserSelect },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!project) throw new NotFoundException("Project not found");
        const isMember = project.members.some(
          (member) => member.userId === actor.id,
        );
        const sensitive =
          isMember || hasPermission(actor, Permissions.PROJECTS_READ_ALL);
        if (!sensitive && !project.readAccessEnabled)
          throw new ForbiddenException(
            "You do not have access to this project",
          );
        if (!sensitive) {
          const { members: _members, ...publicProject } = project;
          return { ...publicProject, isMember };
        }
        return { ...mapProjectMembers(project), isMember };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async currentProjectReader(
    actor: AuthenticatedUser,
    tx: Prisma.TransactionClient,
  ) {
    const current = await tx.user.findFirst({
      where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
      select: {
        roleAssignments: {
          select: {
            role: {
              select: { permissions: { select: { permissionKey: true } } },
            },
          },
        },
      },
    });
    const permissions =
      current?.roleAssignments.flatMap((assignment) =>
        assignment.role.permissions.map(
          (permission) => permission.permissionKey,
        ),
      ) ?? [];
    if (!current || !permissions.includes(Permissions.PROJECTS_READ))
      throw new ForbiddenException(
        "Project read access is no longer available",
      );
    return { ...actor, permissions };
  }

  @ActiveProjectMutation()
  async update(
    actor: AuthenticatedUser,
    projectId: string,
    dto: UpdateProjectDto,
  ) {
    await this.assertSensitiveAccess(actor, projectId);
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.readAccessEnabled !== undefined
          ? { readAccessEnabled: dto.readAccessEnabled }
          : {}),
      },
    });
  }

  @ActiveProjectMutation()
  async addMember(actor: AuthenticatedUser, projectId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const project = await this.currentMembershipWriter(tx, actor, projectId);
      const user = await tx.user.findFirst({
        where: {
          id: userId,
          workspaceId: project.workspaceId,
          OR: [
            { status: "OPEN" },
            { projectMemberships: { some: { projectId } } },
          ],
        },
        select: { id: true },
      });
      if (!user)
        throw new NotFoundException(
          "Eligible user not found in this workspace",
        );
      const membership = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: {},
        create: { projectId, userId },
        include: {
          user: { select: projectMemberUserSelect },
        },
      });
      return mapProjectMembership(membership);
    });
  }

  @ActiveProjectMutation()
  async removeMember(
    actor: AuthenticatedUser,
    projectId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.currentMembershipWriter(tx, actor, projectId);
      const member = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { projectId: true },
      });
      if (!member) throw new NotFoundException("Project member not found");
      return tx.projectMember.delete({
        where: { projectId_userId: { projectId, userId } },
      });
    });
  }

  private async currentMembershipWriter(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
  ) {
    await lockWorkspace(tx, actor.workspaceId);
    await assertCurrentManagement(
      tx,
      actor.workspaceId,
      actor.id,
      Permissions.PROJECT_MEMBERS_MANAGE,
    );
    const manager = await tx.user.findFirst({
      where: {
        id: actor.id,
        workspaceId: actor.workspaceId,
        status: "OPEN",
        roleAssignments: {
          some: {
            role: {
              permissions: {
                some: { permissionKey: Permissions.PROJECTS_MANAGE_ALL },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    const project = await tx.project.findFirst({
      where: { id: projectId, workspaceId: actor.workspaceId },
      include: {
        members: { where: { userId: actor.id }, select: { userId: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (!manager && !project.members.length)
      throw new ForbiddenException(
        "Project membership management scope is unavailable",
      );
    if (project.archivedAt || project.status === "DELETING")
      throw new ConflictException(
        "Project lifecycle blocks membership changes",
      );
    return project;
  }

  @ActiveProjectMutation()
  async createFolder(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const target = await this.resolveProjectPath(project, relativePath, false);
    if (await exists(target))
      throw new ConflictException(
        "A file or folder already exists at this path",
      );
    try {
      await fs.mkdir(target, { recursive: true });
    } catch (error) {
      throw filesystemError(error, "Unable to create folder");
    }
    return { path: toApiPath(relativePath), type: "directory" };
  }

  async listFiles(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath?: string,
  ) {
    const { project } = await this.assertReadAccess(actor, projectId);
    this.assertProjectReady(project);
    const target = await this.resolveProjectPath(
      project,
      relativePath ?? "",
      true,
    );
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      throw filesystemError(error, "Folder not found");
    }
    if (!stat.isDirectory())
      throw new BadRequestException("Path is not a folder");
    const entries = await fs.readdir(target, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.name !== ".proboxai-trash")
        .map(async (entry) => {
          const entryPath = path.join(target, entry.name);
          const entryStat = await fs.lstat(entryPath);
          return {
            name: entry.name,
            path: toApiPath(
              path.posix.join(toApiPath(relativePath ?? ""), entry.name),
            ),
            type: entryStat.isSymbolicLink()
              ? "symlink"
              : entryStat.isDirectory()
                ? "directory"
                : "file",
            size: entryStat.isFile() ? entryStat.size : null,
            updatedAt: entryStat.mtime,
          };
        }),
    );
    return { path: toApiPath(relativePath ?? ""), files };
  }

  @ActiveProjectMutation()
  async uploadFile(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath: string | undefined,
    file: UploadedProjectFile,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size !== file.buffer.length ||
      file.size > ProjectsService.maxUploadBytes()
    )
      throw new BadRequestException(
        "Project file exceeds the configured limit or has an invalid size",
      );
    const directory = await this.resolveProjectPath(
      project,
      relativePath ?? "",
      true,
    );
    const directoryStat = await safeLstat(
      directory,
      "Destination folder not found",
    );
    if (!directoryStat.isDirectory())
      throw new BadRequestException("Upload path must be a folder");
    const name = validateUploadedFileName(file.originalname);
    const target = path.join(directory, name);
    await this.assertProjectPathSafe(project, target);
    if (await exists(target))
      throw new ConflictException("A file already exists at this path");
    try {
      await fs.writeFile(target, file.buffer, { flag: "wx" });
    } catch (error) {
      throw filesystemError(error, "Unable to save uploaded file");
    }
    return {
      name,
      path: toApiPath(path.posix.join(toApiPath(relativePath ?? ""), name)),
      size: file.size,
    };
  }

  @ActiveProjectMutation()
  async moveFile(
    actor: AuthenticatedUser,
    projectId: string,
    sourcePath: string,
    destinationPath: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const sourceRelative = normalizeRelativePath(sourcePath, false);
    const destinationRelative = normalizeRelativePath(destinationPath, false);
    if (
      destinationRelative === sourceRelative ||
      destinationRelative.startsWith(`${sourceRelative}/`)
    )
      throw new BadRequestException("Cannot move an item into itself");
    const source = await this.resolveProjectPath(
      project,
      sourceRelative,
      false,
    );
    const destination = await this.resolveProjectPath(
      project,
      destinationRelative,
      false,
    );
    const sourceStat = await safeLstat(
      source,
      "Source file or folder not found",
    );
    if (sourceStat.isSymbolicLink())
      throw new BadRequestException("Symbolic links cannot be moved");
    if (await exists(destination))
      throw new ConflictException(
        "A file or folder already exists at the destination",
      );
    const destinationParent = path.dirname(destination);
    const parentStat = await safeLstat(
      destinationParent,
      "Destination folder not found",
    );
    if (!parentStat.isDirectory())
      throw new BadRequestException("Destination parent must be a folder");
    try {
      await fs.rename(source, destination);
    } catch (error) {
      throw filesystemError(error, "Unable to move file or folder");
    }
    return { sourcePath: sourceRelative, destinationPath: destinationRelative };
  }

  async downloadFile(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath: string,
  ) {
    const { project } = await this.assertReadAccess(actor, projectId);
    this.assertProjectReady(project);
    const target = await this.resolveProjectPath(project, relativePath, false);
    const stat = await safeLstat(target, "File not found");
    if (!stat.isFile())
      throw new BadRequestException("Only files can be downloaded");
    return { path: target, name: path.basename(target) };
  }

  async listProtectedFileTypes(actor: AuthenticatedUser, projectId: string) {
    await this.assertSensitiveAccess(actor, projectId);
    return this.prisma.projectProtectedFileType.findMany({
      where: { projectId },
      orderBy: { extension: "asc" },
    });
  }

  @ActiveProjectMutation()
  async addProtectedFileType(
    actor: AuthenticatedUser,
    projectId: string,
    extension: string,
  ) {
    await this.assertSensitiveAccess(actor, projectId);
    const normalized = normalizeExtension(extension);
    return this.prisma.projectProtectedFileType.upsert({
      where: { projectId_extension: { projectId, extension: normalized } },
      update: {},
      create: { projectId, extension: normalized, createdById: actor.id },
    });
  }

  @ActiveProjectMutation()
  async updateProtectedFileType(
    actor: AuthenticatedUser,
    projectId: string,
    typeId: string,
    extension: string,
  ) {
    await this.assertOwner(actor, projectId);
    const existing = await this.prisma.projectProtectedFileType.findFirst({
      where: { id: typeId, projectId },
    });
    if (!existing) throw new NotFoundException("Protected file type not found");
    return this.prisma.projectProtectedFileType.update({
      where: { id: typeId },
      data: { extension: normalizeExtension(extension) },
    });
  }

  @ActiveProjectMutation()
  async removeProtectedFileType(
    actor: AuthenticatedUser,
    projectId: string,
    typeId: string,
  ) {
    await this.assertOwner(actor, projectId);
    const removed = await this.prisma.projectProtectedFileType.deleteMany({
      where: { id: typeId, projectId },
    });
    if (!removed.count)
      throw new NotFoundException("Protected file type not found");
    return { removed: true };
  }

  private deletionJournal() {
    return new DurableFileDeletion(this.prisma);
  }
  private async deletionPaths(
    project: { departmentId: string; directoryName: string },
    relativePath: string,
  ) {
    const source = await this.resolveProjectPath(project, relativePath, false);
    const directory = await this.projectTrashDirectory(project);
    const root = path.dirname(directory);
    return {
      source: async () => {
        await assertNoSymlinks(root, source);
        return source;
      },
      trash: async () => {
        await assertNoSymlinks(root, directory);
        return directory;
      },
    };
  }
  @ActiveProjectMutation()
  async deleteFile(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath: string,
    operationId: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const normalized = normalizeRelativePath(relativePath, false);
    const journal = this.deletionJournal();
    const prior = await journal.prior(
      projectId,
      operationId,
      normalized,
      actor.id,
    );
    if (prior) return journal.result(prior);
    const paths = await this.deletionPaths(project, normalized);
    const prepared = await journal.prepare(
      projectId,
      actor.id,
      normalized,
      operationId,
      paths,
      await this.protectedExtensions(projectId),
    );
    if (!prepared.created || prepared.op.state === "AWAITING_CONFIRMATION")
      return journal.result(prepared.op);
    return journal.execute(prepared.op, paths);
  }
  @ActiveProjectMutation()
  async confirmFileDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    confirmationId: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const op = await this.prisma.projectFileOperation.findFirst({
      where: { projectId, confirmationId },
    });
    if (!op)
      throw new ConflictException(
        "Legacy confirmation has no durable identity; request a new deletion",
      );
    const journal = this.deletionJournal();
    if (op.state !== "AWAITING_CONFIRMATION") return journal.result(op);
    const confirmation =
      await this.prisma.projectFileDeletionConfirmation.findFirst({
        where: { id: confirmationId, projectId },
      });
    if (
      !confirmation ||
      confirmation.status !== "PENDING" ||
      confirmation.expiresAt <= new Date()
    ) {
      await journal.rejectConfirmation(op, "FILE_CONFIRMATION_EXPIRED");
      throw new ConflictException(
        "File deletion confirmation is no longer valid",
      );
    }
    const paths = await this.deletionPaths(project, confirmation.targetPath);
    const evidence = await fileEvidence(await paths.source());
    const protectedTypes = await this.protectedExtensions(projectId);
    if (
      ![...evidence.extensions].some((extension) =>
        protectedTypes.has(extension),
      ) ||
      evidence.identity !== op.sourceIdentity ||
      evidence.hash !== op.contentHash
    ) {
      await journal.rejectConfirmation(op, "FILE_CHANGED");
      throw new ConflictException(
        "File changed; create a new deletion confirmation",
      );
    }
    const claimed = await journal.claimConfirmation(op, actor.id);
    if (!claimed.created) return journal.result(claimed.op);
    return journal.execute(claimed.op, paths);
  }
  async listFileOperations(actor: AuthenticatedUser, projectId: string) {
    await this.assertSensitiveAccess(actor, projectId);
    return (
      await this.prisma.projectFileOperation.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    ).map(fileOperationResponse);
  }
  async fileOperation(
    actor: AuthenticatedUser,
    projectId: string,
    operationId: string,
  ) {
    await this.assertSensitiveAccess(actor, projectId);
    const op = await findFileOperation(this.prisma, projectId, operationId);
    if (!op) throw new NotFoundException("File operation not found");
    return fileOperationResponse(op);
  }
  @ActiveProjectMutation()
  async reconcileFileOperation(
    actor: AuthenticatedUser,
    projectId: string,
    operationId: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const op = await findFileOperation(this.prisma, projectId, operationId);
    if (!op) throw new NotFoundException("File operation not found");
    return this.deletionJournal().reconcile(
      op,
      await this.deletionPaths(project, op.originalPath),
    );
  }

  async listTrash(actor: AuthenticatedUser, projectId: string) {
    await this.assertSensitiveAccess(actor, projectId);
    const items = await this.prisma.projectFileTrashItem.findMany({
      where: { projectId, status: ProjectFileTrashStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });
    return items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      originalPath: item.originalPath,
      isDirectory: item.isDirectory,
      deletedById: item.deletedById,
      status: item.status,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      restoredAt: item.restoredAt,
      purgedAt: item.purgedAt,
    }));
  }

  @ActiveProjectMutation()
  async restoreTrash(
    actor: AuthenticatedUser,
    projectId: string,
    trashId: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const item = await this.prisma.projectFileTrashItem.findFirst({
      where: { id: trashId, projectId, status: ProjectFileTrashStatus.ACTIVE },
    });
    if (!item || item.expiresAt <= new Date())
      throw new NotFoundException("Recoverable trash item not found");
    const target = await this.resolveProjectPath(
      project,
      item.originalPath,
      false,
    );
    if (await exists(target))
      throw new ConflictException(
        "A file or folder already exists at the restore path",
      );
    const source = path.join(
      await this.projectTrashDirectory(project),
      safeTrashKey(item.trashPath),
    );
    await safeLstat(source, "Recoverable trash item not found");
    try {
      await fs.rename(source, target);
      await this.prisma.projectFileTrashItem.update({
        where: { id: item.id },
        data: {
          status: ProjectFileTrashStatus.RESTORED,
          restoredAt: new Date(),
        },
      });
    } catch (error) {
      throw filesystemError(error, "Unable to restore project item");
    }
    return { restored: true, path: item.originalPath };
  }

  /** Metadata only: never attempts cleanup, issues tokens or signals a runner. */
  async deletionHistory(
    actor: AuthenticatedUser,
    projectId: string,
    requestId?: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.user.findFirst({
          where: {
            id: actor.id,
            workspaceId: actor.workspaceId,
            status: "OPEN",
          },
          select: { id: true },
        });
        if (!current)
          throw new NotFoundException("Project deletion state not found");
        const project = await tx.project.findFirst({
          where: { id: projectId, workspaceId: actor.workspaceId },
          include: { members: { select: { userId: true } } },
        });
        const auditWhere = {
          projectId,
          workspaceId: actor.workspaceId,
          ...(!project
            ? { OR: [{ ownerId: actor.id }, { requestedById: actor.id }] }
            : {}),
          ...(requestId ? { requestId } : {}),
        };
        if (
          project &&
          project.creatorId !== actor.id &&
          !project.members.some((m) => m.userId === actor.id)
        )
          throw new ForbiddenException(
            "Only the project owner or a project member may read deletion state",
          );
        const audits = await tx.projectDeletionAudit.findMany({
          where: auditWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: requestId ? 1 : 100,
        });
        if (!project && !audits.length)
          throw new NotFoundException("Project deletion state not found");
        const requests = project
          ? await tx.projectDeletionRequest.findMany({
              where: { projectId, ...(requestId ? { id: requestId } : {}) },
              orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
              take: requestId ? 1 : 100,
            })
          : [];
        if (requestId && !requests.length && !audits.length)
          throw new NotFoundException("Project deletion state not found");
        // Reuse the existing tracked-session definition, without exposing its cwd.
        const sessions =
          project &&
          requests.some((r) => r.status === "AWAITING_ACTIVE_SESSIONS")
            ? await this.activeProjectSessions(project, tx)
            : [];
        const responses = requests.map((r) => {
          const response = deletionRequestResponse(
            r,
            r.status === "AWAITING_ACTIVE_SESSIONS" ? sessions : [],
          );
          if (
            r.status === "DELETING" &&
            audits.some(
              (a) => a.requestId === r.id && a.status === "PURGE_FAILED",
            )
          )
            response.nextAction = "REVIEW_FAILURE";
          return response;
        });
        if (requestId)
          return {
            projectRemoved: !project,
            request: responses[0] ?? null,
            audit: audits[0] ? deletionAuditResponse(audits[0]) : null,
          };
        return {
          projectRemoved: !project,
          requests: responses,
          audits: audits.map(deletionAuditResponse),
          limit: 100,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  @ActiveProjectMutation()
  async requestProjectDeletion(actor: AuthenticatedUser, projectId: string) {
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    const owner = project.creatorId === actor.id;
    const member = project.members.some((entry) => entry.userId === actor.id);
    if (!owner && !member)
      throw new ForbiddenException(
        "Only the project owner or a project member may request deletion",
      );
    await this.assertContextFree(project);
    const existing = await this.prisma.projectDeletionRequest.findFirst({
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
    });
    if (existing)
      throw new ConflictException(
        "A project deletion request is already active",
      );
    const ownerAccount = await this.prisma.user.findUnique({
      where: { id: project.creatorId },
      select: { telegramChatId: true, status: true },
    });
    if (!ownerAccount?.telegramChatId || ownerAccount.status !== "OPEN")
      throw new ConflictException(
        "The project owner must have a verified Telegram account",
      );
    const request = await this.prisma.projectDeletionRequest.create({
      data: {
        projectId,
        requestedById: actor.id,
        ownerId: project.creatorId,
        status: owner
          ? ProjectDeletionRequestStatus.AWAITING_ACTIVE_SESSIONS
          : ProjectDeletionRequestStatus.PENDING_OWNER_APPROVAL,
      },
    });
    if (!owner) {
      if (!this.telegram)
        throw new ConflictException("Telegram bot is not configured");
      await this.telegram.sendText(
        ownerAccount.telegramChatId,
        `A member requested deletion of project “${project.name}”. Open ProboxAI and approve or cancel request ${request.id}.`,
      );
    }
    return deletionRequestResponse(request);
  }

  @ActiveProjectMutation()
  async approveProjectDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
  ) {
    const request = await this.assertDeletionOwner(actor, projectId, requestId);
    await this.assertContextFree(
      await this.projectForWorkspace(actor.workspaceId, projectId),
    );
    if (
      ![
        "PENDING_OWNER_APPROVAL",
        "AWAITING_ACTIVE_SESSIONS",
        "AWAITING_TOKEN",
      ].includes(request.status)
    )
      throw new ConflictException(
        "Project deletion request cannot be approved",
      );
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    if (project.status === ProjectStatus.DELETING)
      throw new ConflictException("Project deletion is already in progress");
    const initializing = await this.prisma.projectInitialization.count({
      where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (initializing)
      throw new ConflictException(
        "Stop project initialization before deleting this project",
      );
    const activeSessions = await this.activeProjectSessions(project);
    if (activeSessions.length) {
      return this.prisma.projectDeletionRequest
        .update({
          where: { id: request.id },
          data: {
            status: ProjectDeletionRequestStatus.AWAITING_ACTIVE_SESSIONS,
            approvedAt: new Date(),
          },
        })
        .then((updated) => deletionRequestResponse(updated, activeSessions));
    }
    return this.issueProjectDeletionToken(project, request);
  }

  @ActiveProjectMutation()
  async resolveProjectDeletionSessions(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
    action: "WAIT" | "INTERRUPT",
  ) {
    const request = await this.assertDeletionOwner(actor, projectId, requestId);
    await this.assertContextFree(
      await this.projectForWorkspace(actor.workspaceId, projectId),
    );
    if (
      request.status !== ProjectDeletionRequestStatus.AWAITING_ACTIVE_SESSIONS
    )
      throw new ConflictException("No active-session decision is pending");
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    const active = await this.activeProjectSessions(project);
    if (action === "INTERRUPT") {
      if (!this.sessions)
        throw new ServiceUnavailableException(
          "Durable session interruption is unavailable",
        );
      for (const session of active) {
        const turn = await this.prisma.proboxAiTurn.findFirst({
          where: {
            sessionId: session.id,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          orderBy: { startedAt: "desc" },
        });
        if (!turn) continue;
        await this.sessions.interruptScoped(session.id, turn.id, async (tx) => {
          const currentActor = await tx.user.findFirst({
            where: {
              id: actor.id,
              workspaceId: actor.workspaceId,
              status: "OPEN",
              roleAssignments: {
                some: {
                  role: {
                    permissions: {
                      some: { permissionKey: Permissions.PROJECTS_DELETE },
                    },
                  },
                },
              },
            },
            select: { id: true },
          });
          if (!currentActor)
            throw new ForbiddenException(
              "Project deletion access is no longer available",
            );
          const current = await tx.project.findFirst({
            where: {
              id: projectId,
              workspaceId: actor.workspaceId,
              creatorId: actor.id,
            },
          });
          const pending = await tx.projectDeletionRequest.findFirst({
            where: {
              id: requestId,
              projectId,
              ownerId: actor.id,
              status: "AWAITING_ACTIVE_SESSIONS",
            },
          });
          const department = current
            ? await tx.department.findFirst({
                where: {
                  id: current.departmentId,
                  workspaceId: actor.workspaceId,
                },
                select: { homePath: true },
              })
            : null;
          const target = await tx.proboxAiSession.findUnique({
            where: { id: session.id },
            select: { workspaceId: true, cwd: true },
          });
          if (
            !current ||
            !pending ||
            !department ||
            !target ||
            target.workspaceId !== actor.workspaceId ||
            !isWithin(
              path.join(
                this.pathPolicy.validateDepartmentHome(department.homePath),
                current.directoryName,
              ),
              target.cwd,
            )
          )
            throw new NotFoundException("Project deletion session not found");
        });
      }
    }
    await this.prisma.projectDeletionRequest.update({
      where: { id: request.id },
      data: { activeSessionAction: action },
    });
    return {
      action,
      activeSessions: active.map((s) => ({ id: s.id, status: s.status })),
    };
  }

  @ActiveProjectMutation()
  async cancelProjectDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
  ) {
    const request = await this.prisma.projectDeletionRequest.findFirst({
      where: { id: requestId, projectId },
    });
    if (!request)
      throw new NotFoundException("Project deletion request not found");
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    if (actor.id !== request.requestedById && actor.id !== project.creatorId)
      throw new ForbiddenException(
        "Only the requester or project owner may cancel deletion",
      );
    if (["DELETING", "COMPLETED"].includes(request.status))
      throw new ConflictException(
        "Project deletion can no longer be cancelled",
      );
    return this.prisma.projectDeletionRequest
      .update({
        where: { id: request.id },
        data: {
          status: ProjectDeletionRequestStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      })
      .then(deletionRequestResponse);
  }

  @ActiveProjectMutation()
  async confirmProjectDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
    token: string,
  ) {
    const request = await this.assertDeletionOwner(actor, projectId, requestId);
    await this.assertContextFree(
      await this.projectForWorkspace(actor.workspaceId, projectId),
    );
    if (
      request.status !== ProjectDeletionRequestStatus.AWAITING_TOKEN ||
      !request.tokenHash ||
      !request.tokenExpiresAt ||
      request.tokenExpiresAt <= new Date()
    )
      throw new ConflictException(
        "Project deletion token is invalid or expired",
      );
    if (request.tokenAttempts >= 5)
      throw new ConflictException(
        "Project deletion token has too many failed attempts",
      );
    if (hashToken(token) !== request.tokenHash) {
      await this.prisma.projectDeletionRequest.update({
        where: { id: request.id },
        data: { tokenAttempts: { increment: 1 } },
      });
      throw new ForbiddenException("Project deletion token is invalid");
    }
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    const active = await this.activeProjectSessions(project);
    if (active.length)
      throw new ConflictException("Project still has active sessions");
    const audit = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      await this.assertContextFree(project, tx);
      await tx.projectDeletionRequest.update({
        where: { id: request.id },
        data: { status: ProjectDeletionRequestStatus.DELETING },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.DELETING },
      });
      return tx.projectDeletionAudit.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
          projectName: project.name,
          directoryName: project.directoryName,
          departmentId: project.departmentId,
          ownerId: project.creatorId,
          requestedById: request.requestedById,
          requestId: request.id,
          status: "PURGE_PENDING",
          snapshot: {
            contextFreeVerified: true,
            readAccessEnabled: project.readAccessEnabled,
            requestedAt: request.requestedAt.toISOString(),
          },
        },
      });
    });
    const directory = await this.projectDirectoryForDepartment(
      project.departmentId,
      project.directoryName,
    );
    const quarantine = path.join(
      path.dirname(directory),
      ".proboxai-project-deletions",
      audit.id,
    );
    try {
      await fs.mkdir(path.dirname(quarantine), { recursive: true });
      await fs.rename(directory, quarantine);
      await this.prisma.projectDeletionAudit.update({
        where: { id: audit.id },
        data: { quarantinePath: quarantine },
      });
      await this.prisma.project.delete({ where: { id: projectId } });
      await this.purgeProjectAudit(audit.id, quarantine);
    } catch (error) {
      await this.prisma.projectDeletionAudit.update({
        where: { id: audit.id },
        data: {
          status: "PURGE_FAILED",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw filesystemError(error, "Unable to delete project safely");
    }
    const finalAudit = await this.prisma.projectDeletionAudit.findUniqueOrThrow(
      { where: { id: audit.id } },
    );
    return {
      deletionAuditId: audit.id,
      status: finalAudit.status,
      projectRemoved: true,
    };
  }

  async cleanupExpiredTrash() {
    const due = await this.prisma.projectFileTrashItem.findMany({
      where: {
        status: { in: ["ACTIVE", "PURGE_FAILED"] },
        expiresAt: { lte: new Date() },
        project: { archivedAt: null },
      },
      include: {
        project: { select: { departmentId: true, directoryName: true } },
      },
      take: 50,
    });
    for (const item of due) {
      await this.prisma.$transaction(
        async (tx) => {
          await lockProjectLifecycle(tx, item.projectId);
          const project = await tx.project.findUnique({
            where: { id: item.projectId },
            select: { archivedAt: true },
          });
          if (!project || project.archivedAt) return;
          await fencedProjectFilesystem(
            this.prisma,
            item.projectId,
            async () => {
              const claimed = await this.prisma.projectFileTrashItem.updateMany(
                {
                  where: {
                    id: item.id,
                    status: { in: ["ACTIVE", "PURGE_FAILED"] },
                    OR: [
                      { leaseExpiresAt: null },
                      { leaseExpiresAt: { lt: new Date() } },
                    ],
                  },
                  data: {
                    leaseOwner: process.pid.toString(),
                    leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
                  },
                },
              );
              if (!claimed.count) return;
              try {
                await fs.rm(
                  path.join(
                    await this.projectTrashDirectory(item.project),
                    safeTrashKey(item.trashPath),
                  ),
                  { recursive: true, force: true },
                );
                await this.prisma.projectFileTrashItem.update({
                  where: { id: item.id },
                  data: {
                    status: ProjectFileTrashStatus.PURGED,
                    purgedAt: new Date(),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                  },
                });
              } catch (error) {
                await this.prisma.projectFileTrashItem.update({
                  where: { id: item.id },
                  data: {
                    status: ProjectFileTrashStatus.PURGE_FAILED,
                    lastError: String(error),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                  },
                });
              }
            },
          );
        },
        { timeout: 120000, maxWait: 10000 },
      );
    }
    const audits = await this.prisma.projectDeletionAudit.findMany({
      where: {
        status: { in: ["PURGE_PENDING", "PURGE_FAILED"] },
        quarantinePath: { not: null },
        snapshot: { path: ["contextFreeVerified"], equals: true },
      },
      take: 20,
    });
    for (const audit of audits) {
      if (await this.prisma.project.count({ where: { id: audit.projectId } }))
        continue;
      await this.purgeProjectAudit(audit.id, audit.quarantinePath!);
    }
  }

  private async projectTrashDirectory(project: {
    departmentId: string;
    directoryName: string;
  }) {
    const directory = await this.projectDirectoryForDepartment(
      project.departmentId,
      project.directoryName,
    );
    return path.join(directory, ".proboxai-trash");
  }

  private async protectedExtensions(projectId: string) {
    const types = await this.prisma.projectProtectedFileType.findMany({
      where: { projectId },
      select: { extension: true },
    });
    return new Set(types.map((entry) => entry.extension));
  }

  private async assertOwner(actor: AuthenticatedUser, projectId: string) {
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    if (project.creatorId !== actor.id)
      throw new ForbiddenException(
        "Only the project owner may perform this action",
      );
    return project;
  }

  private async assertDeletionOwner(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
  ) {
    const project = await this.assertOwner(actor, projectId);
    const request = await this.prisma.projectDeletionRequest.findFirst({
      where: { id: requestId, projectId, ownerId: project.creatorId },
    });
    if (!request)
      throw new NotFoundException("Project deletion request not found");
    return request;
  }

  private async assertContextFree(
    project: {
      id: string;
      workspaceId: string;
      departmentId: string;
      directoryName: string;
      archivedAt: Date | null;
      description?: string | null;
      appliedTemplateVersionId?: string | null;
    },
    database: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const blocked = () =>
      new ConflictException(
        "Project has context or its context cannot be proven empty; archive it instead",
      );
    if (
      project.archivedAt ||
      project.description?.trim() ||
      project.appliedTemplateVersionId
    )
      throw blocked();
    const counts = await Promise.all([
      database.projectLifecycleExecution.count({
        where: {
          projectId: project.id,
          finishedAt: null,
          ...(currentProjectExecutionId()
            ? { id: { not: currentProjectExecutionId() } }
            : {}),
        },
      }),
      database.taskBoardEntry.count({
        where: { status: { board: { projectId: project.id } } },
      }),
      database.taskBoardAudit.count({
        where: { board: { projectId: project.id } },
      }),
      database.projectInitialization.count({
        where: { projectId: project.id },
      }),
      database.proboxAiSession.count({
        where: {
          workspaceId: project.workspaceId,
          selectedProjectId: project.id,
        },
      }),
      database.projectFileOperation.count({
        where: { projectId: project.id },
      }),
      database.projectFileTrashItem.count({
        where: { projectId: project.id },
      }),
    ]);
    if (counts.some(Boolean)) throw blocked();
    const department = await database.department.findFirst({
      where: { id: project.departmentId, workspaceId: project.workspaceId },
      select: { homePath: true },
    });
    if (
      !department ||
      !project.directoryName ||
      /[\\/\0:]/.test(project.directoryName) ||
      [".", ".."].includes(project.directoryName)
    )
      throw blocked();
    const directory = path.join(
      this.pathPolicy.validateDepartmentHome(department.homePath),
      project.directoryName,
    );
    // Legacy cwd is evidence only for blocking, never an inferred task link.
    const sessions = await database.proboxAiSession.findMany({
      where: { workspaceId: project.workspaceId },
      select: { cwd: true },
    });
    if (sessions.some((session) => isWithin(directory, session.cwd)))
      throw blocked();
    try {
      await this.pathPolicy.assertExistingAncestorsSafe(directory);
      const stat = await fs.lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await fs.readdir(directory)).length
      )
        throw blocked();
    } catch {
      throw blocked();
    }
  }

  private async activeProjectSessions(
    project: {
      workspaceId: string;
      departmentId: string;
      directoryName: string;
    },
    database: Pick<
      Prisma.TransactionClient,
      "department" | "proboxAiSession"
    > = this.prisma,
  ) {
    const department = await database.department.findFirst({
      where: { id: project.departmentId, workspaceId: project.workspaceId },
      select: { homePath: true },
    });
    if (!department) throw new NotFoundException("Department not found");
    const directory = path.join(
      this.pathPolicy.validateDepartmentHome(department.homePath),
      project.directoryName,
    );
    const candidates = await database.proboxAiSession.findMany({
      where: {
        workspaceId: project.workspaceId,
        status: {
          in: [
            SessionStatus.QUEUED,
            SessionStatus.RUNNING,
            SessionStatus.PAUSED,
          ],
        },
      },
      select: { id: true, cwd: true, status: true },
    });
    return candidates.filter((session) => isWithin(directory, session.cwd));
  }

  private async issueProjectDeletionToken(
    project: { id: string; name: string; creatorId: string },
    request: { id: string; ownerId: string },
  ) {
    const owner = await this.prisma.user.findUnique({
      where: { id: request.ownerId },
      select: { telegramChatId: true, status: true },
    });
    if (!owner?.telegramChatId || owner.status !== "OPEN" || !this.telegram)
      throw new ConflictException(
        "The project owner must have a verified Telegram account and configured bot",
      );
    const token = randomBytes(18).toString("base64url");
    const updated = await this.prisma.projectDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: ProjectDeletionRequestStatus.AWAITING_TOKEN,
        approvedAt: new Date(),
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 10 * 60_000),
        tokenAttempts: 0,
      },
    });
    await this.telegram.sendText(
      owner.telegramChatId,
      `Final warning: deleting project “${project.name}” permanently removes it, every file, and its recoverable trash. Session history remains. Enter this one-time ProboxAI token within 10 minutes: ${token}`,
    );
    return deletionRequestResponse(updated, [], true);
  }

  private async purgeProjectAudit(auditId: string, quarantinePath: string) {
    try {
      await fs.rm(quarantinePath, { recursive: true, force: true });
      await this.prisma.projectDeletionAudit.update({
        where: { id: auditId },
        data: { status: "PURGED", completedAt: new Date(), error: null },
      });
    } catch (error) {
      await this.prisma.projectDeletionAudit.update({
        where: { id: auditId },
        data: { status: "PURGE_FAILED", error: String(error) },
      });
    }
  }

  private async assertReadAccess(actor: AuthenticatedUser, projectId: string) {
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    const sensitive =
      hasPermission(actor, Permissions.PROJECTS_READ_ALL) ||
      project.members.some((member) => member.userId === actor.id);
    if (!sensitive && !project.readAccessEnabled)
      throw new ForbiddenException("You do not have access to this project");
    return { project, sensitive };
  }

  private async assertSensitiveAccess(
    actor: AuthenticatedUser,
    projectId: string,
  ) {
    const project = await this.projectForWorkspace(
      actor.workspaceId,
      projectId,
    );
    if (
      !hasPermission(actor, Permissions.PROJECTS_MANAGE_ALL) &&
      !project.members.some((member) => member.userId === actor.id)
    )
      throw new ForbiddenException(
        "Only project members and administrators may perform this action",
      );
    return project;
  }

  private async projectForWorkspace(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      include: { members: { select: { userId: true } } },
    });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  private assertProjectReady(project: { status: ProjectStatus }) {
    if (project.status !== ProjectStatus.READY)
      throw new ConflictException(
        `Project files are unavailable while project status is ${project.status}`,
      );
  }

  private async projectDirectoryForDepartment(
    departmentId: string,
    directoryName: string,
  ) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { homePath: true },
    });
    if (!department) throw new NotFoundException("Department not found");
    const home = this.pathPolicy.validateDepartmentHome(department.homePath);
    await this.ensureHomeDirectory(home);
    return path.join(home, directoryName);
  }

  private async resolveProjectPath(
    project: { departmentId: string; directoryName: string },
    relativePath: string,
    allowRoot: boolean,
  ) {
    const normalized = normalizeRelativePath(relativePath, allowRoot);
    if (
      normalized === ".proboxai-trash" ||
      normalized.startsWith(".proboxai-trash/")
    )
      throw new NotFoundException("Project path not found");
    const projectDirectory = await this.projectDirectoryForDepartment(
      project.departmentId,
      project.directoryName,
    );
    const target = path.resolve(
      projectDirectory,
      ...normalized.split("/").filter(Boolean),
    );
    if (!isWithin(projectDirectory, target))
      throw new BadRequestException("Path must stay inside the project");
    await this.assertProjectPathSafe(project, target);
    return target;
  }

  private async assertProjectPathSafe(
    project: { departmentId: string; directoryName: string },
    target: string,
  ) {
    const projectDirectory = await this.projectDirectoryForDepartment(
      project.departmentId,
      project.directoryName,
    );
    await assertNoSymlinks(projectDirectory, target);
  }

  private async ensureHomeDirectory(home: string) {
    await this.pathPolicy.provisionDepartmentHome(home);
  }

  private async prepareExistingDirectory(
    projectDirectory: string,
    existingDirectory: boolean,
    action: ExistingProjectDirectoryAction | undefined,
    hasTemplate: boolean,
    beforeWrite?: () => Promise<void>,
  ) {
    if (!existingDirectory) return;
    if (!action)
      throw new ConflictException({
        code: "PROJECT_DIRECTORY_EXISTS",
        message:
          "The project directory already exists. Confirm whether to keep its files or clear its contents.",
        existingDirectoryActions: ["KEEP", "CLEAR"],
      });
    if (action === "KEEP" && hasTemplate)
      throw new ConflictException(
        "Keeping an existing directory is not supported when creating from a configuration template. Choose CLEAR to apply the template.",
      );
    if (action === "CLEAR")
      await clearDirectoryContents(projectDirectory, beforeWrite);
  }
}

function validateProjectDirectoryName(value: string) {
  const name = value.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new BadRequestException("Invalid project name");
  return name;
}

function validateUploadedFileName(value: string) {
  const name = value.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!name || name === "." || name === ".." || name.includes("\0"))
    throw new BadRequestException("Invalid upload file name");
  return name;
}

function normalizeExtension(value: string) {
  const extension = value.trim().toLowerCase();
  if (!/^\.[a-z0-9][a-z0-9._+-]{0,63}$/.test(extension))
    throw new BadRequestException(
      "Protected file type must be a file extension such as .env",
    );
  return extension;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeTrashKey(value: string) {
  if (!/^[a-f0-9]{32}$/.test(value))
    throw new BadRequestException("Invalid project trash item");
  return value;
}

function normalizeRelativePath(value: string, allowRoot: boolean) {
  const normalized = (value ?? "").trim().replace(/\\/g, "/");
  if (!normalized && allowRoot) return "";
  if (!normalized) throw new BadRequestException("Path is required");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized))
    throw new BadRequestException("Path must be relative");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0") ||
        (process.platform === "win32" &&
          (/[ .]$/.test(segment) || segment.includes(":"))),
    )
  )
    throw new BadRequestException("Path contains an unsafe segment");
  return segments.join("/");
}

function toApiPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

async function assertNoSymlinks(root: string, target: string) {
  if (!isWithin(root, target))
    throw new BadRequestException(
      "Path must stay inside the allowed directory",
    );
  try {
    const rootStat = await fs.lstat(root);
    if (rootStat.isSymbolicLink())
      throw new BadRequestException("Symbolic links are not supported");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  const relative = path.relative(root, target);
  const segments = relative ? relative.split(path.sep) : [];
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new BadRequestException("Symbolic links are not supported");
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
  }
}

async function exists(filePath: string) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

async function existingDirectoryStatus(directory: string) {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new ConflictException(
        "A non-directory or symbolic link already exists at the project path",
      );
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

async function clearDirectoryContents(
  directory: string,
  beforeWrite?: () => Promise<void>,
) {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new ConflictException(
      "A non-directory or symbolic link already exists at the project path",
    );
  const entries = await fs.readdir(directory);
  for (const entry of entries) {
    await beforeWrite?.();
    await fs.rm(path.join(directory, entry), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

async function safeLstat(filePath: string, missingMessage: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new NotFoundException(missingMessage);
    throw filesystemError(error, missingMessage);
  }
}

function filesystemError(error: unknown, fallback: string) {
  if (error instanceof BadRequestException) return error;
  if (isErrno(error, "EEXIST"))
    return new ConflictException(
      "A file or folder already exists at this path",
    );
  if (isErrno(error, "ENOENT")) return new NotFoundException(fallback);
  if (isErrno(error, "EACCES") || isErrno(error, "EPERM"))
    return new ForbiddenException("The server cannot access this project path");
  return new BadRequestException(fallback);
}

function isErrno(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function mapProjectMembers<T extends { members?: any[] }>(project: T) {
  if (!project.members) return project;
  return {
    ...project,
    members: project.members.map(mapProjectMembership),
  };
}

function mapProjectMembership<T extends { user?: any }>(membership: T) {
  if (!membership.user?.roleAssignments) return membership;
  const { roleAssignments, ...user } = membership.user;
  const roles = roleAssignments.map(({ role }: any) => role);
  const legacyRole = [
    SystemRoleKeys.ADMIN,
    SystemRoleKeys.MANAGER,
    SystemRoleKeys.MEMBER,
  ].find((key) =>
    roles.some((assigned: { key: string }) => assigned.key === key),
  );
  return {
    ...membership,
    user: {
      ...user,
      roles,
      role: legacyRole ?? null,
    },
  };
}
