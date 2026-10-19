import { ApiProperty } from "@nestjs/swagger";

export class ProtectedFileTypeResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({
    description: "Normalized lowercase extension including its leading dot.",
  })
  extension!: string;
  @ApiProperty({
    format: "uuid",
    description:
      "Original rule creator; updating the extension does not replace attribution.",
  })
  createdById!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: string;
}
export class ProtectedFileTypeRemovedResponseDto {
  @ApiProperty({
    enum: [true],
    description:
      "Protection rule removed, not a file-deletion or purge acknowledgment. A missing rule returns404.",
  })
  removed!: true;
}
