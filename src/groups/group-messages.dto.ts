import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsString,
  IsUUID,
  Length,
  Matches,
  IsOptional,
  IsInt,
  Min,
  Max,
} from "class-validator";

export class GroupHistoryQueryDto {
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Omit for the existing unthreaded partition. No topic discovery or management is granted.",
  })
  @IsOptional()
  @IsUUID("4")
  topicId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({
    maxLength: 1024,
    description: "Opaque continuation; retain identical topic and page size.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  cursor?: string;
}
export class GroupHistoryMessageDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) authorId!: string;
  @ApiProperty({ maxLength: 4000 }) text!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) topicId!:
    string | null;
}
export class GroupHistoryPageDto {
  @ApiProperty({ type: [GroupHistoryMessageDto] })
  items!: GroupHistoryMessageDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class SendGroupMessageDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Reuse this UUIDv4 and exact text after an uncertain response.",
  })
  @IsUUID("4")
  requestId!: string;
  @ApiProperty({
    minLength: 1,
    maxLength: 4000,
    description:
      "Plain text, preserved exactly; must contain a non-whitespace character. No HTML execution or attachments.",
  })
  @IsString()
  @Length(1, 4000)
  @Matches(/\S/u)
  text!: string;
}
export class SetGroupSendingPolicyDto {
  @ApiProperty({
    description:
      "True permits all admitted OPEN members (default). False restricts new sends to the current admitted OPEN owner.",
  })
  @IsBoolean()
  membersCanSend!: boolean;
}
export class GroupSendingPolicyDto {
  @ApiProperty() membersCanSend!: boolean;
  @ApiProperty({ minimum: 0 }) revision!: number;
}
export class GroupMessageDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) groupId!: string;
  @ApiProperty({ format: "uuid" }) authorId!: string;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ maxLength: 4000 }) text!: string;
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
}
