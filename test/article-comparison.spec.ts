import { randomUUID } from "node:crypto";
import {
  articleChanges,
  decodeArticleComparison,
  decodeArticleVersionProvenance,
  decodePublishedForest,
  emptyPublishedForest,
} from "../src/articles/article-comparison";
describe("immutable exact article comparisons", () => {
  const id = randomUUID(),
    parent = randomUUID(),
    contribution = randomUUID(),
    review = randomUUID();
  const before = () => ({
    format: 1,
    article: { id, title: "Old title", text: "line one\r\n👩‍💻\u0000" },
    forest: {
      format: 1,
      articles: [
        { id: parent, parentId: null },
        { id, parentId: null },
      ],
      readingOrder: [parent, id],
    },
  });
  const comparison = () => ({
    format: 1,
    before: before(),
    after: {
      format: 1,
      article: { id, title: "New title", text: "line one\n👩‍💻\u0000" },
      forest: {
        format: 1,
        articles: [
          { id: parent, parentId: null },
          { id, parentId: parent },
        ],
        readingOrder: [id, parent],
      },
    },
  });
  it("retains exact text bytes represented by JSON and independent parent/order changes", () => {
    const c = comparison(),
      decoded = decodeArticleComparison(c, id);
    expect(decoded).toEqual(c);
    expect(articleChanges(decoded)).toEqual({
      created: false,
      title: true,
      text: true,
      parent: true,
      forest: true,
      readingOrder: true,
    });
    c.after.forest.readingOrder.reverse();
    c.after.article.text = "mutated";
    expect(decoded.after.article!.text).toBe("line one\n👩‍💻\u0000");
    expect(decoded.after.forest.readingOrder).toEqual([id, parent]);
  });
  it("models a new document with no invented previously published content", () => {
    const c = decodeArticleComparison(
      {
        format: 1,
        before: { format: 1, article: null, forest: emptyPublishedForest() },
        after: {
          format: 1,
          article: { id, title: "New", text: "" },
          forest: {
            format: 1,
            articles: [{ id, parentId: null }],
            readingOrder: [id],
          },
        },
      },
      id,
    );
    expect(c.before.article).toBeNull();
    expect(articleChanges(c).created).toBe(true);
  });
  it("marks exact no-op text and structural comparisons without claiming a UI diff", () => {
    const b = before();
    expect(
      articleChanges(
        decodeArticleComparison({ format: 1, before: b, after: b }, id),
      ),
    ).toEqual({
      created: false,
      title: false,
      text: false,
      parent: false,
      forest: false,
      readingOrder: false,
    });
  });
  it("reports explicit sibling/root ordering changes even when parent and reading order are unchanged", () => {
    const b = before(),
      after = before();
    after.forest.articles.reverse();
    const changes = articleChanges(
      decodeArticleComparison({ format: 1, before: b, after }, id),
    );
    expect(changes).toMatchObject({
      title: false,
      text: false,
      parent: false,
      readingOrder: false,
      forest: true,
    });
  });
  it.each([
    (c: any) => (c.format = 2),
    (c: any) => (c.secret = "unsupported"),
    (c: any) => (c.before.article.id = randomUUID()),
    (c: any) => (c.after.article = null),
    (c: any) => (c.after.article.text = 3),
    (c: any) => (c.after.article.title = ""),
    (c: any) => (c.after.article.title = "x".repeat(201)),
    (c: any) => (c.after.article.text = "x".repeat(10001)),
    (c: any) => (c.after.article.extra = "future"),
    (c: any) => (c.after.forest.secret = "future"),
    (c: any) => (c.after.forest.articles[1].parentId = id),
    (c: any) => (c.after.forest.readingOrder = [id, id]),
    (c: any) => (c.after.forest.readingOrder = [id]),
    (c: any) => (c.after.forest.articles[1].parentId = randomUUID()),
    (c: any) => (c.after.forest.articles[0].text = "private"),
    (c: any) => {
      c.before.article = null;
    },
  ])(
    "fails closed on unknown format, invalid content or impossible before/after forest %#",
    (change) => {
      const c = comparison();
      change(c);
      expect(() => decodeArticleComparison(c, id)).toThrow(
        expect.objectContaining({ status: 409 }),
      );
    },
  );
  it("preserves multiple roots and independent reading order", () => {
    const f = before().forest;
    expect(decodePublishedForest(f)).toEqual(f);
  });
  it("rejects excessive tree depth and node count", () => {
    const ids = Array.from({ length: 9 }, () => randomUUID());
    expect(() =>
      decodePublishedForest({
        format: 1,
        articles: ids.map((id, i) => ({ id, parentId: ids[i - 1] ?? null })),
        readingOrder: ids,
      }),
    ).toThrow();
    const many = Array.from({ length: 101 }, () => randomUUID());
    expect(() =>
      decodePublishedForest({
        format: 1,
        articles: many.map((id) => ({ id, parentId: null })),
        readingOrder: many,
      }),
    ).toThrow();
  });
  it("validates retained version provenance and copies its contribution identities", () => {
    const input = {
        format: 1,
        reviewId: review,
        contributionIds: [contribution],
      },
      output = decodeArticleVersionProvenance(input, review);
    input.contributionIds.push(randomUUID());
    expect(output.contributionIds).toEqual([contribution]);
  });
  it.each([
    {},
    null,
    { format: 2, reviewId: review, contributionIds: [contribution] },
    { format: 1, reviewId: review, contributionIds: [] },
    {
      format: 1,
      reviewId: review,
      contributionIds: [contribution, contribution],
    },
    { format: 1, reviewId: randomUUID(), contributionIds: [contribution] },
    { format: 1, reviewId: review, contributionIds: ["bad"] },
    {
      format: 1,
      reviewId: review,
      contributionIds: [contribution],
      future: true,
    },
  ])("preserves unsupported provenance without accepting it %p", (value) =>
    expect(() => decodeArticleVersionProvenance(value, review)).toThrow(),
  );
});
