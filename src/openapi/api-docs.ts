import { applyDecorators } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

/** Standard NestJS error envelope returned by this API. */
export class ApiErrorResponseDto {
  @ApiProperty({ example: 400, description: "HTTP status code." })
  statusCode!: number;

  @ApiProperty({
    example: ["path must be relative"],
    description: "Human-readable error message, or validation messages.",
    oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  })
  message!: string | string[];

  @ApiProperty({ example: "Bad Request", description: "HTTP error name." })
  error!: string;

  @ApiPropertyOptional({
    enum: [
      "TEMPLATE_MANIFEST_INVALID",
      "TEMPLATE_STORAGE_UNAVAILABLE",
      "TEMPLATE_SLUG_CONFLICT",
      "TEMPLATE_VERSION_CONFLICT",
      "TEMPLATE_FILE_CONFLICT",
      "TEMPLATE_ARCHIVED",
      "TEMPLATE_DRAFT_EXISTS",
      "TEMPLATE_PUBLISHED_VERSION_MISSING",
      "TEMPLATE_FILE_LIMIT",
      "TEMPLATE_VERSION_LIMIT",
      "TEMPLATE_DRAFT_NOT_FOUND",
      "INPUT_INVALID",
      "RESOURCE_NOT_FOUND",
      "CONSTRAINT_CONFLICT",
      "STATE_CONFLICT",
      "USER_PHONE_CONFLICT",
      "SELF_USER_PROTECTED",
      "USER_OWNS_PROJECTS",
      "ROLE_KEY_CONFLICT",
      "ROLE_SYSTEM_PROTECTED",
      "SELF_ROLE_PROTECTED",
      "ROLE_ASSIGNED",
      "PERMISSION_KEYS_UNKNOWN",
      "ROLE_IDS_INVALID",
      "SELF_PERMISSION_GRANT_PROTECTED",
      "SELF_MANAGEMENT_PROTECTED",
      "DEPARTMENT_SLUG_CONFLICT",
      "DEPARTMENT_DEFAULT_CONFLICT",
      "DEPARTMENT_HOME_IN_USE",
      "DEPARTMENT_ARCHIVED",
      "DEPARTMENT_IS_DEFAULT",
      "DEFAULT_DEPARTMENT_MISSING",
      "DEPARTMENT_NAME_INVALID",
      "HOME_PATH_INVALID",
      "HOME_CONFIGURATION_INVALID",
      "HOME_PROVISIONING_FAILED",
      "TASK_BOARD_ACCESS_CHANGED",
      "TASK_BOARD_NOT_FOUND",
      "TASK_BOARD_ACCESS_DENIED",
      "TASK_BOARD_UNAVAILABLE",
      "TASK_BOARD_OPERATION_NOT_FOUND",
      "TASK_BOARD_REQUEST_CONFLICT",
      "TASK_BOARD_PROJECT_DELETING",
      "TASK_BOARD_SCOPE_INVALID",
      "TASK_BOARD_MOVE_ASSIGNMENT_REQUIRED",
      "HUMAN_TASK_OPERATION_REJECTED",
      "HUMAN_TASK_QUERY_REJECTED",
      "HUMAN_TASK_QUERY_CHANGED",
      "HUMAN_TASK_QUERY_SCOPE_LIMIT",
      "GROUP_REQUEST_CONFLICT",
      "GROUP_NOT_FOUND",
      "STATUS_NAME_INVALID",
      "STATUS_LIMIT",
      "STATUS_NOT_FOUND",
      "STATUS_EDIT_EMPTY",
      "STATUS_ORDER_INVALID",
      "STATUS_LAST_REQUIRED",
      "STATUS_REPLACEMENT_INVALID",
      "STATUS_IN_USE",
      "REVISION_REQUIRED",
      "REVISION_INVALID",
      "STALE_REVISION",
      "REVISION_EXHAUSTED",
      "TASK_DEADLINE_INVALID",
      "TASK_DEADLINE_UNAVAILABLE",
      "TASK_DEADLINE_ACCESS_CHANGED",
      "TASK_DEADLINE_NOT_FOUND",
      "TASK_DEADLINE_REQUEST_CONFLICT",
      "TASK_DEADLINE_OPERATION_NOT_FOUND",
      "TASK_DEADLINE_PROJECT_INACTIVE",
    ],
    description:
      "Stable domain failure category on admin/department/template/workflow/deadline errors; absent on standard validation, authentication and unexpected errors.",
  })
  code?: string;

  @ApiPropertyOptional({
    description:
      "Operation requiring corrective action; never an identity or server path.",
  })
  action?: string;

  @ApiPropertyOptional({
    description: "Input field requiring correction, when applicable.",
  })
  field?: string;

  @ApiPropertyOptional({
    type: () => ApiIssueResponseDto,
    isArray: true,
    description:
      "Template validation/publish issues. Locations use caller manifest field/index paths, not database/storage paths.",
  })
  issues?: ApiIssueResponseDto[];
}

export class ApiIssueResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ example: "commandStages.0.commands.1.arguments" })
  location!: string;
}

export const ApiTemplateErrors = () =>
  applyDecorators(
    ApiValidationErrors(),
    ApiResourceErrors(),
    ApiAuthenticationErrors(),
    ApiServiceUnavailableResponse({
      type: ApiErrorResponseDto,
      description:
        "TEMPLATE_STORAGE_UNAVAILABLE. Infrastructure/authentication/network failure, not proof that any object is missing. Mutation outcomes can require rereading.",
    }),
  );

/** Documents the bearer token required by authenticated endpoints. */
export const ApiAccessToken = () => ApiBearerAuth("access-token");

export const ApiUploadSizeError = () =>
  ApiPayloadTooLargeResponse({
    type: ApiErrorResponseDto,
    description:
      "The multipart file exceeds the effective per-file limit. Exactly maxUploadBytes/maxFileBytes is accepted. The server validates every request.",
  });

/** Admin/department operations preserve the standard error envelope. */
export const ApiOperationErrors = (provisionsHome = false) =>
  applyDecorators(
    ApiValidationErrors(),
    ApiResourceErrors(),
    ...(provisionsHome
      ? [
          ApiServiceUnavailableResponse({
            type: ApiErrorResponseDto,
            description:
              "HOME_CONFIGURATION_INVALID or HOME_PROVISIONING_FAILED (homePath, provisionHome). No database write was attempted; a directory may have been created. Correct configuration/access before retrying.",
          }),
        ]
      : []),
  );

/** Errors shared by endpoints that accept validated request input. */
export const ApiValidationErrors = () =>
  applyDecorators(
    ApiBadRequestResponse({
      description: "The request body, path, or query parameters are invalid.",
      type: ApiErrorResponseDto,
    }),
    ApiInternalServerErrorResponse({
      description:
        "An unexpected server error occurred. Mutation outcome may be unknown; reread before retrying. Never treat this as an empty read or a confirmed failed write.",
      type: ApiErrorResponseDto,
    }),
  );

/** Errors shared by endpoints that require an access token. */
export const ApiAuthenticationErrors = () =>
  applyDecorators(
    ApiAuthenticationUnavailable(),
    ApiUnauthorizedResponse({
      description: "A bearer token is missing, invalid, or expired.",
      type: ApiErrorResponseDto,
    }),
    ApiForbiddenResponse({
      description:
        "The authenticated user is not permitted to perform this action.",
      type: ApiErrorResponseDto,
    }),
  );

export const ApiAuthenticationUnavailable = () =>
  ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "Authentication infrastructure is unavailable. This is not a credential rejection or anonymous access; preserve signed-in context and retry later.",
  });

/** Common errors for protected resources addressed by an identifier. */
export const ApiResourceErrors = () =>
  applyDecorators(
    ApiNotFoundResponse({
      description:
        "The requested resource does not exist or is outside the workspace.",
      type: ApiErrorResponseDto,
    }),
    ApiConflictResponse({
      description: "The request conflicts with the current resource state.",
      type: ApiErrorResponseDto,
    }),
  );

/** Error used when an optional integration is not configured. */
export const ApiIntegrationUnavailable = () =>
  ApiServiceUnavailableResponse({
    description:
      "The required external integration is not configured or unavailable.",
    type: ApiErrorResponseDto,
  });
