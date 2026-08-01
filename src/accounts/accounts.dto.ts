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
} from "class-validator";
import { UserStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
export class CreateUserDto {
  @ApiProperty({ example: "Ada Lovelace", maxLength: 120 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

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

export class UserResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "Ada Lovelace" }) fullName!: string;
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
