import { RevisionResponseDto } from "../openapi/revision";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DepartmentStatus } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
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
  @ApiPropertyOptional({
    example: "Brand and Marketing",
    maxLength: 120,
    description:
      "Omit to retain. Explicit null or empty name is rejected; clearing is unsupported.",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(NAME)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: "/opt/marketing",
    maxLength: 1024,
    description:
      "Omit to retain. Explicit null or empty home is rejected; clearing is unsupported. Must satisfy the existing absolute-path/root policy.",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  homePath?: string;
}

export class DepartmentResponseDto extends RevisionResponseDto {
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
  @ApiProperty({
    description:
      "True when the home was absent at the initial check and provisioning attempted creation. False for an existing home or an unchanged home. This is not proof of exclusive creation, ownership or continuing home health.",
  })
  homeCreated!: boolean;
}

export class ArchiveDepartmentDto {
  @ApiPropertyOptional({ enum: DepartmentStatus, default: "ARCHIVED" })
  @IsOptional()
  @IsEnum(DepartmentStatus)
  status?: DepartmentStatus;
}
