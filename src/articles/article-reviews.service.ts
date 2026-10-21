import { Injectable } from "@nestjs/common";
import { ArticleReview, ArticleReviewVoter, Prisma } from "@prisma/client";
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
import { articleReviewDecision } from "./article-review-decision";
import { SubmitArticleReviewDto } from "./article-reviews.dto";

import { eligibleArticleReviewers } from "./article-reviewer-selection";
type Review = ArticleReview & { voters: ArticleReviewVoter[] };
const missing = () =>
  operationError(
    404,
    "ARTICLE_REVIEW_NOT_FOUND",
    "Article review scope not found",
    "articleReviews",
  );
const conflict = () =>
  operationError(
    409,
    "ARTICLE_REVIEW_STATE_CHANGED",
    "Reread the review; this action is no longer available",
    "articleReviews",
  );
const unavailable = () =>
  operationError(
    409,
    "ARTICLE_REVIEW_FORMAT_UNAVAILABLE",
    "Stored review requires compatible handling; content has been preserved",
    "articleReviews",
  );
const summary = (r: ArticleReview) => ({
  id: r.id,
  articleId: r.articleId,
  sourceRevision: r.sourceRevision,
  revision: r.revision,
  state: r.state,
});

@Injectable()
export class ArticleReviewsService {
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
    const project = await tx.project.findFirst({
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
    if (!project) throw missing();
    if (write && (project.archivedAt || project.status === "DELETING"))
      throw operationError(
        409,
        "ARTICLE_PROJECT_INACTIVE",
        "Project lifecycle blocks article changes",
        "articleReviews",
      );
    return project;
  }
  private snapshot(r: Review) {
    const value = r.snapshot as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).some(
        (k) => !["format", "id", "title", "text"].includes(k),
      ) ||
      value.format !== 1 ||
      value.id !== r.articleId
    )
      throw unavailable();
    try {
      const a = decodeForest(
        {
          format: 1,
          articles: [
            {
              id: value.id,
              title: value.title,
              text: value.text,
              parentId: null,
            },
          ],
          readingOrder: [value.id],
        },
        true,
      ).articles[0]!;
      return { format: 1 as const, id: a.id, title: a.title, text: a.text };
    } catch {
      throw unavailable();
    }
  }
  private validate(r: Review) {
    const voted = r.voters.filter((v) => v.approved !== null).length;
    if (
      r.sourceRevision < 1 ||
      r.voters.length > 100 ||
      r.voters.some((v) => (v.approved === null) !== (v.votedAt === null))
    )
      throw unavailable();
    if (r.state === "WAITING_VOTERS") {
      if (
        r.voters.length ||
        r.revision !== 0 ||
        r.selectedById !== null ||
        r.decidedAt !== null
      )
        throw unavailable();
    } else {
      if (
        !r.voters.length ||
        r.selectedById === null ||
        r.revision !== 1 + voted ||
        r.state !== articleReviewDecision(r.voters.map((v) => v.approved)) ||
        (r.state === "PENDING") !== (r.decidedAt === null)
      )
        throw unavailable();
    }
    return this.snapshot(r);
  }
  private detail(r: Review) {
    return {
      ...summary(r),
      article: this.validate(r),
      voters: r.voters.map((v) => ({ userId: v.userId, approved: v.approved })),
    };
  }
  private async load(
    tx: Prisma.TransactionClient,
    projectId: string,
    id: string,
    actorId: string,
    ownerId: string,
  ) {
    const r = await tx.articleReview.findFirst({
      where: {
        id,
        projectId,
        ...(ownerId === actorId
          ? {}
          : {
              OR: [
                { authorId: actorId },
                { voters: { some: { userId: actorId } } },
              ],
            }),
      },
      include: { voters: { orderBy: { userId: "asc" } } },
    });
    if (!r) throw missing();
    this.validate(r);
    return r;
  }
  private async write<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      databaseOperationError(error, "articleReviews");
    }
  }
  submit(
    actor: AuthenticatedUser,
    projectId: string,
    sourceRevision: number,
    dto: SubmitArticleReviewDto,
  ) {
    return this.write(async (tx) => {
      await this.scope(tx, actor, projectId, true, "articles.edit");
      const space = await tx.articleDraftSpace.findUnique({
        where: { projectId_ownerId: { projectId, ownerId: actor.id } },
      });
      if (!space) throw missing();
      if (space.revision !== sourceRevision)
        throw operationError(
          409,
          "STALE_REVISION",
          "Reread the private draft before submission",
          "articleReviews",
        );
      const a = decodeForest(space.forest, true).articles.find(
        (a) => a.id === dto.articleId.toLowerCase(),
      );
      if (!a) throw missing();
      const snapshot = { format: 1, id: a.id, title: a.title, text: a.text };
      return this.detail(
        await tx.articleReview.create({
          data: {
            id: dto.id.toLowerCase(),
            projectId,
            projectRefId: projectId,
            authorId: actor.id,
            articleId: a.id,
            sourceRevision,
            snapshot,
          },
          include: { voters: true },
        }),
      );
    });
  }
  read(actor: AuthenticatedUser, projectId: string, id: string) {
    return readDependency("readArticleReview", () =>
      this.prisma.$transaction(async (tx) => {
        const project = await this.scope(tx, actor, projectId, false);
        return this.detail(
          await this.load(tx, projectId, id, actor.id, project.creatorId),
        );
      }),
    );
  }
  list(
    actor: AuthenticatedUser,
    projectId: string,
    after?: string,
    published = false,
  ) {
    return readDependency("listArticleReviews", () =>
      this.prisma.$transaction(async (tx) => {
        const project = await this.scope(tx, actor, projectId, false);
        const rows = await tx.articleReview.findMany({
          where: {
            projectId,
            ...(after ? { id: { gt: after } } : {}),
            ...(published
              ? { state: "APPROVED" }
              : project.creatorId === actor.id
                ? {}
                : {
                    OR: [
                      { authorId: actor.id },
                      { voters: { some: { userId: actor.id } } },
                    ],
                  }),
          },
          orderBy: { id: "asc" },
          take: 51,
          include: { voters: { orderBy: { userId: "asc" } } },
        });
        const items = rows.slice(0, 50);
        for (const r of items) this.validate(r);
        return {
          items: items.map((r) =>
            published
              ? {
                  reviewId: r.id,
                  articleId: r.articleId,
                  sourceRevision: r.sourceRevision,
                }
              : summary(r),
          ),
          nextAfter: rows.length > 50 ? items[items.length - 1]!.id : null,
        };
      }),
    );
  }
  publication(actor: AuthenticatedUser, projectId: string, id: string) {
    return readDependency("readArticlePublication", () =>
      this.prisma.$transaction(async (tx) => {
        await this.scope(tx, actor, projectId, false);
        const r = await tx.articleReview.findFirst({
          where: { id, projectId, state: "APPROVED" },
          include: { voters: true },
        });
        if (!r) throw missing();
        return {
          reviewId: r.id,
          sourceRevision: r.sourceRevision,
          article: this.validate(r),
        };
      }),
    );
  }
  selectVoters(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    revision: number,
    ids: string[],
  ) {
    return this.write(async (tx) => {
      const project = await this.scope(tx, actor, projectId, true);
      if (project.creatorId !== actor.id) throw missing();
      const r = await this.load(tx, projectId, id, actor.id, project.creatorId);
      if (r.revision !== revision)
        throw operationError(
          409,
          "STALE_REVISION",
          "Reread the review before selecting voters",
          "articleReviews",
        );
      if (r.state !== "WAITING_VOTERS") throw conflict();
      const voterIds = await eligibleArticleReviewers(
        tx,
        actor,
        projectId,
        project.creatorId,
        ids,
        missing,
        "articleReviews",
      );
      return this.detail(
        await tx.articleReview.update({
          where: { id },
          data: {
            state: "PENDING",
            revision: 1,
            selectedById: actor.id,
            voters: { create: voterIds.map((userId) => ({ userId })) },
          },
          include: { voters: { orderBy: { userId: "asc" } } },
        }),
      );
    });
  }
  vote(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    revision: number,
    approved: boolean,
  ) {
    return this.write(async (tx) => {
      const project = await this.scope(tx, actor, projectId, true);
      const r = await this.load(tx, projectId, id, actor.id, project.creatorId);
      if (!r.voters.some((v) => v.userId === actor.id)) throw missing();
      if (r.revision !== revision)
        throw operationError(
          409,
          "STALE_REVISION",
          "Reread the review before voting",
          "articleReviews",
        );
      if (
        r.state !== "PENDING" ||
        r.voters.some((v) => v.userId === actor.id && v.approved !== null)
      )
        throw conflict();
      const now = new Date();
      const state = articleReviewDecision(
        r.voters.map((v) => (v.userId === actor.id ? approved : v.approved)),
      );
      await tx.articleReviewVoter.update({
        where: { reviewId_userId: { reviewId: id, userId: actor.id } },
        data: { approved, votedAt: now },
      });
      return this.detail(
        await tx.articleReview.update({
          where: { id },
          data: {
            state,
            revision: { increment: 1 },
            decidedAt: state === "PENDING" ? null : now,
          },
          include: { voters: { orderBy: { userId: "asc" } } },
        }),
      );
    });
  }
}
