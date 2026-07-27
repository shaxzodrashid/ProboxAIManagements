import { Transform } from "class-transformer";
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export enum AuthLocale {
  UZ = "UZ",
  RU = "RU",
  EN = "EN",
}

export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/;
export const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;

export class RequestOtpDto {
  @ApiProperty({
    example: "+998901234567",
    description: "Pre-registered phone number in E.164 format.",
    pattern: "^\\+[1-9]\\d{7,14}$",
  })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneNumber!: string;

  @ApiProperty({
    enum: AuthLocale,
    example: AuthLocale.UZ,
    description: "Locale of the formal Telegram OTP message.",
  })
  @IsEnum(AuthLocale)
  locale!: AuthLocale;
}

export class VerifyOtpDto {
  @ApiProperty({ example: "+998901234567", pattern: "^\\+[1-9]\\d{7,14}$" })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneNumber!: string;

  @ApiProperty({
    example: "123456",
    description: "Six-digit code delivered to the linked Telegram chat.",
    pattern: "^\\d{6}$",
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class UsernameDto {
  @ApiProperty({
    example: "ada.lovelace",
    minLength: 3,
    maxLength: 32,
    pattern: "^[a-zA-Z][a-zA-Z0-9._-]{2,31}$",
    description:
      "Case-insensitive username beginning with a letter. Letters, numbers, dot, underscore, and hyphen are allowed.",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(USERNAME_PATTERN)
  username!: string;
}

export class RegisterDto extends UsernameDto {
  @ApiProperty({
    example: "Correct-Horse-42!",
    minLength: 12,
    maxLength: 128,
    format: "password",
    description:
      "At least 12 characters with uppercase, lowercase, number, and symbol.",
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  password!: string;

  @ApiProperty({ example: "Correct-Horse-42!", format: "password" })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  passwordConfirmation!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    example: "New-Correct-Horse-42!",
    minLength: 12,
    maxLength: 128,
    format: "password",
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  password!: string;

  @ApiProperty({ example: "New-Correct-Horse-42!", format: "password" })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  passwordConfirmation!: string;
}

export class LoginDto extends UsernameDto {
  @ApiProperty({ example: "Correct-Horse-42!", format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    example: "J6nM9bY...",
    description: "Opaque refresh token returned by the login endpoint.",
  })
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}

export class TemporaryTokenResponseDto {
  @ApiProperty({
    example: "U5JrCQs...",
    description:
      "Single-use, opaque token. Send it as a Bearer token to the matching final endpoint.",
  })
  temporaryToken!: string;

  @ApiProperty({ example: 600 }) expiresInSeconds!: number;
}

export class TokenPairResponseDto {
  @ApiProperty({ description: "JWT access token valid for 30 minutes." })
  accessToken!: string;
  @ApiProperty({ description: "Opaque refresh token valid for one month." })
  refreshToken!: string;
}

export class AccessTokenResponseDto {
  @ApiProperty({ description: "JWT access token valid for 30 minutes." })
  accessToken!: string;
}

export class UsernameAvailabilityResponseDto {
  @ApiProperty({ example: "ada.lovelace" }) username!: string;
  @ApiProperty({ example: true }) available!: boolean;
}

export class SuccessMessageDto {
  @ApiProperty({ example: "Registration completed successfully." })
  message!: string;
}
