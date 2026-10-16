import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID } from "class-validator";

export class ProjectListQueryDto {
  @ApiPropertyOptional({
    enum: ["active", "archived"],
    default: "active",
    description:
      "Archived projects appear only when archived is explicitly requested; existing read scope still applies.",
  })
  @IsOptional()
  @IsIn(["active", "archived"])
  lifecycle?: "active" | "archived";
}
export class ArchiveProjectDto {
  @ApiProperty({
    format: "uuid",
    description: "Stable client request identity, retained on retry.",
  })
  @IsUUID("4")
  requestId!: string;
}
export class ProjectArchiveResponseDto {
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) actorId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: String, format: "date-time" }) archivedAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
