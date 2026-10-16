import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { HumanTaskResponseDto } from "./human-tasks.dto";
export const QueryPriorities = [
  "URGENT",
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNSET",
] as const;
export const QuerySorts = [
  "priority",
  "-priority",
  "deadlineDate",
  "-deadlineDate",
  "deadline",
  "-deadline",
  "createdAt",
  "-createdAt",
] as const;
const csv = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.split(",") : value;
export class HumanTaskQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description:
      "Literal case-insensitive title/description substring; trimmed; no wildcard or execution-content search.",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q?: string;
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    enum: QueryPriorities,
    description:
      "Comma-separated/repeated priority set. UNSET includes missing human state. Omit for all.",
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(QueryPriorities, { each: true })
  priorities?: string[];
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    format: "uuid",
    maxItems: 100,
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  statusIds?: string[];
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Human assignee filter. Unknown/inaccessible target yields empty scoped results, without identity lookup.",
  })
  @IsOptional()
  @IsUUID("4")
  assigneeId?: string;
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    enum: QuerySorts,
    description:
      "Ordered keys; minus means descending. Default -priority,-createdAt. Each field once. ID descending tie-breaker. deadline: timed first by pinned instant, then date-only by calendar date, unset last; direction applies within buckets, never reverses bucket precedence. Earlier keys retain precedence. deadlineDate retains calendar-date-only ordering. No manufactured date-only time or timezone.",
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(QuerySorts, { each: true })
  sort?: string[];
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Transform(({ value }) =>
    typeof value === "string" && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      "Opaque continuation bound to caller, workspace, project, filters, sort and observed result generation. Changed generation returns409; refresh instead of merging pages.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}
export class HumanPriorityCountDto {
  @ApiProperty({ enum: QueryPriorities }) priority!: string;
  @ApiProperty({ minimum: 0 }) count!: number;
}
export class HumanStatusCountDto {
  @ApiProperty({ format: "uuid" }) statusId!: string;
  @ApiProperty({ minimum: 1 }) count!: number;
}
export class HumanTaskQueryResponseDto {
  @ApiProperty({ type: HumanTaskResponseDto, isArray: true, maxItems: 100 })
  items!: HumanTaskResponseDto[];
  @ApiProperty({
    minimum: 0,
    description:
      "Filtered authorized total at this page's database snapshot; not a complete project count when filters are active.",
  })
  total!: number;
  @ApiProperty({ type: HumanPriorityCountDto, isArray: true })
  priorityCounts!: HumanPriorityCountDto[];
  @ApiProperty({
    type: HumanStatusCountDto,
    isArray: true,
    maxItems: 100,
    description:
      "Referenced status IDs/counts in the same filtered scope. No empty-column discovery or status labels/colors; board configuration retains its own read authority.",
  })
  statusCounts!: HumanStatusCountDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({
    format: "date-time",
    description:
      "Initial page observation clock, retained across unchanged-generation continuation. Not a held snapshot or permission token.",
  })
  asOf!: string;
}
