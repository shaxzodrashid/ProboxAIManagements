import { ApiProperty } from "@nestjs/swagger";
import { ProfileAudienceField, ProfileAudienceMode } from "@prisma/client";
import { Type } from "class-transformer";
import { IsObject, ValidateNested } from "class-validator";
import { SelfProfileResponseDto, UpdateSelfProfileDto } from "./accounts.dto";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsUUID,
} from "class-validator";
export class ReplaceProfileAudienceDto {
  @ApiProperty({ enum: ProfileAudienceMode })
  @IsEnum(ProfileAudienceMode)
  mode!: ProfileAudienceMode;
  @ApiProperty({
    type: String,
    isArray: true,
    format: "uuid",
    maxItems: 500,
    description: "Complete explicit account set; empty unless CUSTOM.",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  accountIds!: string[];
  @ApiProperty({
    type: String,
    isArray: true,
    format: "uuid",
    maxItems: 500,
    description:
      "Complete workspace set; empty unless CUSTOM. Current membership is checked on every read.",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  workspaceIds!: string[];
}
export class ProfileAudienceResponseDto extends ReplaceProfileAudienceDto {
  @ApiProperty({
    enum: ProfileAudienceField,
    description:
      "STATUS controls custom text/emoji only; it never hides or varies shared manual availability at /profiles/:accountId/status. Other field audiences remain independent.",
  })
  field!: ProfileAudienceField;
  @ApiProperty({
    description: "Number of selected account entries, not distinct viewers.",
  })
  accountCount!: number;
  @ApiProperty({
    description: "Number of selected workspace entries, not distinct viewers.",
  })
  workspaceCount!: number;
}
export class ProfileContactResponseDto {
  @ApiProperty({ format: "uuid" }) accountId!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class ProfileContactRemovedDto {
  @ApiProperty({ example: true }) removed!: boolean;
}

export class SaveProfileAudienceDto extends ReplaceProfileAudienceDto {
  @ApiProperty({
    enum: ProfileAudienceField,
    description:
      "STATUS selects custom text/emoji visibility only and has no effect on shared manual availability. Other field privacy policies remain independent.",
  })
  @IsEnum(ProfileAudienceField)
  field!: ProfileAudienceField;
}
export class SaveSelfProfileDto extends UpdateSelfProfileDto {
  @ApiProperty({
    type: SaveProfileAudienceDto,
    isArray: true,
    maxItems: 5,
    description:
      "Staged audience replacements saved atomically with profile fields. Omitted audience fields retain their policies. Contacts are separate mutations.",
  })
  @IsArray()
  @ArrayMaxSize(5)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => SaveProfileAudienceDto)
  audiences!: SaveProfileAudienceDto[];
}
export class SavedSelfProfileResponseDto {
  @ApiProperty({ type: SelfProfileResponseDto })
  profile!: SelfProfileResponseDto;
  @ApiProperty({ type: ProfileAudienceResponseDto, isArray: true })
  audiences!: ProfileAudienceResponseDto[];
}
