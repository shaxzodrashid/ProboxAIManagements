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
  UserRole,
} from "@prisma/client";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto, UpdateProjectDto } from "./projects.dto";
import { DepartmentsService } from "../departments/departments.service";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";
import { ProjectInitializationService } from "./project-initialization.service";

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
  ) {}

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
    if (await exists(projectDirectory))
      throw new ConflictException("The project directory already exists");
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
      await fs.mkdir(projectDirectory);
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
      entries.map(async (entry) => {
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
