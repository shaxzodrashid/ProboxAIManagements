import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
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
  @ApiOperation({ summary: "Check PostgreSQL and MinIO readiness" })
  @ApiOkResponse({ description: "Required persistent dependencies are ready." })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.templateStorage.ready();
      return {
        status: "ok",
        service: "proboxai",
        dependencies: { postgres: "ok", minio: "ok" },
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: "unavailable",
        service: "proboxai",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
