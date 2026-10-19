import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { BoardMutationDto } from "./task-boards.dto";

export class ShareTaskDto extends BoardMutationDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Explicit destination-board column. Sharing never maps or copies another board's workflow column.",
  })
  @IsUUID("4")
  statusId!: string;
}
export class SharedTaskQueryDto {}
export class SharedTaskOperationDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) actorId!: string;
  @ApiProperty({
    enum: ["SHARE", "UNSHARE", "MOVE_LOCAL", "CONFIRM_COMPLETION"],
  })
  action!: string;
  @ApiPropertyOptional({
    enum: [true],
    description:
      "Present only for creator-confirmed canonical completion. There is no reopening action.",
  })
  completed?: true;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({
    format: "uuid",
    description: "Authorized route context only.",
  })
  projectId!: string;
  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    description:
      "Destination identity only for owner-controlled share commands.",
  })
  targetProjectId!: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) statusId!:
    string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class OwnedTaskShareDto {
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) statusId!: string;
}
export class TaskSharingEditDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({
    type: OwnedTaskShareDto,
    isArray: true,
    description:
      "Only shares into projects where the owner is currently a member; no hidden-project totals.",
  })
  shares!: OwnedTaskShareDto[];
}
export class SharedTaskStateDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({
    format: "uuid",
    description: "Current authorized project context only.",
  })
  projectId!: string;
  @ApiProperty({ format: "uuid" }) statusId!: string;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      "Single canonical human completion; null means no recorded decision. Never inferred from any board column or runner outcome.",
  })
  completed!: boolean | null;
}
