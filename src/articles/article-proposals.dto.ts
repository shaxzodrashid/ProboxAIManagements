import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class ArticleFoundationEmptyQueryDto {}

export class ReserveArticleDocumentDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Explicit new canonical identity reservation; creates no published content.",
  })
  @IsUUID("4")
  id!: string;
}
export class StageArticleProposalDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") id!: string;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") documentId!: string;
  @ApiProperty({
    format: "uuid",
    description:
      "One own private draft; no other draft or private hierarchy is copied.",
  })
  @IsUUID("4")
  sourceArticleId!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  @IsDefined()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID("4")
  baseVersionId!: string | null;
  @ApiProperty({ minimum: 0, maximum: 2147483646 })
  @IsInt()
  @Min(0)
  @Max(2147483646)
  baseForestRevision!: number;
  @ApiProperty({
    type: () => [PublishedArticlePositionDto],
    maxItems: 100,
    description:
      "Explicit complete published forest placements with this document. No private hierarchy is imported.",
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PublishedArticlePositionDto)
  positions!: PublishedArticlePositionDto[];
  @ApiProperty({
    type: [String],
    maxItems: 100,
    description:
      "Explicit complete published reading order with this document; no private-draft order is imported.",
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  readingOrder!: string[];
}
export class ArticleCandidateQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  after?: string;
}
export class ReservedArticleDocumentResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ type: String, nullable: true }) headVersionId!: string | null;
}
export class PublishedArticleTextDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ maxLength: 200 }) title!: string;
  @ApiProperty({ maxLength: 10000 }) text!: string;
}
export class PublishedArticlePositionDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") id!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  @IsDefined()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID("4")
  parentId!: string | null;
}
export class PublishedArticleForestDto {
  @ApiProperty({ enum: [1] }) format!: 1;
  @ApiProperty({ type: [PublishedArticlePositionDto], maxItems: 100 })
  articles!: PublishedArticlePositionDto[];
  @ApiProperty({ type: [String], maxItems: 100 }) readingOrder!: string[];
}
export class ArticlePublicationSnapshotDto {
  @ApiProperty({ enum: [1] }) format!: 1;
  @ApiProperty({ type: PublishedArticleTextDto, nullable: true })
  article!: PublishedArticleTextDto | null;
  @ApiProperty({ type: PublishedArticleForestDto })
  forest!: PublishedArticleForestDto;
}
export class ExactArticleComparisonDto {
  @ApiProperty({ enum: [1] }) format!: 1;
  @ApiProperty({ type: ArticlePublicationSnapshotDto })
  before!: ArticlePublicationSnapshotDto;
  @ApiProperty({ type: ArticlePublicationSnapshotDto })
  after!: ArticlePublicationSnapshotDto;
}
export class ArticleChangeFlagsDto {
  @ApiProperty() created!: boolean;
  @ApiProperty() title!: boolean;
  @ApiProperty() text!: boolean;
  @ApiProperty() parent!: boolean;
  @ApiProperty() forest!: boolean;
  @ApiProperty() readingOrder!: boolean;
}
export class ArticleCandidateSummaryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) documentId!: string;
  @ApiProperty({ enum: [0, 1, 2] }) revision!: number;
  @ApiProperty({
    enum: ["PRE_REVIEW", "QUEUED_FOR_REVIEW", "REVIEWER_RESOLUTION"],
  })
  state!: string;
  @ApiProperty({ enum: [false] }) dispatchAvailable!: false;
}
export class ArticleCandidateDetailDto extends ArticleCandidateSummaryDto {
  @ApiProperty({ format: "uuid" }) sourceArticleId!: string;
  @ApiProperty() sourceRevision!: number;
  @ApiProperty({ type: String, nullable: true }) baseVersionId!: string | null;
  @ApiProperty() baseForestRevision!: number;
  @ApiProperty({ type: ExactArticleComparisonDto })
  comparison!: ExactArticleComparisonDto;
  @ApiProperty({ type: ArticleChangeFlagsDto }) changes!: ArticleChangeFlagsDto;
}
export class ArticleCandidatePageDto {
  @ApiProperty({ type: [ArticleCandidateSummaryDto], maxItems: 50 })
  items!: ArticleCandidateSummaryDto[];
  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    description:
      "Accessible candidate identity for live FIFO continuation; no raw ordinal or hidden count.",
  })
  nextAfter!: string | null;
}
