import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;

export class CreateProjectDto {
  @IsString()
  @Matches(PROJECT_NAME, {
    message:
      "name may contain letters, numbers, spaces, dots, underscores, and hyphens",
  })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  readAccessEnabled?: boolean;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  readAccessEnabled?: boolean;
}

export class AddProjectMemberDto {
  @IsString()
  @MaxLength(128)
  userId!: string;
}

export class CreateProjectFolderDto {
  @IsString()
  @MaxLength(1024)
  path!: string;
}

export class UploadProjectFileDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  path?: string;
}

export class MoveProjectFileDto {
  @IsString()
  @MaxLength(1024)
  sourcePath!: string;

  @IsString()
  @MaxLength(1024)
  destinationPath!: string;
}

export class SetProjectsHomeDto {
  @IsString()
  @MaxLength(1024)
  path!: string;
}
