import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ProjectMemberPickerQueryDto {
  @ApiPropertyOptional({
    enum: ["all", "members", "nonmembers"],
    default: "all",
    description:
      "Current membership in this specific project. Inactive accounts stay excluded.",
  })
  @IsOptional()
  @IsIn(["all", "members", "nonmembers"])
  membership?: "all" | "members" | "nonmembers" = "all";

  @ApiPropertyOptional({
    enum: ["id", "-id", "name", "-name", "username", "-username"],
    default: "id",
    description:
      "Case-insensitive text sorting. Missing usernames last in either direction; text ties use id ascending.",
  })
  @IsOptional()
  @IsIn(["id", "-id", "name", "-name", "username", "-username"])
  sort?: "id" | "-id" | "name" | "-name" | "username" | "-username" = "id";
  @ApiPropertyOptional({
    maxLength: 200,
    default: "",
    description:
      "Literal case-insensitive public name or username substring. Empty query browses only this project's workspace.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  q: string = "";

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      "Continuation bound to actor, current workspace, project and normalized query. Mutable roster; not an authorization token.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}

export class ProjectMemberCandidateDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) firstName!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastName!: string | null;
  @ApiProperty({ nullable: true, type: String }) username!: string | null;
  @ApiProperty({
    description:
      "Current membership in this specific project only. Does not imply a project role or invitation.",
  })
  isMember!: boolean;
}

export class ProjectMemberPickerResponseDto {
  @ApiProperty({
    minimum: 0,
    description:
      "Exact eligible count for current authorized filters, from the same snapshot as this page. May change between pages.",
  })
  total!: number;
  @ApiProperty({ type: ProjectMemberCandidateDto, isArray: true })
  items!: ProjectMemberCandidateDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
