import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
export class SessionDetailQueryDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 1048576, default: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1048576)
  offset?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 16384, default: 4096 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16384)
  limit?: number;
  @ApiPropertyOptional({
    description:
      "Returned projectionHash, required after offset zero. Changed redaction requires restarting pagination.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  revision?: string;
}
export class SessionDetailPageDto {
  @ApiProperty({ format: "uuid" }) eventId!: string;
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ type: String, nullable: true }) turnId!: string | null;
  @ApiProperty() sequence!: number;
  @ApiProperty() type!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: Number, nullable: true }) archivePolicyVersion!:
    number | null;
  @ApiProperty({ enum: [1] }) projectionVersion!: number;
  @ApiProperty({ enum: ["REDACTED_SESSION_DETAIL_V1"] }) policy!: string;
  @ApiProperty({ enum: ["RUNNER_REPORTED", "UNAVAILABLE"] }) source!: string;
  @ApiProperty({
    enum: [
      "REPORTED_FRAME_ONLY",
      "FINAL_WORKSPACE_DIFF_NOT_PER_TOOL_ATTRIBUTION",
      "UNAVAILABLE",
    ],
  })
  completeness!: string;
  @ApiProperty({ enum: ["USE_SERVER_STATE"] }) runCompletion!: string;
  @ApiProperty({
    enum: ["COMMAND", "FILE_CHANGES", "WORKSPACE_DIFF", "UNAVAILABLE"],
  })
  kind!: string;
  @ApiProperty({
    enum: [
      "AVAILABLE",
      "UNSUPPORTED_SCHEMA",
      "LEGACY_DETAIL_UNAVAILABLE",
      "UNVERIFIED_ARCHIVE",
      "CONTENT_UNAVAILABLE_OR_OVERSIZED",
      "BINARY_DIFF_OMITTED",
    ],
  })
  availability!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 8192 }) command!:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) exitCode!: number | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 16384 }) content!:
    string | null;
  @ApiProperty({
    type: "array",
    nullable: true,
    maxItems: 100,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["path", "kind"],
      properties: {
        path: { type: "string", nullable: true, maxLength: 4096 },
        kind: {
          type: "string",
          enum: ["add", "delete", "update", "UNAVAILABLE"],
        },
      },
    },
  })
  changes!: { path: string | null; kind: string }[] | null;
  @ApiProperty() projectionHash!: string;
  @ApiProperty() offset!: number;
  @ApiProperty() totalUnits!: number;
  @ApiProperty({ enum: ["CHANGES", "UTF16_CODE_UNITS"] }) units!: string;
  @ApiProperty({ type: Number, nullable: true }) nextOffset!: number | null;
  @ApiProperty() truncated!: boolean;
  @ApiProperty({ enum: ["BEST_EFFORT_CURRENT_CONFIGURATION"] })
  redaction!: string;
}
