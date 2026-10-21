import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { assertCurrentManagement } from "../prisma/current-management";
import { readDependency } from "../prisma/read-dependency";
import { operationError } from "../openapi/operation-errors";
import {
  decodePublishedForest,
  emptyPublishedForest,
} from "./article-comparison";
import { validatePublishedVersion } from "./article-version-validation";
import { resolutionUnavailable } from "./article-resolution-state";
const missing = () =>
  operationError(
    404,
    "ARTICLE_PUBLICATION_NOT_FOUND",
    "Published article scope unavailable",
    "articleCanonical",
  );
@Injectable()
export class ArticleCanonicalService {
  constructor(private readonly prisma: PrismaService) {}
  private async scope(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    projectId: string,
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
      select: { id: true },
    });
    if (!p) throw missing();
  }
  private async publishedTree(tx: Prisma.TransactionClient, projectId: string) {
    const space = await tx.articlePublicationSpace.findUnique({
      where: { projectId },
    });
    if (space && (!Number.isInteger(space.revision) || space.revision < 0))
      throw resolutionUnavailable();
    const forest = space
      ? decodePublishedForest(space.forest)
      : emptyPublishedForest();
    const documents = await tx.articleDocument.findMany({
      where: { projectId, id: { in: forest.readingOrder } },
      include: { head: true },
    });
    if (documents.length !== forest.readingOrder.length)
      throw resolutionUnavailable();
    for (const d of documents) {
      if (!d.head || d.head.documentId !== d.id) throw resolutionUnavailable();
      await validatePublishedVersion(tx, d.head, projectId);
    }
    return { revision: space?.revision ?? 0, forest, documents };
  }
  tree(actor: AuthenticatedUser, projectId: string) {
    return readDependency("readPublishedArticleTree", () =>
      this.prisma.$transaction(async (tx) => {
        await this.scope(tx, actor, projectId);
        const { revision, forest } = await this.publishedTree(tx, projectId);
        return { revision, forest };
      }),
    );
  }
  read(actor: AuthenticatedUser, projectId: string, id: string) {
    return readDependency("readCanonicalArticle", () =>
      this.prisma.$transaction(async (tx) => {
        await this.scope(tx, actor, projectId);
        const { revision, forest, documents } = await this.publishedTree(
            tx,
            projectId,
          ),
          index = forest.readingOrder.indexOf(id.toLowerCase());
        if (index < 0) throw missing();
        const document = documents.find((d) => d.id === id.toLowerCase());
        if (!document?.head) throw missing();
        const comparison = await validatePublishedVersion(
          tx,
          document.head,
          projectId,
        );
        return {
          documentId: document.id,
          versionId: document.head.id,
          number: document.head.number,
          forestRevision: revision,
          article: comparison.after.article!,
          previousId: forest.readingOrder[index - 1] ?? null,
          nextId: forest.readingOrder[index + 1] ?? null,
        };
      }),
    );
  }
}
