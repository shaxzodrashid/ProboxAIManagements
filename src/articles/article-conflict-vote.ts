import { ArticleMaterialization } from "./article-materialization";
import { decodeArticleComparison } from "./article-comparison";
export const conflictOptions = [
  "KEEP_BOTH",
  "PUBLISH_A",
  "PUBLISH_B",
  "REJECT_BOTH",
] as const;
export type ConflictOption = (typeof conflictOptions)[number];
// A/B name complete, frozen alternatives, never a per-field mix chosen by a voter.
export function binaryConflictAlternatives(m: ArticleMaterialization) {
  if (!m.conflicts.length)
    return { available: false as const, reason: "NO_CONFLICT" };
  const competing = new Set(
    m.conflicts.flatMap((c) =>
      c.alternatives.flatMap((a) => a.contributionIds),
    ),
  );
  if (
    competing.size !== 2 ||
    m.conflicts.some(
      (c) =>
        c.alternatives.length !== 2 ||
        c.alternatives.some((a) => a.contributionIds.length !== 1),
    )
  )
    return { available: false as const, reason: "MULTIWAY_CONFLICT" };
  const ids = m.contributionIds.filter((id) => competing.has(id));
  try {
    const alternatives = ids.map((id, i) => {
      const fields = { ...m.fields };
      for (const c of m.conflicts) {
        const alternative = c.alternatives.find((a) =>
          a.contributionIds.includes(id),
        );
        if (!alternative) throw new Error("Incompatible alternatives");
        (fields as Record<string, unknown>)[c.field] = alternative.value;
      }
      const comparison = decodeArticleComparison(
        {
          format: 1,
          before: m.before,
          after: {
            format: 1,
            article: {
              id: m.documentId,
              title: fields.title,
              text: fields.text,
            },
            forest: fields.forest,
          },
        },
        m.documentId,
      );
      const expected = new Set([
        ...m.before.forest.articles.map((a) => a.id),
        m.documentId,
      ]);
      if (
        comparison.after.forest.articles.length !== expected.size ||
        comparison.after.forest.articles.some((a) => !expected.has(a.id))
      )
        throw new Error("Incompatible current structure");
      return { label: i === 0 ? "A" : "B", contributionId: id, comparison };
    });
    return { available: true as const, reason: null, alternatives };
  } catch {
    return { available: false as const, reason: "INCOMPATIBLE_STRUCTURE" };
  }
}
export function conflictVoteDecision(
  voterIds: string[],
  ballots: { userId: string; option: string }[],
) {
  if (
    !voterIds.length ||
    voterIds.length > 100 ||
    new Set(voterIds).size !== voterIds.length ||
    new Set(ballots.map((b) => b.userId)).size !== ballots.length ||
    ballots.some(
      (b) =>
        !voterIds.includes(b.userId) ||
        !conflictOptions.includes(b.option as ConflictOption),
    )
  )
    throw new Error("Unsupported conflict electorate or ballots");
  if (ballots.length !== voterIds.length)
    return { state: "PENDING", winner: null } as const;
  const winner =
    conflictOptions.find(
      (option) =>
        ballots.filter((b) => b.option === option).length * 5 >=
        voterIds.length * 3,
    ) ?? null;
  return { state: winner ? "DECIDED" : "NO_WINNER", winner } as const;
}
export function conflictVotingProgress(
  voterIds: string[],
  ballots: { userId: string; option: string; round: number }[],
) {
  if (ballots.some((b) => b.round !== 1 && b.round !== 2))
    throw new Error("Unsupported ballot round");
  const initial = ballots.filter((b) => b.round === 1),
    runoff = ballots.filter((b) => b.round === 2);
  const first = conflictVoteDecision(voterIds, initial);
  if (first.state !== "NO_WINNER") {
    if (runoff.length) throw new Error("Premature runoff ballots");
    return {
      ...first,
      round: 1,
      allowedOptions: [...conflictOptions],
      reason: null,
    };
  }
  const ranked = conflictOptions
    .map((option) => ({
      option,
      count: initial.filter((b) => b.option === option).length,
    }))
    .sort((a, b) => b.count - a.count);
  if (ranked[1]!.count === ranked[2]!.count) {
    if (runoff.length) throw new Error("Ambiguous runoff ballots");
    return {
      state: "FOR_REVISION",
      winner: null,
      round: 1,
      allowedOptions: [] as ConflictOption[],
      reason: "TIED_RUNOFF_CUTOFF",
    };
  }
  const allowedOptions = ranked.slice(0, 2).map((r) => r.option);
  if (runoff.some((b) => !allowedOptions.includes(b.option as ConflictOption)))
    throw new Error("Eliminated runoff option");
  const second = conflictVoteDecision(voterIds, runoff);
  return {
    state:
      second.state === "NO_WINNER"
        ? "FOR_REVISION"
        : second.state === "PENDING"
          ? "RUNOFF_PENDING"
          : "DECIDED",
    winner: second.winner,
    round: 2,
    allowedOptions,
    reason: second.state === "NO_WINNER" ? "RUNOFF_BELOW_THRESHOLD" : null,
  };
}
