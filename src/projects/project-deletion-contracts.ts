import { ApiProperty } from "@nestjs/swagger";
import {
  ProjectDeletionAudit,
  ProjectDeletionRequest,
  ProjectDeletionRequestStatus,
} from "@prisma/client";

export const deletionActions = [
  "OWNER_APPROVAL",
  "RESOLVE_ACTIVE_SESSIONS",
  "CONFIRM_TOKEN",
  "REISSUE_TOKEN",
  "WAIT",
  "NONE",
  "REVIEW_FAILURE",
];
export class DeletionSessionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["QUEUED", "RUNNING", "PAUSED"] }) status!: string;
}
export class ProjectDeletionRequestResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) requestedById!: string;
  @ApiProperty({ format: "uuid" }) ownerId!: string;
  @ApiProperty({ enum: ProjectDeletionRequestStatus }) status!: string;
  @ApiProperty({ enum: deletionActions }) nextAction!: string;
  @ApiProperty({ format: "date-time" }) requestedAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  approvedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  tokenExpiresAt!: string | null;
  @ApiProperty() tokenExpired!: boolean;
  @ApiProperty() tokenLocked!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ["WAIT", "INTERRUPT", null],
  })
  activeSessionAction!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  cancelledAt!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ["DELETION_FAILED", null],
  })
  failureCode!: string | null;
  @ApiProperty({
    type: DeletionSessionResponseDto,
    isArray: true,
    description:
      "Currently observed tracked sessions for this project; this is not proof all filesystem writers stopped.",
  })
  activeSessions!: DeletionSessionResponseDto[];
  @ApiProperty({
    description:
      "Indicates token delivery succeeded for this mutation only, not token validity.",
  })
  tokenSent!: boolean;
}
export class ProjectDeletionAuditResponseDto {
  @ApiProperty({ enum: ["WAIT", "NONE", "REVIEW_FAILURE"] })
  nextAction!: string;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ enum: ["PURGE_PENDING", "PURGED", "PURGE_FAILED"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true, enum: ["PURGE_FAILED", null] })
  failureCode!: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: string | null;
}
export class ProjectDeletionStateResponseDto {
  @ApiProperty() projectRemoved!: boolean;
  @ApiProperty({ type: ProjectDeletionRequestResponseDto, nullable: true })
  request!: ProjectDeletionRequestResponseDto | null;
  @ApiProperty({ type: ProjectDeletionAuditResponseDto, nullable: true })
  audit!: ProjectDeletionAuditResponseDto | null;
}
export class ProjectDeletionHistoryResponseDto {
  @ApiProperty() projectRemoved!: boolean;
  @ApiProperty({ type: ProjectDeletionRequestResponseDto, isArray: true })
  requests!: ProjectDeletionRequestResponseDto[];
  @ApiProperty({ type: ProjectDeletionAuditResponseDto, isArray: true })
  audits!: ProjectDeletionAuditResponseDto[];
  @ApiProperty({
    description:
      "Latest 100 of each type, not complete history. Known IDs remain independently readable.",
  })
  limit!: number;
}
export class DeletionSessionDecisionResponseDto {
  @ApiProperty({ enum: ["WAIT", "INTERRUPT"] }) action!: string;
  @ApiProperty({ type: DeletionSessionResponseDto, isArray: true })
  activeSessions!: DeletionSessionResponseDto[];
}
export class ConfirmProjectDeletionResponseDto {
  @ApiProperty({ format: "uuid" }) deletionAuditId!: string;
  @ApiProperty({ enum: ["PURGE_PENDING", "PURGED", "PURGE_FAILED"] })
  status!: string;
  @ApiProperty() projectRemoved!: boolean;
}

export function deletionRequestResponse(
  r: ProjectDeletionRequest,
  sessions: Array<{ id: string; status: string }> = [],
  tokenSent = false,
) {
  const tokenExpired =
    r.status === "AWAITING_TOKEN" &&
    (!r.tokenExpiresAt || r.tokenExpiresAt <= new Date());
  const tokenLocked = r.status === "AWAITING_TOKEN" && r.tokenAttempts >= 5;
  const nextAction =
    r.status === "PENDING_OWNER_APPROVAL"
      ? "OWNER_APPROVAL"
      : r.status === "AWAITING_ACTIVE_SESSIONS"
        ? "RESOLVE_ACTIVE_SESSIONS"
        : r.status === "AWAITING_TOKEN"
          ? tokenExpired || tokenLocked
            ? "REISSUE_TOKEN"
            : "CONFIRM_TOKEN"
          : r.status === "DELETING"
            ? "WAIT"
            : r.status === "FAILED"
              ? "REVIEW_FAILURE"
              : "NONE";
  return {
    id: r.id,
    projectId: r.projectId,
    requestedById: r.requestedById,
    ownerId: r.ownerId,
    status: r.status,
    nextAction,
    requestedAt: r.requestedAt,
    approvedAt: r.approvedAt,
    tokenExpiresAt: r.tokenExpiresAt,
    tokenExpired,
    tokenLocked,
    activeSessionAction: r.activeSessionAction,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    failureCode: r.failure ? "DELETION_FAILED" : null,
    activeSessions: sessions.map((s) => ({ id: s.id, status: s.status })),
    tokenSent,
  };
}
export function deletionAuditResponse(a: ProjectDeletionAudit) {
  return {
    id: a.id,
    projectId: a.projectId,
    requestId: a.requestId,
    status: a.status,
    nextAction:
      a.status === "PURGE_FAILED"
        ? "REVIEW_FAILURE"
        : a.status === "PURGED"
          ? "NONE"
          : "WAIT",
    failureCode: a.status === "PURGE_FAILED" ? "PURGE_FAILED" : null,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
  };
}
