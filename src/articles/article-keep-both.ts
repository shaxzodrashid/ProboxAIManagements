import {
  ArticleComparison,
  decodeArticleComparison,
  decodePublishedForest,
  PublishedForest,
} from "./article-comparison";
type Edit = { start: number; end: number; lines: string[]; side: 0 | 1 };
const lines = (s: string) => s.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
// Bounded exact line LCS. No normalization or truncation is permitted.
function alignment(a: string[], b: string[]) {
  let prefix = 0,
    aEnd = a.length,
    bEnd = b.length;
  while (prefix < aEnd && prefix < bEnd && a[prefix] === b[prefix]) prefix++;
  while (aEnd > prefix && bEnd > prefix && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const suffixLength = a.length - aEnd;
  const middleA = a.slice(prefix, aEnd),
    middleB = b.slice(prefix, bEnd);
  const leading: [number, number][] = Array.from({ length: prefix }, (_, i) => [
    i,
    i,
  ]);
  a = middleA;
  b = middleB;
  if ((a.length + 1) * (b.length + 1) > 1_000_000)
    throw new Error("TEXT_MERGE_CAPACITY");
  const width = b.length + 1,
    dp = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i * width + j] =
        a[i] === b[j]
          ? 1 + dp[(i + 1) * width + j + 1]!
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i++, j++]);
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) i++;
    else j++;
  }
  return [
    ...leading,
    ...pairs.map(([x, y]) => [x + prefix, y + prefix] as [number, number]),
    ...Array.from(
      { length: suffixLength },
      (_, i) => [aEnd + i, bEnd + i] as [number, number],
    ),
  ];
}
function edits(base: string[], after: string[], side: 0 | 1): Edit[] {
  const result: Edit[] = [];
  let i = 0,
    j = 0;
  for (const [x, y] of [
    ...alignment(base, after),
    [base.length, after.length] as [number, number],
  ]) {
    if (x !== i || y !== j)
      result.push({ start: i, end: x, lines: after.slice(j, y), side });
    i = x + 1;
    j = y + 1;
  }
  return result;
}
function both(a: string[], b: string[]) {
  const result: string[] = [];
  let i = 0,
    j = 0;
  const append = (parts: string[]) => {
    if (!parts.length) return;
    if (result.length && !/[\r\n]$/.test(result[result.length - 1]!))
      result.push("\n");
    result.push(...parts);
  };
  for (const [x, y] of [
    ...alignment(a, b),
    [a.length, b.length] as [number, number],
  ]) {
    append(a.slice(i, x));
    append(b.slice(j, y));
    if (x < a.length) append([a[x]!]);
    i = x + 1;
    j = y + 1;
  }
  return result;
}
export function keepBothText(
  baseText: string,
  leftText: string,
  rightText: string,
) {
  if (leftText === rightText) return leftText;
  if (leftText === baseText) return rightText;
  if (rightText === baseText) return leftText;
  const base = lines(baseText),
    left = edits(base, lines(leftText), 0),
    right = edits(base, lines(rightText), 1),
    all = [...left, ...right].sort(
      (a, b) => a.start - b.start || a.end - b.end || a.side - b.side,
    );
  const result: string[] = [];
  let cursor = 0,
    index = 0;
  while (index < all.length) {
    const group = [all[index++]!];
    const start = group[0]!.start;
    let end = group[0]!.end;
    while (index < all.length) {
      const e = all[index]!;
      const overlaps =
        (e.start < end && e.end > start) ||
        (e.start === e.end && start === end && e.start === start);
      if (!overlaps) break;
      group.push(e);
      end = Math.max(end, e.end);
      index++;
    }
    result.push(...base.slice(cursor, start));
    const render = (side: 0 | 1) => {
      const out: string[] = [];
      let at = start;
      for (const e of group.filter((e) => e.side === side)) {
        out.push(...base.slice(at, e.start), ...e.lines);
        at = e.end;
      }
      out.push(...base.slice(at, end));
      return out;
    };
    const sides = new Set(group.map((e) => e.side));
    result.push(
      ...(sides.size === 1
        ? render(group[0]!.side)
        : both(render(0), render(1))),
    );
    cursor = end;
  }
  result.push(...base.slice(cursor));
  return result.join("");
}
function forestBoth(
  base: PublishedForest,
  a: PublishedForest,
  b: PublishedForest,
): PublishedForest {
  const same = (x: unknown, y: unknown) =>
    JSON.stringify(x) === JSON.stringify(y);
  if (same(a, b)) return a;
  const ids = a.articles.map((n) => n.id);
  if (!same([...ids].sort(), b.articles.map((n) => n.id).sort()))
    throw new Error("INCOMPATIBLE_FOREST");
  const articles = a.articles.map((n) => {
    const other = b.articles.find((v) => v.id === n.id)!,
      prior = base.articles.find((v) => v.id === n.id);
    if (n.parentId === other.parentId) return n;
    if (prior && n.parentId === prior.parentId) return other;
    if (prior && other.parentId === prior.parentId) return n;
    throw new Error("INCOMPATIBLE_PLACEMENT");
  });
  const readingOrder = same(a.readingOrder, b.readingOrder)
    ? a.readingOrder
    : same(a.readingOrder, base.readingOrder)
      ? b.readingOrder
      : same(b.readingOrder, base.readingOrder)
        ? a.readingOrder
        : null;
  if (!readingOrder) throw new Error("INCOMPATIBLE_ORDER");
  return decodePublishedForest({ format: 1, articles, readingOrder });
}
export function keepBothComparison(
  a: ArticleComparison,
  b: ArticleComparison,
  documentId: string,
): ArticleComparison {
  const before = a.before;
  if (JSON.stringify(before) !== JSON.stringify(b.before))
    throw new Error("INCOMPATIBLE_BASE");
  const left = a.after.article!,
    right = b.after.article!;
  return decodeArticleComparison(
    {
      format: 1,
      before,
      after: {
        format: 1,
        article: {
          id: documentId,
          title: keepBothText(
            before.article?.title ?? "",
            left.title,
            right.title,
          ),
          text: keepBothText(before.article?.text ?? "", left.text, right.text),
        },
        forest: forestBoth(before.forest, a.after.forest, b.after.forest),
      },
    },
    documentId,
  );
}
