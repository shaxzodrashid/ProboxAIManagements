import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from "@nestjs/swagger";

export class CreateSessionDto {
  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Authorized selected project; retained and revalidated at launch. Omit cwd to use its canonical directory.",
  })
  @IsOptional()
  @IsUUID("4")
  projectId?: string;
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

  @ApiPropertyOptional({
    example: "/opt/apps/example-project",
    maxLength: 4096,
    description:
      "Absolute working directory. It must be inside the server's allowed workspace root.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(4096)
  cwd?: string;

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

  @ApiPropertyOptional({
    enum: [
      "openai",
      "amazon-bedrock",
      "amazon-bedrock-runtime",
      "anthropic",
      "deepmind",
    ],
    default: "openai",
    description:
      "Managed provider ID. The provider/model/effort combination is validated against the runtime catalog.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerId?: string;

  @ApiPropertyOptional({
    enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
    description:
      "Optional model-specific thinking effort. Omit it to use the selected model's catalog default.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  reasoningEffort?: string;
}

export class DirectoryPreflightDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") taskId!: string;
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  projectId?: string;
  @ApiPropertyOptional({ maxLength: 4096 })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  cwd?: string;
  @ApiPropertyOptional({
    enum: ["read-only", "workspace-write", "danger-full-access"],
    default: "read-only",
  })
  @IsOptional()
  @IsIn(["read-only", "workspace-write", "danger-full-access"])
  sandbox: string = "read-only";
}
export class ProjectExecutionQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  taskId?: string;
  @ApiPropertyOptional({
    enum: ["read-only", "workspace-write", "danger-full-access"],
    default: "read-only",
  })
  @IsOptional()
  @IsIn(["read-only", "workspace-write", "danger-full-access"])
  sandbox: string = "read-only";
}
export class ExecutionProjectDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
}
export class DirectoryPreflightResponseDto {
  @ApiProperty({ nullable: true, type: ExecutionProjectDto })
  project!: ExecutionProjectDto | null;
  @ApiProperty() requestedPath!: string;
  @ApiProperty() valid!: boolean;
  @ApiProperty({ nullable: true, type: String }) normalizedPath!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    enum: [
      "ABSOLUTE_PATH_REQUIRED",
      "OUTSIDE_PROJECT",
      "OUTSIDE_ALLOWED_ROOT",
      "POLICY_UNAVAILABLE",
      "SYMLINK_NOT_ALLOWED",
      "NOT_DIRECTORY",
      "NOT_FOUND",
      "ACCESS_DENIED",
      "REAL_PATH_OUTSIDE_SCOPE",
      "DIRECTORY_UNAVAILABLE",
      "PROJECT_NOT_READY",
    ],
  })
  reason!: string | null;
  @ApiProperty({
    enum: [
      "SELECTED_PROJECT_DIRECTORY",
      "ABSOLUTE_ALLOWED_WORKSPACE_DIRECTORY",
    ],
  })
  guidance!: string;
  @ApiProperty({ enum: [true] }) revalidateAtLaunch!: boolean;
}
export class ExecutionCapabilitiesDto {
  @ApiProperty() canStartSession!: boolean;
  @ApiProperty() requiresAssignedTask!: boolean;
}
export class ProjectExecutionResponseDto extends DirectoryPreflightResponseDto {
  @ApiProperty({ type: ExecutionCapabilitiesDto })
  capabilities!: ExecutionCapabilitiesDto;
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

export class RequestFollowUpDto extends CreateTurnDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Client-generated UUIDv4. Reuse the same ID and prompt after an uncertain response; a different prompt with this ID conflicts.",
  })
  @IsUUID("4")
  requestId!: string;
}

export class SessionResponseDto {
  @ApiProperty({ nullable: true, type: String, format: "uuid" }) projectId!:
    string | null;
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
  @ApiProperty({
    nullable: true,
    type: String,
    enum: ["OWNER_LOST", "AUTHORIZATION_LOST", "DIRECTORY_INVALID"],
  })
  recoveryReason!: string | null;
  @ApiProperty({
    enum: [
      "NOT_OBSERVED",
      "NOT_STARTED",
      "STOP_UNCONFIRMED",
      "LOCAL_EXIT_OBSERVED",
    ],
    description:
      "Local exit is not descendant-stop or filesystem safety proof.",
  })
  stopConfirmation!: string;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  interruptRequestedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  interruptSignalAcceptedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  runnerExitedAt!: string | null;
  @ApiProperty({ example: "/opt/apps/example-project" }) cwd!: string;
  @ApiProperty({ enum: ["read-only", "workspace-write", "danger-full-access"] })
  sandbox!: string;
  @ApiProperty({ nullable: true, example: "gpt-5.4" }) model!: string | null;
  @ApiProperty({ example: "openai" }) providerId!: string;
  @ApiProperty({ nullable: true, example: "gpt-5.6-terra" })
  requestedModel!: string | null;
  @ApiProperty({ nullable: true, example: "gpt-5.6-terra" })
  effectiveModel!: string | null;
  @ApiProperty({ nullable: true, example: "medium" })
  requestedReasoningEffort!: string | null;
  @ApiProperty({ nullable: true, example: "medium" })
  effectiveReasoningEffort!: string | null;
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

export class ModelCatalogQueryDto {
  @ApiPropertyOptional({
    enum: [
      "openai",
      "amazon-bedrock",
      "amazon-bedrock-runtime",
      "anthropic",
      "deepmind",
    ],
    description:
      "Return models for one provider. Omit to return all providers.",
  })
  @IsOptional()
  @IsString()
  providerId?: string;
}

export class TurnResponseDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true }) requestId!:
    string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  executionStartedAt!: string | null;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ nullable: true }) codexTurnId!: string | null;
  @ApiProperty() prompt!: string;
  @ApiProperty({
    enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"],
  })
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
  @ApiProperty({ format: "uuid" }) turnId!: string;
  @ApiProperty({
    example: true,
    description:
      "Whether a signal was accepted by the tracked local process. This does not confirm descendant termination; read persisted turn state.",
  })
  interrupted!: boolean;
  @ApiProperty({
    enum: [
      "NOT_OBSERVED",
      "NOT_STARTED",
      "STOP_UNCONFIRMED",
      "LOCAL_EXIT_OBSERVED",
    ],
  })
  stopConfirmation!: string;
  @ApiProperty({ type: String, format: "date-time" }) requestedAt!: string;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  signalAcceptedAt!: string | null;
}

export class AssistantTextIdentityDto {
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ nullable: true, type: String, format: "uuid" }) turnId!:
    string | null;
  @ApiProperty({ nullable: true, type: String }) itemId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    format: "uuid",
    description: "Distinct event-only identity when turn/item is unavailable.",
  })
  eventId!: string | null;
}
export class AssistantTextUpdateDto {
  @ApiProperty({ enum: [1] }) version!: number;
  @ApiProperty({
    enum: ["SNAPSHOT", "UNVERIFIED_FRAME"],
    description:
      "Replace the display frame; never concatenate. Historical unverified frames remain provisional.",
  })
  mode!: string;
  @ApiProperty({ type: AssistantTextIdentityDto })
  identity!: AssistantTextIdentityDto;
  @ApiProperty({
    description:
      "Session sequence; ignore duplicate/older revisions for this identity.",
  })
  revision!: number;
  @ApiProperty({ enum: ["ITEM_COMPLETED", "PROVISIONAL"] }) phase!: string;
  @ApiProperty({ enum: ["ITEM_COMPLETE", "TRUNCATED", "UNKNOWN"] })
  continuation!: string;
  @ApiProperty({
    enum: ["USE_SERVER_STATE"],
    description:
      "Item completion never proves successful run completion. Gaps require replay.",
  })
  runCompletion!: string;
}
@ApiExtraModels(AssistantTextUpdateDto, AssistantTextIdentityDto)
export class PersistedSessionEventDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ nullable: true, type: String, format: "uuid" }) turnId!:
    string | null;
  @ApiProperty({ type: Number }) sequence!: number;
  @ApiProperty() type!: string;
  @ApiProperty({ format: "date-time", type: String }) createdAt!: string;
  @ApiProperty({ enum: ["SERVER", "RUNNER"] }) source!: string;
  @ApiProperty() legacyProjection!: boolean;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    properties: {
      textUpdate: {
        type: "object",
        additionalProperties: true,
        allOf: [{ $ref: getSchemaPath(AssistantTextUpdateDto) }],
      },
    },
    description:
      "Allowlisted payload. Assistant text is bounded to 16,384 JavaScript characters; textUpdate is present only for assistant display frames. Unsupported events are neutral omissions.",
  })
  data!: Record<string, unknown>;
}

export class SessionEventDataDto {
  @ApiProperty({
    type: () => PersistedSessionEventDto,
    description:
      "Persisted allowlisted event envelope, with source and sequence. Viewer identity is not authorship.",
  })
  data!: PersistedSessionEventDto;
}

export class SessionEventDto extends SessionEventDataDto {
  @ApiProperty({ example: "17" }) id!: string;
  @ApiProperty({ example: "turn.completed" }) type!: string;
}

export class CreatedSessionResponseDto extends SessionResponseDto {
  @ApiProperty({ type: TurnResponseDto, nullable: true })
  initialTurn!: TurnResponseDto | null;
}
export class TurnAcceptanceResponseDto {
  @ApiProperty({
    enum: [true],
    description: "Historical durable acceptance, not runner success.",
  })
  accepted!: true;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ format: "uuid" }) turnId!: string;
  @ApiProperty({
    enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"],
    description:
      "Persisted run state; QUEUED/RUNNING do not prove process liveness after restart.",
  })
  status!: string;
  @ApiProperty({ format: "date-time" }) acceptedAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  executionStartedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) endedAt!:
    string | null;
}

export class SessionHistoryQueryDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 2147483647,
    description:
      "Fixed first-page highWaterSequence for bounded history pagination. Omit for a fresh boundary; unsupported on SSE.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  untilSequence?: number;
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 2147483647,
    description: "Exclusive persisted sequence cursor, defaults to zero.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  after?: number;
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class SessionHistoryResponseDto {
  @ApiProperty({ type: SessionResponseDto }) session!: SessionResponseDto;
  @ApiProperty({ type: PersistedSessionEventDto, isArray: true })
  events!: PersistedSessionEventDto[];
  @ApiProperty() after!: number;
  @ApiProperty() nextCursor!: number;
  @ApiProperty() highWaterSequence!: number;
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ enum: ["RETAINED_WITH_EXPLICIT_OMISSIONS"] })
  historyAvailability!: string;
}

export class RequestInterruptDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Known target turn; retrying an old target cannot signal a newer run.",
  })
  @IsUUID("4")
  turnId!: string;
}
