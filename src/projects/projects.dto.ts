import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;

export class CreateProjectDto {
  @ApiProperty({
    example: "Customer Portal",
    maxLength: 120,
    pattern: "^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$",
    description:
      "Display name and directory name. Letters, numbers, spaces, dots, underscores, and hyphens are allowed.",
  })
  @IsString()
  @Matches(PROJECT_NAME, {
    message:
      "name may contain letters, numbers, spaces, dots, underscores, and hyphens",
  })
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: "Customer-facing web application and its supporting services.",
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      "When true, all workspace users may list and download project files; write access remains limited to members and administrators.",
  })
  @IsOptional()
  @IsBoolean()
  readAccessEnabled?: boolean;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Department that owns the project home. The workspace default is used when omitted.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  departmentId?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Optional published configuration template from the selected department.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  configurationTemplateId?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({
    example: "Customer-facing web application and its supporting services.",
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  readAccessEnabled?: boolean;
}

export class AddProjectMemberDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of an existing user in the current workspace.",
  })
  @IsString()
  @MaxLength(128)
  userId!: string;
}

export class CreateProjectFolderDto {
  @ApiProperty({
    example: "src/components",
    maxLength: 1024,
    description:
      "Project-relative directory path. Absolute paths, traversal segments, and symbolic links are rejected.",
  })
  @IsString()
  @MaxLength(1024)
  path!: string;
}

export class UploadProjectFileDto {
  @ApiPropertyOptional({
    example: "assets/images",
    maxLength: 1024,
    description:
      "Existing project-relative destination folder. The project root is used when omitted.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  path?: string;
}

export class MoveProjectFileDto {
  @ApiProperty({
    example: "drafts/readme.md",
    maxLength: 1024,
    description: "Existing project-relative file or folder path.",
  })
  @IsString()
  @MaxLength(1024)
  sourcePath!: string;

  @ApiProperty({
    example: "docs/readme.md",
    maxLength: 1024,
    description:
      "New project-relative path. Its parent directory must already exist.",
  })
  @IsString()
  @MaxLength(1024)
  destinationPath!: string;
}

export class SetProjectsHomeDto {
  @ApiProperty({
    example: "/opt/apps",
    maxLength: 1024,
    description:
      "Absolute projects home directory inside the server's configured allowed workspace root.",
  })
  @IsString()
  @MaxLength(1024)
  path!: string;
}

export class ProjectCreatorDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "Ada Lovelace" }) fullName!: string;
}

export class ProjectMemberUserDto extends ProjectCreatorDto {
  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER }) role!: UserRole;
}

export class ProjectMemberResponseDto {
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: ProjectMemberUserDto }) user!: ProjectMemberUserDto;
}

export class ProjectMemberCountDto {
  @ApiProperty({ example: 3 }) members!: number;
}

export class ProjectResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ format: "uuid" }) departmentId!: string;
  @ApiProperty({ example: "Customer Portal" }) name!: string;
  @ApiProperty({ example: "Customer Portal" }) directoryName!: string;
  @ApiProperty({ nullable: true, example: "Customer-facing web application." })
  description!: string | null;
  @ApiProperty({ example: false }) readAccessEnabled!: boolean;
  @ApiProperty({ enum: ["INITIALIZING", "READY", "FAILED"] })
  status!: "INITIALIZING" | "READY" | "FAILED";
  @ApiProperty({ nullable: true, format: "uuid" })
  appliedTemplateVersionId!: string | null;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
  @ApiPropertyOptional({ type: ProjectCreatorDto }) creator?: ProjectCreatorDto;
  @ApiPropertyOptional({ type: ProjectMemberCountDto, name: "_count" })
  _count?: ProjectMemberCountDto;
  @ApiPropertyOptional({ type: ProjectMemberResponseDto, isArray: true })
  members?: ProjectMemberResponseDto[];
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Owning department metadata.",
  })
  department?: { id: string; name: string; slug: string };
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Latest initialization attempt, when a template was selected.",
  })
  initializations?: Record<string, unknown>[];
}

export class ProjectsHomeResponseDto {
  @ApiProperty({ example: "/opt/apps" }) path!: string;
  @ApiProperty({
    example: true,
    description:
      "Whether this workspace explicitly configured the path instead of using the server default.",
  })
  configured!: boolean;
}

export class ProjectFolderResponseDto {
  @ApiProperty({ example: "src/components" }) path!: string;
  @ApiProperty({ enum: ["directory"], example: "directory" })
  type!: "directory";
}

export class ProjectFileEntryDto {
  @ApiProperty({ example: "README.md" }) name!: string;
  @ApiProperty({ example: "docs/README.md" }) path!: string;
  @ApiProperty({ enum: ["file", "directory", "symlink"], example: "file" })
  type!: "file" | "directory" | "symlink";
  @ApiProperty({
    nullable: true,
    example: 2048,
    description: "Size in bytes; null for non-file entries.",
  })
  size!: number | null;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class ProjectFileListResponseDto {
  @ApiProperty({ example: "src" }) path!: string;
  @ApiProperty({ type: ProjectFileEntryDto, isArray: true })
  files!: ProjectFileEntryDto[];
}

export class UploadedProjectFileResponseDto {
  @ApiProperty({ example: "logo.svg" }) name!: string;
  @ApiProperty({ example: "assets/logo.svg" }) path!: string;
  @ApiProperty({ example: 2048 }) size!: number;
}

export class MoveProjectFileResponseDto {
  @ApiProperty({ example: "drafts/readme.md" }) sourcePath!: string;
  @ApiProperty({ example: "docs/readme.md" }) destinationPath!: string;
}
