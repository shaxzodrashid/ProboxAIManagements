import { Injectable } from "@nestjs/common";
import {
  ArticleProposalCandidate,
  ArticleProposalContribution,
  Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { assertCurrentManagement } from "../prisma/current-management";
import { lockWorkspace } from "../prisma/workspace-lock";
import { readDependency } from "../prisma/read-dependency";
import { PrismaService } from "../prisma/prisma.service";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import { decodeForest } from "./article-forest";
import {
  ArticleComparison,
  articleChanges,
  decodeArticleComparison,
  decodeArticleVersionProvenance,
  decodePublishedForest,
  emptyPublishedForest,
  PublicationSnapshot,
} from "./article-comparison";
import { StageArticleProposalDto } from "./article-proposals.dto";
import { validatePublishedVersion } from "./article-version-validation";
import { pendingBatchLimit } from "./article-pending-batch";
const action = "articleProposalFoundations";
const missing = () =>
  operationError(
    404,
    "ARTICLE_PROPOSAL_NOT_FOUND",
    "Article proposal scope unavailable",
    action,
  );
const unavailable = () =>
  operationError(
    409,
    "ARTICLE_PROPOSAL_FORMAT_UNAVAILABLE",
    "Stored article foundation requires compatible handling; content preserved",
    action,
  );
const stale = () =>
  operationError(
    409,
    "STALE_REVISION",
    "Reread the current private draft and published base before staging",
    action,
  );
type Candidate = ArticleProposalCandidate & {
  contribution: ArticleProposalContribution;
};
@Injectable()
export class ArticleProposalsService {
  constructor(private readonly prisma: PrismaService) {}
  private async scope(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    write: boolean,
    capability = "projects.read",
  ) {
    if (actor.type !== undefined && actor.type !== "access") throw missing();
    await lockWorkspace(tx, actor.workspaceId);
    await assertCurrentManagement(tx, actor.workspaceId, actor.id, capability);
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
        "Project lifecycle blocks article changes",
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
  reserve(actor: AuthenticatedUser, projectId: string, id: string) {
    id = id.toLowerCase();
    return this.write(async (tx) => {
      await this.scope(tx, actor, projectId, true, "articles.create");
      const document = await tx.articleDocument.create({
        data: { id, projectId, creatorId: actor.id },
      });
      return { id: document.id, headVersionId: document.headVersionId };
    });
  }
  private async pending(
    tx: Prisma.TransactionClient,
    projectId: string,
    documentId: string,
  ) {
    return tx.articleProposalCandidate.findMany({
      where: {
        projectId,
        documentId,
        submittedAt: { not: null },
        resolutionReviewId: null,
        coordinationRejectedAt: null,
      },
      select: {
        id: true,
        authorId: true,
        contribution: {
          select: { sourceArticleId: true, sourceRevision: true },
        },
      },
      orderBy: { submittedSequence: "asc" },
      take: 101,
    });
  }
  private async opponentWarning(
    tx: Prisma.TransactionClient,
    projectId: string,
    documentId: string,
    authorId: string,
  ) {
    const rows = await this.pending(tx, projectId, documentId);
    return this.warningFor(rows, authorId);
  }
  private warningFor(rows: { authorId: string }[], authorId: string) {
    const count = new Set(
      rows.filter((r) => r.authorId !== authorId).map((r) => r.authorId),
    ).size;
    return {
      competing: count > 0,
      otherAuthorCount: count,
      instruction: count
        ? "Other authors have submitted this document; discuss conflicting work before review"
        : null,
    };
  }
  private detail(
    r: Candidate,
    opponentWarning = {
      competing: false,
      otherAuthorCount: 0,
      instruction: null as string | null,
    },
  ) {
    const c = r.contribution;
    if (
      r.revision !== 3 &&
      (r.coordinationRejectedAt != null || r.coordinationReason != null)
    )
      throw unavailable();
    if (
      !(
        (r.revision === 3 &&
          r.submittedAt != null &&
          r.submittedSequence != null &&
          r.reachedReviewersAt === null &&
          r.resolutionReviewId == null &&
          r.coordinationRejectedAt != null &&
          ["AUTHOR_LIMIT", "VERSION_LIMIT"].includes(
            r.coordinationReason ?? "",
          )) ||
        (r.revision === 0 &&
          r.submittedAt == null &&
          r.submittedSequence == null &&
          r.reachedReviewersAt === null &&
          r.resolutionReviewId == null) ||
        (r.revision === 1 &&
          r.submittedAt != null &&
          r.submittedSequence != null &&
          r.reachedReviewersAt === null &&
          r.resolutionReviewId == null) ||
        (r.revision === 2 &&
          r.submittedAt != null &&
          r.submittedSequence != null &&
          r.reachedReviewersAt !== null &&
          r.resolutionReviewId != null)
      ) ||
      r.documentId !== c.documentId ||
      r.authorId !== c.authorId ||
      c.sourceRevision < 1 ||
      c.baseForestRevision < 0
    )
      throw unavailable();
    const comparison = decodeArticleComparison(c.comparison, r.documentId);
    return {
      id: r.id,
      documentId: r.documentId,
      revision: r.revision,
      opponentWarning,
      coordination:
        r.coordinationRejectedAt != null
          ? {
              required: true,
              reason: r.coordinationReason,
              instruction:
                "Review submissions rejected for coordination. Contact the other participants, discuss the changes and submit one combined document; drafts and history are preserved",
            }
          : null,
      state:
        r.coordinationRejectedAt != null
          ? "REJECTED_FOR_COORDINATION"
          : r.reachedReviewersAt !== null
            ? "REVIEWER_RESOLUTION"
            : r.submittedAt != null
              ? "QUEUED_FOR_REVIEW"
              : "PRE_REVIEW",
      dispatchAvailable: false,
      sourceArticleId: c.sourceArticleId,
      sourceRevision: c.sourceRevision,
      baseVersionId: c.baseVersionId,
      baseForestRevision: c.baseForestRevision,
      comparison,
      changes: articleChanges(comparison),
    };
  }
  submit(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    revision: number,
  ) {
    return this.write(async (tx) => {
      await this.scope(tx, actor, projectId, true, "articles.edit");
      const r = await tx.articleProposalCandidate.findFirst({
        where: { id: id.toLowerCase(), projectId, authorId: actor.id },
        include: { contribution: true },
      });
      if (!r) throw missing();
      this.detail(r);
      if (r.revision !== revision) throw stale();
      if (r.submittedAt !== null)
        throw operationError(
          409,
          "ARTICLE_CANDIDATE_ALREADY_SUBMITTED",
          "Contribution already submitted; reread its state",
          action,
        );
      const space = await tx.articlePublicationSpace.findUnique({
        where: { projectId },
      });
      if (!space || space.nextSequence < 0 || space.nextSequence >= 2147483646)
        throw unavailable();
      const next = space.nextSequence + 1;
      const pending = await this.pending(tx, projectId, r.documentId);
      if (pending.length >= 100)
        throw operationError(
          409,
          "ARTICLE_REVIEW_CAPACITY",
          "Pending contribution history exceeds supported review capacity; all work preserved",
          action,
        );
      const warning = this.warningFor(pending, actor.id);
      await tx.articlePublicationSpace.update({
        where: { projectId },
        data: { nextSequence: next },
      });
      const submitted = await tx.articleProposalCandidate.update({
        where: { id: r.id },
        data: {
          submittedAt: new Date(),
          submittedSequence: next,
          revision: 1,
        },
        include: { contribution: true },
      });
      const reason = pendingBatchLimit([...pending, submitted]);
      if (reason) {
        const now = new Date();
        const rejected = await tx.articleProposalCandidate.updateMany({
          where: {
            projectId,
            documentId: r.documentId,
            submittedAt: { not: null },
            resolutionReviewId: null,
            reachedReviewersAt: null,
            coordinationRejectedAt: null,
            revision: 1,
          },
          data: {
            coordinationRejectedAt: now,
            coordinationReason: reason,
            revision: 3,
          },
        });
        if (rejected.count !== pending.length + 1) throw unavailable();
        return this.detail(
          {
            ...submitted,
            coordinationRejectedAt: now,
            coordinationReason: reason,
            revision: 3,
          },
          warning,
        );
      }
      return this.detail(submitted, warning);
    });
  }
  stage(
    actor: AuthenticatedUser,
    projectId: string,
    sourceRevision: number,
    input: StageArticleProposalDto,
  ) {
    const dto = {
      ...input,
      id: input.id.toLowerCase(),
      documentId: input.documentId.toLowerCase(),
      sourceArticleId: input.sourceArticleId.toLowerCase(),
      baseVersionId: input.baseVersionId?.toLowerCase() ?? null,
      positions: input.positions.map((p) => ({
        id: p.id.toLowerCase(),
        parentId: p.parentId?.toLowerCase() ?? null,
      })),
      readingOrder: input.readingOrder.map((id) => id.toLowerCase()),
    };
    return this.write(async (tx) => {
      const project = await this.scope(
        tx,
        actor,
        projectId,
        true,
        "articles.edit",
      );
      const document = await tx.articleDocument.findFirst({
        where: { id: dto.documentId, projectId },
      });
      if (
        !document ||
        (!document.headVersionId &&
          document.creatorId !== actor.id &&
          project.creatorId !== actor.id)
      )
        throw missing();
      const draft = await tx.articleDraftSpace.findUnique({
        where: { projectId_ownerId: { projectId, ownerId: actor.id } },
      });
      if (!draft) throw missing();
      if (draft.revision !== sourceRevision) throw stale();
      const source = decodeForest(draft.forest, true).articles.find(
        (a) => a.id === dto.sourceArticleId,
      );
      if (!source) throw missing();
      const space = await tx.articlePublicationSpace.findUnique({
        where: { projectId },
      });
      const baseRevision = space?.revision ?? 0;
      if (
        dto.baseVersionId !== document.headVersionId ||
        dto.baseForestRevision !== baseRevision
      )
        throw stale();
      if (baseRevision < 0 || (space && space.nextSequence < 0))
        throw unavailable();
      const forest = space
        ? decodePublishedForest(space.forest)
        : emptyPublishedForest();
      // Retained canonical forest may name only documents that really have a head.
      if (
        (await tx.articleDocument.count({
          where: {
            projectId,
            id: { in: forest.articles.map((a) => a.id) },
            headVersionId: { not: null },
          },
        })) !== forest.articles.length
      )
        throw unavailable();
      let article: PublicationSnapshot["article"] = null;
      if (document.headVersionId) {
        const version = await tx.articlePublishedVersion.findUnique({
          where: { id: document.headVersionId },
        });
        if (
          !version ||
          version.documentId !== document.id ||
          version.number < 1
        )
          throw unavailable();
        article = decodeArticleComparison(version.comparison, document.id).after
          .article;
        if (version.reviewId) {
          if (version.resolutionReviewId) throw unavailable();
          decodeArticleVersionProvenance(version.provenance, version.reviewId);
          const review = await tx.articleReview.findUnique({
            where: { id: version.reviewId },
          });
          const reviewed = review?.snapshot as
            { format?: number; title?: unknown; text?: unknown } | undefined;
          if (
            !review ||
            review.projectId !== projectId ||
            review.state !== "APPROVED" ||
            reviewed?.format !== 1 ||
            reviewed.title !== article!.title ||
            reviewed.text !== article!.text
          )
            throw unavailable();
        } else {
          article = (await validatePublishedVersion(tx, version, projectId))
            .after.article;
        }
        if (!forest.articles.some((a) => a.id === document.id))
          throw unavailable();
      } else if (forest.articles.some((a) => a.id === document.id))
        throw unavailable();
      const before: PublicationSnapshot = { format: 1, article, forest };
      const expectedIds = new Set([
        ...forest.articles.map((a) => a.id),
        document.id,
      ]);
      let next;
      try {
        if (
          dto.positions.length !== expectedIds.size ||
          dto.positions.some((p) => !expectedIds.has(p.id))
        )
          throw new Error("Invalid explicit placement");
        next = decodePublishedForest({
          format: 1,
          articles: dto.positions,
          readingOrder: dto.readingOrder,
        });
      } catch {
        throw operationError(
          400,
          "ARTICLE_TREE_INVALID",
          "Explicit placement and reading order must retain every published document and this article exactly once",
          action,
        );
      }
      const comparison: ArticleComparison = {
        format: 1,
        before,
        after: {
          format: 1,
          article: { id: document.id, title: source.title, text: source.text },
          forest: next,
        },
      };
      // Each immutable contribution is staged separately. No merge/freeze/dispatch is implied.
      const inputHash = createHash("sha256")
        .update(
          JSON.stringify({
            sourceRevision,
            sourceArticleId: dto.sourceArticleId,
            baseVersionId: dto.baseVersionId,
            baseForestRevision: dto.baseForestRevision,
            positions: dto.positions,
            readingOrder: dto.readingOrder,
          }),
        )
        .digest("hex");
      const counter = space?.nextSequence ?? 0;
      if (counter >= 2147483646)
        throw operationError(
          409,
          "ARTICLE_QUEUE_CAPACITY",
          "Proposal sequence capacity reached",
          action,
        );
      await tx.articlePublicationSpace.upsert({
        where: { projectId },
        create: {
          projectId,
          forest: emptyPublishedForest() as unknown as Prisma.InputJsonValue,
          nextSequence: counter + 1,
        },
        update: { nextSequence: counter + 1 },
      });
      const contribution = await tx.articleProposalContribution.create({
        data: {
          id: dto.id,
          documentId: document.id,
          authorId: actor.id,
          sourceArticleId: source.id,
          sourceRevision,
          baseVersionId: document.headVersionId,
          baseForestRevision: baseRevision,
          inputHash,
          comparison: comparison as unknown as Prisma.InputJsonValue,
        },
      });
      const candidate = await tx.articleProposalCandidate.create({
        data: {
          id: dto.id,
          projectId,
          documentId: document.id,
          authorId: actor.id,
          sequence: counter + 1,
          contributionId: contribution.id,
        },
        include: { contribution: true },
      });
      return this.detail(
        candidate,
        await this.opponentWarning(tx, projectId, document.id, actor.id),
      );
    });
  }
  read(actor: AuthenticatedUser, projectId: string, id: string) {
    return readDependency("readArticleCandidate", () =>
      this.prisma.$transaction(async (tx) => {
        const p = await this.scope(tx, actor, projectId, false);
        const r = await tx.articleProposalCandidate.findFirst({
          where: {
            id: id.toLowerCase(),
            projectId,
            ...(p.creatorId === actor.id ? {} : { authorId: actor.id }),
          },
          include: { contribution: true },
        });
        if (!r) throw missing();
        return this.detail(
          r,
          await this.opponentWarning(tx, projectId, r.documentId, r.authorId),
        );
      }),
    );
  }
  list(actor: AuthenticatedUser, projectId: string, after?: string) {
    return readDependency("listArticleCandidates", () =>
      this.prisma.$transaction(async (tx) => {
        const p = await this.scope(tx, actor, projectId, false);
        const where = {
          projectId,
          ...(p.creatorId === actor.id ? {} : { authorId: actor.id }),
        };
        let sequence = 0;
        if (after) {
          const anchor = await tx.articleProposalCandidate.findFirst({
            where: { ...where, id: after.toLowerCase() },
          });
          if (!anchor) throw missing();
          sequence = anchor.sequence;
        }
        const rows = await tx.articleProposalCandidate.findMany({
          where: { ...where, sequence: { gt: sequence } },
          orderBy: { sequence: "asc" },
          take: 51,
          include: { contribution: true },
        });
        const page = rows.slice(0, 50).map((r) => {
          const d = this.detail(r);
          return {
            id: d.id,
            documentId: d.documentId,
            revision: d.revision,
            state: d.state,
            dispatchAvailable: d.dispatchAvailable,
          };
        });
        return {
          items: page,
          nextAfter: rows.length > 50 ? page[page.length - 1]!.id : null,
        };
      }),
    );
  }
}
