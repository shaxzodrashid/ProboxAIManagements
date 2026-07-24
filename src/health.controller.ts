import { Controller, Get } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";

class HealthResponseDto {
  @ApiProperty({ example: "ok" })
  status!: "ok";

  @ApiProperty({ example: "proboxai" })
  service!: "proboxai";
}

@Controller("health")
@ApiTags("Health")
export class HealthController {
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
}
