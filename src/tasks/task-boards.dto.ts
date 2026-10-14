import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { Transform, Type } from "class-transformer";
export const BoardColors = ["NEUTRAL", "TEAL", "PURPLE", "GREEN"] as const;
export const boardPalette = {
  NEUTRAL: { foreground: "#4d5c6c", background: "#e8edf2" },
  TEAL: { foreground: "#08695f", background: "#d9efeb" },
  PURPLE: { foreground: "#60318b", background: "#e8def7" },
  GREEN: { foreground: "#376b32", background: "#dff0dc" },
} as const;
export class BoardMutationDto {
  @ApiProperty({
    format: "uuid",
    description: "Stable UUIDv4 for retry/readback of this exact mutation.",
  })
  @IsUUID("4")
  requestId!: string;
}
export class CreateBoardStatusDto extends BoardMutationDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  name!: string;
  @ApiProperty({ enum: BoardColors })
  @IsIn(BoardColors)
  color!: (typeof BoardColors)[number];
}
export class UpdateBoardStatusDto extends BoardMutationDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional({ enum: BoardColors })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(BoardColors)
  color?: (typeof BoardColors)[number];
}
export class ReorderBoardStatusesDto extends BoardMutationDto {
  @ApiProperty({
    type: String,
    isArray: true,
    format: "uuid",
    maxItems: 100,
    description: "Every current status exactly once, in the desired order.",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID("4", { each: true })
  statusIds!: string[];
}
export class RemoveBoardStatusDto extends BoardMutationDto {
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Same-board replacement, required when tasks reference the removed status. All tasks move atomically before removal.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID("4")
  replacementStatusId?: string;
}
export class BoardAuditQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  afterRevision?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class BoardColorPairDto {
  @ApiProperty() foreground!: string;
  @ApiProperty() background!: string;
}
export class BoardStatusResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: BoardColors }) color!: string;
  @ApiProperty({ type: BoardColorPairDto }) palette!: BoardColorPairDto;
  @ApiProperty({ minimum: 0 }) position!: number;
}
export class TaskBoardResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ type: BoardStatusResponseDto, isArray: true, maxItems: 100 })
  statuses!: BoardStatusResponseDto[];
}
export class BoardMutationResponseDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({
    enum: [
      "CREATE_STATUS",
      "UPDATE_STATUS",
      "REORDER_STATUSES",
      "REMOVE_STATUS",
    ],
  })
  action!: string;
  @ApiProperty({ format: "uuid" }) actorId!: string;
  @ApiProperty({ minimum: 0 }) affectedTasks!: number;
  @ApiProperty({ type: TaskBoardResponseDto }) before!: TaskBoardResponseDto;
  @ApiProperty({ type: TaskBoardResponseDto }) after!: TaskBoardResponseDto;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
}
export class BoardAuditResponseDto {
  @ApiProperty({ type: BoardMutationResponseDto, isArray: true, maxItems: 100 })
  items!: BoardMutationResponseDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: Number, nullable: true }) nextAfterRevision!:
    number | null;
}
