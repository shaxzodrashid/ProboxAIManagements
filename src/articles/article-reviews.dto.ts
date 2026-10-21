import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from "class-validator";
import { EditArticleDraftDto } from "./articles.dto";

export class SubmitArticleReviewDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Explicit review identity; submission shares only this article's frozen text for review.",
  })
  @IsUUID("4")
  id!: string;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") articleId!: string;
}
export class SelectArticleVotersDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 100,
    description:
      "Owner-selected fixed electorate; every listed voter must vote.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  voterIds!: string[];
}
export class VoteArticleReviewDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
}
export class ArticleReviewPageQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  after?: string;
}
export class SubmittedArticleResponseDto extends EditArticleDraftDto {
  @ApiProperty({ enum: [1] }) format!: 1;
  @ApiProperty({ format: "uuid" }) id!: string;
}
export class ArticleReviewVoterResponseDto {
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ type: Boolean, nullable: true }) approved!: boolean | null;
}
export class ArticleReviewSummaryResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) articleId!: string;
  @ApiProperty() sourceRevision!: number;
  @ApiProperty() revision!: number;
  @ApiProperty({ enum: ["WAITING_VOTERS", "PENDING", "APPROVED", "REJECTED"] })
  state!: string;
}
export class ArticleReviewResponseDto extends ArticleReviewSummaryResponseDto {
  @ApiProperty({ type: SubmittedArticleResponseDto })
  article!: SubmittedArticleResponseDto;
  @ApiProperty({ type: [ArticleReviewVoterResponseDto] })
  voters!: ArticleReviewVoterResponseDto[];
}
export class ArticleReviewPageResponseDto {
  @ApiProperty({ type: [ArticleReviewSummaryResponseDto] })
  items!: ArticleReviewSummaryResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextAfter!: string | null;
}
export class ArticlePublicationResponseDto {
  @ApiProperty({ format: "uuid" }) reviewId!: string;
  @ApiProperty() sourceRevision!: number;
  @ApiProperty({ type: SubmittedArticleResponseDto })
  article!: SubmittedArticleResponseDto;
}
export class ArticlePublicationSummaryResponseDto {
  @ApiProperty({ format: "uuid" }) reviewId!: string;
  @ApiProperty({ format: "uuid" }) articleId!: string;
  @ApiProperty() sourceRevision!: number;
}
export class ArticlePublicationPageResponseDto {
  @ApiProperty({ type: [ArticlePublicationSummaryResponseDto] })
  items!: ArticlePublicationSummaryResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextAfter!: string | null;
}
