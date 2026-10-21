import { operationError } from "../openapi/operation-errors";
import { validateForest } from "./article-forest";

export interface PublishedArticleText {
  id: string;
  title: string;
  text: string;
}
export interface PublishedForest {
  format: 1;
  articles: { id: string; parentId: string | null }[];
  readingOrder: string[];
}
export interface PublicationSnapshot {
  format: 1;
  article: PublishedArticleText | null;
  forest: PublishedForest;
}
export interface ArticleComparison {
  format: 1;
  before: PublicationSnapshot;
  after: PublicationSnapshot;
}
export function decodeArticleVersionProvenance(
  value: unknown,
  reviewId: string,
) {
  if (!object(value, ["format", "reviewId", "contributionIds"])) throw fail();
  const p = value as {
    format: number;
    reviewId: string;
    contributionIds: string[];
  };
  if (
    p.format !== 1 ||
    p.reviewId !== reviewId ||
    !uuid.test(p.reviewId) ||
    !Array.isArray(p.contributionIds) ||
    p.contributionIds.length < 1 ||
    p.contributionIds.length > 100 ||
    new Set(p.contributionIds).size !== p.contributionIds.length ||
    p.contributionIds.some((id) => typeof id !== "string" || !uuid.test(id))
  )
    throw fail();
  return {
    format: 1 as const,
    reviewId: p.reviewId,
    contributionIds: [...p.contributionIds],
  };
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (v: unknown, keys: string[]) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  Object.keys(v).every((k) => keys.includes(k));
const fail = () =>
  operationError(
    409,
    "ARTICLE_PROPOSAL_FORMAT_UNAVAILABLE",
    "Stored article foundation requires compatible handling; content preserved",
    "articleProposalFoundations",
  );
export const emptyPublishedForest = (): PublishedForest => ({
  format: 1,
  articles: [],
  readingOrder: [],
});
export function decodePublishedForest(value: unknown): PublishedForest {
  try {
    if (!object(value, ["format", "articles", "readingOrder"])) throw fail();
    const f = value as PublishedForest;
    if (
      f.format !== 1 ||
      !Array.isArray(f.articles) ||
      !Array.isArray(f.readingOrder) ||
      f.articles.some(
        (a) =>
          !object(a, ["id", "parentId"]) ||
          typeof a.id !== "string" ||
          !uuid.test(a.id) ||
          (a.parentId !== null &&
            (typeof a.parentId !== "string" || !uuid.test(a.parentId))),
      )
    )
      throw fail();
    validateForest({
      format: 1,
      articles: f.articles.map((a) => ({ ...a, title: "_", text: "" })),
      readingOrder: f.readingOrder,
    });
    return {
      format: 1,
      articles: f.articles.map((a) => ({ id: a.id, parentId: a.parentId })),
      readingOrder: [...f.readingOrder],
    };
  } catch {
    throw fail();
  }
}
export function decodePublicationSnapshot(
  value: unknown,
  documentId: string,
  allowAbsent: boolean,
): PublicationSnapshot {
  if (!object(value, ["format", "article", "forest"])) throw fail();
  const s = value as PublicationSnapshot;
  if (s.format !== 1) throw fail();
  const forest = decodePublishedForest(s.forest);
  if (s.article === null) {
    if (!allowAbsent || forest.articles.some((a) => a.id === documentId))
      throw fail();
  } else if (
    !object(s.article, ["id", "title", "text"]) ||
    s.article.id !== documentId ||
    typeof s.article.title !== "string" ||
    s.article.title.length < 1 ||
    s.article.title.length > 200 ||
    typeof s.article.text !== "string" ||
    s.article.text.length > 10000 ||
    !forest.articles.some((a) => a.id === documentId)
  )
    throw fail();
  return {
    format: 1,
    article:
      s.article === null
        ? null
        : { id: s.article.id, title: s.article.title, text: s.article.text },
    forest,
  };
}
export function decodeArticleComparison(
  value: unknown,
  documentId: string,
): ArticleComparison {
  if (
    !object(value, ["format", "before", "after"]) ||
    (value as ArticleComparison).format !== 1
  )
    throw fail();
  const c = value as ArticleComparison;
  return {
    format: 1,
    before: decodePublicationSnapshot(c.before, documentId, true),
    after: decodePublicationSnapshot(c.after, documentId, false),
  };
}
export function articleChanges(c: ArticleComparison) {
  const id = c.after.article!.id;
  return {
    created: c.before.article === null,
    title: c.before.article?.title !== c.after.article!.title,
    text: c.before.article?.text !== c.after.article!.text,
    parent:
      c.before.forest.articles.find((a) => a.id === id)?.parentId !==
      c.after.forest.articles.find((a) => a.id === id)?.parentId,
    forest:
      JSON.stringify(c.before.forest.articles) !==
      JSON.stringify(c.after.forest.articles),
    readingOrder:
      JSON.stringify(c.before.forest.readingOrder) !==
      JSON.stringify(c.after.forest.readingOrder),
  };
}
