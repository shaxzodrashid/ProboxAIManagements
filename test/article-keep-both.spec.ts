import { randomUUID } from "node:crypto";
import {
  keepBothComparison,
  keepBothText,
} from "../src/articles/article-keep-both";
import {
  activePending,
  pendingBatchLimit,
} from "../src/articles/article-pending-batch";
describe("single immutable keep-both result", () => {
  it.each([
    ["", "Intro\nA\nFooter\n", "Intro\nB\nFooter\n", "Intro\nA\nB\nFooter\n"],
    [
      "Intro\nold\nFooter\n",
      "Intro\nA\nFooter\n",
      "Intro\nB\nFooter\n",
      "Intro\nA\nB\nFooter\n",
    ],
    ["X\nY\n", "X1\nY\n", "X\nY1\n", "X1\nY1\n"],
    [
      "one\nmid\ntwo\n",
      "ONE\nmid\ntwo\n",
      "one\nmid\nTWO\n",
      "ONE\nmid\nTWO\n",
    ],
    ["old", "A", "B", "A\nB"],
    [
      "head\r\nold\r\nend",
      "head\r\n👩‍💻\r\nend",
      "head\r\n世界\r\nend",
      "head\r\n👩‍💻\r\n世界\r\nend",
    ],
    ["head\nold\nend\n", "head\nend\n", "head\nnew\nend\n", "head\nnew\nend\n"],
    ["same", "same", "changed", "changed"],
    ["old", "same", "same", "same"],
  ])(
    "preserves exact common content and conflicting chunks %#",
    (base, a, b, expected) => expect(keepBothText(base, a, b)).toBe(expected),
  );
  it("fails closed on unbounded diff work without truncating either source", () => {
    const a = Array.from({ length: 1100 }, (_, i) => `a${i}\n`).join(""),
      b = Array.from({ length: 1100 }, (_, i) => `b${i}\n`).join("");
    expect(() => keepBothText("", a, b)).toThrow("TEXT_MERGE_CAPACITY");
    expect(a).toContain("a1099");
    expect(b).toContain("b1099");
  });
  it("handles long unchanged context without quadratic diff work or repeated content", () => {
    const base = Array.from({ length: 1100 }, (_, i) => `l${i}\n`),
      a = [...base],
      b = [...base],
      expected = [...base];
    a[50] = "A\n";
    b[1050] = "B\n";
    expected[50] = "A\n";
    expected[1050] = "B\n";
    expect(keepBothText(base.join(""), a.join(""), b.join(""))).toBe(
      expected.join(""),
    );
  });
  const doc = randomUUID(),
    p = randomUUID(),
    q = randomUUID();
  const forest = {
    format: 1 as const,
    articles: [
      { id: doc, parentId: null as string | null },
      { id: p, parentId: null as string | null },
      { id: q, parentId: null as string | null },
    ],
    readingOrder: [doc, p, q],
  };
  const before = {
    format: 1 as const,
    article: { id: doc, title: "Title", text: "Intro\nold\nFooter\n" },
    forest,
  };
  const comparison = (text: string) => ({
    format: 1 as const,
    before,
    after: {
      format: 1 as const,
      article: { id: doc, title: "Title", text },
      forest: structuredClone(forest),
    },
  });
  it("creates one exact validated before/after comparison with no labeled duplicate documents", () => {
    const result = keepBothComparison(
      comparison("Intro\nA\nFooter\n"),
      comparison("Intro\nB\nFooter\n"),
      doc,
    );
    expect(result.after.article).toEqual({
      id: doc,
      title: "Title",
      text: "Intro\nA\nB\nFooter\n",
    });
    expect(result.after.forest.articles).toHaveLength(3);
    expect(result.before).toEqual(before);
  });
  it("combines disjoint valid parent edits and preserves the explicitly unchanged order", () => {
    const a = comparison("A"),
      b = comparison("B");
    a.after.forest.articles[0]!.parentId = p;
    b.after.forest.articles[2]!.parentId = p;
    const result = keepBothComparison(a, b, doc);
    expect(result.after.forest.articles[0]!.parentId).toBe(p);
    expect(result.after.forest.articles[2]!.parentId).toBe(p);
  });
  it("rejects incompatible placements and conflicting reading orders instead of choosing one", () => {
    const a = comparison("A"),
      b = comparison("B");
    a.after.forest.articles[0]!.parentId = p;
    b.after.forest.articles[0]!.parentId = q;
    expect(() => keepBothComparison(a, b, doc)).toThrow();
    a.after.forest = structuredClone(forest);
    b.after.forest = structuredClone(forest);
    a.after.forest.readingOrder = [p, doc, q];
    b.after.forest.readingOrder = [q, p, doc];
    expect(() => keepBothComparison(a, b, doc)).toThrow();
  });
  it("rejects oversized combined title/text rather than truncating or selecting one side", () => {
    const a = comparison("A".repeat(6000)),
      b = comparison("B".repeat(6000));
    expect(() => keepBothComparison(a, b, doc)).toThrow();
    a.after.article.text = "A";
    b.after.article.text = "B";
    a.after.article.title = "A".repeat(120);
    b.after.article.title = "B".repeat(120);
    expect(() => keepBothComparison(a, b, doc)).toThrow();
  });
});
describe("pending same-document author/version limits", () => {
  const author = randomUUID(),
    other = randomUUID(),
    third = randomUUID(),
    source = randomUUID();
  const row = (
    authorId = author,
    sourceArticleId = source,
    sourceRevision = 1,
  ) => ({ authorId, contribution: { sourceArticleId, sourceRevision } });
  it("permits two authors and two active versions", () =>
    expect(pendingBatchLimit([row(), row(other, randomUUID())])).toBeNull());
  it("rejects the pending batch at a third distinct author, even if the content might match", () =>
    expect(
      pendingBatchLimit([
        row(),
        row(other, randomUUID()),
        row(third, randomUUID()),
      ]),
    ).toBe("AUTHOR_LIMIT"));
  it("rejects three active versions without inventing pairwise or three-option voting", () =>
    expect(
      pendingBatchLimit([
        row(),
        row(author, randomUUID()),
        row(other, randomUUID()),
      ]),
    ).toBe("VERSION_LIMIT"));
  it("retains history but counts only the latest proven revision of the same private lineage", () => {
    const rows = [row(), row(author, source, 2), row(other, randomUUID())];
    expect(activePending(rows)).toEqual(rows.slice(1));
    expect(pendingBatchLimit(rows)).toBeNull();
    expect(rows).toHaveLength(3);
  });
});
