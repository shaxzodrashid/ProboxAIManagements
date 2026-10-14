import {
  ConfigurationTemplate,
  ConfigurationTemplateVersion,
  ConfigurationTemplateFile,
  ConfigurationTemplateFolder,
  ConfigurationTemplateCommand,
  ConfigurationTemplateCommandStage,
  TemplateCommandType,
  Prisma,
} from "@prisma/client";
import { structuredCommandArguments } from "./command-arguments";
import type { manifestInclude } from "./configuration-templates.service";

export function templateScalar(t: ConfigurationTemplate) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    departmentId: t.departmentId,
    name: t.name,
    slug: t.slug,
    description: t.description,
    status: t.status,
    creatorId: t.creatorId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
export function versionScalar(v: ConfigurationTemplateVersion) {
  return {
    id: v.id,
    templateId: v.templateId,
    version: v.version,
    revision: v.revision,
    status: v.status,
    creatorId: v.creatorId,
    publishedById: v.publishedById,
    publishedAt: v.publishedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}
export function templateFile(f: ConfigurationTemplateFile) {
  return {
    id: f.id,
    versionId: f.versionId,
    destinationPath: f.destinationPath,
    originalName: f.originalName,
    contentType: f.contentType,
    size: f.size,
    sha256: f.sha256,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
function folder(f: ConfigurationTemplateFolder) {
  return {
    id: f.id,
    versionId: f.versionId,
    path: f.path,
    createdAt: f.createdAt,
  };
}
function command(c: ConfigurationTemplateCommand) {
  return {
    id: c.id,
    stageId: c.stageId,
    name: c.name,
    position: c.position,
    type: c.type,
    executable: c.executable,
    arguments:
      c.type === TemplateCommandType.STRUCTURED
        ? structuredCommandArguments(c.arguments, true)
        : null,
    script: c.script,
    workingDirectory: c.workingDirectory,
    timeoutSeconds: c.timeoutSeconds,
  };
}
function stage(
  s: ConfigurationTemplateCommandStage & {
    commands: ConfigurationTemplateCommand[];
  },
) {
  return {
    id: s.id,
    versionId: s.versionId,
    name: s.name,
    position: s.position,
    mode: s.mode,
    maxConcurrency: s.maxConcurrency,
    commands: s.commands.map(command),
  };
}
export function templateManifest(
  v: Prisma.ConfigurationTemplateVersionGetPayload<{
    include: typeof manifestInclude;
  }>,
) {
  return {
    ...versionScalar(v),
    folders: v.folders.map(folder),
    files: v.files.map(templateFile),
    commandStages: v.commandStages.map(stage),
  };
}
export function templateWithVersions<V extends ConfigurationTemplateVersion, R>(
  t: ConfigurationTemplate & {
    department: { id: string; name: string; slug: string };
    versions: V[];
  },
  project: (v: V) => R,
) {
  return {
    ...templateScalar(t),
    department: {
      id: t.department.id,
      name: t.department.name,
      slug: t.department.slug,
    },
    versions: t.versions.map(project),
  };
}
