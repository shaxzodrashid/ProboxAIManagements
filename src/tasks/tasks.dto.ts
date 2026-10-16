import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SessionStatus, TaskStatus } from "@prisma/client";

export class CreateTaskDto {
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Optional client UUIDv4 reused after an uncertain create. Same caller/workspace/key and canonical input replay the frozen original task; changed reuse conflicts. Omit for legacy non-idempotent creation; null is invalid.",
  })
  @ValidateIf((_o, value) => value !== undefined)
  @IsUUID("4")
  requestId?: string;
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
  @ApiProperty({ example: "Ada Lovelace" }) fullName!: string;
}

export class LatestSessionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: SessionStatus }) status!: SessionStatus;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}

export class TaskResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ example: "Add project activity timeline" }) title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) criteria!: string | null;
  @ApiProperty({ enum: TaskStatus }) status!: TaskStatus;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
  @ApiProperty({ format: "uuid" }) managerId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class TaskListItemResponseDto extends TaskResponseDto {
  @ApiProperty({ type: TaskManagerDto }) manager!: TaskManagerDto;
  @ApiProperty({
    type: LatestSessionDto,
    isArray: true,
    maxItems: 1,
    description:
      "Zero or one latest session, ordered by createdAt descending. A summary grants no session-detail access.",
  })
  sessions!: LatestSessionDto[];
}

/** Existing task read projection, addressed by a stable task identity. */
export class TaskDetailResponseDto extends TaskListItemResponseDto {}
