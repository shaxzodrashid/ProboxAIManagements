import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import { ArticleReviewsService } from "./article-reviews.service";
import {
  ArticlePublicationPageResponseDto,
  ArticlePublicationResponseDto,
  ArticleReviewPageQueryDto,
  ArticleReviewPageResponseDto,
  ArticleReviewResponseDto,
  SelectArticleVotersDto,
  SubmitArticleReviewDto,
  VoteArticleReviewDto,
} from "./article-reviews.dto";

@ApiTags("Reviewed article publication")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ArticleReviewsController {
  constructor(private readonly reviews: ArticleReviewsService) {}
  @Post("article-reviews")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.edit")
  @ApiRevision("individual draft space")
  @ApiCreatedResponse({ type: ArticleReviewResponseDto })
  @ApiOperation({
    summary:
      "Explicitly submit one own draft's immutable text to the owner and selected voters for publication review",
  })
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: SubmitArticleReviewDto,
  ) {
    return this.reviews.submit(actor, projectId.toLowerCase(), revision, dto);
  }
  @Get("article-reviews")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleReviewPageResponseDto })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: ArticleReviewPageQueryDto,
  ) {
    return this.reviews.list(
      actor,
      projectId.toLowerCase(),
      query.after?.toLowerCase(),
    );
  }
  @Get("article-reviews/:reviewId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleReviewResponseDto })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) reviewId: string,
  ) {
    return this.reviews.read(
      actor,
      projectId.toLowerCase(),
      reviewId.toLowerCase(),
    );
  }
  @Put("article-reviews/:reviewId/voters")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiRevision("article review")
  @ApiOkResponse({ type: ArticleReviewResponseDto })
  @ApiOperation({
    summary:
      "Current project owner fixes one nonempty voter list; every listed voter must vote",
  })
  select(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) reviewId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: SelectArticleVotersDto,
  ) {
    return this.reviews.selectVoters(
      actor,
      projectId.toLowerCase(),
      reviewId.toLowerCase(),
      revision,
      dto.voterIds,
    );
  }
  @Post("article-reviews/:reviewId/votes")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiRevision("article review")
  @ApiCreatedResponse({ type: ArticleReviewResponseDto })
  @ApiOperation({
    summary:
      "Cast one immutable listed vote; only the completed electorate decides using yes*5 >= total*3",
  })
  vote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) reviewId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: VoteArticleReviewDto,
  ) {
    return this.reviews.vote(
      actor,
      projectId.toLowerCase(),
      reviewId.toLowerCase(),
      revision,
      dto.approved,
    );
  }
  @Get("article-publications")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticlePublicationPageResponseDto })
  publications(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: ArticleReviewPageQueryDto,
  ) {
    return this.reviews.list(
      actor,
      projectId.toLowerCase(),
      query.after?.toLowerCase(),
      true,
    );
  }
  @Get("article-publications/:reviewId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticlePublicationResponseDto })
  publication(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) reviewId: string,
  ) {
    return this.reviews.publication(
      actor,
      projectId.toLowerCase(),
      reviewId.toLowerCase(),
    );
  }
}
