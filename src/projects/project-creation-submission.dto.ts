import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { CreateProjectDto } from "./projects.dto";

export class SubmitProjectCreationDto extends CreateProjectDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Client-generated UUIDv4 retained across response loss. Same identity never replays filesystem work.",
  })
  @IsUUID("4")
  requestId!: string;
}
export class ProjectCreationOutcomeDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ enum: ["COMPLETED", "UNRESOLVED"] }) state!: string;
  @ApiProperty({ nullable: true, type: String, format: "uuid" }) projectId!:
    string | null;
  @ApiProperty({ nullable: true, type: String, format: "uuid" })
  initializationId!: string | null;
  @ApiProperty({ format: "uuid" }) departmentId!: string;
  @ApiProperty({ nullable: true, type: String, format: "uuid" })
  templateVersionId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    enum: [
      "PROJECT_DIRECTORY_EXISTS",
      "CREATE_REJECTED",
      "CREATION_OUTCOME_UNKNOWN",
    ],
  })
  failureCode!: string | null;
  @ApiProperty({
    description:
      "Local transaction callback and all issued awaits settled; not external-writer containment proof.",
  })
  executionFinished!: boolean;
  @ApiProperty({ enum: [false] }) willReplay!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}
