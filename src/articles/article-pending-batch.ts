export interface PendingContribution {
  authorId: string;
  contribution: { sourceArticleId: string; sourceRevision: number };
}
export function activePending<T extends PendingContribution>(rows: T[]): T[] {
  const latest = new Map<string, number>();
  for (const r of rows) {
    const key = JSON.stringify([r.authorId, r.contribution.sourceArticleId]);
    latest.set(
      key,
      Math.max(latest.get(key) ?? 0, r.contribution.sourceRevision),
    );
  }
  return rows.filter(
    (r) =>
      r.contribution.sourceRevision ===
      latest.get(JSON.stringify([r.authorId, r.contribution.sourceArticleId])),
  );
}
export function pendingBatchLimit(rows: PendingContribution[]) {
  const active = activePending(rows);
  return new Set(active.map((r) => r.authorId)).size > 2
    ? "AUTHOR_LIMIT"
    : active.length > 2
      ? "VERSION_LIMIT"
      : null;
}
