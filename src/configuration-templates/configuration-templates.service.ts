import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ConfigurationTemplateStatus,
  ConfigurationTemplateVersionStatus,
  Prisma,
  TemplateCommandStageMode,
  TemplateCommandType,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeProjectRelativePath } from "../storage/workspace-path-policy.service";
import {
  CreateConfigurationTemplateDto,
  MoveTemplateFileDto,
  ReplaceTemplateManifestDto,
  UpdateConfigurationTemplateDto,
} from "./configuration-templates.dto";
import { TemplateStorageService } from "./template-storage.service";

type UploadedTemplateFile = {
  originalname: string;
  mimetype: string;
  buffer?: Buffer;
  path?: string;
  size: number;
};

@Injectable()
export class ConfigurationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: TemplateStorageService,
  ) {}

  static maxFileBytes() {
    return configuredLimit(
      "PROBOXAI_TEMPLATE_FILE_MAX_BYTES",
      100 * 1024 * 1024,
    );
  }

  static maxVersionBytes() {
    return configuredLimit(
      "PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES",
      1024 * 1024 * 1024,
    );
  }

  list(workspaceId: string, admin: boolean, departmentId?: string) {
    return this.prisma.configurationTemplate.findMany({
      where: {
        workspaceId,
        ...(departmentId ? { departmentId } : {}),
        ...(admin ? {} : { status: ConfigurationTemplateStatus.ACTIVE }),
      },
      include: {
        department: { select: { id: true, name: true, slug: true } },
        versions: {
          where: admin
            ? undefined
            : { status: ConfigurationTemplateVersionStatus.PUBLISHED },
          orderBy: { version: "desc" },
          take: 2,
        },
      },
      orderBy: { name: "asc" },
    });
  }

  async get(workspaceId: string, id: string, admin: boolean) {
    const template = await this.prisma.configurationTemplate.findFirst({
      where: {
        id,
        workspaceId,
        ...(admin ? {} : { status: ConfigurationTemplateStatus.ACTIVE }),
      },
      include: {
        department: true,
        versions: {
          where: admin
            ? undefined
            : { status: ConfigurationTemplateVersionStatus.PUBLISHED },
          include: manifestInclude,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!template)
      throw new NotFoundException("Configuration template not found");
    return template;
  }

  async create(
    workspaceId: string,
    actorId: string,
    dto: CreateConfigurationTemplateDto,
  ) {
    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, workspaceId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!department) throw new NotFoundException("Active department not found");
    try {
      return await this.prisma.configurationTemplate.create({
        data: {
          workspaceId,
          departmentId: department.id,
          creatorId: actorId,
          name: dto.name.trim(),
          slug: slugify(dto.name),
          description: dto.description?.trim() || null,
          versions: { create: { version: 1, creatorId: actorId } },
        },
        include: { versions: true, department: true },
      });
    } catch (error) {
      if (isUniqueError(error))
        throw new ConflictException(
          "A template with this name exists in the department",
        );
      throw error;
    }
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateConfigurationTemplateDto,
  ) {
    await this.assertTemplate(workspaceId, id);
    try {
      return await this.prisma.configurationTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined
            ? { name: dto.name.trim(), slug: slugify(dto.name) }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
        },
      });
    } catch (error) {
      if (isUniqueError(error))
        throw new ConflictException(
          "A template with this name exists in the department",
        );
      throw error;
    }
  }

  async createDraft(workspaceId: string, templateId: string, actorId: string) {
    const template = await this.assertTemplate(workspaceId, templateId);
    if (template.status === ConfigurationTemplateStatus.ARCHIVED)
      throw new ConflictException(
        "Archived templates cannot receive new drafts",
      );
    const versions = await this.prisma.configurationTemplateVersion.findMany({
      where: { templateId },
      include: manifestInclude,
      orderBy: { version: "desc" },
    });
    if (
      versions.some(
        (version) =>
          version.status === ConfigurationTemplateVersionStatus.DRAFT,
      )
    )
      throw new ConflictException("The template already has an editable draft");
    const source = versions.find(
      (version) =>
        version.status === ConfigurationTemplateVersionStatus.PUBLISHED,
    );
    if (!source)
      throw new ConflictException(
        "The template has no published version to clone",
      );
    return this.prisma.configurationTemplateVersion.create({
      data: {
        templateId,
        version: source.version + 1,
        creatorId: actorId,
        folders: {
          create: source.folders.map((folder) => ({ path: folder.path })),
        },
        files: {
          create: source.files.map((file) => ({
            destinationPath: file.destinationPath,
            objectKey: file.objectKey,
            originalName: file.originalName,
            contentType: file.contentType,
            size: file.size,
            sha256: file.sha256,
          })),
        },
        commandStages: {
          create: source.commandStages.map((stage) => ({
            name: stage.name,
            position: stage.position,
            mode: stage.mode,
            maxConcurrency: stage.maxConcurrency,
            commands: {
              create: stage.commands.map((command) => ({
                name: command.name,
                position: command.position,
                type: command.type,
                executable: command.executable,
                arguments: command.arguments ?? undefined,
                script: command.script,
                workingDirectory: command.workingDirectory,
                timeoutSeconds: command.timeoutSeconds,
              })),
            },
          })),
        },
      },
      include: manifestInclude,
    });
  }

  async replaceManifest(
    workspaceId: string,
    versionId: string,
    dto: ReplaceTemplateManifestDto,
  ) {
    const version = await this.assertDraft(workspaceId, versionId);
    const manifest = validateManifest(dto);
    await this.prisma.$transaction(async (tx) => {
      await tx.configurationTemplateCommandStage.deleteMany({
        where: { versionId },
      });
      await tx.configurationTemplateFolder.deleteMany({ where: { versionId } });
      if (manifest.folders.length)
        await tx.configurationTemplateFolder.createMany({
          data: manifest.folders.map((folder) => ({
            versionId,
            path: folder.path,
          })),
        });
      for (const stage of manifest.commandStages) {
        await tx.configurationTemplateCommandStage.create({
          data: {
            versionId,
            name: stage.name,
            position: stage.position,
            mode: stage.mode,
            maxConcurrency: stage.maxConcurrency,
            commands: { create: stage.commands },
          },
        });
      }
    });
    return this.prisma.configurationTemplateVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: manifestInclude,
    });
  }

  async uploadFile(
    workspaceId: string,
    versionId: string,
    destinationPath: string,
    file: UploadedTemplateFile,
  ) {
    const version = await this.assertDraft(workspaceId, versionId);
    const normalized = normalizeProjectRelativePath(destinationPath);
    validateFileParent(
      normalized,
      version.folders.map((folder) => folder.path),
    );
    if (file.size > ConfigurationTemplatesService.maxFileBytes())
      throw new BadRequestException(
        "Template file exceeds the configured limit",
      );
    const aggregate = await this.prisma.configurationTemplateFile.aggregate({
      where: { versionId },
      _sum: { size: true },
    });
    if (
      (aggregate._sum.size ?? 0) + file.size >
      ConfigurationTemplatesService.maxVersionBytes()
    )
      throw new BadRequestException(
        "Template version exceeds the configured total size",
      );
    const existing = await this.prisma.configurationTemplateFile.findUnique({
      where: {
        versionId_destinationPath: { versionId, destinationPath: normalized },
      },
    });
    if (existing)
      throw new ConflictException("A file is already registered at this path");
    if (!file.buffer && !file.path)
      throw new BadRequestException("Uploaded file content is unavailable");
    const sha256 = file.buffer
      ? createHash("sha256").update(file.buffer).digest("hex")
      : await hashFile(file.path!);
    const objectKey = `workspaces/${workspaceId}/templates/${version.templateId}/versions/${version.version}/${randomUUID()}`;
    await this.storage.putObject(
      objectKey,
      file.buffer ?? createReadStream(file.path!),
      file.size,
      file.mimetype || "application/octet-stream",
      sha256,
    );
    try {
      return await this.prisma.configurationTemplateFile.create({
        data: {
          versionId,
          destinationPath: normalized,
          objectKey,
          originalName: safeOriginalName(file.originalname),
          contentType: file.mimetype || "application/octet-stream",
          size: file.size,
          sha256,
        },
      });
    } catch (error) {
      await this.queueCleanup(objectKey);
      throw error;
    }
  }

  async moveFile(
    workspaceId: string,
    versionId: string,
    fileId: string,
    dto: MoveTemplateFileDto,
  ) {
    const version = await this.assertDraft(workspaceId, versionId);
    const normalized = normalizeProjectRelativePath(dto.destinationPath);
    validateFileParent(
      normalized,
      version.folders.map((folder) => folder.path),
    );
    const file = await this.prisma.configurationTemplateFile.findFirst({
      where: { id: fileId, versionId },
    });
    if (!file) throw new NotFoundException("Template file not found");
    return this.prisma.configurationTemplateFile.update({
      where: { id: fileId },
      data: { destinationPath: normalized },
    });
  }

  async removeFile(workspaceId: string, versionId: string, fileId: string) {
    await this.assertDraft(workspaceId, versionId);
    const file = await this.prisma.configurationTemplateFile.findFirst({
      where: { id: fileId, versionId },
    });
    if (!file) throw new NotFoundException("Template file not found");
    await this.prisma.configurationTemplateFile.delete({
      where: { id: fileId },
    });
    const remaining = await this.prisma.configurationTemplateFile.count({
      where: { objectKey: file.objectKey },
    });
    if (!remaining) await this.queueCleanup(file.objectKey);
    return { deleted: true };
  }

  async publish(workspaceId: string, versionId: string, actorId: string) {
    const version = await this.assertDraft(workspaceId, versionId);
    validatePublishedManifest(version);
    for (const file of version.files) {
      let head;
      try {
        head = await this.storage.headObject(file.objectKey);
      } catch {
        throw new ConflictException(
          `MinIO object is missing for ${file.destinationPath}`,
        );
      }
      if (
        Number(head.ContentLength) !== file.size ||
        head.Metadata?.sha256 !== file.sha256
      )
        throw new ConflictException(
          `MinIO metadata mismatch for ${file.destinationPath}`,
        );
    }
    return this.prisma.configurationTemplateVersion.update({
      where: { id: versionId },
      data: {
        status: ConfigurationTemplateVersionStatus.PUBLISHED,
        publishedAt: new Date(),
        publishedById: actorId,
      },
      include: manifestInclude,
    });
  }

  async archive(workspaceId: string, id: string) {
    await this.assertTemplate(workspaceId, id);
    return this.prisma.configurationTemplate.update({
      where: { id },
      data: { status: ConfigurationTemplateStatus.ARCHIVED },
    });
  }

  private async assertTemplate(workspaceId: string, id: string) {
    const template = await this.prisma.configurationTemplate.findFirst({
      where: { id, workspaceId },
    });
    if (!template)
      throw new NotFoundException("Configuration template not found");
    return template;
  }

  private async assertDraft(workspaceId: string, versionId: string) {
    const version = await this.prisma.configurationTemplateVersion.findFirst({
      where: {
        id: versionId,
        status: ConfigurationTemplateVersionStatus.DRAFT,
        template: { workspaceId },
      },
      include: manifestInclude,
    });
    if (!version)
      throw new NotFoundException("Editable template version not found");
    return version;
  }

  private async queueCleanup(objectKey: string) {
    try {
      await this.storage.deleteObject(objectKey);
    } catch (error) {
      await this.prisma.templateObjectCleanup.upsert({
        where: { objectKey },
        update: {
          status: "PENDING",
          lastError: String(error),
          nextAttemptAt: new Date(),
        },
        create: { objectKey, lastError: String(error) },
      });
    }
  }
}

export const manifestInclude = {
  folders: { orderBy: { path: "asc" as const } },
  files: { orderBy: { destinationPath: "asc" as const } },
  commandStages: {
    orderBy: { position: "asc" as const },
    include: { commands: { orderBy: { position: "asc" as const } } },
  },
};

function validateManifest(dto: ReplaceTemplateManifestDto) {
  const folders = dto.folders.map((folder) => ({
    path: normalizeProjectRelativePath(folder.path),
  }));
  if (new Set(folders.map((folder) => folder.path)).size !== folders.length)
    throw new BadRequestException("Folder paths must be unique");
  const commandStages = dto.commandStages.map((stage, stagePosition) => ({
    name: stage.name.trim(),
    position: stagePosition,
    mode: stage.mode,
    maxConcurrency:
      stage.mode === TemplateCommandStageMode.SEQUENTIAL
        ? 1
        : (stage.maxConcurrency ?? 4),
    commands: stage.commands.map((command, commandPosition) => {
      const workingDirectory = normalizeProjectRelativePath(
        command.workingDirectory,
        true,
      );
      if (
        workingDirectory &&
        !folders.some((folder) => folder.path === workingDirectory)
      )
        throw new BadRequestException(
          `Command working directory must be declared as a folder: ${workingDirectory}`,
        );
      if (command.type === TemplateCommandType.STRUCTURED) {
        if (!command.executable?.trim() || command.script !== undefined)
          throw new BadRequestException(
            "Structured commands require executable and cannot contain script",
          );
      } else if (
        !command.script?.trim() ||
        command.executable !== undefined ||
        command.arguments !== undefined
      ) {
        throw new BadRequestException(
          "Shell commands require script and cannot contain executable or arguments",
        );
      }
      return {
        name: command.name.trim(),
        position: commandPosition,
        type: command.type,
        executable: command.executable?.trim() || null,
        arguments: command.arguments ?? Prisma.JsonNull,
        script: command.script?.trim() || null,
        workingDirectory,
        timeoutSeconds: command.timeoutSeconds ?? 900,
      };
    }),
  }));
  return { folders, commandStages };
}

function validatePublishedManifest(version: {
  folders: Array<{ path: string }>;
  files: Array<{ destinationPath: string }>;
  commandStages: Array<{ commands: Array<{ workingDirectory: string }> }>;
}) {
  const folders = new Set(version.folders.map((folder) => folder.path));
  const files = new Set<string>();
  for (const file of version.files) {
    if (files.has(file.destinationPath) || folders.has(file.destinationPath))
      throw new ConflictException(
        `Duplicate template path: ${file.destinationPath}`,
      );
    validateFileParent(file.destinationPath, [...folders]);
    files.add(file.destinationPath);
  }
  for (const folder of folders) {
    for (const file of files)
      if (folder.startsWith(`${file}/`))
        throw new ConflictException(
          `File path is an ancestor of folder: ${file}`,
        );
  }
  for (const stage of version.commandStages)
    for (const command of stage.commands)
      if (command.workingDirectory && !folders.has(command.workingDirectory))
        throw new ConflictException(
          `Command folder does not exist: ${command.workingDirectory}`,
        );
}

function validateFileParent(destinationPath: string, folders: string[]) {
  const parent = path.posix.dirname(destinationPath);
  if (parent !== "." && !folders.includes(parent))
    throw new BadRequestException(
      `File parent must be declared as a folder: ${parent}`,
    );
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new BadRequestException("Template name has no usable slug");
  return slug;
}

function safeOriginalName(value: string) {
  return value.replace(/\\/g, "/").split("/").pop()?.slice(0, 255) || "file";
}

function configuredLimit(name: string, fallback: number) {
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 1024 * 1024 * 1024)
    : fallback;
}

function isUniqueError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

export async function removeTemporaryUpload(filePath?: string) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
