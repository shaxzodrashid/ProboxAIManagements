import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
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
  ApiOperationErrors,
  ApiReadAvailability,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ApiRevision, ExpectedRevision } from "../openapi/revision";
import { ArticleProposalsService } from "./article-proposals.service";
import {
  ArticleCandidateDetailDto,
  ArticleCandidatePageDto,
  ArticleCandidateQueryDto,
  ReserveArticleDocumentDto,
  ReservedArticleDocumentResponseDto,
  StageArticleProposalDto,
} from "./article-proposals.dto";
import { ArticleFoundationEmptyQueryDto } from "./article-proposals.dto";
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiTags("Private article proposal foundations")
export class ArticleProposalsController {
  constructor(private readonly proposals: ArticleProposalsService) {}
  @Post("article-documents")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.create")
  @ApiOperationErrors()
  @ApiCreatedResponse({ type: ReservedArticleDocumentResponseDto })
  @ApiOperation({
    summary:
      "Reserve an explicit stable article identity without publishing or copying a draft",
  })
  reserve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Body() dto: ReserveArticleDocumentDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.proposals.reserve(actor, projectId.toLowerCase(), dto.id);
  }
  @Post("article-proposal-candidates")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.edit")
  @ApiRevision("own private draft space")
  @ApiOperationErrors()
  @ApiCreatedResponse({ type: ArticleCandidateDetailDto })
  @ApiOperation({
    summary:
      "Stage one immutable private contribution and reserve FIFO order; does not submit to reviewers",
    description:
      "Exact private source and published version/forest base required. Only selected text and explicitly supplied published placement/order are captured. Creator/owner-only access to unpublished identities. Separate contributions remain private to their author and current project owner. No automatic merge, voter selection, reviewer disclosure, dispatch or publication; dispatchAvailable is false. Reviewer visibility must later freeze the combined snapshot atomically with selection; conflict authority is unresolved. No automatic retries.",
  })
  stage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @ExpectedRevision() revision: number,
    @Body() dto: StageArticleProposalDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.proposals.stage(actor, projectId.toLowerCase(), revision, dto);
  }
  @Get("article-proposal-candidates")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleCandidatePageDto })
  @ApiOperation({
    summary:
      "Read only your private FIFO staging metadata, or the current owner's admitted project view",
    description:
      "At most50 authorized candidates, accepted sequence order. Continuation is a currently accessible candidate ID, not a raw ordinal or hidden queue position. No unrelated contributions, total counts, profiles or reviewer access are disclosed.",
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: ArticleCandidateQueryDto,
  ) {
    return this.proposals.list(actor, projectId.toLowerCase(), query.after);
  }
  @Get("article-proposal-candidates/:candidateId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleCandidateDetailDto })
  @ApiOperation({
    summary:
      "Read your own or the project owner's exact immutable before/after contribution",
    description:
      "Backend comparison data only; no change UI, merge, dispatch, votes, published-version write or version restore is implemented.",
  })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("candidateId", new ParseUUIDPipe({ version: "4" }))
    candidateId: string,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.proposals.read(actor, projectId.toLowerCase(), candidateId);
  }
}
