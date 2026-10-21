import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsDefined,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { REASONING_EFFORTS } from "./model-catalog.service";
export class PersonalModelPreferencesQueryDto {}
export class SavedPersonalModelDto {
  @ApiProperty({ maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  providerId!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 256 })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(256)
  model!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 64 })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(64)
  reasoningEffort!: string | null;
}
export class EffectivePersonalModelDto {
  @ApiProperty() providerId!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ enum: REASONING_EFFORTS }) reasoningEffort!: string;
}
export class PutPersonalModelPreferencesDto {
  @ApiProperty({
    description:
      "Exact previously read saved triple. Detects changed values across web and Telegram; this is value comparison, not a historical revision or idempotency receipt.",
    type: SavedPersonalModelDto,
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => SavedPersonalModelDto)
  expected!: SavedPersonalModelDto;
  @ApiProperty({ maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  providerId!: string;
  @ApiProperty({ maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  model!: string;
  @ApiProperty({ enum: REASONING_EFFORTS })
  @IsIn(REASONING_EFFORTS)
  reasoningEffort!: string;
}
export class PersonalModelPreferencesDto {
  @ApiProperty({ type: SavedPersonalModelDto }) saved!: SavedPersonalModelDto;
  @ApiProperty({ type: EffectivePersonalModelDto, nullable: true })
  effective!: EffectivePersonalModelDto | null;
  @ApiProperty({
    description:
      "False for a legacy value outside the current managed catalog; select again, never silently overwrite it.",
  })
  valid!: boolean;
  @ApiProperty() catalogVersion!: string;
}
