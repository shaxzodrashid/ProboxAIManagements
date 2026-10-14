import { Transform } from "class-transformer";
import { IsString, IsUUID, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateChatGroupDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Client-generated UUIDv4, reused unchanged after an uncertain response.",
  })
  @IsUUID("4")
  requestId!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 120,
    description: "Trimmed plain-text group name.",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @Length(1, 120)
  name!: string;
}

export class ChatGroupResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ format: "uuid" }) ownerId!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
}

export class ChatGroupCreationResponseDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({
    type: ChatGroupResponseDto,
    description:
      "Frozen initial metadata; identical on replay even if future metadata changes.",
  })
  group!: ChatGroupResponseDto;
}

// Query selectors are not accepted on these self-scoped endpoints.
export class ChatGroupQueryDto {}
