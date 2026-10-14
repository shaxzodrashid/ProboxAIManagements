import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const queryInteger = (value: unknown) =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
    ? Number(value)
    : value;

export class InitializationEventsQueryDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 2147483647,
    description: "Exclusive initialization sequence cursor; defaults to zero.",
  })
  @IsOptional()
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(0)
  @Max(2147483647)
  after?: number;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 100,
    description: "REST page bound; stream batches are always at most 100.",
  })
  @IsOptional()
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class InitializationPersistedEventDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) initializationId!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() type!: string;
  @ApiProperty({ type: "object", additionalProperties: true }) payload!: Record<
    string,
    unknown
  >;
  @ApiProperty({ format: "date-time", type: String }) createdAt!: string;
}
export class InitializationStreamEventDto {
  @ApiProperty({ description: "Numeric persisted initialization sequence." })
  id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Same payload as the matching REST event; retains existing initialization disclosure contract.",
  })
  data!: Record<string, unknown>;
}
