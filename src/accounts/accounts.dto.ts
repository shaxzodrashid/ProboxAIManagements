import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  Validate,
} from "class-validator";
import { UserStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { BirthDateValidator } from "./profile-birthday";
/** Profile content routes accept identity only from the path/current authentication. */
export class ProfileQueryDto {}

export class CreateUserDto {
  @ApiProperty({
    required: false,
    deprecated: true,
    example: "Ada Lovelace",
    maxLength: 120,
    description:
      "Legacy creation input. Supply either fullName or nonempty structured names, never both.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiProperty({
    required: false,
    maxLength: 120,
    description:
      "Independent name component; multiword names supported. At least one name component is required for structured creation.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName?: string;

  @ApiProperty({
    required: false,
    maxLength: 120,
    description: "Independent name component. No mandatory last name.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName?: string;

  @ApiProperty({ example: "+998901234567", pattern: "^\\+[1-9]\\d{7,14}$" })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneNumber!: string;

  @ApiProperty({
    type: String,
    isArray: true,
    format: "uuid",
    description: "One or more role IDs from GET /api/v1/authorization/roles.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  roleIds?: string[];

  @ApiProperty({
    required: false,
    deprecated: true,
    enum: ["ADMIN", "MANAGER", "MEMBER"],
    description:
      "Compatibility input for one built-in role. New clients must use roleIds.",
  })
  @IsOptional()
  @IsIn(["ADMIN", "MANAGER", "MEMBER"])
  role?: string;
}

export class UserRoleSummaryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "MANAGER" }) key!: string;
  @ApiProperty({ example: "Manager" }) name!: string;
}

export class UpdateSelfProfileDto {
  @ApiProperty({
    type: String,
    format: "date",
    nullable: true,
    required: false,
    description:
      "Self-only calendar date YYYY-MM-DD. Omit to retain; null clears. No age restriction.",
  })
  @IsOptional()
  @Validate(BirthDateValidator)
  birthDate?: string | null;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    maxLength: 120,
    description:
      "Omit to retain; null clears. Nonempty after trimming. A name update must leave at least one nonempty component.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName?: string | null;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    maxLength: 120,
    description:
      "Omit to retain; null clears. Nonempty after trimming. Last name is never mandatory.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName?: string | null;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    maxLength: 1000,
    description:
      "Plain text. Omit to retain; null clears; empty string is retained.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string | null;
}

export class SelfProfileResponseDto {
  @ApiProperty({ type: String, format: "date", nullable: true }) birthDate!:
    string | null;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({
    description:
      "Composed firstName then lastName, or untouched legacy fullName until structured names are supplied.",
  })
  displayName!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 120 }) firstName!:
    string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 120 }) lastName!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
  @ApiProperty() phoneNumber!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 1000 }) bio!:
    string | null;
}

export class UserResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "Ada Lovelace" }) fullName!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 120 }) firstName!:
    string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 120 }) lastName!:
    string | null;
  @ApiProperty({ example: "ada.lovelace", nullable: true })
  username!: string | null;
  @ApiProperty({ example: "+998901234567" }) phoneNumber!: string;
  @ApiProperty({ type: UserRoleSummaryDto, isArray: true })
  roles!: UserRoleSummaryDto[];
  @ApiProperty({
    nullable: true,
    deprecated: true,
    enum: ["ADMIN", "MANAGER", "MEMBER"],
    description:
      "Derived compatibility value. Null when no built-in role is assigned.",
  })
  role!: string | null;
  @ApiProperty({ enum: UserStatus, example: UserStatus.OPEN })
  status!: UserStatus;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
