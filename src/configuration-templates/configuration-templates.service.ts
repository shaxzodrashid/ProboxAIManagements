import {
  BadRequestException,
  HttpException,
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
import { finished } from "node:stream/promises";
import * as path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeProjectRelativePath } from "../storage/workspace-path-policy.service";
import { configuredUploadLimit } from "../storage/upload-limits";
import { operationError } from "../openapi/operation-errors";
import {
  manifestIssue,
  objectMissing,
  storageUnavailable,
  templateWriteError,
} from "./template-errors";
import {
  templateScalar,
  versionScalar,
  templateFile,
  templateManifest,
  templateWithVersions,
} from "./template-projections";
import { structuredCommandArguments } from "./command-arguments";
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
    return configuredUploadLimit(
      "PROBOXAI_TEMPLATE_FILE_MAX_BYTES",
      100 * 1024 * 1024,
    );
  }

  static maxVersionBytes() {
    return configuredUploadLimit(
      "PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES",
      1024 * 1024 * 1024,
    );
  }

  uploadConfiguration() {
    return {
      maxFileBytes: ConfigurationTemplatesService.maxFileBytes(),
      maxVersionBytes: ConfigurationTemplatesService.maxVersionBytes(),
      requestMode: "single-file" as const,
    };
  }

  async revision(workspaceId: string, id: string) {
    const version = await this.prisma.configurationTemplateVersion.findFirst({
      where: { id, template: { workspaceId } },
      select: { revision: true },
    });
    if (!version) throw new NotFoundException("Template version not found");
    return version;
  }

  async list(workspaceId: string, admin: boolean, departmentId?: string) {
    const templates = await this.prisma.configurationTemplate.findMany({
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
    return templates.map((t) => templateWithVersions(t, versionScalar));
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
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Configuration template not found",
        "readTemplate",
      );
    return templateWithVersions(template, templateManifest);
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
      const created = await this.prisma.configurationTemplate.create({
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
      return templateWithVersions(created, versionScalar);
    } catch (error) {
      templateWriteError(error, "writeTemplateMetadata");
    }
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateConfigurationTemplateDto,
  ) {
    await this.assertTemplate(workspaceId, id);
    try {
      const updated = await this.prisma.configurationTemplate.update({
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
      return templateScalar(updated);
    } catch (error) {
      templateWriteError(error, "writeTemplateMetadata");
    }
  }

  async createDraft(workspaceId: string, templateId: string, actorId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "ConfigurationTemplate" WHERE "id" = ${templateId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
          const template = await tx.configurationTemplate.findFirst({
            where: { id: templateId, workspaceId },
          });
          if (!template)
            throw new NotFoundException("Configuration template not found");
          if (template.status === ConfigurationTemplateStatus.ARCHIVED)
            throw operationError(
              409,
              "TEMPLATE_ARCHIVED",
              "Archived templates cannot receive new drafts",
              "createTemplateDraft",
            );
          const versions = await tx.configurationTemplateVersion.findMany({
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
            throw operationError(
              409,
              "TEMPLATE_DRAFT_EXISTS",
              "The template already has an editable draft",
              "createTemplateDraft",
            );
          const source = versions.find(
            (version) =>
              version.status === ConfigurationTemplateVersionStatus.PUBLISHED,
          );
          if (!source)
            throw operationError(
              409,
              "TEMPLATE_PUBLISHED_VERSION_MISSING",
              "The template has no published version to clone",
              "createTemplateDraft",
            );
          const draft = await tx.configurationTemplateVersion
            .create({
              data: {
                templateId,
                version: source.version + 1,
                creatorId: actorId,
                folders: {
                  create: source.folders.map((folder) => ({
                    path: folder.path,
                  })),
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
                        arguments:
                          command.type === TemplateCommandType.STRUCTURED
                            ? structuredCommandArguments(
                                command.arguments,
                                true,
                              )
                            : Prisma.JsonNull,
                        script: command.script,
                        workingDirectory: command.workingDirectory,
                        timeoutSeconds: command.timeoutSeconds,
                      })),
                    },
                  })),
                },
              },
              include: manifestInclude,
            })
            .catch((error) => templateWriteError(error, "createTemplateDraft"));
          return templateManifest(draft);
        },
        { timeout: 30000 },
      );
    } catch (error) {
      templateWriteError(error, "createTemplateDraft");
    }
  }

  async replaceManifest(
    workspaceId: string,
    versionId: string,
    dto: ReplaceTemplateManifestDto,
    expectedRevision?: number,
  ) {
    const manifest = validateManifest(dto);
    return this.mutateDraft(
      workspaceId,
      versionId,
      expectedRevision,
      async (tx, version) => {
        validatePublishedManifest({
          folders: manifest.folders,
          files: version.files,
          commandStages: [],
        });
        for (const file of version.files)
          validateFileParent(
            file.destinationPath,
            manifest.folders.map((f) => f.path),
          );
        await tx.configurationTemplateCommandStage.deleteMany({
          where: { versionId },
        });
        await tx.configurationTemplateFolder.deleteMany({
          where: { versionId },
        });
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

        const saved = await tx.configurationTemplateVersion.findUniqueOrThrow({
          where: { id: versionId },
          include: manifestInclude,
        });
        return templateManifest(saved);
      },
    );
  }

  async uploadFile(
    workspaceId: string,
    versionId: string,
    destinationPath: string,
    file: UploadedTemplateFile,
    expectedRevision?: number,
  ) {
    const version = await this.assertDraft(
      workspaceId,
      versionId,
      expectedRevision,
    );
    const normalized = checkedRelativePath(
      destinationPath,
      false,
      "destinationPath",
    );
    validateFileParent(
      normalized,
      version.folders.map((folder) => folder.path),
    );
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      (file.buffer && file.buffer.length !== file.size)
    )
      throw new BadRequestException("Uploaded file size is invalid");
    if (file.size > ConfigurationTemplatesService.maxFileBytes())
      throw operationError(
        400,
        "TEMPLATE_FILE_LIMIT",
        "Template file exceeds the configured limit",
        "uploadTemplateFile",
        "file",
      );
    const aggregate = await this.prisma.configurationTemplateFile.aggregate({
      where: { versionId },
      _sum: { size: true },
    });
    if (
      (aggregate._sum.size ?? 0) + file.size >
      ConfigurationTemplatesService.maxVersionBytes()
    )
      throw operationError(
        400,
        "TEMPLATE_VERSION_LIMIT",
        "Template version exceeds the configured total size",
        "uploadTemplateFile",
        "file",
      );
    const existing = await this.prisma.configurationTemplateFile.findUnique({
      where: {
        versionId_destinationPath: { versionId, destinationPath: normalized },
      },
    });
    if (existing)
      throw operationError(
        409,
        "TEMPLATE_FILE_CONFLICT",
        "A file is already registered at this path",
        "uploadTemplateFile",
        "destinationPath",
      );
    if (!file.buffer && !file.path)
      throw new BadRequestException("Uploaded file content is unavailable");
    const sha256 = file.buffer
      ? createHash("sha256").update(file.buffer).digest("hex")
      : await hashFile(file.path!);
    const objectKey = `workspaces/${workspaceId}/templates/${version.templateId}/versions/${version.version}/${randomUUID()}`;
    const body = file.buffer ?? createReadStream(file.path!);
    const streamClosed = Buffer.isBuffer(body)
      ? Promise.resolve()
      : finished(body).catch(() => undefined);
    try {
      await this.storage.putObject(
        objectKey,
        body,
        file.size,
        file.mimetype || "application/octet-stream",
        sha256,
      );
    } catch {
      storageUnavailable();
    } finally {
      if (!Buffer.isBuffer(body)) body.destroy();
      await streamClosed;
    }
    try {
      return await this.mutateDraft(
        workspaceId,
        versionId,
        expectedRevision ?? version.revision,
        async (tx, current) => {
          validateFileParent(
            normalized,
            current.folders.map((f) => f.path),
          );
          validatePublishedManifest({
            folders: current.folders,
            files: [...current.files, { destinationPath: normalized }],
            commandStages: [],
          });
          const sum = current.files.reduce(
            (total, item) => total + item.size,
            0,
          );
          if (sum + file.size > ConfigurationTemplatesService.maxVersionBytes())
            throw operationError(
              400,
              "TEMPLATE_VERSION_LIMIT",
              "Template version exceeds the configured total size",
              "uploadTemplateFile",
              "file",
            );
          const registered = await tx.configurationTemplateFile.create({
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
          return {
            ...templateFile(registered),
            versionRevision: current.revision,
          };
        },
      );
    } catch (error) {
      // Preserve the uploaded object if a successful commit lost its acknowledgement.
      if (
        (error instanceof HttpException &&
          [400, 404, 409].includes(error.getStatus())) ||
        error instanceof Prisma.PrismaClientValidationError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2002", "P2003", "P2025", "P2034"].includes(error.code))
      )
        await this.queueCleanup(objectKey);
      templateWriteError(error, "registerTemplateFile");
    }
  }

  async moveFile(
    workspaceId: string,
    versionId: string,
    fileId: string,
    dto: MoveTemplateFileDto,
    expectedRevision?: number,
  ) {
    const normalized = checkedRelativePath(
      dto.destinationPath,
      false,
      "destinationPath",
    );
    return this.mutateDraft(
      workspaceId,
      versionId,
      expectedRevision,
      async (tx, version) => {
        validateFileParent(
          normalized,
          version.folders.map((f) => f.path),
        );
        const file = version.files.find((f) => f.id === fileId);
        if (!file)
          throw operationError(
            404,
            "RESOURCE_NOT_FOUND",
            "Template file not found",
            "readTemplateFile",
          );
        validatePublishedManifest({
          folders: version.folders,
          files: [
            ...version.files.filter((f) => f.id !== fileId),
            { destinationPath: normalized },
          ],
          commandStages: [],
        });
        const moved = await tx.configurationTemplateFile.update({
          where: { id: fileId },
          data: { destinationPath: normalized },
        });
        return { ...templateFile(moved), versionRevision: version.revision };
      },
    );
  }
  async removeFile(
    workspaceId: string,
    versionId: string,
    fileId: string,
    expectedRevision?: number,
  ) {
    const removed = await this.mutateDraft(
      workspaceId,
      versionId,
      expectedRevision,
      async (tx, version) => {
        const file = version.files.find((f) => f.id === fileId);
        if (!file)
          throw operationError(
            404,
            "RESOURCE_NOT_FOUND",
            "Template file not found",
            "readTemplateFile",
          );
        await tx.configurationTemplateFile.delete({ where: { id: fileId } });
        return { objectKey: file.objectKey, versionRevision: version.revision };
      },
    );
    const remaining = await this.prisma.configurationTemplateFile.count({
      where: { objectKey: removed.objectKey },
    });
    if (!remaining) await this.queueCleanup(removed.objectKey);
    return { deleted: true, versionRevision: removed.versionRevision };
  }

  async publish(
    workspaceId: string,
    versionId: string,
    actorId: string,
    expectedRevision?: number,
  ) {
    const version = await this.assertDraft(
      workspaceId,
      versionId,
      expectedRevision,
    );
    validatePublishedManifest(version);
    for (const [index, file] of version.files.entries()) {
      let head;
      try {
        head = await this.storage.headObject(file.objectKey);
      } catch (error) {
        if (objectMissing(error))
          throw manifestIssue(
            409,
            "TEMPLATE_OBJECT_MISSING",
            "Stored template file is missing",
            `files.${index}.destinationPath`,
          );
        storageUnavailable();
      }
      if (
        Number(head.ContentLength) !== file.size ||
        head.Metadata?.sha256 !== file.sha256
      )
        throw manifestIssue(
          409,
          "TEMPLATE_OBJECT_MISMATCH",
          "Stored template file metadata does not match",
          `files.${index}.destinationPath`,
        );
    }
    return this.mutateDraft(
      workspaceId,
      versionId,
      expectedRevision ?? version.revision,
      async (tx) => {
        const published = await tx.configurationTemplateVersion
          .update({
            where: { id: versionId },
            data: {
              status: ConfigurationTemplateVersionStatus.PUBLISHED,
              publishedAt: new Date(),
              publishedById: actorId,
            },
            include: manifestInclude,
          })
          .catch((error) => templateWriteError(error, "publishTemplate"));
        return templateManifest(published);
      },
    );
  }

  async archive(workspaceId: string, id: string) {
    await this.assertTemplate(workspaceId, id);
    const archived = await this.prisma.configurationTemplate
      .update({
        where: { id },
        data: { status: ConfigurationTemplateStatus.ARCHIVED },
      })
      .catch((error) => templateWriteError(error, "archiveTemplate"));
    return templateScalar(archived);
  }

  private async assertTemplate(workspaceId: string, id: string) {
    const template = await this.prisma.configurationTemplate.findFirst({
      where: { id, workspaceId },
    });
    if (!template)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Configuration template not found",
        "readTemplate",
      );
    return template;
  }

  private async assertDraft(
    workspaceId: string,
    versionId: string,
    expectedRevision?: number,
  ) {
    const version = await this.prisma.configurationTemplateVersion.findFirst({
      where: {
        id: versionId,
        template: { workspaceId },
      },
      include: manifestInclude,
    });
    if (!version)
      throw operationError(
        404,
        "TEMPLATE_DRAFT_NOT_FOUND",
        "Editable template version not found",
        "editTemplateVersion",
      );
    if (version.status !== ConfigurationTemplateVersionStatus.DRAFT)
      throw operationError(
        409,
        "TEMPLATE_VERSION_IMMUTABLE",
        "Published versions cannot be modified",
        "editTemplateVersion",
      );
    if (expectedRevision !== undefined && version.revision !== expectedRevision)
      throw operationError(
        409,
        "STALE_REVISION",
        "Template changed; preserve entered values and reread before retrying",
        "editTemplateVersion",
      );
    return version;
  }

  private async mutateDraft<T>(
    workspaceId: string,
    versionId: string,
    expectedRevision: number | undefined,
    mutate: (
      tx: Prisma.TransactionClient,
      version: Prisma.ConfigurationTemplateVersionGetPayload<{
        include: typeof manifestInclude;
      }>,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const row = await tx.configurationTemplateVersion.findFirst({
            where: { id: versionId, template: { workspaceId } },
            include: manifestInclude,
          });
          if (!row)
            throw operationError(
              404,
              "TEMPLATE_DRAFT_NOT_FOUND",
              "Editable template version not found",
              "editTemplateVersion",
            );
          if (row.status !== ConfigurationTemplateVersionStatus.DRAFT)
            throw operationError(
              409,
              "TEMPLATE_VERSION_IMMUTABLE",
              "Published versions cannot be modified",
              "editTemplateVersion",
            );
          if (
            expectedRevision !== undefined &&
            row.revision !== expectedRevision
          )
            throw operationError(
              409,
              "STALE_REVISION",
              "Template changed; preserve entered values and reread before retrying",
              "editTemplateVersion",
            );
          const claimed = await tx.configurationTemplateVersion.updateMany({
            where: {
              id: versionId,
              revision: row.revision,
              status: ConfigurationTemplateVersionStatus.DRAFT,
            },
            data: { revision: { increment: 1 } },
          });
          if (!claimed.count)
            throw operationError(
              409,
              "STALE_REVISION",
              "Template changed concurrently; reread before retrying",
              "editTemplateVersion",
            );
          const current =
            await tx.configurationTemplateVersion.findUniqueOrThrow({
              where: { id: versionId },
              include: manifestInclude,
            });
          return mutate(tx, current);
        },
        { timeout: 30000 },
      );
    } catch (error) {
      templateWriteError(error, "editTemplateVersion");
    }
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

function checkedRelativePath(
  value: string,
  allowRoot: boolean,
  location: string,
) {
  try {
    return normalizeProjectRelativePath(value, allowRoot);
  } catch {
    throw manifestIssue(
      400,
      "PATH_INVALID",
      "Path must be a safe project-relative path",
      location,
    );
  }
}

function validateManifest(dto: ReplaceTemplateManifestDto) {
  const folders = dto.folders.map((folder, index) => ({
    path: checkedRelativePath(folder.path, false, `folders.${index}.path`),
  }));
  if (new Set(folders.map((folder) => folder.path)).size !== folders.length)
    throw manifestIssue(
      400,
      "PATH_DUPLICATE",
      "Folder paths must be unique",
      "folders",
    );
  const commandStages = dto.commandStages.map((stage, stagePosition) => ({
    name: stage.name.trim(),
    position: stagePosition,
    mode: stage.mode,
    maxConcurrency:
      stage.mode === TemplateCommandStageMode.SEQUENTIAL
        ? 1
        : (stage.maxConcurrency ?? 4),
    commands: stage.commands.map((command, commandPosition) => {
      const location = `commandStages.${stagePosition}.commands.${commandPosition}`;
      const workingDirectory = checkedRelativePath(
        command.workingDirectory,
        true,
        `${location}.workingDirectory`,
      );
      if (
        workingDirectory &&
        !folders.some((folder) => folder.path === workingDirectory)
      )
        throw manifestIssue(
          400,
          "COMMAND_FOLDER_INVALID",
          `Command working directory must be declared as a folder: ${workingDirectory}`,
          `${location}.workingDirectory`,
        );
      if (command.type === TemplateCommandType.STRUCTURED) {
        if (!command.executable?.trim() || command.script !== undefined)
          throw manifestIssue(
            400,
            "COMMAND_MODE_INVALID",
            "Structured commands require executable and cannot contain script",
            location,
          );
        try {
          structuredCommandArguments(command.arguments);
        } catch (error) {
          throw manifestIssue(
            400,
            "COMMAND_ARGUMENTS_INVALID",
            (error as Error).message,
            `${location}.arguments`,
          );
        }
      } else if (
        !command.script?.trim() ||
        command.executable !== undefined ||
        command.arguments !== undefined
      ) {
        throw manifestIssue(
          400,
          "COMMAND_MODE_INVALID",
          "Shell commands require script and cannot contain executable or arguments",
          location,
        );
      }
      return {
        name: command.name.trim(),
        position: commandPosition,
        type: command.type,
        executable: command.executable?.trim() || null,
        arguments:
          command.type === TemplateCommandType.STRUCTURED
            ? structuredCommandArguments(command.arguments)
            : Prisma.JsonNull,
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
  commandStages: Array<{
    commands: Array<{
      workingDirectory: string;
      type: TemplateCommandType;
      executable: string | null;
      arguments: Prisma.JsonValue | null;
      script: string | null;
    }>;
  }>;
}) {
  const folders = new Set(version.folders.map((folder) => folder.path));
  const files = new Set<string>();
  for (const [fileIndex, file] of version.files.entries()) {
    if (files.has(file.destinationPath) || folders.has(file.destinationPath))
      throw manifestIssue(
        409,
        "PATH_DUPLICATE",
        `Duplicate template path: ${file.destinationPath}`,
        `files.${fileIndex}.destinationPath`,
      );
    validateFileParent(
      file.destinationPath,
      [...folders],
      `files.${fileIndex}.destinationPath`,
    );
    files.add(file.destinationPath);
  }
  for (const folder of folders) {
    for (const file of files)
      if (folder.startsWith(`${file}/`))
        throw manifestIssue(
          409,
          "PATH_ANCESTOR_CONFLICT",
          `File path is an ancestor of folder: ${file}`,
          "folders",
        );
  }
  for (const [stageIndex, stage] of version.commandStages.entries())
    for (const [commandIndex, command] of stage.commands.entries()) {
      const location = `commandStages.${stageIndex}.commands.${commandIndex}`;
      if (command.type === TemplateCommandType.STRUCTURED) {
        if (!command.executable?.trim() || command.script != null)
          throw manifestIssue(
            409,
            "COMMAND_MODE_INVALID",
            "Structured commands require executable and cannot contain script",
            location,
          );
        try {
          structuredCommandArguments(command.arguments, true);
        } catch (error) {
          throw manifestIssue(
            409,
            "COMMAND_ARGUMENTS_INVALID",
            (error as Error).message,
            `${location}.arguments`,
          );
        }
      } else if (
        !command.script?.trim() ||
        command.executable != null ||
        command.arguments != null
      ) {
        throw manifestIssue(
          409,
          "COMMAND_MODE_INVALID",
          "Shell commands require script and cannot contain executable or arguments",
          location,
        );
      }
      if (command.workingDirectory && !folders.has(command.workingDirectory))
        throw manifestIssue(
          409,
          "COMMAND_FOLDER_INVALID",
          `Command folder does not exist: ${command.workingDirectory}`,
          `${location}.workingDirectory`,
        );
    }
}

function validateFileParent(
  destinationPath: string,
  folders: string[],
  location = "destinationPath",
) {
  const parent = path.posix.dirname(destinationPath);
  if (parent !== "." && !folders.includes(parent))
    throw manifestIssue(
      400,
      "FILE_PARENT_INVALID",
      `File parent must be declared as a folder: ${parent}`,
      location,
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
