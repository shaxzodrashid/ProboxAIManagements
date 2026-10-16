import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import {
  ApiHeader,
  ApiConflictResponse,
  ApiResponse,
  ApiProperty,
} from "@nestjs/swagger";
import { applyDecorators } from "@nestjs/common";
import { operationError } from "./operation-errors";
export function parseRevision(value: unknown): number {
  if (value === undefined)
    throw operationError(
      428,
      "REVISION_REQUIRED",
      "If-Match with the current quoted revision is required",
      "checkRevision",
    );
  if (typeof value !== "string" || !/^"(0|[1-9][0-9]*)"$/.test(value))
    throw operationError(
      400,
      "REVISION_INVALID",
      "If-Match must contain one quoted nonnegative integer revision",
      "checkRevision",
    );
  const revision = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(revision) || revision > 2147483646)
    throw operationError(
      400,
      "REVISION_INVALID",
      "Revision is out of range",
      "checkRevision",
    );
  return revision;
}
export const ExpectedRevision = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    parseRevision(context.switchToHttp().getRequest().headers["if-match"]),
);
export const ApiRevision = (scope = "department/version") =>
  applyDecorators(
    ApiHeader({
      name: "If-Match",
      required: true,
      example: '"0"',
      description: `Exact quoted revision from the current ${scope} snapshot. Preserve entered data on 409, reread and resolve; never automatically replay stale edits.`,
    }),
    ApiConflictResponse({
      description:
        "STALE_REVISION or lifecycle conflict; no mutation committed.",
    }),
    ApiResponse({
      status: 428,
      description: "REVISION_REQUIRED: missing If-Match.",
    }),
  );
export class RevisionResponseDto {
  @ApiProperty({
    type: "integer",
    minimum: 0,
    description: "Optimistic mutation revision; send quoted in If-Match.",
  })
  revision!: number;
}
