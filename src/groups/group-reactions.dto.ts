import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { validStatusEmoji } from "../accounts/custom-status";

@ValidatorConstraint({ name: "reactionEmoji", async: false })
class ReactionEmojiValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return validStatusEmoji(value);
  }
  defaultMessage() {
    return "emoji must be one supported Unicode emoji sequence";
  }
}
export class SetGroupReactionDto {
  @ApiProperty({
    maxLength: 64,
    description:
      "One Unicode emoji grapheme, at most32 code points. Exact sequences are distinct; no variant folding or custom assets.",
  })
  @Validate(ReactionEmojiValidator)
  emoji!: string;
  @ApiProperty({ description: "Desired presence of your own emoji reaction." })
  @IsBoolean()
  present!: boolean;
}
export class GroupReactionQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({
    description:
      "Exact emoji returned by nextAfter. Current-state keyset paging, not a frozen snapshot.",
    maxLength: 64,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(ReactionEmojiValidator)
  after?: string;
}
export class GroupReactionDto {
  @ApiProperty({ maxLength: 64 }) emoji!: string;
  @ApiProperty({ minimum: 1 }) count!: number;
  @ApiProperty() mine!: boolean;
}
export class GroupReactionPageDto {
  @ApiProperty({ type: [GroupReactionDto], maxItems: 100 })
  items!: GroupReactionDto[];
  @ApiProperty({ type: String, nullable: true, maxLength: 64 })
  nextAfter!: string | null;
}
export class OwnGroupReactionDto {
  @ApiProperty({ maxLength: 64 }) emoji!: string;
  @ApiProperty() present!: boolean;
}
