import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PrismaService } from "./prisma/prisma.service";
import { TemplateStorageService } from "./configuration-templates/template-storage.service";

class HealthResponseDto {
  @ApiProperty({ example: "ok" })
  status!: "ok";

  @ApiProperty({ example: "proboxai" })
  service!: "proboxai";
}

class ReadyDependenciesDto {
  @ApiProperty({ enum: ["ok"] }) postgres!: "ok";
  @ApiProperty({
    enum: ["ok"],
    description:
      "Existing configuration-template storage check; does not verify avatar storage.",
  })
  minio!: "ok";
}

class ReadyResponseDto extends HealthResponseDto {
  @ApiProperty({ type: ReadyDependenciesDto })
  dependencies!: ReadyDependenciesDto;
}

class ReadyUnavailableResponseDto {
  @ApiProperty({ enum: ["unavailable"] }) status!: "unavailable";
  @ApiProperty({ enum: ["proboxai"] }) service!: "proboxai";
  @ApiProperty({ example: "Required persistent dependencies are unavailable" })
  message!: string;
}

@Controller("health")
@ApiTags("Health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateStorage: TemplateStorageService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Check API health",
    description: "Returns once the HTTP application is accepting requests.",
  })
  @ApiOkResponse({
    description: "The API is healthy.",
    type: HealthResponseDto,
  })
  health() {
    return { status: "ok", service: "proboxai" };
  }

  @Get("ready")
  @ApiOperation({
    summary: "Check PostgreSQL and MinIO readiness",
    description:
      "Checks PostgreSQL and the existing configuration-template storage dependency. Does not establish avatar bucket readiness, runner liveness or individual feature readiness. Dependency failures return a sanitized 503 without internal exception text.",
  })
  @ApiOkResponse({
    description: "Required persistent dependencies are ready.",
    type: ReadyResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      "Required persistent dependencies are unavailable; no connection, bucket, credential or raw exception details.",
    type: ReadyUnavailableResponseDto,
  })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.templateStorage.ready();
      return {
        status: "ok",
        service: "proboxai",
        dependencies: { postgres: "ok", minio: "ok" },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "unavailable",
        service: "proboxai",
        message: "Required persistent dependencies are unavailable",
      });
    }
  }
}
