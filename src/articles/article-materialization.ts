import { createHash } from "node:crypto";
import { operationError } from "../openapi/operation-errors";
import {
  ArticleComparison,
  decodeArticleComparison,
  decodePublicationSnapshot,
  PublishedForest,
  PublicationSnapshot,
} from "./article-comparison";
export type ResolutionField = "title" | "text" | "forest";
export interface AuthoredArticleChange {
  id: string;
  authorId: string;
  sourceArticleId: string;
  sourceRevision: number;
  sequence: number;
  comparison: ArticleComparison;
}
export interface ConflictAlternative {
  id: string;
  value: string | PublishedForest;
  contributionIds: string[];
}
export interface ArticleFieldConflict {
  id: string;
  field: ResolutionField;
  alternatives: ConflictAlternative[];
}
export interface ArticleMaterialization {
  format: 1;
  documentId: string;
  before: PublicationSnapshot;
  fields: {
    title: string | null;
    text: string | null;
    forest: PublishedForest | null;
  };
  conflicts: ArticleFieldConflict[];
  comparison: ArticleComparison | null;
  contributionIds: string[];
  supersededContributionIds: string[];
}
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const value = (s: PublicationSnapshot, field: ResolutionField) =>
  field === "forest" ? s.forest : (s.article?.[field] ?? null);
export function materializeArticleChanges(
  documentId: string,
  beforeValue: unknown,
  changes: AuthoredArticleChange[],
): ArticleMaterialization {
  const fail = () =>
    operationError(
      409,
      "ARTICLE_RESOLUTION_FORMAT_UNAVAILABLE",
      "Contributions require compatible handling; all content preserved",
      "articleResolution",
    );
  if (
    !changes.length ||
    changes.length > 100 ||
    new Set(changes.map((c) => c.id)).size !== changes.length ||
    new Set(changes.map((c) => c.sequence)).size !== changes.length
  )
    throw fail();
  const before = decodePublicationSnapshot(beforeValue, documentId, true);
  const ordered = [...changes]
    .sort((a, b) => a.sequence - b.sequence)
    .map((c) => {
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (
        [c.id, c.authorId, c.sourceArticleId].some(
          (id) => typeof id !== "string" || !uuid.test(id),
        ) ||
        !Number.isInteger(c.sourceRevision) ||
        c.sourceRevision < 1 ||
        !Number.isInteger(c.sequence) ||
        c.sequence < 1
      )
        throw fail();
      return {
        ...c,
        comparison: decodeArticleComparison(c.comparison, documentId),
      };
    });
  // A newer revision supersedes only its own proven author/private-article lineage.
  // Equal-revision structural alternatives and every cross-author alternative remain.
  const latest = new Map<string, number>();
  for (const c of ordered) {
    const key = JSON.stringify([c.authorId, c.sourceArticleId]);
    latest.set(key, Math.max(latest.get(key) ?? 0, c.sourceRevision));
  }
  const active = ordered.filter(
    (c) =>
      c.sourceRevision ===
      latest.get(JSON.stringify([c.authorId, c.sourceArticleId])),
  );
  const fields: ArticleMaterialization["fields"] = {
    title: before.article?.title ?? null,
    text: before.article?.text ?? null,
    forest: before.forest,
  };
  const conflicts: ArticleFieldConflict[] = [];
  for (const field of ["title", "text", "forest"] as const) {
    const alternatives = new Map<string, ConflictAlternative>();
    for (const c of active) {
      const after = value(c.comparison.after, field);
      if (
        JSON.stringify(after) ===
        JSON.stringify(value(c.comparison.before, field))
      )
        continue;
      const id = hash([documentId, field, after]);
      const prior = alternatives.get(id);
      if (prior) prior.contributionIds.push(c.id);
      else
        alternatives.set(id, {
          id,
          value: after as string | PublishedForest,
          contributionIds: [c.id],
        });
    }
    const options = [...alternatives.values()];
    if (options.length === 1)
      (fields as Record<ResolutionField, unknown>)[field] = options[0]!.value;
    else if (options.length > 1) {
      (fields as Record<ResolutionField, unknown>)[field] = null;
      conflicts.push({
        id: hash([documentId, field]),
        field,
        alternatives: options,
      });
    }
  }
  let comparison: ArticleComparison | null = null;
  if (!conflicts.length) {
    if (fields.title === null || fields.text === null || fields.forest === null)
      throw fail();
    comparison = decodeArticleComparison(
      {
        format: 1,
        before,
        after: {
          format: 1,
          article: { id: documentId, title: fields.title, text: fields.text },
          forest: fields.forest,
        },
      },
      documentId,
    );
    const expected = new Set([
      ...before.forest.articles.map((a) => a.id),
      documentId,
    ]);
    if (
      comparison.after.forest.articles.length !== expected.size ||
      comparison.after.forest.articles.some((a) => !expected.has(a.id))
    )
      throw operationError(
        409,
        "ARTICLE_RESOLUTION_STRUCTURE_CONFLICT",
        "Current published structure and submitted alternatives need explicit compatible resolution; contributions preserved",
        "articleResolution",
      );
  }
  return {
    format: 1,
    documentId,
    before,
    fields,
    conflicts,
    comparison,
    contributionIds: ordered.map((c) => c.id),
    supersededContributionIds: ordered
      .filter((c) => !active.includes(c))
      .map((c) => c.id),
  };
}
export function validateReviewerChoices(
  materialization: ArticleMaterialization,
  choices: { conflictId: string; alternativeId: string }[],
) {
  if (
    choices.length !== materialization.conflicts.length ||
    new Set(choices.map((c) => c.conflictId)).size !== choices.length ||
    choices.some(
      (c) =>
        !materialization.conflicts.some(
          (f) =>
            f.id === c.conflictId &&
            f.alternatives.some((a) => a.id === c.alternativeId),
        ),
    )
  )
    throw operationError(
      400,
      "ARTICLE_RESOLUTION_CHOICES_INVALID",
      "Choose exactly one retained alternative for every conflict",
      "articleResolution",
    );
  return [...choices].sort((a, b) => a.conflictId.localeCompare(b.conflictId));
}
