import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ManualAvailability } from "@prisma/client";
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateIf } from "class-validator";
import {
  SaveSelfProfileDto,
  SavedSelfProfileResponseDto,
} from "./profile-privacy.dto";
import { ManualStatusResponseDto } from "./manual-status.dto";
import { Type, Transform } from "class-transformer";
import { IsObject, ValidateNested } from "class-validator";
import { CustomStatusInputDto, CustomStatusResponseDto } from "./custom-status";
import { ProfileAvatarResponseDto } from "./profile-avatar-domain";

export class ProfileSaveQueryDto {}
export class CommitSelfProfileDto extends SaveSelfProfileDto {
  @ApiPropertyOptional({
    type: CustomStatusInputDto,
    nullable: true,
    description:
      "Omit to retain, null clears, object replaces the entire custom text/emoji/expiry unit. STATUS audience applies; availability stays separate.",
  })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => CustomStatusInputDto)
  customStatus?: CustomStatusInputDto | null;
  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    nullable: true,
    description:
      "Owned staged avatar asset to publish atomically. Omit retains; null removes. Never a path or storage URL.",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsUUID("4")
  avatarAssetId?: string | null;
  @ApiProperty({
    format: "uuid",
    description: "UUIDv4 retained for exact whole-Save retry/readback.",
  })
  @IsUUID("4")
  requestId!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 2147483646,
    description:
      "Opaque aggregate revision from the coherent edit read. Stale input returns 409; never silently rebase.",
  })
  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedRevision!: number;

  @ApiPropertyOptional({
    enum: ManualAvailability,
    nullable: true,
    description:
      "Omit to retain availability; null explicitly clears it. Supplied value becomes shared with everyone only when the entire Save commits.",
  })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsEnum(ManualAvailability)
  availability?: ManualAvailability | null;
}
export class ProfileEditResponseDto extends SavedSelfProfileResponseDto {
  @ApiProperty({ type: CustomStatusResponseDto, nullable: true })
  customStatus!: CustomStatusResponseDto | null;
  @ApiProperty({ type: ProfileAvatarResponseDto, nullable: true })
  avatar!: ProfileAvatarResponseDto | null;
  @ApiProperty({
    minimum: 0,
    description:
      "Opaque monotonic generation covering profile content, audience records and availability. Not an edit count or status ETag.",
  })
  revision!: number;
  @ApiProperty({ type: ManualStatusResponseDto })
  status!: ManualStatusResponseDto;
}
export class ProfileSaveReceiptDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ minimum: 0 }) expectedRevision!: number;
  @ApiProperty({
    minimum: 1,
    description:
      "Historical committed generation; reread edit state for current values.",
  })
  revision!: number;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
