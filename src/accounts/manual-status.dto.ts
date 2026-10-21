import { ApiProperty } from "@nestjs/swagger";
import { ManualAvailability } from "@prisma/client";
import { IsDefined, IsEnum, IsUUID, ValidateIf } from "class-validator";

export class ManualStatusQueryDto {}
export class SetManualStatusDto {
  @ApiProperty({
    format: "uuid",
    description: "Client UUIDv4 retained for exact retry/readback.",
  })
  @IsUUID("4")
  requestId!: string;
  @ApiProperty({
    enum: ManualAvailability,
    nullable: true,
    description:
      "One shared manual availability, visible equally to everyone. Null clears to unset; no default or automatic presence. Legacy STATUS audience policies do not control this value.",
  })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @IsEnum(ManualAvailability)
  availability!: ManualAvailability | null;
}
export class ManualStatusResponseDto {
  @ApiProperty({
    enum: ManualAvailability,
    nullable: true,
    description:
      "Unset is null, never inferred Available/Offline. Shared with everyone; unrelated to account lifecycle or connection presence.",
  })
  availability!: ManualAvailability | null;
  @ApiProperty({ minimum: 0 }) revision!: number;
}
export class PublicManualStatusResponseDto {
  @ApiProperty({ format: "uuid" }) accountId!: string;
  @ApiProperty({
    enum: ManualAvailability,
    nullable: true,
    description:
      "Same current manual value for all viewers, including anonymous viewers. Legacy STATUS audiences have no effect; no presence, timestamps or actor history.",
  })
  availability!: ManualAvailability | null;
}
export class ManualStatusActorDto {
  @ApiProperty({ enum: ["EMPLOYEE"] }) kind!: "EMPLOYEE";
  @ApiProperty({ format: "uuid" }) id!: string;
}
export class ManualStatusMutationResponseDto extends ManualStatusResponseDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ type: ManualStatusActorDto }) actor!: ManualStatusActorDto;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
