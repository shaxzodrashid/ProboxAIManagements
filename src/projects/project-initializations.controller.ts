import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Observable } from "rxjs";
import { CurrentUser } from "../auth/auth.decorator";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
} from "../openapi/api-docs";
import { ProjectInitializationService } from "./project-initialization.service";

@Controller("projects/:projectId/initializations")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags("Project Initializations")
@ApiAccessToken()
export class ProjectInitializationsController {
  constructor(private readonly initializations: ProjectInitializationService) {}

  @Get()
  @ApiOperation({ summary: "List project initialization attempts" })
  @ApiOkResponse({ description: "Newest attempt first, including step logs." })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.initializations.list(user, projectId);
  }

  @Get(":initializationId")
  @ApiOperation({ summary: "Get initialization status and bounded step logs" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("initializationId") initializationId: string,
  ) {
    return this.initializations.get(user, projectId, initializationId);
  }

  @Get(":initializationId/events")
  @ApiOperation({ summary: "Replay persisted initialization events" })
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("initializationId") initializationId: string,
    @Query("after", new DefaultValuePipe(0), ParseIntPipe) after: number,
  ) {
    return this.initializations.events(
      user,
      projectId,
      initializationId,
      after,
    );
  }

  @Sse(":initializationId/events/stream")
  @ApiOperation({
    summary: "Replay and stream initialization events",
    description:
      "Pass `after` or the last received event sequence to resume without duplicates.",
  })
  @ApiProduces("text/event-stream")
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("initializationId") initializationId: string,
    @Query("after", new DefaultValuePipe(0), ParseIntPipe) after: number,
  ): Promise<Observable<MessageEvent>> {
    return this.initializations.stream(
      user,
      projectId,
      initializationId,
      after,
    );
  }

  @Post(":initializationId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel a queued or running initialization" })
  @ApiOkResponse({ description: "Processes stopped and staging quarantined." })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("initializationId") initializationId: string,
  ) {
    return this.initializations.cancel(user, projectId, initializationId);
  }

  @Post("retry")
  @ApiOperation({
    summary: "Retry the latest failed initialization from clean staging",
  })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.initializations.retry(user, projectId);
  }
}
