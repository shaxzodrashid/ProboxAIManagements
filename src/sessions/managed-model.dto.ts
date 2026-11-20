import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
  OmitType,
} from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

const slug = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const effort = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const supplied = (_: unknown, value: unknown) => value !== undefined;
const nonNull = (_: unknown, value: unknown) =>
  value !== undefined && value !== null;

export class CreateManagedModelDto {
  @ApiProperty({ pattern: slug.source, maxLength: 200 })
  @Matches(slug)
  id!: string;
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  displayName!: string;
  @ApiProperty({ pattern: effort.source, maxLength: 64 })
  @Matches(effort)
  defaultReasoningEffort!: string;
  @ApiProperty({
    type: "array",
    minItems: 1,
    maxItems: 64,
    uniqueItems: true,
    items: { type: "string", pattern: effort.source, maxLength: 64 },
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(64)
  @ArrayUnique()
  @Matches(effort, { each: true })
  supportedReasoningEfforts!: string[];
  @ApiPropertyOptional({
    description:
      "The eligible model with the lowest priority number is the provider default. Ties use the model ID.",
    minimum: -2147483648,
    default: 100,
  })
  @ValidateIf(supplied)
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  priority?: number;
  @ApiPropertyOptional({ default: true })
  @ValidateIf(supplied)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional({ default: true })
  @ValidateIf(supplied)
  @IsBoolean()
  isAvailable?: boolean;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @ValidateIf(nonNull)
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  sunsetAt?: string | null;
  @ApiPropertyOptional({
    description:
      "Maximum output tokens sent by native Anthropic and Gemini transports.",
  })
  @ValidateIf(supplied)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  maxOutputTokens?: number;
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "integer" },
    nullable: true,
    description:
      "Manual Anthropic thinking budgets by effort. Null selects adaptive thinking.",
  })
  @ValidateIf(nonNull)
  @IsObject()
  thinkingBudgets?: Record<string, number> | null;
}

export class PatchManagedModelDto extends PartialType(
  OmitType(CreateManagedModelDto, ["id"] as const),
  { skipNullProperties: false },
) {}

export class ManagedModelResponseDto extends PickType(CreateManagedModelDto, [
  "id",
  "displayName",
  "defaultReasoningEffort",
  "supportedReasoningEfforts",
] as const) {
  @ApiProperty() providerId!: string;
  @ApiProperty() priority!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isAvailable!: boolean;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  sunsetAt!: string | null;
  @ApiProperty() maxOutputTokens!: number;
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "integer" },
    nullable: true,
  })
  thinkingBudgets!: Record<string, number> | null;
}
