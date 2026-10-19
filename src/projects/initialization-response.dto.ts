import { ApiProperty } from "@nestjs/swagger";
import {
  ProjectInitializationStatus,
  ProjectInitializationStepStatus,
} from "@prisma/client";

/** Existing permission-gated persisted record; no additional public projection. */
export class InitializationAttemptResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) templateVersionId!: string;
  @ApiProperty({ minimum: 1 }) attempt!: number;
  @ApiProperty({ enum: ProjectInitializationStatus })
  status!: ProjectInitializationStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Existing privileged staging-path metadata; never a client-selected filesystem target.",
  })
  stagingPath!: string | null;
  @ApiProperty({ type: String, nullable: true }) quarantinePath!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Persisted worker lease metadata, not proof of current process liveness.",
  })
  leaseOwner!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  leaseExpiresAt!: string | null;
  @ApiProperty({ minimum: 0 }) lastSequence!: number;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) endedAt!:
    string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}
export class InitializationStepResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) initializationId!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) commandId!:
    string | null;
  @ApiProperty() key!: string;
  @ApiProperty({
    description:
      "Persisted step kind; not a closed provider command vocabulary.",
  })
  kind!: string;
  @ApiProperty({ minimum: 0 }) position!: number;
  @ApiProperty({ enum: ProjectInitializationStepStatus })
  status!: ProjectInitializationStepStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Existing stored bounded output. Treat as untrusted text; inspect outputTruncated.",
  })
  stdout!: string | null;
  @ApiProperty({ type: String, nullable: true }) stderr!: string | null;
  @ApiProperty() outputTruncated!: boolean;
  @ApiProperty({ type: Number, nullable: true }) exitCode!: number | null;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) endedAt!:
    string | null;
}
export class InitializationDetailResponseDto extends InitializationAttemptResponseDto {
  @ApiProperty({
    type: InitializationStepResponseDto,
    isArray: true,
    description:
      "Included by list/detail, ordered by position. Retry returns the scalar attempt shape instead.",
  })
  steps!: InitializationStepResponseDto[];
}
export class InitializationCancelledResponseDto {
  @ApiProperty({
    enum: [true],
    description:
      "Cancellation transition completed and local signals were attempted. Does not prove descendant termination or staging quarantine.",
  })
  cancelled!: true;
}
