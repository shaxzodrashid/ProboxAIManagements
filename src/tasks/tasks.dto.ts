import { IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateTaskDto {
  @ApiProperty({ example: "Add project activity timeline", maxLength: 240 })
  @IsString()
  @MaxLength(240)
  title!: string;

  @ApiProperty({
    example:
      "Show project file changes and session milestones in the workspace UI.",
    maxLength: 16000,
  })
  @IsString()
  @MaxLength(16000)
  description!: string;

  @ApiPropertyOptional({
    example: "The timeline renders for members and has focused test coverage.",
    maxLength: 8000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  criteria?: string;
}

export class TaskManagerDto {
  @ApiProperty({ example: "Ada Lovelace" }) displayName!: string;
}

export class LatestSessionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({
    enum: [
      "QUEUED",
      "RUNNING",
      "PAUSED",
      "COMPLETED",
      "FAILED",
      "INTERRUPTED",
      "ARCHIVED",
    ],
  })
  status!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}

export class TaskResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ example: "Add project activity timeline" }) title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true }) criteria!: string | null;
  @ApiProperty({
    enum: [
      "QUEUED",
      "RUNNING",
      "AWAITING_APPROVAL",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ],
  })
  status!: string;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ format: "uuid" }) managerId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
  @ApiPropertyOptional({ type: TaskManagerDto }) manager?: TaskManagerDto;
  @ApiPropertyOptional({ type: LatestSessionDto, isArray: true })
  sessions?: LatestSessionDto[];
}
