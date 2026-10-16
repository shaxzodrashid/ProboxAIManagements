import { RevisionResponseDto } from "../openapi/revision";
import { Transform } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateRoleDto {
  @ApiProperty({ example: "project-reviewer", maxLength: 64 })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/)
  key!: string;

  @ApiProperty({ example: "Project reviewer", maxLength: 120 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ type: String, isArray: true, example: ["projects.read"] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: "Senior project reviewer", maxLength: 120 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: String, isArray: true, example: ["projects.read"] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class SetUserRolesDto {
  @ApiProperty({ type: String, isArray: true, format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  roleIds!: string[];
}

export class PermissionResponseDto {
  @ApiProperty({ example: "projects.read" }) key!: string;
  @ApiProperty({ example: "View accessible projects" }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: "Projects" }) category!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class RoleResponseDto extends RevisionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "project-reviewer" }) key!: string;
  @ApiProperty({ example: "Project reviewer" }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ type: PermissionResponseDto, isArray: true })
  permissions!: PermissionResponseDto[];
  @ApiProperty({ example: 2 }) userCount!: number;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class DeletedRoleResponseDto extends RevisionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class AssignedRoleResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
}

export class UserRolesResponseDto extends RevisionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ type: AssignedRoleResponseDto, isArray: true })
  roles!: AssignedRoleResponseDto[];
}
