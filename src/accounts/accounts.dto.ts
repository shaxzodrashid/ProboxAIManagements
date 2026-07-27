import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserRole, UserStatus } from "@prisma/client";
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

  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER })
  @IsEnum(UserRole)
  role!: UserRole;
}

export class UserResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "Ada Lovelace" }) fullName!: string;
  @ApiProperty({ example: "ada.lovelace", nullable: true })
  username!: string | null;
  @ApiProperty({ example: "+998901234567" }) phoneNumber!: string;
  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER }) role!: UserRole;
  @ApiProperty({ enum: UserStatus, example: UserStatus.OPEN })
  status!: UserStatus;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
