import { RevisionResponseDto } from "../openapi/revision";
import { ApiProperty } from "@nestjs/swagger";
import {
  ConfigurationTemplateStatus,
  ConfigurationTemplateVersionStatus,
  TemplateCommandStageMode,
  TemplateCommandType,
} from "@prisma/client";

export class TemplateUploadConfigurationResponseDto {
  @ApiProperty({ type: "integer", minimum: 1, maximum: 1073741824 })
  maxFileBytes!: number;
  @ApiProperty({ type: "integer", minimum: 1, maximum: 1073741824 })
  maxVersionBytes!: number;
  @ApiProperty({
    enum: ["single-file"],
    description:
      "multipart/form-data with one file named file and destinationPath; per-version total also enforced.",
  })
  requestMode!: "single-file";
}
export class TemplateDepartmentResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}
export class TemplateScalarResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ format: "uuid" }) departmentId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: ConfigurationTemplateStatus })
  status!: ConfigurationTemplateStatus;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}
export class TemplateVersionScalarResponseDto extends RevisionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) templateId!: string;
  @ApiProperty({ type: "integer" }) version!: number;
  @ApiProperty({ enum: ConfigurationTemplateVersionStatus })
  status!: ConfigurationTemplateVersionStatus;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  publishedById!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  publishedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}
export class TemplateFolderResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty() path!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
export class TemplateFileResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty() destinationPath!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty({ type: "integer" }) size!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}
export class TemplateFileMutationResponseDto extends TemplateFileResponseDto {
  @ApiProperty({ minimum: 0 }) versionRevision!: number;
}
export class TemplateCommandResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) stageId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: "integer" }) position!: number;
  @ApiProperty({ enum: TemplateCommandType }) type!: TemplateCommandType;
  @ApiProperty({ type: String, nullable: true }) executable!: string | null;
  @ApiProperty({
    type: String,
    isArray: true,
    nullable: true,
    description:
      "Structured argv; legacy structured null projects as []. Shell commands project null.",
  })
  arguments!: string[] | null;
  @ApiProperty({ type: String, nullable: true }) script!: string | null;
  @ApiProperty() workingDirectory!: string;
  @ApiProperty({ type: "integer" }) timeoutSeconds!: number;
}
export class TemplateCommandStageResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: "integer" }) position!: number;
  @ApiProperty({ enum: TemplateCommandStageMode })
  mode!: TemplateCommandStageMode;
  @ApiProperty({ type: "integer" }) maxConcurrency!: number;
  @ApiProperty({ type: TemplateCommandResponseDto, isArray: true })
  commands!: TemplateCommandResponseDto[];
}
export class TemplateManifestResponseDto extends TemplateVersionScalarResponseDto {
  @ApiProperty({ type: TemplateFolderResponseDto, isArray: true })
  folders!: TemplateFolderResponseDto[];
  @ApiProperty({ type: TemplateFileResponseDto, isArray: true })
  files!: TemplateFileResponseDto[];
  @ApiProperty({ type: TemplateCommandStageResponseDto, isArray: true })
  commandStages!: TemplateCommandStageResponseDto[];
}
export class ConfigurationTemplateListResponseDto extends TemplateScalarResponseDto {
  @ApiProperty({ type: TemplateDepartmentResponseDto })
  department!: TemplateDepartmentResponseDto;
  @ApiProperty({
    type: TemplateVersionScalarResponseDto,
    isArray: true,
    maxItems: 2,
    description:
      "Latest two visible versions, descending version. Managers see drafts; readers see published only.",
  })
  versions!: TemplateVersionScalarResponseDto[];
}
export class ConfigurationTemplateCreatedResponseDto extends TemplateScalarResponseDto {
  @ApiProperty({ type: TemplateDepartmentResponseDto })
  department!: TemplateDepartmentResponseDto;
  @ApiProperty({ type: TemplateVersionScalarResponseDto, isArray: true })
  versions!: TemplateVersionScalarResponseDto[];
}
export class ConfigurationTemplateDetailResponseDto extends TemplateScalarResponseDto {
  @ApiProperty({ type: TemplateDepartmentResponseDto })
  department!: TemplateDepartmentResponseDto;
  @ApiProperty({
    type: TemplateManifestResponseDto,
    isArray: true,
    description:
      "Full visible history descending version; same manager/reader visibility policy as list.",
  })
  versions!: TemplateManifestResponseDto[];
}
export class TemplateFileRemovedResponseDto {
  @ApiProperty({ minimum: 0 }) versionRevision!: number;
  @ApiProperty({ enum: [true] }) deleted!: true;
}
