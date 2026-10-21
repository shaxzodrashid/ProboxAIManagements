import { operationError } from "../openapi/operation-errors";

export interface DraftArticle {
  id: string;
  title: string;
  text: string;
  parentId: string | null;
}
export interface DraftForest {
  format: 1;
  articles: DraftArticle[];
  readingOrder: string[];
}
export const emptyForest = (): DraftForest => ({
  format: 1,
  articles: [],
  readingOrder: [],
});
export function decodeForest(value: unknown, forWrite = false): DraftForest {
  try {
    const f = value as DraftForest;
    if (
      f?.format !== 1 ||
      !Array.isArray(f.articles) ||
      !Array.isArray(f.readingOrder)
    )
      throw invalid();
    if (
      forWrite &&
      Object.keys(f).some(
        (key) => !["format", "articles", "readingOrder"].includes(key),
      )
    )
      throw invalid();
    const forest: DraftForest = {
      format: 1,
      articles: f.articles.map((a) => {
        if (
          forWrite &&
          a &&
          Object.keys(a).some(
            (key) => !["id", "title", "text", "parentId"].includes(key),
          )
        )
          throw invalid();
        if (
          typeof a?.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            a.id,
          ) ||
          typeof a.title !== "string" ||
          a.title.length < 1 ||
          a.title.length > 200 ||
          typeof a.text !== "string" ||
          a.text.length > 10000 ||
          (a.parentId !== null && typeof a.parentId !== "string")
        )
          throw invalid();
        return { id: a.id, title: a.title, text: a.text, parentId: a.parentId };
      }),
      readingOrder: [...f.readingOrder],
    };
    validateForest(forest);
    return forest;
  } catch {
    throw operationError(
      409,
      "ARTICLE_FORMAT_UNAVAILABLE",
      "Stored draft format requires compatible handling; content has been preserved",
      "readArticleDrafts",
    );
  }
}
const invalid = () =>
  operationError(
    400,
    "ARTICLE_TREE_INVALID",
    "Invalid article forest or reading order",
    "validateArticleForest",
  );

// Parent hierarchy and reading sequence are deliberately independent.
export function validateForest(forest: DraftForest) {
  const ids = new Set(forest.articles.map((article) => article.id));
  if (
    forest.articles.length > 100 ||
    ids.size !== forest.articles.length ||
    forest.readingOrder.length !== ids.size ||
    new Set(forest.readingOrder).size !== ids.size ||
    forest.readingOrder.some((id) => !ids.has(id))
  )
    throw invalid();
  const parents = new Map(forest.articles.map((a) => [a.id, a.parentId]));
  for (const article of forest.articles) {
    const seen = new Set<string>();
    let current: string | null = article.id;
    while (current !== null) {
      if (!ids.has(current) || seen.has(current) || seen.size >= 8)
        throw invalid();
      seen.add(current);
      current = parents.get(current)!;
    }
  }
}
