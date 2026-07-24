import { IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RequestOtpDto {
  @ApiProperty({
    example: "+998901234567",
    description: "Active account phone number in E.164 format.",
    pattern: "^\\+[1-9]\\d{7,14}$",
  })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneNumber!: string;
}
export class VerifyOtpDto extends RequestOtpDto {
  @ApiProperty({
    example: "123456",
    description: "Six-digit code delivered to the account's Telegram chat.",
    pattern: "^\\d{6}$",
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class VerifyOtpResponseDto {
  @ApiProperty({
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    description:
      "JWT access token. Send it as `Authorization: Bearer <accessToken>` on protected endpoints.",
  })
  accessToken!: string;
}
