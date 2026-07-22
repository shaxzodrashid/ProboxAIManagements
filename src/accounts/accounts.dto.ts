import { IsEnum, IsString, Matches, MaxLength } from "class-validator";
import { UserRole } from "@prisma/client";
export class CreateUserDto {
  @IsString() @MaxLength(120) displayName!: string;
  @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phoneNumber!: string;
  @IsEnum(UserRole) role!: UserRole;
}
