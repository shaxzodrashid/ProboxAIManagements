import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ArticleFoundationEmptyQueryDto } from "./article-proposals.dto";
import {
  CanonicalArticlePublicationDto,
  CanonicalArticleTreeDto,
} from "./article-canonical.dto";
import { ArticleCanonicalService } from "./article-canonical.service";
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiTags("Canonical reviewed articles")
export class ArticleCanonicalController {
  constructor(private readonly service: ArticleCanonicalService) {}
  @Get("article-tree")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: CanonicalArticleTreeDto })
  @ApiOperation({
    summary:
      "Read only the current approved canonical article forest and explicit reading order",
  })
  tree(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.service.tree(actor, projectId.toLowerCase());
  }
  @Get("article-documents/:documentId/publication")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: CanonicalArticlePublicationDto })
  @ApiOperation({
    summary:
      "Read immutable approved head content with canonical Previous/Next",
    description:
      "Current project authority required. No private draft/proposal, electorate, preference, ballot or private provenance is exposed. No restore or historical-version policy is inferred.",
  })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.service.read(actor, projectId.toLowerCase(), id);
  }
}
