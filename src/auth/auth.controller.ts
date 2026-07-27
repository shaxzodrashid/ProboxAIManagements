import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import {
  AccessTokenResponseDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  RequestOtpDto,
  ResetPasswordDto,
  SuccessMessageDto,
  TemporaryTokenResponseDto,
  TokenPairResponseDto,
  UsernameAvailabilityResponseDto,
  UsernameDto,
  VerifyOtpDto,
} from "./auth.dto";
import {
  ApiErrorResponseDto,
  ApiIntegrationUnavailable,
  ApiValidationErrors,
} from "../openapi/api-docs";

@Controller("auth")
@ApiTags("Authentication")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("registration/otp/send")
  @HttpCode(200)
  @ApiOperation({
    summary: "Send a registration OTP through Telegram",
    description:
      "Accepts only a phone number and UZ, RU, or EN locale. The phone must belong to a pre-created PENDING identity whose matching contact was shared with the Telegram bot. The formal Telegram message displays the code as a spoiler and tells the user it is valid for one minute; the technical expiry window is five minutes.",
  })
  @ApiOkResponse({ description: "OTP sent.", type: SuccessMessageDto })
  @ApiNotFoundResponse({
    description: "No pre-created identity has this phone number.",
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: "The phone has not been verified through the Telegram bot.",
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: "The identity has already completed registration.",
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: "Three OTPs have already been requested in ten minutes.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  @ApiIntegrationUnavailable()
  sendRegistrationOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestRegistrationOtp(dto.phoneNumber, dto.locale);
  }

  @Post("registration/otp/verify")
  @HttpCode(200)
  @ApiOperation({
    summary: "Verify a registration OTP",
    description:
      "Verifies the newest unconsumed registration code. A code is technically valid for five minutes and permits at most five failed attempts. Success returns a single-use cryptographically random registration token valid for ten minutes.",
  })
  @ApiOkResponse({
    description: "OTP verified.",
    type: TemporaryTokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: "The OTP is invalid, expired, consumed, or attempt-limited.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  verifyRegistrationOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyRegistrationOtp(dto.phoneNumber, dto.code);
  }

  @Get("usernames/availability")
  @ApiOperation({ summary: "Check username availability" })
  @ApiOkResponse({ type: UsernameAvailabilityResponseDto })
  @ApiValidationErrors()
  usernameAvailability(@Query() dto: UsernameDto) {
    return this.auth.usernameAvailability(dto.username);
  }

  @Post("registration")
  @HttpCode(200)
  @ApiBearerAuth("temporary-token")
  @ApiOperation({
    summary: "Complete platform registration",
    description:
      "Send the temporary registration token as `Authorization: Bearer <temporaryToken>`. The token is purpose-bound and single-use. A successful request stores the normalized unique username and scrypt password hash, then changes the user status from PENDING to OPEN.",
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  @ApiUnauthorizedResponse({
    description: "The temporary token is missing, invalid, expired, or used.",
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: "The username is taken or the identity cannot register.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  register(
    @Headers("authorization") authorization: string | undefined,
    @Body() dto: RegisterDto,
  ) {
    return this.auth.register(authorization, dto);
  }

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in with username and password" })
  @ApiOkResponse({
    description:
      "Returns a 30-minute JWT access token and a one-month opaque refresh token.",
    type: TokenPairResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: "Credentials are invalid or the user is not OPEN.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Refresh an access token" })
  @ApiOkResponse({
    description:
      "Returns only a new 30-minute access token. The refresh token is not rotated.",
    type: AccessTokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: "The refresh token is invalid, expired, or revoked.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("password-reset/otp/send")
  @HttpCode(200)
  @ApiOperation({
    summary: "Send a password-reset OTP through Telegram",
    description:
      "Uses the same localized Telegram verification controls as registration, but requires an OPEN account.",
  })
  @ApiOkResponse({ description: "OTP sent.", type: SuccessMessageDto })
  @ApiNotFoundResponse({
    description: "No pre-created identity has this phone number.",
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: "The phone has not been verified through the Telegram bot.",
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: "The account cannot reset its password.",
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: "Three OTPs have already been requested in ten minutes.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  @ApiIntegrationUnavailable()
  sendPasswordResetOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestPasswordResetOtp(dto.phoneNumber, dto.locale);
  }

  @Post("password-reset/otp/verify")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify a password-reset OTP" })
  @ApiOkResponse({ type: TemporaryTokenResponseDto })
  @ApiUnauthorizedResponse({
    description: "The OTP is invalid, expired, consumed, or attempt-limited.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  verifyPasswordResetOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyPasswordResetOtp(dto.phoneNumber, dto.code);
  }

  @Post("password-reset")
  @HttpCode(200)
  @ApiBearerAuth("temporary-token")
  @ApiOperation({
    summary: "Set a new password",
    description:
      "Send the temporary password-reset token as `Authorization: Bearer <temporaryToken>`. Success consumes the token and revokes every refresh token for the account.",
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  @ApiUnauthorizedResponse({
    description: "The temporary token is missing, invalid, expired, or used.",
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: "The account cannot reset its password.",
    type: ApiErrorResponseDto,
  })
  @ApiValidationErrors()
  resetPassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.auth.resetPassword(authorization, dto);
  }
}
