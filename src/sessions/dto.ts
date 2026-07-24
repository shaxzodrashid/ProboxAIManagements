import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateSessionDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of a task assigned to the authenticated manager.",
  })
  @IsString()
  taskId!: string;

  @ApiProperty({
    example:
      "Implement the approved task, run focused tests, and report the result.",
    maxLength: 8000,
    description: "Initial prompt for the first Codex turn.",
  })
  @IsString()
  @MaxLength(8000)
  prompt!: string;

  @ApiProperty({
    example: "/opt/apps/example-project",
    description:
      "Absolute working directory. It must be inside the server's allowed workspace root.",
  })
  @IsString()
  cwd!: string;

  @ApiProperty({
    enum: ["read-only", "workspace-write", "danger-full-access"],
    example: "workspace-write",
    description: "Sandbox policy passed to the managed ProboxAI runner.",
  })
  @IsIn(["read-only", "workspace-write", "danger-full-access"])
  sandbox!: "read-only" | "workspace-write" | "danger-full-access";

  @ApiPropertyOptional({
    example: "gpt-5.4",
    description: "Optional runner model identifier.",
  })
  @IsOptional()
  @IsString()
  model?: string;
}

export class CreateTurnDto {
  @ApiProperty({
    example: "Now add a regression test for the error case.",
    maxLength: 8000,
    description: "Follow-up prompt for a completed or paused session.",
  })
  @IsString()
  @MaxLength(8000)
  prompt!: string;
}

export class SessionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ format: "uuid" }) creatorId!: string;
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
    example: "RUNNING",
  })
  status!: string;
  @ApiProperty({ example: "/opt/apps/example-project" }) cwd!: string;
  @ApiProperty({ enum: ["read-only", "workspace-write", "danger-full-access"] })
  sandbox!: string;
  @ApiProperty({ nullable: true, example: "gpt-5.4" }) model!: string | null;
  @ApiProperty({
    nullable: true,
    example: "019f92e1-d51b-7780-a795-13f9dabf0106",
  })
  codexThreadId!: string | null;
  @ApiProperty({ nullable: true, example: 12345 }) processId!: number | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  startedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  endedAt!: string | null;
  @ApiProperty({
    example: 17,
    description: "Last persisted event sequence number.",
  })
  lastSequence!: number;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}

export class TurnResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ nullable: true }) codexTurnId!: string | null;
  @ApiProperty() prompt!: string;
  @ApiProperty({ enum: ["RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"] })
  status!: string;
  @ApiProperty({ nullable: true }) inputTokens!: number | null;
  @ApiProperty({ nullable: true }) cachedTokens!: number | null;
  @ApiProperty({ nullable: true }) outputTokens!: number | null;
  @ApiProperty({ nullable: true }) reasoningTokens!: number | null;
  @ApiProperty({ type: String, format: "date-time" }) startedAt!: string;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  endedAt!: string | null;
}

export class SessionDetailResponseDto extends SessionResponseDto {
  @ApiProperty({ type: TurnResponseDto, isArray: true })
  turns!: TurnResponseDto[];
}

export class InterruptSessionResponseDto {
  @ApiProperty({
    example: true,
    description: "Whether the active local runner was interrupted.",
  })
  interrupted!: boolean;
}

export class SessionEventDataDto {
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Original event payload from the managed runner, augmented with the requesting actor ID.",
  })
  data!: Record<string, unknown>;
}

export class SessionEventDto extends SessionEventDataDto {
  @ApiProperty({ example: "17" }) id!: string;
  @ApiProperty({ example: "turn.completed" }) type!: string;
}
