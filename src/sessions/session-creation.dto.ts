import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { CreateSessionDto } from "./dto";
export class KeyedCreateSessionDto extends CreateSessionDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Persist before sending. Transport retries keep this same intent; intentional Run again creates a new UUID immediately, even for identical task/input. There is no per-task retention lock.",
  })
  @IsUUID("4")
  requestId!: string;
}
export class SessionCreationQueryDto {}
export class SessionCreationReceiptDto {
  @ApiProperty({ enum: [true] }) accepted!: true;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ format: "uuid" }) initialTurnId!: string;
  @ApiProperty({ type: String, format: "date-time" }) acceptedAt!: Date;
}
