import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ConfigurationTemplateVersionStatus,
  DepartmentStatus,
  ProjectStatus,
  ProjectFileDeletionConfirmationStatus,
  ProjectFileTrashStatus,
  ProjectDeletionRequestStatus,
  SessionStatus,
  UserRole,
} from "@prisma/client";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
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
import { ProboxAiRunner } from "../sessions/proboxai-runner.service";

type UploadedProjectFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
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
    const configured = Number(process.env.PROBOXAI_PROJECT_UPLOAD_MAX_BYTES);
    return Number.isSafeInteger(configured) && configured > 0
      ? Math.min(configured, 1024 * 1024 * 1024)
      : 100 * 1024 * 1024;
  }

  async getProjectsHome(workspaceId: string) {
    const department = await this.departments.defaultForWorkspace(workspaceId);
    return {
      path: department.homePath,
      configured: true,
      departmentId: department.id,
    };
  }

  async setProjectsHome(workspaceId: string, requestedPath: string) {
    const department = await this.departments.defaultForWorkspace(workspaceId);
    const updated = await this.departments.update(workspaceId, department.id, {
      homePath: requestedPath,
    });
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { projectsHomePath: updated.homePath },
    });
    return {
      path: updated.homePath,
      configured: true,
      departmentId: updated.id,
      created: updated.homeCreated,
    };
  }

  async list(actor: AuthenticatedUser) {
    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: actor.workspaceId,
        ...(actor.role === UserRole.ADMIN
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
        initializations: { orderBy: { attempt: "desc" }, take: 1 },
        _count: { select: { members: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return projects;
  }

  async create(actor: AuthenticatedUser, dto: CreateProjectDto) {
    const department = dto.departmentId
      ? await this.departments.get(actor.workspaceId, dto.departmentId)
      : await this.departments.defaultForWorkspace(actor.workspaceId);
    if (department.status !== DepartmentStatus.ACTIVE)
      throw new ConflictException(
        "Projects cannot be created in an archived department",
      );
    const directoryName = validateProjectDirectoryName(dto.name);
    const existing = await this.prisma.project.findFirst({
      where: { departmentId: department.id, directoryName },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException("A project with this name exists");

    const projectDirectory = await this.projectDirectoryForDepartment(
      department.id,
      directoryName,
    );
    const existingDirectory = await existingDirectoryStatus(projectDirectory);
    let templateVersion: { id: string } | null = null;
    if (dto.configurationTemplateId) {
      templateVersion =
        await this.prisma.configurationTemplateVersion.findFirst({
          where: {
            templateId: dto.configurationTemplateId,
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
    await this.prepareExistingDirectory(
      projectDirectory,
      existingDirectory,
      dto.existingDirectoryAction,
      Boolean(templateVersion),
    );
    if (templateVersion) {
      const project = await this.prisma.project.create({
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
          department: { select: { id: true, name: true, slug: true } },
          members: {
            include: {
              user: { select: { id: true, fullName: true, role: true } },
            },
          },
        },
      });
      try {
        const initialization = await this.initializations.enqueue(
          project.id,
          templateVersion.id,
        );
        return { ...project, initializations: [initialization] };
      } catch (error) {
        await this.prisma.project.update({
          where: { id: project.id },
          data: { status: ProjectStatus.FAILED },
        });
        throw error;
      }
    }
    try {
      if (!existingDirectory) await fs.mkdir(projectDirectory);
    } catch (error) {
      throw filesystemError(error, "Unable to create the project directory");
    }

    // If the database write fails, deliberately keep the empty directory for an
    // operator to inspect; deleting it could race with a concurrent writer.
    return this.prisma.project.create({
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
            user: { select: { id: true, fullName: true, role: true } },
          },
        },
      },
    });
  }

  async get(actor: AuthenticatedUser, projectId: string) {
    const access = await this.assertReadAccess(actor, projectId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        creator: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true, slug: true } },
        initializations: { orderBy: { attempt: "desc" }, take: 1 },
        members: {
          include: {
            user: { select: { id: true, fullName: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!access.sensitive) {
      const { members: _members, ...publicProject } = project;
      return publicProject;
    }
    return project;
  }

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

  async addMember(actor: AuthenticatedUser, projectId: string, userId: string) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, workspaceId: project.workspaceId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("User not found in this workspace");
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      update: {},
      create: { projectId, userId },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
      },
    });
  }

  async removeMember(
    actor: AuthenticatedUser,
    projectId: string,
    userId: string,
  ) {
    await this.assertSensitiveAccess(actor, projectId);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectId: true },
    });
    if (!member) throw new NotFoundException("Project member not found");
    return this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
  }

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

  async uploadFile(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath: string | undefined,
    file: UploadedProjectFile,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
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

  async deleteFile(
    actor: AuthenticatedUser,
    projectId: string,
    relativePath: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const normalized = normalizeRelativePath(relativePath, false);
    const target = await this.resolveProjectPath(project, normalized, false);
    const stat = await safeLstat(target, "File or folder not found");
    if (stat.isSymbolicLink())
      throw new BadRequestException("Symbolic links cannot be deleted");
    const protectedTypes = await this.protectedExtensions(projectId);
    const fingerprint = await projectPathFingerprint(target, protectedTypes);
    if (fingerprint.protected) {
      const confirmation =
        await this.prisma.projectFileDeletionConfirmation.create({
          data: {
            projectId,
            targetPath: normalized,
            fingerprint: fingerprint.value,
            requestedById: actor.id,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
      return {
        confirmationRequired: true,
        confirmationId: confirmation.id,
        expiresAt: confirmation.expiresAt,
      };
    }
    return this.moveToTrash(project, actor.id, normalized, stat.isDirectory());
  }

  async confirmFileDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    confirmationId: string,
  ) {
    const project = await this.assertSensitiveAccess(actor, projectId);
    this.assertProjectReady(project);
    const confirmation =
      await this.prisma.projectFileDeletionConfirmation.findFirst({
        where: { id: confirmationId, projectId },
      });
    if (
      !confirmation ||
      confirmation.status !== ProjectFileDeletionConfirmationStatus.PENDING ||
      confirmation.expiresAt <= new Date()
    )
      throw new ConflictException(
        "File deletion confirmation is no longer valid",
      );
    const target = await this.resolveProjectPath(
      project,
      confirmation.targetPath,
      false,
    );
    const stat = await safeLstat(target, "File or folder not found");
    const fingerprint = await projectPathFingerprint(
      target,
      await this.protectedExtensions(projectId),
    );
    if (
      !fingerprint.protected ||
      fingerprint.value !== confirmation.fingerprint
    ) {
      await this.prisma.projectFileDeletionConfirmation.update({
        where: { id: confirmation.id },
        data: { status: ProjectFileDeletionConfirmationStatus.EXPIRED },
      });
      throw new ConflictException(
        "File changed; create a new deletion confirmation",
      );
    }
    const result = await this.moveToTrash(
      project,
      actor.id,
      confirmation.targetPath,
      stat.isDirectory(),
    );
    await this.prisma.projectFileDeletionConfirmation.update({
      where: { id: confirmation.id },
      data: {
        status: ProjectFileDeletionConfirmationStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });
    return result;
  }

  async listTrash(actor: AuthenticatedUser, projectId: string) {
    await this.assertSensitiveAccess(actor, projectId);
    const items = await this.prisma.projectFileTrashItem.findMany({
      where: { projectId, status: ProjectFileTrashStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });
    return items.map(
      ({
        trashPath: _trashPath,
        leaseOwner: _leaseOwner,
        leaseExpiresAt: _leaseExpiresAt,
        lastError: _lastError,
        ...item
      }) => item,
    );
  }

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
    return request;
  }

  async approveProjectDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
  ) {
    const request = await this.assertDeletionOwner(actor, projectId, requestId);
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
        .then((updated) => ({ ...updated, activeSessions }));
    }
    return this.issueProjectDeletionToken(project, request);
  }

  async resolveProjectDeletionSessions(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
    action: "WAIT" | "INTERRUPT",
  ) {
    const request = await this.assertDeletionOwner(actor, projectId, requestId);
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
      for (const session of active) this.runner?.interrupt(session.id);
    }
    await this.prisma.projectDeletionRequest.update({
      where: { id: request.id },
      data: { activeSessionAction: action },
    });
    return { action, activeSessions: active };
  }

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
    return this.prisma.projectDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: ProjectDeletionRequestStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
  }

  async confirmProjectDeletion(
    actor: AuthenticatedUser,
    projectId: string,
    requestId: string,
    token: string,
  ) {
    const request = await this.assertDeletionOwner(actor, projectId, requestId);
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
          projectId: project.id,
          projectName: project.name,
          directoryName: project.directoryName,
          departmentId: project.departmentId,
          ownerId: project.creatorId,
          requestedById: request.requestedById,
          requestId: request.id,
          status: "PURGE_PENDING",
          snapshot: {
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
    return { deletionAuditId: audit.id, status: "PURGE_PENDING" };
  }

  async cleanupExpiredTrash() {
    const due = await this.prisma.projectFileTrashItem.findMany({
      where: {
        status: { in: ["ACTIVE", "PURGE_FAILED"] },
        expiresAt: { lte: new Date() },
      },
      include: {
        project: { select: { departmentId: true, directoryName: true } },
      },
      take: 50,
    });
    for (const item of due) {
      const claimed = await this.prisma.projectFileTrashItem.updateMany({
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
      });
      if (!claimed.count) continue;
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
    }
    const audits = await this.prisma.projectDeletionAudit.findMany({
      where: {
        status: { in: ["PURGE_PENDING", "PURGE_FAILED"] },
        quarantinePath: { not: null },
      },
      take: 20,
    });
    for (const audit of audits)
      await this.purgeProjectAudit(audit.id, audit.quarantinePath!);
  }

  private async moveToTrash(
    project: { id: string; departmentId: string; directoryName: string },
    actorId: string,
    relativePath: string,
    isDirectory: boolean,
  ) {
    const source = await this.resolveProjectPath(project, relativePath, false);
    const trashDirectory = await this.projectTrashDirectory(project);
    const id = randomBytes(16).toString("hex");
    const destination = path.join(trashDirectory, id);
    try {
      await fs.mkdir(trashDirectory, { recursive: true });
      await fs.rename(source, destination);
      const item = await this.prisma.projectFileTrashItem.create({
        data: {
          projectId: project.id,
          originalPath: relativePath,
          trashPath: id,
          isDirectory,
          deletedById: actorId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        },
      });
      return {
        trashed: true,
        trashId: item.id,
        path: relativePath,
        expiresAt: item.expiresAt,
      };
    } catch (error) {
      if ((await exists(destination)) && !(await exists(source))) {
        await fs.rename(destination, source).catch(() => undefined);
      }
      throw filesystemError(error, "Unable to move project item to trash");
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

  private async activeProjectSessions(project: {
    workspaceId: string;
    departmentId: string;
    directoryName: string;
  }) {
    const directory = await this.projectDirectoryForDepartment(
      project.departmentId,
      project.directoryName,
    );
    const candidates = await this.prisma.proboxAiSession.findMany({
      where: {
        workspaceId: project.workspaceId,
        status: {
          in: [
            SessionStatus.QUEUED,
            SessionStatus.RUNNING,
            SessionStatus.PAUSED,
          ],
        },
        cwd: { startsWith: directory },
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
    return { ...updated, tokenSent: true };
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
      actor.role === UserRole.ADMIN ||
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
      actor.role !== UserRole.ADMIN &&
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
    if (action === "CLEAR") await clearDirectoryContents(projectDirectory);
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

async function projectPathFingerprint(
  target: string,
  protectedExtensions: Set<string>,
) {
  const entries: string[] = [];
  let protectedMatch = false;
  async function visit(current: string, relative: string) {
    const stat = await safeLstat(current, "File or folder not found");
    if (stat.isSymbolicLink())
      throw new BadRequestException("Symbolic links cannot be deleted");
    const extension = fileExtension(current);
    if (stat.isFile() && protectedExtensions.has(extension))
      protectedMatch = true;
    entries.push(
      `${relative}:${stat.isDirectory() ? "d" : "f"}:${stat.size}:${stat.mtimeMs}`,
    );
    if (!stat.isDirectory()) return;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (child.name === ".proboxai-trash") continue;
      await visit(
        path.join(current, child.name),
        path.posix.join(relative, child.name),
      );
    }
  }
  await visit(target, "");
  return {
    protected: protectedMatch,
    value: createHash("sha256").update(entries.join("\n")).digest("hex"),
  };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function fileExtension(filePath: string) {
  const base = path.basename(filePath).toLowerCase();
  if (base.startsWith(".") && base.indexOf(".", 1) === -1) return base;
  return path.extname(base).toLowerCase();
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
        segment.includes("\0"),
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

async function clearDirectoryContents(directory: string) {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new ConflictException(
      "A non-directory or symbolic link already exists at the project path",
    );
  const entries = await fs.readdir(directory);
  for (const entry of entries)
    await fs.rm(path.join(directory, entry), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
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
