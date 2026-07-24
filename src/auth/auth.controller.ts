import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { RequestOtpDto, VerifyOtpDto, VerifyOtpResponseDto } from "./auth.dto";
import {
  ApiErrorResponseDto,
  ApiIntegrationUnavailable,
  ApiValidationErrors,
} from "../openapi/api-docs";

@Controller("auth")
@ApiTags("Authentication")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("otp/request")
  @HttpCode(204)
  @ApiOperation({
    summary: "Request a Telegram login code",
    description:
      "Delivers a six-digit OTP to an active account with a verified Telegram chat. To prevent account enumeration and brute force, unknown, inactive, unverified, or rate-limited accounts receive the same `204` response.",
  })
  @ApiNoContentResponse({
    description:
      "Request accepted. A code is sent when the account is eligible.",
  })
  @ApiValidationErrors()
  @ApiIntegrationUnavailable()
  async request(@Body() dto: RequestOtpDto) {
    await this.auth.requestOtp(dto.phoneNumber);
  }
  @Post("otp/verify")
  @ApiOperation({
    summary: "Verify a Telegram login code",
    description:
      "Codes expire after five minutes, are single-use, and allow at most five failed attempts.",
  })
  @ApiOkResponse({
    description: "Authenticated successfully.",
    type: VerifyOtpResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      "The code is invalid, expired, consumed, or has exhausted its attempts.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phoneNumber, dto.code);
  }
}
