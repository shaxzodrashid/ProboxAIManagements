import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DepartmentStatus } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;

export class CreateDepartmentDto {
  @ApiProperty({ example: "Marketing", maxLength: 120 })
  @IsString()
  @Matches(NAME)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: "/opt/marketing", maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  homePath!: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ example: "Brand and Marketing", maxLength: 120 })
  @IsOptional()
  @IsString()
  @Matches(NAME)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: "/opt/marketing", maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  homePath?: string;
}

export class DepartmentResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ example: "Marketing" }) name!: string;
  @ApiProperty({ example: "marketing" }) slug!: string;
  @ApiProperty({ example: "/opt/marketing" }) homePath!: string;
  @ApiProperty({ example: false }) isDefault!: boolean;
  @ApiProperty({ enum: DepartmentStatus }) status!: DepartmentStatus;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class DepartmentHomeProvisioningResponseDto extends DepartmentResponseDto {
  @ApiProperty({ description: "True when the server created the directory." })
  homeCreated!: boolean;
}

export class ArchiveDepartmentDto {
  @ApiPropertyOptional({ enum: DepartmentStatus, default: "ARCHIVED" })
  @IsOptional()
  @IsEnum(DepartmentStatus)
  status?: DepartmentStatus;
}
