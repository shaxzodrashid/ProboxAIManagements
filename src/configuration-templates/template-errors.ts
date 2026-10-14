import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  databaseOperationError,
  operationError,
  uniqueTarget,
} from "../openapi/operation-errors";

export function manifestIssue(
  status: 400 | 409,
  code: string,
  message: string,
  location: string,
) {
  const body = {
    ...(operationError(
      status,
      "TEMPLATE_MANIFEST_INVALID",
      message,
      "validateManifest",
    ).getResponse() as object),
    issues: [{ code, message, location }],
  };
  return status === 400
    ? new BadRequestException(body)
    : new ConflictException(body);
}
export function objectMissing(error: unknown) {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name !== "NoSuchBucket" &&
    (e?.name === "NoSuchKey" ||
      e?.name === "NotFound" ||
      e?.$metadata?.httpStatusCode === 404)
  );
}
export function storageUnavailable(): never {
  throw operationError(
    503,
    "TEMPLATE_STORAGE_UNAVAILABLE",
    "Template storage is unavailable; retry after service recovery",
    "accessTemplateStorage",
  );
}
export function templateWriteError(error: unknown, action: string): never {
  if (
    uniqueTarget(
      error,
      ["templateId"],
      "ConfigurationTemplateVersion_one_draft_per_template",
    )
  )
    throw operationError(
      409,
      "TEMPLATE_DRAFT_EXISTS",
      "The template already has an editable draft; reread before retrying",
      action,
    );
  if (
    uniqueTarget(
      error,
      ["departmentId", "slug"],
      "ConfigurationTemplate_departmentId_slug_key",
    )
  )
    throw operationError(
      409,
      "TEMPLATE_SLUG_CONFLICT",
      "A template with this name exists in the department",
      action,
      "name",
    );
  if (
    uniqueTarget(
      error,
      ["templateId", "version"],
      "ConfigurationTemplateVersion_templateId_version_key",
    )
  )
    throw operationError(
      409,
      "TEMPLATE_VERSION_CONFLICT",
      "Template versions changed concurrently; reread before retrying",
      action,
    );
  if (
    uniqueTarget(
      error,
      ["versionId", "destinationPath"],
      "ConfigurationTemplateFile_versionId_destinationPath_key",
    )
  )
    throw operationError(
      409,
      "TEMPLATE_FILE_CONFLICT",
      "A file is already registered at this path",
      action,
      "destinationPath",
    );
  databaseOperationError(error, action);
}
