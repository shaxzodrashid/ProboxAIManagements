import { IsEnum, IsString, Matches, MaxLength } from "class-validator";
import { UserRole } from "@prisma/client";
import { ApiProperty } from "@nestjs/swagger";
export class CreateUserDto {
  @ApiProperty({ example: "Ada Lovelace", maxLength: 120 })
  @IsString()
  @MaxLength(120)
  displayName!: string;

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
  @ApiProperty({ example: "Ada Lovelace" }) displayName!: string;
  @ApiProperty({ example: "+998901234567" }) phoneNumber!: string;
  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER }) role!: UserRole;
  @ApiProperty({ enum: ["PENDING", "ACTIVE", "SUSPENDED"], example: "ACTIVE" })
  status!: "PENDING" | "ACTIVE" | "SUSPENDED";
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
