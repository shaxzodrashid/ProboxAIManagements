import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { assertCurrentManagement } from "../prisma/current-management";
import {
  databaseOperationError,
  operationError,
} from "../openapi/operation-errors";
import { readDependency } from "../prisma/read-dependency";
import {
  ArrangeArticleDraftsDto,
  CreateArticleDraftDto,
  EditArticleDraftDto,
} from "./articles.dto";
import {
  DraftForest,
  decodeForest,
  emptyForest,
  validateForest,
} from "./article-forest";

const missing = () =>
  operationError(
    404,
    "ARTICLE_SCOPE_NOT_FOUND",
    "Article scope not found",
    "articleDrafts",
  );
@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}
  private async scope(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    capability: string,
    write: boolean,
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
      select: { archivedAt: true, status: true },
    });
    if (!project) throw missing();
    if (write && (project.archivedAt || project.status === "DELETING"))
      throw operationError(
        409,
        "ARTICLE_PROJECT_INACTIVE",
        "Project lifecycle blocks article changes",
        "articleDrafts",
      );
  }
  private async load(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
    forWrite = false,
  ) {
    const space = await tx.articleDraftSpace.findUnique({
      where: { projectId_ownerId: { projectId, ownerId: actor.id } },
    });
    return {
      ...(space ? decodeForest(space.forest, forWrite) : emptyForest()),
      revision: space?.revision ?? 0,
    };
  }
  read(actor: AuthenticatedUser, projectId: string, articleId?: string) {
    return readDependency("readArticleDrafts", () =>
      this.prisma.$transaction(async (tx) => {
        await this.scope(tx, actor, projectId, "projects.read", false);
        const space = await this.load(tx, actor, projectId);
        if (!articleId) return space;
        const article = space.articles.find((a) => a.id === articleId);
        if (!article) throw missing();
        const i = space.readingOrder.indexOf(articleId);
        return {
          ...article,
          revision: space.revision,
          previousId: space.readingOrder[i - 1] ?? null,
          nextId: space.readingOrder[i + 1] ?? null,
        };
      }),
    );
  }
  private async mutate(
    actor: AuthenticatedUser,
    projectId: string,
    revision: number,
    capability: string,
    change: (forest: DraftForest) => void,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.scope(tx, actor, projectId, capability, true);
        const current = await this.load(tx, actor, projectId, true);
        if (current.revision !== revision || revision >= 2147483646)
          throw operationError(
            409,
            "STALE_REVISION",
            "Reread the current private draft space before editing",
            "articleDrafts",
          );
        const forest: DraftForest = {
          format: 1,
          articles: current.articles,
          readingOrder: current.readingOrder,
        };
        change(forest);
        validateForest(forest);
        const key = { projectId, ownerId: actor.id };
        const json = forest as unknown as Prisma.InputJsonValue;
        await tx.articleDraftSpace.upsert({
          where: { projectId_ownerId: key },
          create: {
            ...key,
            projectRefId: projectId,
            ownerRefId: actor.id,
            revision: revision + 1,
            forest: json,
          },
          update: { revision: revision + 1, forest: json },
        });
        await tx.articleDraftRevision.create({
          data: { ...key, revision: revision + 1, forest: json },
        });
        return { ...forest, revision: revision + 1 };
      });
    } catch (error) {
      databaseOperationError(error, "articleDrafts");
    }
  }
  create(
    actor: AuthenticatedUser,
    projectId: string,
    revision: number,
    dto: CreateArticleDraftDto,
  ) {
    return this.mutate(
      actor,
      projectId,
      revision,
      "articles.create",
      (forest) => {
        const id = dto.id.toLowerCase();
        if (forest.articles.some((a) => a.id === id))
          throw operationError(
            409,
            "ARTICLE_ID_CONFLICT",
            "Draft identity already exists",
            "createArticleDraft",
          );
        forest.articles.push({
          id,
          title: dto.title,
          text: dto.text,
          parentId: null,
        });
        forest.readingOrder.push(id);
      },
    );
  }
  edit(
    actor: AuthenticatedUser,
    projectId: string,
    articleId: string,
    revision: number,
    dto: EditArticleDraftDto,
  ) {
    return this.mutate(
      actor,
      projectId,
      revision,
      "articles.edit",
      (forest) => {
        const article = forest.articles.find((a) => a.id === articleId);
        if (!article) throw missing();
        article.title = dto.title;
        article.text = dto.text;
      },
    );
  }
  arrange(
    actor: AuthenticatedUser,
    projectId: string,
    revision: number,
    dto: ArrangeArticleDraftsDto,
  ) {
    return this.mutate(
      actor,
      projectId,
      revision,
      "articles.edit",
      (forest) => {
        const positions = dto.articles.map((a) => ({
          id: a.id.toLowerCase(),
          parentId: a.parentId?.toLowerCase() ?? null,
        }));
        if (
          positions.length !== forest.articles.length ||
          new Set(positions.map((a) => a.id)).size !== forest.articles.length ||
          positions.some((a) => !forest.articles.some((b) => b.id === a.id))
        )
          throw operationError(
            400,
            "ARTICLE_TREE_INVALID",
            "Placement must retain every current draft exactly once",
            "arrangeArticleDrafts",
          );
        forest.articles = positions.map((p) => ({
          ...forest.articles.find((a) => a.id === p.id)!,
          parentId: p.parentId,
        }));
        forest.readingOrder = dto.readingOrder.map((id) => id.toLowerCase());
      },
    );
  }
}
