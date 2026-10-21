import { ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsUUID,
  IsIn,
  IsOptional,
  IsBoolean,
  Matches,
  ValidateNested,
} from "class-validator";
import { SelectArticleVotersDto } from "./article-reviews.dto";
import { conflictOptions, ConflictOption } from "./article-conflict-vote";
import {
  ArticlePublicationSnapshotDto,
  ExactArticleComparisonDto,
  PublishedArticleForestDto,
} from "./article-proposals.dto";
export class DispatchArticleResolutionDto extends SelectArticleVotersDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") id!: string;
}
export class CastConflictBallotDto {
  @ApiProperty({ enum: [1, 2], required: false, default: 1 })
  @IsOptional()
  @IsIn([1, 2])
  round?: 1 | 2;
  @ApiProperty({ enum: conflictOptions })
  @IsIn(conflictOptions)
  option!: ConflictOption;
}
export class CastArticleApprovalDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
}
export class OwnArticleApprovalDto {
  @ApiProperty() approved!: boolean;
  @ApiProperty({ enum: [1] }) revision!: 1;
}
export class ArticleApprovalStateDto {
  @ApiProperty() available!: boolean;
  @ApiProperty({ enum: ["PENDING", "APPROVED", "REJECTED", "NOT_APPLICABLE"] })
  state!: string;
  @ApiProperty({ type: OwnArticleApprovalDto, nullable: true })
  myApproval!: OwnArticleApprovalDto | null;
}
export class ResolutionPublicationDto {
  @ApiProperty({ enum: ["PUBLISHED", "PENDING_COMPATIBILITY", "CLOSED"] })
  state!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) versionId!:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) number!: number | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}
export class ConflictVersionAlternativeDto {
  @ApiProperty({ enum: ["A", "B"] }) label!: string;
  @ApiProperty({ format: "uuid" }) contributionId!: string;
  @ApiProperty({ type: ExactArticleComparisonDto })
  comparison!: ExactArticleComparisonDto;
}
export class ConflictVotingDto {
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({
    type: [ConflictVersionAlternativeDto],
    required: false,
    maxItems: 2,
  })
  alternatives?: ConflictVersionAlternativeDto[];
  @ApiProperty({
    enum: ["PENDING", "RUNOFF_PENDING", "DECIDED", "FOR_REVISION"],
  })
  state!: string;
  @ApiProperty({ enum: [1, 2] }) round!: number;
  @ApiProperty({ enum: conflictOptions, isArray: true, maxItems: 4 })
  allowedOptions!: ConflictOption[];
  @ApiProperty({ enum: conflictOptions, nullable: true })
  winner!: ConflictOption | null;
  @ApiProperty() publicationAvailable!: boolean;
}
export class OwnConflictBallotDto {
  @ApiProperty({ enum: [1, 2] }) round!: number;
  @ApiProperty({ enum: conflictOptions }) option!: ConflictOption;
  @ApiProperty({ enum: [1] }) revision!: 1;
}
export class ReviewerAlternativeChoiceDto {
  @ApiProperty({ pattern: "^[0-9a-f]{64}$" })
  @Matches(/^[0-9a-f]{64}$/)
  conflictId!: string;
  @ApiProperty({ pattern: "^[0-9a-f]{64}$" })
  @Matches(/^[0-9a-f]{64}$/)
  alternativeId!: string;
}
export class SetReviewerAlternativesDto {
  @ApiProperty({ type: [ReviewerAlternativeChoiceDto], maxItems: 3 })
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReviewerAlternativeChoiceDto)
  choices!: ReviewerAlternativeChoiceDto[];
}
export class ArticleAlternativeDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    oneOf: [
      { type: "string" },
      { $ref: getSchemaPath(PublishedArticleForestDto) },
    ],
  })
  value!: string | PublishedArticleForestDto;
  @ApiProperty({ type: [String], maxItems: 100 }) contributionIds!: string[];
}
export class ArticleConflictDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ["title", "text", "forest"] }) field!: string;
  @ApiProperty({ type: [ArticleAlternativeDto], maxItems: 100 })
  alternatives!: ArticleAlternativeDto[];
}
export class ArticleMergedFieldsDto {
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ type: String, nullable: true }) text!: string | null;
  @ApiProperty({ type: PublishedArticleForestDto, nullable: true })
  forest!: PublishedArticleForestDto | null;
}
export class ArticleMaterializationDto {
  @ApiProperty({ enum: [1] }) format!: 1;
  @ApiProperty({ format: "uuid" }) documentId!: string;
  @ApiProperty({ type: ArticlePublicationSnapshotDto })
  before!: ArticlePublicationSnapshotDto;
  @ApiProperty({ type: ArticleMergedFieldsDto })
  fields!: ArticleMergedFieldsDto;
  @ApiProperty({ type: [ArticleConflictDto], maxItems: 3 })
  conflicts!: ArticleConflictDto[];
  @ApiProperty({ type: ExactArticleComparisonDto, nullable: true })
  comparison!: ExactArticleComparisonDto | null;
  @ApiProperty({ type: [String], maxItems: 100 }) contributionIds!: string[];
  @ApiProperty({ type: [String], maxItems: 100 })
  supersededContributionIds!: string[];
}
export class ArticleResolutionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) documentId!: string;
  @ApiProperty({
    enum: [
      "RESOLVING",
      "DECIDED",
      "RETURNED_FOR_REVISION",
      "REJECTED",
      "APPROVED",
    ],
  })
  phase!: string;
  @ApiProperty() finalVotingAvailable!: boolean;
  @ApiProperty({ type: ArticleApprovalStateDto })
  approvalVoting!: ArticleApprovalStateDto;
  @ApiProperty({ type: ResolutionPublicationDto })
  publication!: ResolutionPublicationDto;
  @ApiProperty({ type: ArticleMaterializationDto })
  materialization!: ArticleMaterializationDto;
  @ApiProperty({ type: ConflictVotingDto }) conflictVoting!: ConflictVotingDto;
  @ApiProperty({ type: [OwnConflictBallotDto], maxItems: 2 })
  myBallots!: OwnConflictBallotDto[];
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  reviewerIds!: string[];
  @ApiProperty({ type: Number, nullable: true }) myChoiceVersion!:
    number | null;
  @ApiProperty({
    type: [ReviewerAlternativeChoiceDto],
    nullable: true,
    maxItems: 3,
  })
  myChoices!: ReviewerAlternativeChoiceDto[] | null;
}
export class ReviewerChoiceResponseDto {
  @ApiProperty({ minimum: 1 }) choiceVersion!: number;
  @ApiProperty({ type: [ReviewerAlternativeChoiceDto], maxItems: 3 })
  choices!: ReviewerAlternativeChoiceDto[];
}
export class ArticleResolutionSummaryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) documentId!: string;
  @ApiProperty({
    enum: ["RESOLVING", "DECIDED", "RETURNED_FOR_REVISION", "REJECTED"],
  })
  phase!: string;
  @ApiProperty({ enum: [false] }) finalVotingAvailable!: false;
}
export class ArticleResolutionPageDto {
  @ApiProperty({ type: [ArticleResolutionSummaryDto], maxItems: 50 })
  items!: ArticleResolutionSummaryDto[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) nextAfter!:
    string | null;
}
