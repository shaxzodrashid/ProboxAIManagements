import { ApiProperty } from "@nestjs/swagger";
import {
  PublishedArticleForestDto,
  PublishedArticleTextDto,
} from "./article-proposals.dto";
export class CanonicalArticleTreeDto {
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ type: PublishedArticleForestDto })
  forest!: PublishedArticleForestDto;
}
export class CanonicalArticlePublicationDto {
  @ApiProperty({ format: "uuid" }) documentId!: string;
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty({ minimum: 1 }) number!: number;
  @ApiProperty({ minimum: 1 }) forestRevision!: number;
  @ApiProperty({ type: PublishedArticleTextDto })
  article!: PublishedArticleTextDto;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) previousId!:
    string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) nextId!:
    string | null;
}
