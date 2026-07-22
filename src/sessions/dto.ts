import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSessionDto {
  @IsString() taskId!: string;
  @IsString() @MaxLength(8000) prompt!: string;
  @IsString() cwd!: string;
  @IsIn(["read-only", "workspace-write", "danger-full-access"]) sandbox!:
    "read-only" | "workspace-write" | "danger-full-access";
  @IsOptional() @IsString() model?: string;
}

export class CreateTurnDto {
  @IsString() @MaxLength(8000) prompt!: string;
}
