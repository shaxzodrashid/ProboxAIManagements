import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { ChatGroupResponseDto } from "./groups.dto";
export const groupHistoryChoices = [
  "NONE",
  "LAST_100",
  "LAST_300",
  "ALL",
] as const;
export class CreateGroupInvitationDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") requestId!: string;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") recipientId!: string;
  @ApiProperty({ enum: ["DIRECT", "APPROVABLE"] })
  @IsIn(["DIRECT", "APPROVABLE"])
  mode!: "DIRECT" | "APPROVABLE";
  @ApiPropertyOptional({
    enum: groupHistoryChoices,
    default: "NONE",
    description:
      "Chosen by the inviter, without an extra owner/admin approval. Initial admission only; future group-history retrieval must honor the selected per-topic window.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(groupHistoryChoices)
  historyAccess?: (typeof groupHistoryChoices)[number];
}
export class SetGroupInvitationPermissionDto {
  @ApiProperty() @IsBoolean() canInvite!: boolean;
}
export class GroupInvitationDecisionDto {
  @ApiProperty({
    description:
      "True accepts, false declines. Only the exact recipient may decide; a contrary later decision conflicts.",
  })
  @IsBoolean()
  accept!: boolean;
}
export class GroupPageQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID("4")
  afterId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class DirectCardQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  afterSequence?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class GroupInvitationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) groupId!: string;
  @ApiProperty({ description: "Frozen group name at invitation creation." })
  groupName!: string;
  @ApiProperty({ format: "uuid" }) inviterId!: string;
  @ApiProperty({ format: "uuid" }) recipientId!: string;
  @ApiProperty({ enum: ["DIRECT", "APPROVABLE"] }) mode!: string;
  @ApiProperty({ enum: groupHistoryChoices }) historyAccess!: string;
  @ApiProperty({ enum: ["PENDING", "ADDED", "ACCEPTED", "DECLINED"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  conversationId!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  resolvedAt!: Date | null;
}
export class GroupInvitationOutcomeDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ type: GroupInvitationDto }) invitation!: GroupInvitationDto;
}
export class GroupMembershipDto {
  @ApiProperty({ type: ChatGroupResponseDto }) group!: ChatGroupResponseDto;
  @ApiProperty({ enum: groupHistoryChoices }) historyAccess!: string;
  @ApiProperty({ format: "date-time" }) joinedAt!: Date;
}
export class GroupMembershipListDto {
  @ApiProperty({ type: GroupMembershipDto, isArray: true })
  items!: GroupMembershipDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) nextAfterId!:
    string | null;
}
export class InvitationPermissionDto {
  @ApiProperty({ format: "uuid" }) accountId!: string;
  @ApiProperty() canInvite!: boolean;
}
export class GroupInvitationPermissionsDto {
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ type: InvitationPermissionDto, isArray: true })
  items!: InvitationPermissionDto[];
}
export class DirectConversationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) counterpartId!: string;
  @ApiProperty({ minimum: 1 }) lastSequence!: number;
}
export class DirectConversationsDto {
  @ApiProperty({ type: DirectConversationDto, isArray: true })
  items!: DirectConversationDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) nextAfterId!:
    string | null;
}
export class DirectInvitationActionsDto {
  @ApiProperty({
    description:
      "Current recipient and inviter authority snapshot; acceptance rechecks under locks.",
  })
  accept!: boolean;
  @ApiProperty({
    description: "Only the pending invitation's recipient can decline.",
  })
  decline!: boolean;
}
export class DirectInvitationCardDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["GROUP_INVITATION"] }) kind!: "GROUP_INVITATION";
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty({ type: GroupInvitationDto }) invitation!: GroupInvitationDto;
  @ApiProperty({ type: DirectInvitationActionsDto })
  actions!: DirectInvitationActionsDto;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
}
export class DirectInvitationCardsDto {
  @ApiProperty({ type: DirectInvitationCardDto, isArray: true })
  items!: DirectInvitationCardDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: Number, nullable: true }) nextAfterSequence!:
    number | null;
}
