import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsUUID, Max, Min, ValidateIf } from "class-validator";

const number = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)
    ? Number(value)
    : value;
export class AvatarUploadDto {
  @ApiProperty({
    format: "uuid",
    description:
      "UUIDv4 retained for byte-identical upload retry/readback. Separate from the main Save request identity.",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsUUID("4")
  requestId!: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 8192 })
  @Transform(number)
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(8192)
  cropX?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 8192 })
  @Transform(number)
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(8192)
  cropY?: number;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 8192,
    description:
      "Supply all three crop fields, in oriented source pixels, or none for centered square.",
  })
  @Transform(number)
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(8192)
  cropSize?: number;
}
export class AvatarUploadQueryDto {}
export class AvatarUploadReceiptDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) assetId!: string;
  @ApiProperty({
    enum: [
      "UPLOADING",
      "STAGED",
      "ACTIVE",
      "EXPIRED",
      "DELETE_PENDING",
      "DELETING",
      "DELETED",
    ],
    description:
      "Current upload/asset state, not a whole-Profile Save receipt. UPLOADING is uncertain, never proven failed.",
  })
  state!: string;
  @ApiProperty({
    format: "date-time",
    description:
      "Staging deadline only. A published ACTIVE avatar does not expire at this time.",
  })
  expiresAt!: string;
  @ApiProperty({ maximum: 512 }) width!: number;
  @ApiProperty({ maximum: 512 }) height!: number;
  @ApiProperty({ type: String, nullable: true }) previewUrl!: string | null;
}
export class DiscardedAvatarDto {
  @ApiProperty({
    enum: [true],
    description:
      "Draft retired for safe cleanup. Does not remove an active profile photo or prove physical deletion.",
  })
  discarded!: true;
}
