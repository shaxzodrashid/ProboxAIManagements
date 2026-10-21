import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsDefined,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import type EmojiRegex from "emoji-regex";
// These CommonJS runtime exports are callable; their declarations use default exports.
const emojiRegex: typeof EmojiRegex = require("emoji-regex");
import { validBirthDate } from "./profile-birthday";

export const CUSTOM_STATUS_API_LIMIT = 100;
export const CUSTOM_STATUS_STORAGE_LIMIT = 300;
const emoji = new RegExp(`^(?:${emojiRegex().source})$`);
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export function validStatusEmoji(value: unknown): boolean {
  return (
    typeof value === "string" &&
    !/^\p{Emoji_Modifier}$/u.test(value) &&
    Array.from(value).length <= 32 &&
    [...segmenter.segment(value)].length === 1 &&
    emoji.test(value)
  );
}
export function statusExpiry(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(
      value,
    ) ||
    value.endsWith("-00:00") ||
    !validBirthDate(value.slice(0, 10))
  )
    throw new Error("Invalid expiry");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    throw new Error("Invalid expiry");
  return date.toISOString();
}
@ValidatorConstraint({ name: "statusEmoji", async: false })
class StatusEmojiValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return validStatusEmoji(value);
  }
  defaultMessage() {
    return "emoji must be one supported Unicode emoji sequence";
  }
}
@ValidatorConstraint({ name: "statusExpiry", async: false })
class StatusExpiryValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    try {
      statusExpiry(value);
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage() {
    return "expiresAt must be a complete RFC3339 instant with an explicit timezone";
  }
}
@ValidatorConstraint({ name: "singleLineStatus", async: false })
class SingleLineStatusValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      typeof value === "string" &&
      Array.from(value).every((c) => {
        const code = c.codePointAt(0)!;
        return code > 31 && code !== 127 && code !== 0x2028 && code !== 0x2029;
      })
    );
  }
  defaultMessage() {
    return "text must be single-line plain text without control characters";
  }
}
export class CustomStatusInputDto {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: CUSTOM_STATUS_API_LIMIT,
    description:
      "API write limit: 100 Unicode code points. Storage capacity is separately 300; blank trims to unset.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(CUSTOM_STATUS_API_LIMIT)
  @Validate(SingleLineStatusValidator)
  text!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 32,
    description:
      "One supported emoji grapheme/sequence, including flags, modifiers and ZWJ.",
  })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @Validate(StatusEmojiValidator)
  emoji!: string | null;
  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description:
      "No default expiry. Explicit future instant for a new Save; exact committed replay remains valid after expiry.",
  })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @Validate(StatusExpiryValidator)
  expiresAt!: string | null;
}
export class CustomStatusResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: CUSTOM_STATUS_STORAGE_LIMIT,
    description:
      "Stored value, up to 300 Unicode code points. API writes are independently limited to 100; reads never truncate stored data.",
  })
  text!: string | null;
  @ApiProperty({ type: String, nullable: true }) emoji!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  expiresAt!: string | null;
  @ApiProperty({
    description:
      "Owner edit reads may retain an expired stored value with active=false. Public projection returns null instead.",
  })
  active!: boolean;
}
export function normalizedStatus(value: CustomStatusInputDto | null) {
  if (value === null) return null;
  return {
    text: value.text || null,
    emoji: value.emoji,
    expiresAt: statusExpiry(value.expiresAt),
  };
}
export const customStatusSelect = {
  customStatusText: true,
  customStatusEmoji: true,
  customStatusExpiresAt: true,
} as const;
export function storedCustomStatus(row: {
  customStatusText?: string | null;
  customStatusEmoji?: string | null;
  customStatusExpiresAt?: Date | null;
}) {
  if (!row.customStatusText && !row.customStatusEmoji) return null;
  return {
    text: row.customStatusText ?? null,
    emoji: row.customStatusEmoji ?? null,
    expiresAt: row.customStatusExpiresAt?.toISOString() ?? null,
    active:
      !row.customStatusExpiresAt ||
      row.customStatusExpiresAt.getTime() > Date.now(),
  };
}
