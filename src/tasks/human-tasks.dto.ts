import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import {
  BoardMutationDto,
  BoardAuditQueryDto,
  BoardStatusResponseDto,
} from "./task-boards.dto";
import { DeadlineInputDto, DeadlineValueDto } from "./task-deadlines.dto";
import { TaskPriority } from "@prisma/client";
import { ProfileAvatarResponseDto } from "../accounts/profile-avatar-domain";
import { PublicIdentityResponseDto } from "../accounts/profile-picker.dto";
import {
  TASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
} from "./task-text-limits";

export class HumanTaskLifecycleDto {
  @ApiProperty({ enum: ["ACTIVE", "ARCHIVED", "DELETED"] }) state!: string;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  archivedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  deletedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  sourceProjectArchivedAt!: string | null;
}
export class HumanTaskResponseDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      "Recorded original-board order label at mutation time; historical receipts may omit it. Neighbor labels may later shift.",
  })
  position?: number;
  @ApiProperty({ type: () => HumanTaskLifecycleDto })
  lifecycle!: HumanTaskLifecycleDto;
  @ApiProperty({ type: () => HumanChecklistSectionDto, isArray: true })
  checklistSections!: HumanChecklistSectionDto[];
  @ApiProperty({
    enum: TaskPriority,
    nullable: true,
    description:
      "Human priority: Urgent, High, Medium, Low; null means unset, never inferred from runner state.",
  })
  priority!: TaskPriority | null;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ type: String, format: "uuid", isArray: true })
  assigneeIds!: string[];
  @ApiProperty({
    type: () => HumanChecklistItemDto,
    isArray: true,
    maxItems: 200,
  })
  checklist!: HumanChecklistItemDto[];
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({
    format: "uuid",
    description: "Persisted task creator, distinct from AI execution manager.",
  })
  ownerId!: string;
  @ApiProperty({ format: "uuid" }) statusId!: string;
  @ApiProperty({ type: DeadlineValueDto, nullable: true }) deadline!: unknown;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  projectArchivedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class TaskAssigneeIdentityDto extends PublicIdentityResponseDto {
  @ApiProperty({ type: ProfileAvatarResponseDto, nullable: true })
  avatar!: ProfileAvatarResponseDto | null;
}
export class HumanTaskReadResponseDto extends HumanTaskResponseDto {
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      "Canonical explicit owner confirmation, independent of local column.",
  })
  completed!: boolean | null;
  @ApiProperty({
    minimum: 0,
    description:
      "Board-local order label; sort by position then creation/id descending. Labels can shift after placement.",
  })
  declare position: number;
  @ApiPropertyOptional({
    description: "Present in unified query; true for destination share.",
  })
  shared?: boolean;
  @ApiProperty({
    type: TaskAssigneeIdentityDto,
    isArray: true,
    maxItems: 100,
    description:
      "Current public identities for task assigneeIds, ordered by id; checklist assigneeId reuses the same identities. Inactive or foreign-workspace identities are omitted while retained assignment IDs remain. Avatar is nullable and evaluated against current AVATAR audience and ACTIVE asset. No private profile or action eligibility is exposed. Names may change between query pages without changing task ordering/counts. Frozen mutation/audit snapshots exclude this field.",
  })
  assigneeIdentities!: TaskAssigneeIdentityDto[];
  @ApiProperty({
    type: BoardStatusResponseDto,
    description:
      "Current human workflow status using the board name/color/palette projection. Not runner status or management authority. Frozen mutation/audit snapshots retain their separate schema.",
  })
  workflowStatus!: BoardStatusResponseDto;
}

export class HumanChecklistItemDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Stable opaque side section identity, never an authorization token.",
  })
  sectionId!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) parentId!:
    string | null;
  @ApiProperty({ type: DeadlineValueDto, nullable: true })
  deadline!: DeadlineValueDto | null;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: "uuid" }) assigneeId!: string;
  @ApiProperty({ minimum: 0 }) position!: number;
  @ApiProperty() completed!: boolean;
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  completedById!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: string | null;
}
export class HumanChecklistNodeDto extends HumanChecklistItemDto {
  @ApiProperty({ type: () => HumanChecklistNodeDto, isArray: true })
  children!: HumanChecklistNodeDto[];
}
export class HumanChecklistSectionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() original!: boolean;
  @ApiProperty() currentSide!: boolean;
  @ApiProperty({
    description:
      "False for retained items of a removed share; this does not grant access to that side.",
  })
  active!: boolean;
  @ApiProperty({ type: HumanChecklistNodeDto, isArray: true })
  items!: HumanChecklistNodeDto[];
}
export class HumanChecklistPlacementDto extends BoardMutationDto {
  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    nullable: true,
    description:
      "Same-section parent; null selects a root. Maximum depth 8; cycles are rejected.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID("4")
  parentId?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    nullable: true,
    description:
      "Insert before this sibling; null appends. Omission preserves order on definition-only updates, or appends on create/reparent.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID("4")
  beforeItemId?: string | null;
}
export class HumanTaskLinkDto extends BoardMutationDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Explicit same-board initial workflow status. No legacy association is inferred.",
  })
  @IsUUID("4")
  statusId!: string;
}
export class HumanTaskDetailsDto extends BoardMutationDto {
  @ApiPropertyOptional({
    enum: TaskPriority,
    nullable: true,
    description:
      "Owner-only human priority. Omit to retain; null clears. Urgent / High / Medium / Low. Requires tasks.details.manage and current project membership.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsEnum(TaskPriority)
  priority?: TaskPriority | null;
  @ApiPropertyOptional({ maxLength: TASK_TITLE_MAX_LENGTH })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;
  @ApiPropertyOptional({ maxLength: TASK_DESCRIPTION_MAX_LENGTH })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
export class HumanTaskAssigneesDto extends BoardMutationDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    isArray: true,
    maxItems: 100,
    description:
      "Whole set. New assignees must be OPEN project members; existing inactive assignments may remain temporarily for explicit checklist handoff and grant no action access. Empty requires no checklist assignee.",
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  assigneeIds!: string[];
}
export class HumanTaskMoveDto extends BoardMutationDto {
  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "Place before this card in destination column; null appends. Omit to retain same-column position or append on column change. Supports original/shared neighbors.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID("4")
  declare beforeTaskId?: string | null;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") statusId!: string;
}
export class HumanChecklistCreateDto extends HumanChecklistPlacementDto {
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Current side section; defaults to original. Requires existing owner authority plus membership in this side.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID("4")
  sectionId?: string;
  @ApiPropertyOptional({
    type: DeadlineInputDto,
    nullable: true,
    description:
      "Independent item deadline; omission or null starts without one. Uses the task deadline calendar/timezone contract.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @ValidateNested()
  @Type(() => DeadlineInputDto)
  deadline?: DeadlineInputDto | null;
  @ApiProperty({
    format: "uuid",
    description: "Client-generated stable item identity.",
  })
  @IsUUID("4")
  itemId!: string;
  @ApiProperty({ maxLength: 200 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") assigneeId!: string;
}
export class HumanChecklistUpdateDto extends HumanChecklistPlacementDto {
  @ApiPropertyOptional({
    type: DeadlineInputDto,
    nullable: true,
    description:
      "Replace the whole item deadline; omission retains it, null clears it. Does not change task deadline or completion.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @ValidateNested()
  @Type(() => DeadlineInputDto)
  deadline?: DeadlineInputDto | null;
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional({ format: "uuid" })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID("4")
  assigneeId?: string;
}
export class HumanChecklistCompleteDto extends BoardMutationDto {
  @ApiProperty() @IsBoolean() completed!: boolean;
}
export class HumanChecklistReorderDto extends BoardMutationDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    isArray: true,
    maxItems: 200,
    description:
      "Every current checklist item exactly once, in desired order. Empty only for an empty checklist. Item identity and other fields remain unchanged.",
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  itemIds!: string[];
}
export class HumanCommentCreateDto extends BoardMutationDto {
  @ApiProperty({
    maxLength: 4000,
    description:
      "User-authored plain text only. No attachment, execution-event import or external fetch is performed.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}
export class HumanCommentDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) authorId!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
export class HumanTaskMutationResponseDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) actorId!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: HumanTaskResponseDto, nullable: true })
  before!: HumanTaskResponseDto | null;
  @ApiProperty({ type: HumanTaskResponseDto }) after!: HumanTaskResponseDto;
  @ApiProperty({ type: HumanCommentDto, nullable: true })
  comment!: HumanCommentDto | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
export class HumanTaskHistoryQueryDto extends BoardAuditQueryDto {}
export class HumanTaskAuditResponseDto {
  @ApiProperty({ type: HumanTaskMutationResponseDto, isArray: true })
  items!: HumanTaskMutationResponseDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: Number, nullable: true }) nextAfterRevision!:
    number | null;
}
export class HumanCommentsResponseDto {
  @ApiProperty({ type: HumanCommentDto, isArray: true })
  items!: HumanCommentDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: Number, nullable: true }) nextAfterRevision!:
    number | null;
}
