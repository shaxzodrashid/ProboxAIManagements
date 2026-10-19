import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";
import {
  ApiExtraModels,
  getSchemaPath,
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";
import {
  ProjectStatus,
  ProjectInitializationStatus,
  ProjectFileTrashStatus,
} from "@prisma/client";

export class ProjectUploadConfigurationResponseDto {
  @ApiProperty({ type: "integer", minimum: 1, maximum: 1073741824 })
  maxUploadBytes!: number;
  @ApiProperty({
    enum: ["single-file"],
    description:
      "multipart/form-data with one file field named file; optional destination folder path.",
  })
  requestMode!: "single-file";
}

export class ProjectFileDeletionConfirmationResponseDto {
  @ApiProperty({ format: "uuid" }) operationId!: string;
  @ApiProperty({ enum: [true] }) confirmationRequired!: true;
  @ApiProperty({ format: "uuid" }) confirmationId!: string;
  @ApiProperty({ type: String, format: "date-time" }) expiresAt!: string;
}

export class ProjectFileTrashedResponseDto {
  @ApiProperty({ format: "uuid" }) operationId!: string;
  @ApiProperty({ enum: [true] }) trashed!: true;
  @ApiProperty({ format: "uuid" }) trashId!: string;
  @ApiProperty({ description: "Original project-relative path." })
  path!: string;
  @ApiProperty({ type: String, format: "date-time" }) expiresAt!: string;
}

export class ProjectTrashItemResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty() originalPath!: string;
  @ApiProperty() isDirectory!: boolean;
  @ApiProperty({ format: "uuid" }) deletedById!: string;
  @ApiProperty({
    enum: ProjectFileTrashStatus,
    description:
      "List selects ACTIVE rows even when expiresAt has passed and cleanup has not run; expiry does not imply restorability.",
  })
  status!: ProjectFileTrashStatus;
  @ApiProperty({ type: String, format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  restoredAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  purgedAt!: string | null;
}

export class ProjectTrashRestoredResponseDto {
  @ApiProperty({ enum: [true] }) restored!: true;
  @ApiProperty() path!: string;
}

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;

export const EXISTING_PROJECT_DIRECTORY_ACTIONS = ["KEEP", "CLEAR"] as const;
export type ExistingProjectDirectoryAction =
  (typeof EXISTING_PROJECT_DIRECTORY_ACTIONS)[number];

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

  @ApiPropertyOptional({
    enum: EXISTING_PROJECT_DIRECTORY_ACTIONS,
    description:
      "Required only after the API reports that the project directory already exists. KEEP preserves existing files and cannot be combined with configurationTemplateId. CLEAR permanently removes contents and requires POST /projects/creation-submissions with a client-generated requestId; legacy POST /projects returns 428 for CLEAR.",
  })
  @IsOptional()
  @IsIn(EXISTING_PROJECT_DIRECTORY_ACTIONS)
  existingDirectoryAction?: ExistingProjectDirectoryAction;
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

export class ProtectedFileTypeDto {
  @ApiProperty({
    example: ".env",
    maxLength: 64,
    description:
      "Leading-dot file extension protected by a second deletion confirmation. Case-insensitive; boundary whitespace is trimmed. At most 64 input characters.",
  })
  @IsString()
  @MaxLength(64)
  extension!: string;
}

export class DeleteProjectFileDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Client-generated deletion identity; retain it through retries and reconciliation.",
  })
  @IsUUID()
  operationId!: string;
  @ApiProperty({ example: "secrets/.env", maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  path!: string;
}

export class ActiveSessionDecisionDto {
  @ApiProperty({ enum: ["WAIT", "INTERRUPT"], example: "WAIT" })
  @IsString()
  @Matches(/^(WAIT|INTERRUPT)$/)
  action!: "WAIT" | "INTERRUPT";
}

export class ConfirmProjectDeletionDto {
  @ApiProperty({
    description: "One-time token delivered only to the owner's Telegram chat.",
  })
  @IsString()
  @MaxLength(128)
  token!: string;
}

export class SetProjectsHomeDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Default department ID from the current settings response; protects against concurrent default changes.",
  })
  @IsUUID("4")
  departmentId!: string;
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
  @ApiProperty({
    type: "array",
    items: {
      type: "object",
      required: ["id", "key", "name"],
      properties: {
        id: { type: "string", format: "uuid" },
        key: { type: "string", example: "MANAGER" },
        name: { type: "string", example: "Manager" },
      },
    },
  })
  roles!: Array<{ id: string; key: string; name: string }>;
  @ApiProperty({
    type: String,
    nullable: true,
    deprecated: true,
    enum: ["ADMIN", "MANAGER", "MEMBER"],
  })
  role!: string | null;
}

export class ProjectMembershipScalarResponseDto {
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}

export class ProjectMemberResponseDto extends ProjectMembershipScalarResponseDto {
  @ApiProperty({ type: ProjectMemberUserDto }) user!: ProjectMemberUserDto;
}

export class ProjectMemberCountDto {
  @ApiProperty({ example: 3 }) members!: number;
}

export class ProjectScalarResponseDto {
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  archivedAt!: string | null;
  @ApiProperty({ minimum: 0 }) archiveRevision!: number;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ format: "uuid" }) departmentId!: string;
  @ApiProperty({ example: "Customer Portal" }) name!: string;
  @ApiProperty({ example: "Customer Portal" }) directoryName!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: "Customer-facing web application.",
  })
  description!: string | null;
  @ApiProperty({ example: false }) readAccessEnabled!: boolean;
  @ApiProperty({ enum: ProjectStatus }) status!: ProjectStatus;
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  appliedTemplateVersionId!: string | null;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class ProjectDepartmentResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class ProjectInitializationSummaryResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) templateVersionId!: string;
  @ApiProperty() attempt!: number;
  @ApiProperty({ enum: ProjectInitializationStatus })
  status!: ProjectInitializationStatus;
  @ApiProperty() lastSequence!: number;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) endedAt!:
    string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class ProjectCreatedResponseDto extends ProjectScalarResponseDto {
  @ApiProperty({ type: ProjectCreatorDto }) creator!: ProjectCreatorDto;
  @ApiProperty({ type: ProjectDepartmentResponseDto })
  department!: ProjectDepartmentResponseDto;
  @ApiProperty({ type: ProjectMemberResponseDto, isArray: true })
  members!: ProjectMemberResponseDto[];
  @ApiPropertyOptional({
    type: ProjectInitializationSummaryResponseDto,
    isArray: true,
    maxItems: 1,
    description: "Present for templated creation; omitted for empty projects.",
  })
  initializations?: ProjectInitializationSummaryResponseDto[];
}

export class ProjectListItemResponseDto extends ProjectScalarResponseDto {
  @ApiProperty({
    type: Boolean,
    description:
      "Current caller's persisted ProjectMember relationship at this read. Independent of creator identity, read-all grants, public access and role labels; not a capability or ranking.",
  })
  isMember!: boolean;
  @ApiProperty({ type: ProjectCreatorDto }) creator!: ProjectCreatorDto;
  @ApiProperty({ type: ProjectDepartmentResponseDto })
  department!: ProjectDepartmentResponseDto;
  @ApiProperty({ type: ProjectMemberCountDto }) _count!: ProjectMemberCountDto;
  @ApiProperty({
    type: ProjectInitializationSummaryResponseDto,
    isArray: true,
    maxItems: 1,
    description:
      "Latest safe initialization summary by attempt DESC, or []. No paths, leases or raw errors.",
  })
  initializations!: ProjectInitializationSummaryResponseDto[];
}

export class ProjectResponseDto extends ProjectScalarResponseDto {
  @ApiProperty({
    type: Boolean,
    description:
      "Current caller's persisted ProjectMember relationship, not inferred from creator/admin/public access. Detail/actions reauthorize independently.",
  })
  isMember!: boolean;
  @ApiProperty({ type: ProjectCreatorDto }) creator!: ProjectCreatorDto;
  @ApiProperty({ type: ProjectDepartmentResponseDto })
  department!: ProjectDepartmentResponseDto;
  @ApiProperty({
    type: ProjectInitializationSummaryResponseDto,
    isArray: true,
    maxItems: 1,
    description:
      "Latest safe initialization summary by attempt DESC, or []. No paths, leases or raw errors.",
  })
  initializations!: ProjectInitializationSummaryResponseDto[];
  @ApiPropertyOptional({
    type: ProjectMemberResponseDto,
    isArray: true,
    description:
      "Returned to project members or projects.read-all callers. Omitted for other authorized workspace readers; omission does not mean zero members.",
  })
  members?: ProjectMemberResponseDto[];
}

export class ProjectsHomeResponseDto {
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ format: "uuid" }) departmentId!: string;
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

@ApiExtraModels(
  ProjectFileDeletionConfirmationResponseDto,
  ProjectFileTrashedResponseDto,
)
export class ProjectFileOperationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ enum: ["DELETE"] }) kind!: "DELETE";
  @ApiProperty() path!: string;
  @ApiProperty({
    enum: [
      "AWAITING_CONFIRMATION",
      "PREPARED",
      "COMPLETED",
      "FAILED",
      "NEEDS_REPAIR",
    ],
  })
  state!: string;
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ProjectFileDeletionConfirmationResponseDto) },
      { $ref: getSchemaPath(ProjectFileTrashedResponseDto) },
    ],
    nullable: true,
    description:
      "Historical deletion or confirmation result. Null until recorded.",
  })
  result!:
    | ProjectFileDeletionConfirmationResponseDto
    | ProjectFileTrashedResponseDto
    | null;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}
