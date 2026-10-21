import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsInt,
  Max,
  Min,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";
import { SessionHistoryResponseDto, TurnResponseDto } from "./dto";
export class SessionArchiveQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  after?: number;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    default: 1,
    description:
      "Small detail pages; live event history retains its separate larger-page contract.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  untilSequence?: number;
}
export class SessionArchiveEventDto {
  @ApiProperty({ format: "uuid" }) eventId!: string;
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty() type!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
  @ApiProperty() retainedDetail!: boolean;
  @ApiProperty({ type: Number, nullable: true }) policyVersion!: number | null;
  @ApiProperty({ type: String, nullable: true }) storedHash!: string | null;
  @ApiProperty() projectionHash!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Sanitized retained projection. Hidden reasoning/internal prompts excluded. Tool text follows the selected server disclosure policy; legacy omissions remain explicit. Re-redacted on retrieval.",
  })
  data!: unknown;
}
export class SessionArchiveRecordDto {
  @ApiProperty({ enum: ["RETAIN_UNTIL_AUTHORIZED_DELETION"] })
  retentionPolicy!: string;
  @ApiProperty({ type: "object", additionalProperties: true, nullable: true })
  catalogSnapshot!: unknown;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    nullable: true,
    description:
      "Actual captured app/runtime/schema metadata; unknown versions remain null, operator-reported commit is labeled.",
  })
  runtimeProvenance!: unknown;
  @ApiProperty({ minimum: 0 }) dispatchAttempts!: number;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastDispatchAt!: Date | null;
}
export class SessionArchiveResponseDto extends SessionHistoryResponseDto {
  @ApiProperty({ type: SessionArchiveRecordDto })
  record!: SessionArchiveRecordDto;
  @ApiProperty({ type: SessionArchiveEventDto, isArray: true })
  archiveEvents!: SessionArchiveEventDto[];
}
export class SessionTurnsQueryDto {
  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      "Opaque startedAt/id keyset cursor bound to actor/workspace/session. Not an authorization token.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}
export class RetainedTurnDto extends TurnResponseDto {
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    nullable: true,
    description:
      "Reported usage provenance; no price estimates or fabricated costs. Legacy provenance can be unavailable.",
  })
  usageProvenance!: unknown;
}
export class SessionTurnsResponseDto {
  @ApiProperty({ type: RetainedTurnDto, isArray: true, maxItems: 50 })
  items!: RetainedTurnDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
