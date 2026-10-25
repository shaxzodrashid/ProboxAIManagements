import {
  IsString,
  MaxLength,
  MinLength,
  ValidateBy,
  IsEnum,
  Matches,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { AuthLocale } from "../auth/auth.dto";

export class EmptyBrowserBodyDto {
  @ValidateBy({
    name: "emptyBody",
    validator: {
      validate: (value, args) =>
        value === undefined &&
        !!args &&
        Object.keys(args.object).every((key) => key === "_empty"),
      defaultMessage: () => "Body must be an empty object",
    },
  })
  private readonly _empty?: never;
}

export class ReauthenticateDto {
  @ApiProperty({ format: "password", minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class SendStepUpOtpDto {
  @ApiProperty({ enum: AuthLocale })
  @IsEnum(AuthLocale)
  locale!: AuthLocale;
}

export class VerifyStepUpOtpDto {
  @ApiProperty({ pattern: "^\\d{6}$" })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
