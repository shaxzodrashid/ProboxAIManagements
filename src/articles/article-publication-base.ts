import { ArticleDocument, Prisma } from "@prisma/client";
import { operationError } from "../openapi/operation-errors";
import {
  decodePublishedForest,
  emptyPublishedForest,
  PublicationSnapshot,
} from "./article-comparison";
import { validatePublishedVersion } from "./article-version-validation";
export async function currentArticlePublicationBase(
  tx: Prisma.TransactionClient,
  document: Pick<ArticleDocument, "id" | "headVersionId" | "projectId">,
  projectId: string,
) {
  const fail = () =>
    operationError(
      409,
      "ARTICLE_RESOLUTION_FORMAT_UNAVAILABLE",
      "Published base requires compatible handling; contributions preserved",
      "articleResolution",
    );
  if (document.projectId !== projectId) throw fail();
  const space = await tx.articlePublicationSpace.findUnique({
    where: { projectId },
  });
  if (space && (space.revision < 0 || space.nextSequence < 0)) throw fail();
  const forest = space
    ? decodePublishedForest(space.forest)
    : emptyPublishedForest();
  if (
    (await tx.articleDocument.count({
      where: {
        projectId,
        id: { in: forest.articles.map((a) => a.id) },
        headVersionId: { not: null },
      },
    })) !== forest.articles.length
  )
    throw fail();
  let article: PublicationSnapshot["article"] = null;
  if (document.headVersionId) {
    const v = await tx.articlePublishedVersion.findUnique({
      where: { id: document.headVersionId },
    });
    if (!v || v.documentId !== document.id || v.number < 1) throw fail();
    article = (await validatePublishedVersion(tx, v, projectId)).after.article;
    if (!forest.articles.some((a) => a.id === document.id)) throw fail();
  } else if (forest.articles.some((a) => a.id === document.id)) throw fail();
  return { format: 1 as const, article, forest };
}
