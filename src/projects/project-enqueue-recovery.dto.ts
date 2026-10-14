import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class RecoverProjectEnqueueDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Exact pinned template version returned by recovery readback; never select the latest version automatically.",
  })
  @IsUUID("4")
  templateVersionId!: string;
}
export class RecoveryInitializationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) templateVersionId!: string;
  @ApiProperty() attempt!: number;
  @ApiProperty({
    enum: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"],
  })
  status!: string;
}
export class ProjectEnqueueRecoveryStateDto {
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ enum: ["INITIALIZING", "READY", "FAILED", "DELETING"] })
  projectStatus!: string;
  @ApiProperty({ nullable: true, type: String, format: "uuid" })
  pinnedTemplateVersionId!: string | null;
  @ApiProperty({ enum: ["NO_ATTEMPT", "ATTEMPT_EXISTS"] }) state!: string;
  @ApiProperty() canRegisterInitialSetup!: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    enum: [
      "ATTEMPT_EXISTS",
      "NO_PINNED_TEMPLATE",
      "PROJECT_NOT_RECOVERABLE",
      "PINNED_TEMPLATE_UNAVAILABLE",
    ],
  })
  blockedReason!: string | null;
  @ApiProperty({ nullable: true, type: RecoveryInitializationDto })
  latestAttempt!: RecoveryInitializationDto | null;
}
export class ProjectEnqueueRecoveryResponseDto {
  @ApiProperty({ enum: [true] }) registered!: boolean;
  @ApiProperty({
    description:
      "True only when this request registered the first attempt; not proof of execution or completion.",
  })
  created!: boolean;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty() projectStatus!: string;
  @ApiProperty({ format: "uuid" }) pinnedTemplateVersionId!: string;
  @ApiProperty({ type: RecoveryInitializationDto })
  initialization!: RecoveryInitializationDto;
}
