import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RequestOtpDto, VerifyOtpDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("otp/request") @HttpCode(204) async request(
    @Body() dto: RequestOtpDto,
  ) {
    await this.auth.requestOtp(dto.phoneNumber);
  }
  @Post("otp/verify") verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phoneNumber, dto.code);
  }
}
