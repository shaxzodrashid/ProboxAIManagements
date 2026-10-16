import { SessionStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SessionListQueryDto {
  @ApiPropertyOptional({
    type: String,
    enum: SessionStatus,
    isArray: true,
    description:
      "Comma-separated or repeated explicit persisted statuses. Omit for all statuses; no inferred active/liveness category.",
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.split(",") : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsEnum(SessionStatus, { each: true })
  statuses?: SessionStatus[];
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Filter assigned-task sessions. Unknown/inaccessible task filters yield an empty list.",
  })
  @IsOptional()
  @IsUUID("4")
  taskId?: string;
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Filter by the task's explicit project-board association and current project membership. Intersects taskId/statuses; unknown/inaccessible projects yield an empty list. Never infers membership from a session's saved execution project or cwd.",
  })
  @IsOptional()
  @IsUUID("4")
  projectId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 })
  @Transform(({ value }) =>
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
      ? Number(value)
      : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 100;
  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      "Opaque continuation bound to caller/workspace/filter and creation cutoff. Not a permission token or retained status snapshot.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}
export class SessionListTaskContextDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({
    description: "Current task title from this page's authorized snapshot.",
  })
  title!: string;
  @ApiProperty({
    format: "uuid",
    description:
      "Explicit task-board project; never the saved execution project.",
  })
  projectId!: string;
}
export class SessionListItemDto {
  @ApiPropertyOptional({
    type: SessionListTaskContextDto,
    description:
      "Present only with a projectId filter, after current project membership and assigned-session checks. Current per-page metadata, not frozen by asOf. No project label, execution content or action capability is implied.",
  })
  task?: SessionListTaskContextDto;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({
    enum: SessionStatus,
    description: "Persisted state, not proof of current process liveness.",
  })
  status!: SessionStatus;
  @ApiProperty({
    enum: [
      "NOT_OBSERVED",
      "NOT_STARTED",
      "STOP_UNCONFIRMED",
      "LOCAL_EXIT_OBSERVED",
    ],
  })
  stopConfirmation!: string;
  @ApiProperty({ format: "date-time", type: String }) createdAt!: string;
  @ApiProperty({
    format: "date-time",
    type: String,
    description:
      "Database modification time, including event/lease writes; not user activity or online time.",
  })
  updatedAt!: string;
}
export class SessionListResponseDto {
  @ApiProperty({ type: SessionListItemDto, isArray: true })
  items!: SessionListItemDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({
    format: "date-time",
    description:
      "Creation-time cutoff retained across paging, not a shared or frozen snapshot of mutable status/assignment.",
  })
  asOf!: string;
}
