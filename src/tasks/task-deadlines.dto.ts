import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDefined,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { BoardMutationDto, BoardAuditQueryDto } from "./task-boards.dto";
export class DeadlineInputDto {
  @ApiProperty({
    example: "2026-10-13",
    description:
      "Real Gregorian YYYY-MM-DD, years0001–9999. Date-only is a calendar value, never a UTC midnight.",
  })
  @IsString()
  @MaxLength(10)
  date!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "17:30",
    description:
      "Optional HH:mm local clock. Timed deadlines also require IANA zone and explicit matching UTC offset.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(5)
  time?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "Asia/Tashkent",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(80)
  timeZone?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "+05:00",
    description:
      "Selects one exact instant, including repeated DST hours. Must match the zone at that date/time. -00:00 is not accepted as a known offset.",
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(6)
  utcOffset?: string | null;
}
export class PutDeadlineDto extends BoardMutationDto {
  @ApiProperty({
    type: DeadlineInputDto,
    nullable: true,
    description:
      "Replace the whole deadline; null clears it. Omission is invalid.",
  })
  @ValidateIf((_o, v) => v !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => DeadlineInputDto)
  deadline!: DeadlineInputDto | null;
}
export class DeadlineValueDto {
  @ApiProperty({ enum: ["DATE", "TIMED"] }) kind!: "DATE" | "TIMED";
  @ApiProperty() date!: string;
  @ApiProperty({ type: String, nullable: true }) time!: string | null;
  @ApiProperty({ type: String, nullable: true }) timeZone!: string | null;
  @ApiProperty({ type: String, nullable: true }) utcOffset!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) instant!:
    string | null;
}
export class TaskDeadlineResponseDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ type: DeadlineValueDto, nullable: true })
  deadline!: DeadlineValueDto | null;
}
export class DeadlineMutationResponseDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) actorId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: TaskDeadlineResponseDto })
  before!: TaskDeadlineResponseDto;
  @ApiProperty({ type: TaskDeadlineResponseDto })
  after!: TaskDeadlineResponseDto;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
}
export class DeadlineAuditQueryDto extends BoardAuditQueryDto {}
export class DeadlineAuditResponseDto {
  @ApiProperty({
    type: DeadlineMutationResponseDto,
    isArray: true,
    maxItems: 100,
  })
  items!: DeadlineMutationResponseDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: Number, nullable: true }) nextAfterRevision!:
    number | null;
}
