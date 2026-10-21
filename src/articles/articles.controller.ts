import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ArticlesService } from "./articles.service";
import {
  ArticleDraftDetailResponseDto,
  ArticleDraftSpaceResponseDto,
  ArrangeArticleDraftsDto,
  CreateArticleDraftDto,
  EditArticleDraftDto,
} from "./articles.dto";

@ApiTags("Private article drafts")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@Controller("projects/:projectId/article-drafts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOperation({
    summary:
      "Read only the current individual's draft forest and independent reading sequence",
  })
  @ApiOkResponse({ type: ArticleDraftSpaceResponseDto })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
  ) {
    return this.articles.read(actor, projectId.toLowerCase());
  }
  @Get(":articleId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleDraftDetailResponseDto })
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("articleId", new ParseUUIDPipe({ version: "4" })) articleId: string,
  ) {
    return this.articles.read(
      actor,
      projectId.toLowerCase(),
      articleId.toLowerCase(),
    );
  }
  @Post()
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.create")
  @ApiRevision("individual draft space")
  @ApiCreatedResponse({ type: ArticleDraftSpaceResponseDto })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: CreateArticleDraftDto,
  ) {
    return this.articles.create(actor, projectId.toLowerCase(), revision, dto);
  }
  @Put()
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.edit")
  @ApiRevision("individual draft space")
  @ApiOkResponse({ type: ArticleDraftSpaceResponseDto })
  arrange(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: ArrangeArticleDraftsDto,
  ) {
    return this.articles.arrange(actor, projectId.toLowerCase(), revision, dto);
  }
  @Put(":articleId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.edit")
  @ApiRevision("individual draft space")
  @ApiOkResponse({ type: ArticleDraftSpaceResponseDto })
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("articleId", new ParseUUIDPipe({ version: "4" })) articleId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: EditArticleDraftDto,
  ) {
    return this.articles.edit(
      actor,
      projectId.toLowerCase(),
      articleId.toLowerCase(),
      revision,
      dto,
    );
  }
}
