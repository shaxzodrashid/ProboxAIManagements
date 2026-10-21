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
    type: String,
    example: "REVISION_REQUIRED",
    description:
      "Optional domain failure category. Open string vocabulary: consult the operation-specific code contract. Absent on standard validation, authentication and unexpected errors.",
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

/** Authentication and post-authentication content failures remain distinct. */
export const ApiReadAvailability = () =>
  ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "Authentication or content-read dependency is temporarily unavailable. Content reads use READ_DEPENDENCY_UNAVAILABLE with an operation action. No empty-data success, identity invalidation or automatic retry is implied; mutation outcomes have separate recovery contracts.",
  });

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
