import { randomUUID } from "node:crypto";
import {
  AuthoredArticleChange,
  materializeArticleChanges,
  validateReviewerChoices,
} from "../src/articles/article-materialization";
import { PublicationSnapshot } from "../src/articles/article-comparison";
describe("conflict-preserving article materialization", () => {
  const documentId = randomUUID(),
    authorA = randomUUID(),
    authorB = randomUUID(),
    sourceA = randomUUID(),
    sourceB = randomUUID();
  const base = (): PublicationSnapshot => ({
    format: 1,
    article: { id: documentId, title: "Base title", text: "Base text" },
    forest: {
      format: 1,
      articles: [{ id: documentId, parentId: null }],
      readingOrder: [documentId],
    },
  });
  const change = (
    sequence: number,
    patch: { title?: string; text?: string } = {},
    authorId = authorA,
    sourceArticleId = sourceA,
    sourceRevision = 1,
  ): AuthoredArticleChange => {
    const before = base(),
      after = base();
    Object.assign(after.article!, patch);
    return {
      id: randomUUID(),
      authorId,
      sourceArticleId,
      sourceRevision,
      sequence,
      comparison: { format: 1, before, after },
    };
  };
  it("merges disjoint author fields while preserving both original comparisons and provenance", () => {
    const a = change(1, { title: "Author A" }),
      b = change(2, { text: "Author B" }, authorB, sourceB),
      copy = JSON.stringify([a, b]);
    const r = materializeArticleChanges(documentId, base(), [b, a]);
    expect(r.conflicts).toEqual([]);
    expect(r.comparison!.after.article).toEqual({
      id: documentId,
      title: "Author A",
      text: "Author B",
    });
    expect(r.contributionIds).toEqual([a.id, b.id]);
    expect(JSON.stringify([a, b])).toBe(copy);
  });
  it("keeps competing cross-author text alternatives without selecting first or latest", () => {
    const a = change(1, { text: "A" }),
      b = change(2, { text: "B" }, authorB, sourceB),
      r = materializeArticleChanges(documentId, base(), [a, b]);
    expect(r.fields.text).toBeNull();
    expect(r.comparison).toBeNull();
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.alternatives.map((a) => a.value)).toEqual([
      "A",
      "B",
    ]);
    expect(r.conflicts[0]!.alternatives.map((a) => a.contributionIds)).toEqual([
      [a.id],
      [b.id],
    ]);
  });
  it("deduplicates equal alternatives while retaining all author contribution references", () => {
    const a = change(1, { text: "Same" }),
      b = change(2, { text: "Same" }, authorB, sourceB),
      r = materializeArticleChanges(documentId, base(), [a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.comparison!.after.article!.text).toBe("Same");
    expect(r.contributionIds).toEqual([a.id, b.id]);
  });
  it("uses a proven newer own source revision but retains the superseded immutable evidence", () => {
    const a = change(1, { title: "Old own", text: "Old body" }),
      b = change(2, { title: "New own" }, authorA, sourceA, 2),
      other = change(3, { text: "Other body" }, authorB, sourceB);
    const r = materializeArticleChanges(documentId, base(), [a, b, other]);
    expect(r.comparison!.after.article).toEqual({
      id: documentId,
      title: "New own",
      text: "Other body",
    });
    expect(r.supersededContributionIds).toEqual([a.id]);
    expect(r.contributionIds).toContain(a.id);
  });
  it("does not treat a different private source or author as the same revision lineage", () => {
    const a = change(1, { text: "A" }, authorA, sourceA, 9),
      b = change(2, { text: "B" }, authorA, sourceB, 10);
    expect(
      materializeArticleChanges(documentId, base(), [a, b]).conflicts,
    ).toHaveLength(1);
  });
  it("keeps equal-revision structural alternatives instead of silently replacing one", () => {
    const a = change(1),
      b = change(2),
      parent = randomUUID();
    for (const c of [a, b]) {
      c.comparison.before.forest.articles.push({ id: parent, parentId: null });
      c.comparison.before.forest.readingOrder.push(parent);
      c.comparison.after.forest.articles.push({ id: parent, parentId: null });
      c.comparison.after.forest.readingOrder.push(parent);
    }
    a.comparison.after.forest.articles[0]!.parentId = parent;
    b.comparison.after.forest.readingOrder.reverse();
    const before = base();
    before.forest = a.comparison.before.forest;
    const r = materializeArticleChanges(documentId, before, [a, b]);
    expect(r.conflicts[0]!.field).toBe("forest");
    expect(r.conflicts[0]!.alternatives).toHaveLength(2);
  });
  it("keeps current published values for fields not changed by a queued contribution", () => {
    const before = base();
    before.article!.title = "Already approved title";
    const r = materializeArticleChanges(documentId, before, [
      change(1, { text: "Queued body" }),
    ]);
    expect(r.comparison!.before.article!.title).toBe("Already approved title");
    expect(r.comparison!.after.article).toEqual({
      id: documentId,
      title: "Already approved title",
      text: "Queued body",
    });
  });
  it("preserves exact Unicode and line endings in conflicting alternatives", () => {
    const r = materializeArticleChanges(documentId, base(), [
      change(1, { text: "👩‍💻\r\nA" }),
      change(2, { text: "👩‍💻\nB" }, authorB, sourceB),
    ]);
    expect(r.conflicts[0]!.alternatives.map((a) => a.value)).toEqual([
      "👩‍💻\r\nA",
      "👩‍💻\nB",
    ]);
  });
  it("supports new-document materialization without invented before content", () => {
    const c = change(1, { title: "Created", text: "" });
    c.comparison.before = {
      format: 1,
      article: null,
      forest: { format: 1, articles: [], readingOrder: [] },
    };
    const r = materializeArticleChanges(documentId, c.comparison.before, [c]);
    expect(r.comparison!.before.article).toBeNull();
    expect(r.comparison!.after.article!.text).toBe("");
  });
  it.each([
    "duplicate-id",
    "duplicate-order",
    "missing-author",
    "invalid-revision",
    "future-format",
    "cycle",
  ])("preserves invalid or unsupported inputs without guessing %s", (kind) => {
    const a = change(1, { title: "A" }),
      b = change(2, { title: "B" }, authorB, sourceB);
    if (kind === "duplicate-id") b.id = a.id;
    if (kind === "duplicate-order") b.sequence = 1;
    if (kind === "missing-author") b.authorId = "";
    if (kind === "invalid-revision") b.sourceRevision = 0;
    if (kind === "future-format") (b.comparison as any).format = 2;
    if (kind === "cycle")
      b.comparison.after.forest.articles[0]!.parentId = documentId;
    expect(() =>
      materializeArticleChanges(documentId, base(), [a, b]),
    ).toThrow();
  });
  it("refuses unsupported contribution counts and incompatible structural bases", () => {
    expect(() => materializeArticleChanges(documentId, base(), [])).toThrow();
    expect(() =>
      materializeArticleChanges(
        documentId,
        base(),
        Array.from({ length: 101 }, (_, i) => change(i + 1)),
      ),
    ).toThrow();
    const c = change(1);
    const foreign = randomUUID();
    c.comparison.after.forest.articles.push({ id: foreign, parentId: null });
    c.comparison.after.forest.readingOrder.push(foreign);
    expect(() => materializeArticleChanges(documentId, base(), [c])).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });
  it("validates complete reviewer alternatives and never turns them into a publication decision", () => {
    const r = materializeArticleChanges(documentId, base(), [
      change(1, { title: "A", text: "A" }),
      change(2, { title: "B", text: "B" }, authorB, sourceB),
    ]);
    const choices = r.conflicts.map((c) => ({
      conflictId: c.id,
      alternativeId: c.alternatives[0]!.id,
    }));
    expect(validateReviewerChoices(r, choices)).toHaveLength(2);
    expect(r.comparison).toBeNull();
    expect(() => validateReviewerChoices(r, choices.slice(0, 1))).toThrow();
    expect(() =>
      validateReviewerChoices(r, [choices[0]!, choices[0]!]),
    ).toThrow();
    expect(() =>
      validateReviewerChoices(
        r,
        choices.map((c) => ({ ...c, alternativeId: "0".repeat(64) })),
      ),
    ).toThrow();
  });
  it("allows explicit acknowledgement of a conflict-free frozen comparison", () => {
    const r = materializeArticleChanges(documentId, base(), [
      change(1, { text: "New" }),
    ]);
    expect(validateReviewerChoices(r, [])).toEqual([]);
    expect(r.comparison).not.toBeNull();
  });
});
