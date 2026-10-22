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
  ApiExtraModels,
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
import { ArticleResolutionService } from "./article-resolution.service";
import {
  ArticleCandidateDetailDto,
  ArticleCandidateQueryDto,
  ArticleFoundationEmptyQueryDto,
  PublishedArticleForestDto,
} from "./article-proposals.dto";
import {
  ArticleResolutionResponseDto,
  ArticleResolutionPageDto,
  DispatchArticleResolutionDto,
  ReviewerChoiceResponseDto,
  SetReviewerAlternativesDto,
  CastConflictBallotDto,
  CastArticleApprovalDto,
} from "./article-resolution.dto";
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiResourceErrors()
@ApiValidationErrors()
@ApiExtraModels(PublishedArticleForestDto)
@ApiTags("Article reviewer resolution")
export class ArticleResolutionController {
  constructor(
    private readonly proposals: ArticleProposalsService,
    private readonly resolution: ArticleResolutionService,
  ) {}
  @Post("article-resolution-reviews/:reviewId/approval")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiOperationErrors()
  @ApiRevision("own immutable approval ballot, initial revision0")
  @ApiCreatedResponse({ type: ArticleResolutionResponseDto })
  @ApiOperation({
    summary:
      "Selected reviewer approves or rejects the entire frozen conflict-free content and forest",
    description:
      "All fixed reviewers must vote; inclusive60% approves. A supported decision promotes the exact approved snapshot atomically when its published base still matches. A mismatch retains the completed decision without overwrite, rebase or a new vote.",
  })
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) id: string,
    @ExpectedRevision() revision: number,
    @Body() dto: CastArticleApprovalDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.resolution.approve(
      actor,
      projectId.toLowerCase(),
      id,
      revision,
      dto,
    );
  }
  @Post("article-resolution-reviews/:reviewId/publication")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiOperationErrors()
  @ApiCreatedResponse({ type: ArticleResolutionResponseDto })
  @ApiOperation({
    summary:
      "Reconcile only an already approved immutable resolution publication",
    description:
      "Current selected reviewer or owner only. No supplied content, vote override, rebase or permission grant. Identical successful retries reuse the same version. Keep-both, multiway and incompatible bases remain closed.",
  })
  promote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() _body: ArticleFoundationEmptyQueryDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.resolution.promote(actor, projectId.toLowerCase(), id);
  }
  @Post("article-resolution-reviews/:reviewId/ballot")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiOperationErrors()
  @ApiRevision(
    "own immutable ballot, initial revision0; identical initial retry is idempotent",
  )
  @ApiCreatedResponse({ type: ArticleResolutionResponseDto })
  @ApiOperation({
    summary:
      "Selected reviewer casts one immutable four-option conflict ballot",
    description:
      "KEEP_BOTH, PUBLISH_A, PUBLISH_B or REJECT_BOTH. Frozen complete A/B comparisons retain provenance. Every fixed reviewer must vote; winner needs inclusive60% of the full electorate. If needed, one unique-top-two runoff requires all reviewers and60%; a tied cutoff or failed runoff returns for revision. No plurality fallback or extra binary conflict approval occurs. KEEP_BOTH uses the exact frozen single combinedComparison preview, retaining common context once and both conflicting chunks. Compatible approved results promote atomically. Invalid combined title/placement/order fails before reviewer visibility. More than two competing authors or active versions requires one coordinated document.",
  })
  vote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) id: string,
    @ExpectedRevision() revision: number,
    @Body() dto: CastConflictBallotDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.resolution.vote(
      actor,
      projectId.toLowerCase(),
      id,
      revision,
      dto,
    );
  }
  @Get("article-resolution-reviews")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleResolutionPageDto })
  @ApiOperation({
    summary:
      "Discover only reviews you were selected for, or the current owner's review metadata",
    description:
      "At most50 live authorized items in accepted submission order; UUID continuation resolves only an accessible row. No raw ordinals, hidden totals or choice details.",
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Query() query: ArticleCandidateQueryDto,
  ) {
    return this.resolution.list(actor, projectId.toLowerCase(), query.after);
  }
  @Post("article-proposal-candidates/:candidateId/submit")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("articles.edit")
  @ApiOperationErrors()
  @ApiRevision("own candidate")
  @ApiCreatedResponse({ type: ArticleCandidateDetailDto })
  @ApiOperation({
    summary:
      "Author explicitly submits immutable staged contribution for reviewer visibility",
    description:
      "Current author only, including when owner is a different person. Staging alone is never reviewer disclosure. Reserves accepted submission FIFO order. Does not change content, choose reviewers, resolve conflicts or publish.",
  })
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("candidateId", new ParseUUIDPipe({ version: "4" })) id: string,
    @ExpectedRevision() revision: number,
    @Body() _body: ArticleFoundationEmptyQueryDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.proposals.submit(actor, projectId.toLowerCase(), id, revision);
  }
  @Post("article-proposal-candidates/:candidateId/reviewer-resolution")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiOperationErrors()
  @ApiRevision("oldest submitted candidate")
  @ApiCreatedResponse({ type: ArticleResolutionResponseDto })
  @ApiOperation({
    summary:
      "Owner selects fixed reviewers and atomically freezes submitted alternatives",
    description:
      "Oldest submitted candidate for this document only. All currently submitted same-document contributions before this commit join the immutable reviewer bundle; unsubmitted private stages are excluded. Later submissions queue behind the active review. Same eligible reviewer selection rules as existing article review. Distinct authors' conflicting values remain alternatives; owner cannot select the winning content. Immutable four-option ballots and one top-two runoff are separate explicit actions; published promotion remains disabled.",
  })
  dispatch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("candidateId", new ParseUUIDPipe({ version: "4" })) id: string,
    @ExpectedRevision() revision: number,
    @Body() dto: DispatchArticleResolutionDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.resolution.dispatch(
      actor,
      projectId.toLowerCase(),
      id,
      revision,
      dto,
    );
  }
  @Get("article-resolution-reviews/:reviewId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiReadAvailability()
  @ApiOkResponse({ type: ArticleResolutionResponseDto })
  @ApiOperation({
    summary:
      "Read frozen alternatives as current owner or explicitly selected reviewer",
    description:
      "No other authors' private drafts, raw queue ordinals, profiles or other reviewers' choice history are exposed. Only your own preferences and immutable round ballots are returned. Frozen complete A/B alternatives and the derived all-voters-complete60% decision retain provenance; publication promotion remains disabled.",
  })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.resolution.read(actor, projectId.toLowerCase(), id);
  }
  @Put("article-resolution-reviews/:reviewId/choices")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("projects.read")
  @ApiOperationErrors()
  @ApiRevision("your own reviewer choice version")
  @ApiOkResponse({ type: ReviewerChoiceResponseDto })
  @ApiOperation({
    summary:
      "Selected reviewer records or revises own complete alternative choices",
    description:
      "Exactly one retained alternative per conflict. Prior choices remain immutable history; only your own pointer advances. Owner has no choice authority unless explicitly selected. Choice changes do not change the frozen alternatives and are not publication votes. Preferences close when immutable ballots begin and never count as votes. No first-reviewer-wins, plurality, owner override or promotion is implemented.",
  })
  choose(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) id: string,
    @ExpectedRevision() revision: number,
    @Body() dto: SetReviewerAlternativesDto,
    @Query() _query: ArticleFoundationEmptyQueryDto,
  ) {
    return this.resolution.choose(
      actor,
      projectId.toLowerCase(),
      id,
      revision,
      dto,
    );
  }
}
