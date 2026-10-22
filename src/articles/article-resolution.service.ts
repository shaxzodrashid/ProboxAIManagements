import {
  resolutionInclude,
  ResolutionBundle,
  resolutionMaterialization,
  resolutionDecision,
} from "./article-resolution-state";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import {
  binaryConflictAlternatives,
  conflictVotingProgress,
} from "./article-conflict-vote";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { assertCurrentManagement } from "../prisma/current-management";
import { readDependency } from "../prisma/read-dependency";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import { currentArticlePublicationBase } from "./article-publication-base";
import { promoteReviewedArticle } from "./article-promotion";
import { keepBothComparison } from "./article-keep-both";
import { pendingBatchLimit } from "./article-pending-batch";
import { eligibleArticleReviewers } from "./article-reviewer-selection";
import {
  AuthoredArticleChange,
  materializeArticleChanges,
  validateReviewerChoices,
} from "./article-materialization";
import {
  DispatchArticleResolutionDto,
  SetReviewerAlternativesDto,
  CastConflictBallotDto,
  CastArticleApprovalDto,
} from "./article-resolution.dto";
const action = "articleResolution";
const missing = () =>
  operationError(
    404,
    "ARTICLE_RESOLUTION_NOT_FOUND",
    "Reviewer resolution scope unavailable",
    action,
  );
const unavailable = () =>
  operationError(
    409,
    "ARTICLE_RESOLUTION_FORMAT_UNAVAILABLE",
    "Stored reviewer resolution requires compatible handling; all content preserved",
    action,
  );
const stale = () =>
  operationError(
    409,
    "STALE_REVISION",
    "Reread current contribution or own choice before continuing",
    action,
  );
const blocked = () =>
  operationError(
    409,
    "ARTICLE_QUEUE_BLOCKED",
    "An older submitted contribution or active review must go first",
    action,
  );
const bundleInclude = resolutionInclude;
type Bundle = ResolutionBundle;
@Injectable()
export class ArticleResolutionService {
  constructor(private readonly prisma: PrismaService) {}
  private async scope(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    write: boolean,
  ) {
    if (actor.type !== undefined && actor.type !== "access") throw missing();
    await lockWorkspace(tx, actor.workspaceId);
    await assertCurrentManagement(
      tx,
      actor.workspaceId,
      actor.id,
      "projects.read",
    );
    const p = await tx.project.findFirst({
      where: {
        id: projectId,
        workspaceId: actor.workspaceId,
        OR: [
          { creatorId: actor.id },
          { members: { some: { userId: actor.id } } },
        ],
      },
      select: { creatorId: true, archivedAt: true, status: true },
    });
    if (!p) throw missing();
    if (write && (p.archivedAt || p.status === "DELETING"))
      throw operationError(
        409,
        "ARTICLE_PROJECT_INACTIVE",
        "Project lifecycle blocks article review changes",
        action,
      );
    return p;
  }
  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      databaseOperationError(error, action);
    }
  }
  private materialization(r: Bundle) {
    return resolutionMaterialization(r);
  }
  private async detail(
    tx: Prisma.TransactionClient,
    r: Bundle,
    actor: AuthenticatedUser,
  ) {
    const materialization = this.materialization(r),
      reviewer = r.reviewers.find((v) => v.userId === actor.id);
    let myChoices: SetReviewerAlternativesDto["choices"] | null = null;
    if (reviewer?.choiceVersion) {
      const choice = await tx.articleResolutionChoice.findUnique({
        where: {
          reviewId_userId_version: {
            reviewId: r.id,
            userId: actor.id,
            version: reviewer.choiceVersion,
          },
        },
      });
      if (!choice) throw unavailable();
      try {
        myChoices = validateReviewerChoices(
          materialization,
          choice.choices as unknown as SetReviewerAlternativesDto["choices"],
        );
      } catch {
        throw unavailable();
      }
    }
    const voting = this.voting(r, materialization);
    const decision = resolutionDecision(r);
    if (
      r.phase === "APPROVED" &&
      (!r.publishedVersion || decision.state !== "APPROVED")
    )
      throw unavailable();
    return {
      id: r.id,
      documentId: r.documentId,
      phase: r.phase,
      finalVotingAvailable:
        !materialization.conflicts.length && r.phase === "RESOLVING",
      materialization,
      combinedComparison: r.combinedComparison ?? null,
      reviewerIds: r.reviewers.map((v) => v.userId),
      myChoiceVersion: reviewer?.choiceVersion ?? null,
      myChoices,
      conflictVoting: voting,
      myBallots: (reviewer?.ballots ?? []).map((b) => ({
        round: b.round,
        option: b.option,
        revision: 1,
      })),
      approvalVoting: {
        available: !materialization.conflicts.length && r.phase === "RESOLVING",
        state: materialization.conflicts.length
          ? "NOT_APPLICABLE"
          : decision.state,
        myApproval: reviewer?.approval
          ? { approved: reviewer.approval.approved, revision: 1 }
          : null,
      },
      publication:
        r.phase === "APPROVED"
          ? {
              state: "PUBLISHED",
              versionId: r.publishedVersion!.id,
              number: r.publishedVersion!.number,
              reason: null,
            }
          : {
              state:
                decision.state === "APPROVED" && decision.comparison
                  ? "PENDING_COMPATIBILITY"
                  : "CLOSED",
              versionId: null,
              number: null,
              reason:
                decision.state === "APPROVED" && decision.comparison
                  ? "EXACT_PUBLISHED_BASE_REQUIRED"
                  : "NO_SUPPORTED_APPROVED_SNAPSHOT",
            },
    };
  }
  private voting(r: Bundle, materialization = this.materialization(r)) {
    const alternatives = binaryConflictAlternatives(materialization);
    try {
      const decision = conflictVotingProgress(
        r.reviewers.map((v) => v.userId),
        r.reviewers.flatMap((v) =>
          (v.ballots ?? []).map((b) => ({
            userId: v.userId,
            option: b.option,
            round: b.round,
          })),
        ),
      );
      if (!alternatives.available && r.reviewers.some((v) => v.ballots?.length))
        throw unavailable();
      return {
        ...alternatives,
        ...decision,
        reason: alternatives.available ? decision.reason : alternatives.reason,
        allowedOptions: alternatives.available ? decision.allowedOptions : [],
        publicationAvailable: r.phase === "APPROVED",
      };
    } catch {
      throw unavailable();
    }
  }
  private async load(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    ownerId: string,
  ) {
    const r = await tx.articleResolutionReview.findFirst({
      where: {
        id: id.toLowerCase(),
        projectId,
        ...(ownerId === actor.id
          ? {}
          : { reviewers: { some: { userId: actor.id } } }),
      },
      include: bundleInclude,
    });
    if (!r) throw missing();
    this.materialization(r);
    return r;
  }
  dispatch(
    actor: AuthenticatedUser,
    projectId: string,
    candidateId: string,
    revision: number,
    dto: DispatchArticleResolutionDto,
  ) {
    return this.write(async (tx) => {
      const p = await this.scope(tx, actor, projectId, true);
      if (p.creatorId !== actor.id) throw missing();
      const candidate = await tx.articleProposalCandidate.findFirst({
        where: { id: candidateId.toLowerCase(), projectId },
        include: { contribution: true },
      });
      if (!candidate) throw missing();
      if (candidate.revision !== revision) throw stale();
      if (!candidate.submittedAt || candidate.resolutionReviewId)
        throw blocked();
      if (
        await tx.articleResolutionReview.findFirst({
          where: {
            projectId,
            documentId: candidate.documentId,
            phase: { notIn: ["APPROVED", "REJECTED", "RETURNED_FOR_REVISION"] },
          },
        })
      )
        throw blocked();
      const candidates = await tx.articleProposalCandidate.findMany({
        where: {
          projectId,
          documentId: candidate.documentId,
          submittedAt: { not: null },
          resolutionReviewId: null,
          coordinationRejectedAt: null,
        },
        orderBy: { submittedSequence: "asc" },
        take: 101,
        include: { contribution: true },
      });
      if (candidates.length > 100)
        throw operationError(
          409,
          "ARTICLE_REVIEW_CAPACITY",
          "Review bundle exceeds supported contribution bound; all contributions preserved",
          action,
        );
      if (candidates[0]?.id !== candidate.id) throw blocked();
      const document = await tx.articleDocument.findFirst({
        where: { id: candidate.documentId, projectId },
      });
      if (!document) throw missing();
      const before = await currentArticlePublicationBase(
        tx,
        document,
        projectId,
      );
      const publicationSpace = await tx.articlePublicationSpace.findUnique({
        where: { projectId },
      });
      const changes: AuthoredArticleChange[] = candidates.map((c) => {
        if (
          c.revision !== 1 ||
          !c.submittedSequence ||
          c.reachedReviewersAt ||
          c.contribution.documentId !== document.id ||
          c.authorId !== c.contribution.authorId
        )
          throw unavailable();
        return {
          id: c.contributionId,
          authorId: c.authorId,
          sourceArticleId: c.contribution.sourceArticleId,
          sourceRevision: c.contribution.sourceRevision,
          sequence: c.submittedSequence,
          comparison: c.contribution
            .comparison as unknown as AuthoredArticleChange["comparison"],
        };
      });
      const materialization = materializeArticleChanges(
        document.id,
        before,
        changes,
      );
      if (pendingBatchLimit(candidates))
        throw operationError(
          409,
          "ARTICLE_COORDINATION_REQUIRED",
          "At most two authors and two active versions may enter conflict review; combine work and resubmit",
          action,
        );
      let combinedComparison: Prisma.InputJsonValue | typeof Prisma.DbNull =
        Prisma.DbNull;
      if (materialization.conflicts.length) {
        const binary = binaryConflictAlternatives(materialization);
        if (!binary.available)
          throw operationError(
            409,
            "ARTICLE_COORDINATION_REQUIRED",
            "Two complete alternatives are required; coordinate one combined document",
            action,
          );
        try {
          combinedComparison = keepBothComparison(
            binary.alternatives[0]!.comparison,
            binary.alternatives[1]!.comparison,
            document.id,
          ) as unknown as Prisma.InputJsonValue;
        } catch {
          throw operationError(
            409,
            "ARTICLE_COMBINED_RESULT_INVALID",
            "A valid exact keep-both preview is required before review; coordinate incompatible title, placement or order changes",
            action,
          );
        }
      }
      const reviewerIds = await eligibleArticleReviewers(
        tx,
        actor,
        projectId,
        p.creatorId,
        dto.voterIds,
        missing,
        action,
      );
      const id = dto.id.toLowerCase();
      if (
        await tx.articleReview.findUnique({
          where: { id },
          select: { id: true },
        })
      )
        throw operationError(
          409,
          "ARTICLE_REVIEW_ID_CONFLICT",
          "Review identity already reserved",
          action,
        );
      await tx.articleResolutionReview.create({
        data: {
          id,
          headSequence: candidate.submittedSequence!,
          projectId,
          documentId: document.id,
          selectedById: actor.id,
          baseVersionId: document.headVersionId,
          baseForestRevision: publicationSpace?.revision ?? 0,
          before: before as unknown as Prisma.InputJsonValue,
          materialization: materialization as unknown as Prisma.InputJsonValue,
          combinedComparison,
          reviewers: { create: reviewerIds.map((userId) => ({ userId })) },
        },
      });
      const frozen = await tx.articleProposalCandidate.updateMany({
        where: {
          id: { in: candidates.map((c) => c.id) },
          resolutionReviewId: null,
          revision: 1,
        },
        data: {
          resolutionReviewId: id,
          reachedReviewersAt: new Date(),
          revision: 2,
        },
      });
      if (frozen.count !== candidates.length) throw blocked();
      const r = await tx.articleResolutionReview.findUniqueOrThrow({
        where: { id },
        include: bundleInclude,
      });
      return this.detail(tx, r, actor);
    });
  }
  read(actor: AuthenticatedUser, projectId: string, id: string) {
    return readDependency("readArticleResolution", () =>
      this.prisma.$transaction(async (tx) => {
        const p = await this.scope(tx, actor, projectId, false);
        return this.detail(
          tx,
          await this.load(tx, actor, projectId, id, p.creatorId),
          actor,
        );
      }),
    );
  }
  list(actor: AuthenticatedUser, projectId: string, after?: string) {
    return readDependency("listArticleResolutions", () =>
      this.prisma.$transaction(async (tx) => {
        const p = await this.scope(tx, actor, projectId, false);
        const where = {
          projectId,
          ...(p.creatorId === actor.id
            ? {}
            : { reviewers: { some: { userId: actor.id } } }),
        };
        let sequence = 0;
        if (after) {
          const anchor = await tx.articleResolutionReview.findFirst({
            where: { ...where, id: after.toLowerCase() },
            select: { headSequence: true },
          });
          if (!anchor) throw missing();
          sequence = anchor.headSequence;
        }
        const rows = await tx.articleResolutionReview.findMany({
          where: { ...where, headSequence: { gt: sequence } },
          orderBy: { headSequence: "asc" },
          take: 51,
          select: { id: true, documentId: true, phase: true },
        });
        const page = rows.slice(0, 50);
        return {
          items: page.map((r) => ({
            ...r,
            finalVotingAvailable: false,
          })),
          nextAfter: rows.length > 50 ? page[page.length - 1]!.id : null,
        };
      }),
    );
  }
  choose(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    version: number,
    dto: SetReviewerAlternativesDto,
  ) {
    return this.write(async (tx) => {
      const p = await this.scope(tx, actor, projectId, true),
        r = await this.load(tx, actor, projectId, id, p.creatorId),
        reviewer = r.reviewers.find((v) => v.userId === actor.id);
      if (!reviewer) throw missing();
      if (
        r.phase !== "RESOLVING" ||
        r.reviewers.some((v) => v.ballots?.length || v.approval)
      )
        throw operationError(
          409,
          "ARTICLE_BALLOTS_STARTED",
          "Reviewer preferences are closed once immutable ballots start",
          action,
        );
      if (reviewer.choiceVersion !== version) throw stale();
      const choices = validateReviewerChoices(
        this.materialization(r),
        dto.choices,
      );
      if (version > 0) {
        const previous = await tx.articleResolutionChoice.findUnique({
          where: {
            reviewId_userId_version: {
              reviewId: r.id,
              userId: actor.id,
              version,
            },
          },
        });
        if (!previous) throw unavailable();
        if (isDeepStrictEqual(previous.choices, choices))
          return { choiceVersion: version, choices };
      }
      if (version >= 2147483646) throw unavailable();
      await tx.articleResolutionChoice.create({
        data: {
          reviewId: r.id,
          userId: actor.id,
          version: version + 1,
          choices: choices as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.articleResolutionReviewer.update({
        where: { reviewId_userId: { reviewId: r.id, userId: actor.id } },
        data: { choiceVersion: version + 1 },
      });
      return { choiceVersion: version + 1, choices };
    });
  }
  vote(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    revision: number,
    dto: CastConflictBallotDto,
  ) {
    return this.write(async (tx) => {
      const p = await this.scope(tx, actor, projectId, true),
        r = await this.load(tx, actor, projectId, id, p.creatorId),
        reviewer = r.reviewers.find((v) => v.userId === actor.id);
      if (!reviewer) throw missing();
      if (revision !== 0) throw stale();
      const round = dto.round ?? 1,
        previous = reviewer.ballots?.find((b) => b.round === round);
      if (previous) {
        if (previous.option !== dto.option)
          throw operationError(
            409,
            "ARTICLE_BALLOT_IMMUTABLE",
            "An immutable conflict ballot already exists",
            action,
          );
        return this.detail(tx, r, actor);
      }
      const progress = this.voting(r);
      if (dto.option === "KEEP_BOTH" && r.combinedComparison == null)
        throw operationError(
          409,
          "ARTICLE_KEEP_BOTH_PREVIEW_UNAVAILABLE",
          "This retained review has no immutable combined preview; content and ballots preserved",
          action,
        );
      if (
        r.phase !== "RESOLVING" ||
        !progress.available ||
        progress.round !== round ||
        !progress.allowedOptions.includes(dto.option)
      )
        throw operationError(
          409,
          "ARTICLE_CONFLICT_BALLOT_UNAVAILABLE",
          "Four-option voting needs two unambiguous complete alternatives; all contributions retained",
          action,
        );
      await tx.articleResolutionBallot.create({
        data: { reviewId: r.id, userId: actor.id, option: dto.option, round },
      });
      const updated = await tx.articleResolutionReview.findUniqueOrThrow({
        where: { id: r.id },
        include: bundleInclude,
      });
      const outcome = this.voting(updated);
      const phase =
        outcome.state === "FOR_REVISION"
          ? "RETURNED_FOR_REVISION"
          : outcome.state === "DECIDED"
            ? outcome.winner === "REJECT_BOTH"
              ? "REJECTED"
              : "DECIDED"
            : "RESOLVING";
      if (phase !== updated.phase) {
        await tx.articleResolutionReview.update({
          where: { id: r.id },
          data: { phase },
        });
        updated.phase = phase;
      }
      if (phase === "DECIDED") await promoteReviewedArticle(tx, updated);
      return this.detail(
        tx,
        await tx.articleResolutionReview.findUniqueOrThrow({
          where: { id: r.id },
          include: bundleInclude,
        }),
        actor,
      );
    });
  }
  approve(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    revision: number,
    dto: CastArticleApprovalDto,
  ) {
    return this.write(async (tx) => {
      const p = await this.scope(tx, actor, projectId, true),
        r = await this.load(tx, actor, projectId, id, p.creatorId),
        reviewer = r.reviewers.find((v) => v.userId === actor.id);
      if (!reviewer) throw missing();
      if (revision !== 0) throw stale();
      if (reviewer.approval) {
        if (reviewer.approval.approved !== dto.approved)
          throw operationError(
            409,
            "ARTICLE_BALLOT_IMMUTABLE",
            "An immutable approval ballot already exists",
            action,
          );
        return this.detail(tx, r, actor);
      }
      if (r.phase !== "RESOLVING" || this.materialization(r).conflicts.length)
        throw operationError(
          409,
          "ARTICLE_APPROVAL_UNAVAILABLE",
          "Only a frozen conflict-free comparison uses approval ballots",
          action,
        );
      await tx.articleResolutionApproval.create({
        data: { reviewId: r.id, userId: actor.id, approved: dto.approved },
      });
      const updated = await tx.articleResolutionReview.findUniqueOrThrow({
        where: { id: r.id },
        include: bundleInclude,
      });
      const decision = resolutionDecision(updated);
      if (decision.state === "APPROVED" || decision.state === "REJECTED") {
        updated.phase = decision.state === "APPROVED" ? "DECIDED" : "REJECTED";
        await tx.articleResolutionReview.update({
          where: { id: r.id },
          data: { phase: updated.phase },
        });
        if (decision.state === "APPROVED")
          await promoteReviewedArticle(tx, updated);
      }
      return this.detail(
        tx,
        await tx.articleResolutionReview.findUniqueOrThrow({
          where: { id: r.id },
          include: bundleInclude,
        }),
        actor,
      );
    });
  }
  promote(actor: AuthenticatedUser, projectId: string, id: string) {
    return this.write(async (tx) => {
      const p = await this.scope(tx, actor, projectId, true),
        r = await this.load(tx, actor, projectId, id, p.creatorId);
      const result = await promoteReviewedArticle(tx, r);
      const detail = await this.detail(
        tx,
        await tx.articleResolutionReview.findUniqueOrThrow({
          where: { id: r.id },
          include: bundleInclude,
        }),
        actor,
      );
      return {
        ...detail,
        publication: {
          ...detail.publication,
          reason: "reason" in result ? result.reason : null,
        },
      };
    });
  }
}
