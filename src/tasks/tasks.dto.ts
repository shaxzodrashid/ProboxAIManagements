import { IsOptional, IsString, MaxLength } from "class-validator";
export class CreateTaskDto {
  @IsString() @MaxLength(240) title!: string;
  @IsString() @MaxLength(16000) description!: string;
  @IsOptional() @IsString() @MaxLength(8000) criteria?: string;
}
