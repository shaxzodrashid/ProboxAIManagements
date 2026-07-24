import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto, UpdateProjectDto } from "./projects.dto";

type UploadedProjectFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
};

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  static maxUploadBytes() {
    const configured = Number(process.env.PROBOXAI_PROJECT_UPLOAD_MAX_BYTES);
    return Number.isSafeInteger(configured) && configured > 0
      ? Math.min(configured, 1024 * 1024 * 1024)
      : 100 * 1024 * 1024;
  }

  async getProjectsHome(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { projectsHomePath: true },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    const path = this.resolveProjectsHome(workspace.projectsHomePath);
    return { path, configured: workspace.projectsHomePath !== null };
  }

  async setProjectsHome(workspaceId: string, requestedPath: string) {
    const projectsHomePath = this.validateProjectsHome(requestedPath);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        projectsHomePath: true,
        _count: { select: { projects: true } },
      },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    if (
      workspace._count.projects > 0 &&
      this.resolveProjectsHome(workspace.projectsHomePath) !== projectsHomePath
    )
      throw new ConflictException(
        "Projects home cannot change after projects have been created",
      );
    await this.ensureHomeDirectory(projectsHomePath);
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { projectsHomePath },
    });
    return { path: projectsHomePath, configured: true };
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
        creator: { select: { id: true, displayName: true } },
        _count: { select: { members: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return projects;
  }

  async create(actor: AuthenticatedUser, dto: CreateProjectDto) {
    const directoryName = validateProjectDirectoryName(dto.name);
    const existing = await this.prisma.project.findFirst({
      where: { workspaceId: actor.workspaceId, directoryName },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException("A project with this name exists");

    const projectDirectory = await this.projectDirectoryForWorkspace(
      actor.workspaceId,
      directoryName,
    );
    if (await exists(projectDirectory))
      throw new ConflictException("The project directory already exists");
    try {
      await fs.mkdir(projectDirectory);
    } catch (error) {
      throw filesystemError(error, "Unable to create the project directory");
    }

    try {
      return await this.prisma.project.create({
        data: {
          workspaceId: actor.workspaceId,
          creatorId: actor.id,
          name: dto.name.trim(),
          directoryName,
          description: dto.description?.trim() || null,
          readAccessEnabled: dto.readAccessEnabled ?? false,
          members: { create: { userId: actor.id } },
        },
        include: {
          creator: { select: { id: true, displayName: true } },
          members: {
            include: {
              user: { select: { id: true, displayName: true, role: true } },
            },
          },
        },
      });
    } catch (error) {
      // The directory is deliberately kept for an operator to inspect. Removing it
      // after a failed database write could erase files concurrently added by a user.
      throw error;
    }
  }

  async get(actor: AuthenticatedUser, projectId: string) {
    const access = await this.assertReadAccess(actor, projectId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        creator: { select: { id: true, displayName: true } },
        members: {
          include: {
            user: { select: { id: true, displayName: true, role: true } },
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
        user: { select: { id: true, displayName: true, role: true } },
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

  private resolveProjectsHome(configuredPath: string | null) {
    const defaultPath =
      process.env.PROBOXAI_PROJECTS_HOME ?? this.allowedWorkspaceRoot();
    return this.validateProjectsHome(configuredPath ?? defaultPath);
  }

  private validateProjectsHome(requestedPath: string) {
    if (!path.isAbsolute(requestedPath))
      throw new BadRequestException("Projects home must be an absolute path");
    const resolved = path.resolve(requestedPath);
    const allowedRoot = this.allowedWorkspaceRoot();
    if (!isWithin(allowedRoot, resolved))
      throw new BadRequestException(
        `Projects home must be inside ${allowedRoot}`,
      );
    return resolved;
  }

  private allowedWorkspaceRoot() {
    const configured =
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT ?? "/opt/apps";
    if (!path.isAbsolute(configured))
      throw new Error(
        "PROBOXAI_ALLOWED_WORKSPACE_ROOT must be an absolute path",
      );
    return path.resolve(configured);
  }

  private async projectDirectoryForWorkspace(
    workspaceId: string,
    directoryName: string,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { projectsHomePath: true },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    const home = this.resolveProjectsHome(workspace.projectsHomePath);
    await this.ensureHomeDirectory(home);
    return path.join(home, directoryName);
  }

  private async resolveProjectPath(
    project: { workspaceId: string; directoryName: string },
    relativePath: string,
    allowRoot: boolean,
  ) {
    const normalized = normalizeRelativePath(relativePath, allowRoot);
    const projectDirectory = await this.projectDirectoryForWorkspace(
      project.workspaceId,
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
    project: { workspaceId: string; directoryName: string },
    target: string,
  ) {
    const projectDirectory = await this.projectDirectoryForWorkspace(
      project.workspaceId,
      project.directoryName,
    );
    await assertNoSymlinks(projectDirectory, target);
  }

  private async ensureHomeDirectory(home: string) {
    const allowedRoot = this.allowedWorkspaceRoot();
    await fs.mkdir(allowedRoot, { recursive: true });
    await assertNoSymlinks(allowedRoot, allowedRoot);
    await fs.mkdir(home, { recursive: true });
    await assertNoSymlinks(allowedRoot, home);
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
