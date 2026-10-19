import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  Matches,
} from "class-validator";
import { ProfileAudienceField } from "@prisma/client";
import { ProfileAudienceResponseDto } from "./profile-privacy.dto";
import { CustomStatusResponseDto } from "./custom-status";
import { ProfileAvatarResponseDto } from "./profile-avatar-domain";

export class AudiencePickerQueryDto {
  @ApiProperty({
    enum: ProfileAudienceField,
    description:
      "STATUS selects custom text/emoji audience, never privacy for universally shared manual availability. Other field pickers retain their audience semantics.",
  })
  @IsEnum(ProfileAudienceField)
  field!: ProfileAudienceField;
  @ApiPropertyOptional({
    maxLength: 120,
    description:
      "Literal substring across workspace label, public names/username and only your contact aliases. Leading @ matches username.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q: string = "";
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Expand only your current workspace. Omit for mixed workspace/account search.",
  })
  @IsOptional()
  @IsUUID("4")
  workspaceId?: string;
  @ApiPropertyOptional({ maximum: 100, minimum: 1, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      "Opaque keyset cursor bound to caller, field, query and expansion scope.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}
export class SetContactAliasDto {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 120,
    description:
      "Owner-private plain-text alias. Null clears. Requires an existing Contact; does not create a grant.",
  })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, { message: "alias must not be blank" })
  alias!: string | null;
}
export class ContactAliasResponseDto {
  @ApiProperty({ format: "uuid" }) accountId!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 120 }) alias!:
    string | null;
}
export class PublicIdentityResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) firstName!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastName!: string | null;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
}
export class BirthdayDayMonthResponseDto {
  @ApiProperty({ minimum: 1, maximum: 31 }) day!: number;
  @ApiProperty({ minimum: 1, maximum: 12 }) month!: number;
}
export class PublicProfileResponseDto extends PublicIdentityResponseDto {
  @ApiProperty({
    type: CustomStatusResponseDto,
    nullable: true,
    description:
      "Null for unset, expired or STATUS-audience-hidden custom status. Shared availability has a separate unchanged endpoint.",
  })
  customStatus!: CustomStatusResponseDto | null;
  @ApiProperty({
    type: ProfileAvatarResponseDto,
    nullable: true,
    description:
      "Null for unset or hidden images, with no hidden asset metadata.",
  })
  avatar!: ProfileAvatarResponseDto | null;
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
  @ApiProperty({ type: BirthdayDayMonthResponseDto, nullable: true })
  birthdayDayMonth!: BirthdayDayMonthResponseDto | null;
  @ApiProperty({ type: Number, nullable: true }) birthdayYear!: number | null;
}
export class PickerAccountResponseDto extends PublicIdentityResponseDto {
  @ApiProperty({ enum: ["ACCOUNT"] }) kind!: "ACCOUNT";
  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    description:
      "Tree parent only within your authorized current workspace; otherwise null, never foreign affiliation.",
  })
  parentWorkspaceId!: string | null;
  @ApiProperty({ type: String, nullable: true }) alias!: string | null;
  @ApiProperty() isContact!: boolean;
  @ApiProperty() explicitSelected!: boolean;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      "Workspace-derived selection within the authorized tree; null where affiliation is unavailable.",
  })
  selectedViaWorkspace!: boolean | null;
}
export class PickerWorkspaceResponseDto {
  @ApiProperty({ enum: ["WORKSPACE"] }) kind!: "WORKSPACE";
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ description: "Existing workspace slug used as its label." })
  label!: string;
  @ApiProperty() explicitSelected!: boolean;
  @ApiProperty({
    enum: ["CHECKED", "INDETERMINATE", "UNCHECKED"],
    description:
      "CHECKED means an explicit dynamic workspace grant. Explicit child entries yield INDETERMINATE even when they cover all current members.",
  })
  selectionState!: string;
  @ApiProperty({
    description:
      "Whether saved explicit account grants include any currently available child; independent of query/page.",
  })
  hasExplicitChildren!: boolean;
}
@ApiExtraModels(PickerAccountResponseDto, PickerWorkspaceResponseDto)
export class AudiencePickerResponseDto {
  @ApiProperty({
    type: "array",
    items: {
      oneOf: [
        { $ref: getSchemaPath(PickerAccountResponseDto) },
        { $ref: getSchemaPath(PickerWorkspaceResponseDto) },
      ],
    },
  })
  items!: Array<PickerAccountResponseDto | PickerWorkspaceResponseDto>;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({
    type: ProfileAudienceResponseDto,
    description:
      "Complete saved selection sets, retained regardless of search/page. Counts are entries, not global viewer/member counts.",
  })
  selection!: ProfileAudienceResponseDto;
  @ApiProperty({
    type: PickerWorkspaceResponseDto,
    description:
      "Authorized parent context, also retained on child/search pages.",
  })
  workspaceContext!: PickerWorkspaceResponseDto;
}
