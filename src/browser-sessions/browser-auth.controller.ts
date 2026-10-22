import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiProperty,
  ApiHeader,
} from "@nestjs/swagger";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import {
  RegisterDto,
  RequestOtpDto,
  ResetPasswordDto,
  VerifyOtpDto,
  UsernameDto,
  SuccessMessageDto,
  UsernameAvailabilityResponseDto,
} from "../auth/auth.dto";
import {
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { BrowserSessionService } from "./browser-session.service";

export class BrowserVerificationResponseDto {
  @ApiProperty({
    description:
      "Session-bound verification handle; not an original API bearer token. Keep only in memory and send as X-Browser-Grant to the matching browser completion route.",
    pattern: "^[A-Za-z0-9_-]{64}$",
  })
  temporaryToken!: string;
  @ApiProperty({ type: "integer", minimum: 1, maximum: 600 })
  expiresInSeconds!: number;
}

@Controller("browser/auth")
@ApiTags("Browser authentication")
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
export class BrowserAuthController {
  constructor(
    private readonly sessions: BrowserSessionService,
    private readonly auth: AuthService,
  ) {}

  @Post("registration/otp/send")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Send activation code for the anonymous browser" })
  @ApiOkResponse({ type: SuccessMessageDto })
  async sendRegistration(@Req() req: Request, @Body() dto: RequestOtpDto) {
    await this.sessions.anonymous(req);
    return this.auth.requestRegistrationOtp(dto.phoneNumber, dto.locale);
  }
  @Post("password-reset/otp/send")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Send password recovery code for the anonymous browser",
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  async sendRecovery(@Req() req: Request, @Body() dto: RequestOtpDto) {
    await this.sessions.anonymous(req);
    return this.auth.requestPasswordResetOtp(dto.phoneNumber, dto.locale);
  }
  @Post("registration/otp/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Verify activation code",
    description:
      "Returns a session-bound opaque handle in temporaryToken, not a bearer token. Keep in memory and send as X-Browser-Grant to browser/auth/registration.",
  })
  @ApiOkResponse({ type: BrowserVerificationResponseDto })
  async verifyRegistration(@Req() req: Request, @Body() dto: VerifyOtpDto) {
    await this.sessions.anonymous(req);
    const grant = await this.auth.verifyRegistrationOtp(
      dto.phoneNumber,
      dto.code,
    );
    return this.sessions.rememberGrant(req, "registration", grant);
  }
  @Post("password-reset/otp/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Verify recovery code",
    description:
      "Returns a session-bound handle in temporaryToken. Send as X-Browser-Grant to browser/auth/password-reset. Does not expose the server-held temporary credential.",
  })
  @ApiOkResponse({ type: BrowserVerificationResponseDto })
  async verifyRecovery(@Req() req: Request, @Body() dto: VerifyOtpDto) {
    await this.sessions.anonymous(req);
    const grant = await this.auth.verifyPasswordResetOtp(
      dto.phoneNumber,
      dto.code,
    );
    return this.sessions.rememberGrant(req, "password-reset", grant);
  }
  @Get("usernames/availability")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Check username availability in the anonymous browser",
  })
  @ApiOkResponse({ type: UsernameAvailabilityResponseDto })
  async availability(@Req() req: Request, @Query() dto: UsernameDto) {
    await this.sessions.anonymous(req);
    return this.auth.usernameAvailability(dto.username);
  }
  @Post("registration")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Complete browser activation",
    description:
      "Requires cookie, Origin, CSRF and X-Browser-Grant from this browser's activation verification. Does not sign in automatically.",
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  @ApiHeader({
    name: "X-Browser-Grant",
    required: true,
    description: "Handle from this browser session activation verification.",
  })
  async register(@Req() req: Request, @Body() dto: RegisterDto) {
    const token = await this.sessions.temporaryGrant(req, "registration");
    const value = await this.auth.register("Bearer " + token, dto);
    await this.sessions.forgetGrant(req);
    return value;
  }
  @Post("password-reset")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Complete browser password recovery",
    description:
      "Requires cookie, Origin, CSRF and this browser's recovery X-Browser-Grant. Existing refresh sessions are revoked by the original auth service.",
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  @ApiHeader({
    name: "X-Browser-Grant",
    required: true,
    description: "Handle from this browser session recovery verification.",
  })
  async reset(@Req() req: Request, @Body() dto: ResetPasswordDto) {
    const token = await this.sessions.temporaryGrant(req, "password-reset");
    const value = await this.auth.resetPassword("Bearer " + token, dto);
    await this.sessions.forgetGrant(req);
    return value;
  }
}
