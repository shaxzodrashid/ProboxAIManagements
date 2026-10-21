import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class EditArticleDraftDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
  @ApiProperty({
    maxLength: 10000,
    description: "Plain text only; no media or executable embed resolution.",
  })
  @IsString()
  @MaxLength(10000)
  text!: string;
}
export class CreateArticleDraftDto extends EditArticleDraftDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  id!: string;
}
export class ArticlePlacementDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") id!: string;
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID("4")
  parentId!: string | null;
}
export class ArrangeArticleDraftsDto {
  @ApiProperty({ type: [ArticlePlacementDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ArticlePlacementDto)
  articles!: ArticlePlacementDto[];
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID("4", { each: true })
  readingOrder!: string[];
}
export class ArticleDraftResponseDto extends CreateArticleDraftDto {
  @ApiProperty({ type: String, nullable: true }) parentId!: string | null;
}
export class ArticleDraftSpaceResponseDto {
  @ApiProperty({ enum: [1] }) format!: 1;
  @ApiProperty() revision!: number;
  @ApiProperty({ type: [ArticleDraftResponseDto] })
  articles!: ArticleDraftResponseDto[];
  @ApiProperty({ type: [String] }) readingOrder!: string[];
}
export class ArticleDraftDetailResponseDto extends ArticleDraftResponseDto {
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, nullable: true }) previousId!: string | null;
  @ApiProperty({ type: String, nullable: true }) nextId!: string | null;
}
