import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min, ValidateIf } from "class-validator";
import {
  HumanTaskReadResponseDto,
  HumanTaskResponseDto,
  HumanCommentDto,
} from "./human-tasks.dto";
export class SharedTaskContentQueryDto {}
export class SharedTaskListQueryDto {
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Last task ID from the previous page; every page rechecks current membership and sharing.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID("4")
  afterTaskId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class SharedTaskContentDto extends HumanTaskReadResponseDto {
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      "Canonical creator-confirmed completion, independent of this board's local workflow.",
  })
  completed!: boolean | null;
}
export class SharedTaskListDto {
  @ApiProperty({ type: SharedTaskContentDto, isArray: true })
  items!: SharedTaskContentDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  nextAfterTaskId!: string | null;
}
export class SharedTaskHistorySnapshotDto extends OmitType(
  HumanTaskResponseDto,
  ["projectId", "statusId", "projectArchivedAt"] as const,
) {}
export class SharedTaskHistoryItemDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) actorId!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: SharedTaskHistorySnapshotDto, nullable: true })
  before!: unknown;
  @ApiProperty({ type: SharedTaskHistorySnapshotDto }) after!: unknown;
  @ApiProperty({ type: HumanCommentDto, nullable: true }) comment!: unknown;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
}
export class SharedTaskHistoryDto {
  @ApiProperty({ type: SharedTaskHistoryItemDto, isArray: true })
  items!: SharedTaskHistoryItemDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: Number, nullable: true }) nextAfterRevision!:
    number | null;
}
