import { applyDecorators } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiProperty,
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
}

/** Documents the bearer token required by authenticated endpoints. */
export const ApiAccessToken = () => ApiBearerAuth("access-token");

/** Errors shared by endpoints that accept validated request input. */
export const ApiValidationErrors = () =>
  applyDecorators(
    ApiBadRequestResponse({
      description: "The request body, path, or query parameters are invalid.",
      type: ApiErrorResponseDto,
    }),
    ApiInternalServerErrorResponse({
      description: "An unexpected server error occurred.",
      type: ApiErrorResponseDto,
    }),
  );

/** Errors shared by endpoints that require an access token. */
export const ApiAuthenticationErrors = () =>
  applyDecorators(
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
