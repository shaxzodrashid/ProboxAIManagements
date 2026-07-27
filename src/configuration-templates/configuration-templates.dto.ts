import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TemplateCommandStageMode, TemplateCommandType } from "@prisma/client";

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;

export class CreateConfigurationTemplateDto {
  @ApiProperty({ format: "uuid" })
  @IsString()
  @MaxLength(128)
  departmentId!: string;

  @ApiProperty({ example: "Marketing brand book", maxLength: 120 })
  @IsString()
  @Matches(NAME)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}

export class UpdateConfigurationTemplateDto {
  @ApiPropertyOptional({ example: "Marketing brand book", maxLength: 120 })
  @IsOptional()
  @IsString()
  @Matches(NAME)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}

export class TemplateFolderInputDto {
  @ApiProperty({ example: "docs/brand" })
  @IsString()
  @MaxLength(1024)
  path!: string;
}

export class TemplateCommandInputDto {
  @ApiProperty({ example: "Install dependencies", maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: TemplateCommandType })
  @IsEnum(TemplateCommandType)
  type!: TemplateCommandType;

  @ApiPropertyOptional({ example: "/usr/bin/pnpm" })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  executable?: string;

  @ApiPropertyOptional({ type: String, isArray: true, example: ["install"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(4096, { each: true })
  arguments?: string[];

  @ApiPropertyOptional({ example: "set -euo pipefail\npnpm install" })
  @IsOptional()
  @IsString()
  @MaxLength(32000)
  script?: string;

  @ApiProperty({
    example: "",
    description: "Project-relative working directory.",
  })
  @IsString()
  @MaxLength(1024)
  workingDirectory!: string;

  @ApiPropertyOptional({ default: 900, minimum: 1, maximum: 3600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  timeoutSeconds?: number;
}

export class TemplateCommandStageInputDto {
  @ApiProperty({ example: "Bootstrap", maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: TemplateCommandStageMode })
  @IsEnum(TemplateCommandStageMode)
  mode!: TemplateCommandStageMode;

  @ApiPropertyOptional({ default: 4, minimum: 1, maximum: 32 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32)
  maxConcurrency?: number;

  @ApiProperty({ type: TemplateCommandInputDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateCommandInputDto)
  commands!: TemplateCommandInputDto[];
}

export class ReplaceTemplateManifestDto {
  @ApiProperty({ type: TemplateFolderInputDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFolderInputDto)
  folders!: TemplateFolderInputDto[];

  @ApiProperty({ type: TemplateCommandStageInputDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateCommandStageInputDto)
  commandStages!: TemplateCommandStageInputDto[];
}

export class UploadTemplateFileDto {
  @ApiProperty({ example: "docs/brand/brand-book.pdf", maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  destinationPath!: string;
}

export class MoveTemplateFileDto {
  @ApiProperty({ example: "docs/brand/brand-book.pdf", maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  destinationPath!: string;
}

export class ConfigurationTemplateResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) departmentId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: ["ACTIVE", "ARCHIVED"] }) status!: string;
  @ApiProperty({ type: "array", items: { type: "object" } })
  versions!: unknown[];
}
