import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Additive machine-readable context; never include identities, paths or DB metadata. */
export function operationError(
  status: number,
  code: string,
  message: string,
  action: string,
  field?: string,
) {
  const names: Record<number, string> = {
    400: "Bad Request",
    403: "Forbidden",
    428: "Precondition Required",
    404: "Not Found",
    409: "Conflict",
    503: "Service Unavailable",
  };
  const body = {
    statusCode: status,
    error: names[status],
    message,
    code,
    action,
    ...(field ? { field } : {}),
  };
  switch (status) {
    case 400:
      return new BadRequestException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    case 503:
      return new ServiceUnavailableException(body);
    default:
      return new HttpException(body, status);
  }
}

export function uniqueTarget(error: unknown, columns: string[], index: string) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  )
    return false;
  const target = error.meta?.target;
  return (
    target === index ||
    (Array.isArray(target) &&
      target.length === columns.length &&
      columns.every((column) => target.includes(column)))
  );
}

/** Unknown failures retain 500 and must not be presented as a known failed write. */
export function databaseOperationError(error: unknown, action: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2028")
      throw operationError(
        503,
        "OPERATION_OUTCOME_UNKNOWN",
        "The operation could not be confirmed; reread and reconcile before retrying",
        action,
      );
    if (error.code === "P2002")
      throw operationError(
        409,
        "CONSTRAINT_CONFLICT",
        "The operation conflicts with an existing record",
        action,
      );
    if (error.code === "P2003" || error.code === "P2034")
      throw operationError(
        409,
        "STATE_CONFLICT",
        "Related records changed; reread before retrying",
        action,
      );
    if (error.code === "P2025")
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Resource not found",
        action,
      );
  }
  throw error;
}
