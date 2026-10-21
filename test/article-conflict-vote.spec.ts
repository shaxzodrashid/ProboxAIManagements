import { randomUUID } from "node:crypto";
import {
  binaryConflictAlternatives,
  conflictOptions,
  conflictVoteDecision,
  conflictVotingProgress,
} from "../src/articles/article-conflict-vote";
import { materializeArticleChanges } from "../src/articles/article-materialization";
describe("four exclusive conflict options with full fixed electorate", () => {
  it("opens exactly one runoff for an unambiguous top-two set including a first-place tie", () => {
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const initial = ids.map((userId, i) => ({
      userId,
      round: 1,
      option: i < 2 ? "PUBLISH_A" : i < 4 ? "PUBLISH_B" : "KEEP_BOTH",
    }));
    expect(conflictVotingProgress(ids, initial)).toMatchObject({
      state: "RUNOFF_PENDING",
      round: 2,
      allowedOptions: ["PUBLISH_A", "PUBLISH_B"],
      winner: null,
    });
    const runoff = ids.map((userId, i) => ({
      userId,
      round: 2,
      option: i < 3 ? "PUBLISH_A" : "PUBLISH_B",
    }));
    expect(
      conflictVotingProgress(ids, [...initial, ...runoff.slice(0, 4)]),
    ).toMatchObject({ state: "RUNOFF_PENDING", winner: null });
    expect(conflictVotingProgress(ids, [...initial, ...runoff])).toMatchObject({
      state: "DECIDED",
      winner: "PUBLISH_A",
      round: 2,
    });
    expect(() =>
      conflictVotingProgress(ids, [
        ...initial,
        { userId: ids[0]!, round: 2, option: "KEEP_BOTH" },
      ]),
    ).toThrow();
  });
  it("returns for revision at a tied second-place cutoff or a completed sub60 runoff", () => {
    const ids = Array.from({ length: 4 }, () => randomUUID());
    const tied = ids.map((userId, i) => ({
      userId,
      round: 1,
      option: conflictOptions[i]!,
    }));
    expect(conflictVotingProgress(ids, tied)).toMatchObject({
      state: "FOR_REVISION",
      reason: "TIED_RUNOFF_CUTOFF",
      round: 1,
    });
    const initial = ids.map((userId, i) => ({
      userId,
      round: 1,
      option: i < 2 ? "PUBLISH_A" : "PUBLISH_B",
    }));
    const runoff = initial.map((b) => ({ ...b, round: 2 }));
    expect(conflictVotingProgress(ids, [...initial, ...runoff])).toMatchObject({
      state: "FOR_REVISION",
      reason: "RUNOFF_BELOW_THRESHOLD",
      round: 2,
      winner: null,
    });
    expect(() =>
      conflictVotingProgress(ids, [
        ...initial,
        { userId: ids[0]!, round: 3, option: "PUBLISH_A" },
      ]),
    ).toThrow();
    expect(() =>
      conflictVotingProgress(ids, [initial[0]!, runoff[0]!]),
    ).toThrow();
  });
  it.each(conflictOptions)(
    "requires all voters and inclusive60%% for %s at every supported electorate size",
    (option) => {
      for (let count = 1; count <= 100; count++) {
        const ids = Array.from({ length: count }, () => randomUUID()),
          threshold = Math.ceil((count * 3) / 5),
          other = conflictOptions.find((o) => o !== option)!;
        const ballots = ids.map((userId, i) => ({
          userId,
          option: i < threshold ? option : other,
        }));
        expect(conflictVoteDecision(ids, ballots)).toEqual({
          state: "DECIDED",
          winner: option,
        });
        if (count > 1)
          expect(conflictVoteDecision(ids, ballots.slice(0, -1))).toEqual({
            state: "PENDING",
            winner: null,
          });
        const below = ids.map((userId, i) => ({
          userId,
          option: i < threshold - 1 ? option : other,
        }));
        expect(conflictVoteDecision(ids, below).winner).not.toBe(option);
      }
    },
  );
  it("records an undecided completed split without plurality, runoff or terminal transition", () => {
    const ids = Array.from({ length: 5 }, () => randomUUID());
    expect(
      conflictVoteDecision(
        ids,
        ids.map((userId, i) => ({ userId, option: conflictOptions[i % 4]! })),
      ),
    ).toEqual({ state: "NO_WINNER", winner: null });
    expect(
      conflictVoteDecision(
        ids,
        ids.slice(0, 4).map((userId) => ({ userId, option: "KEEP_BOTH" })),
      ),
    ).toEqual({ state: "PENDING", winner: null });
  });
  it("rejects unsupported electorates and duplicate, unknown or invalid ballots", () => {
    const a = randomUUID(),
      b = randomUUID();
    for (const [ids, ballots] of [
      [[], []],
      [[a, a], []],
      [[a], [{ userId: b, option: "KEEP_BOTH" }]],
      [[a], [{ userId: a, option: "YES" }]],
      [
        [a, b],
        [
          { userId: a, option: "KEEP_BOTH" },
          { userId: a, option: "KEEP_BOTH" },
        ],
      ],
    ] as [string[], { userId: string; option: string }[]][])
      expect(() => conflictVoteDecision(ids, ballots)).toThrow();
  });
  const documentId = randomUUID(),
    before = {
      format: 1 as const,
      article: null,
      forest: { format: 1 as const, articles: [], readingOrder: [] },
    };
  const change = (sequence: number, text: string, title = "Title") => ({
    id: randomUUID(),
    authorId: randomUUID(),
    sourceArticleId: randomUUID(),
    sourceRevision: 1,
    sequence,
    comparison: {
      format: 1 as const,
      before,
      after: {
        format: 1 as const,
        article: { id: documentId, title, text },
        forest: {
          format: 1 as const,
          articles: [{ id: documentId, parentId: null }],
          readingOrder: [documentId],
        },
      },
    },
  });
  it("derives immutable complete A/B comparisons in accepted submission order without mixing conflicting fields", () => {
    const a = change(1, "A text", "A title"),
      b = change(2, "B text", "B title"),
      m = materializeArticleChanges(documentId, before, [b, a]);
    const result = binaryConflictAlternatives(m);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("Missing alternatives");
    expect(result.alternatives.map((a) => a.comparison.after.article)).toEqual([
      a.comparison.after.article,
      b.comparison.after.article,
    ]);
    expect(result.alternatives.map((a) => a.contributionId)).toEqual([
      a.id,
      b.id,
    ]);
    expect(m.comparison).toBeNull();
  });
  it("keeps three-way conflicts intact rather than arbitrarily selecting A/B", () => {
    const m = materializeArticleChanges(documentId, before, [
      change(1, "A"),
      change(2, "B"),
      change(3, "C"),
    ]);
    expect(binaryConflictAlternatives(m)).toEqual({
      available: false,
      reason: "MULTIWAY_CONFLICT",
    });
    expect(m.conflicts[0]!.alternatives).toHaveLength(3);
  });
  it("does not introduce a four-option conflict ballot for a conflict-free snapshot", () => {
    expect(
      binaryConflictAlternatives(
        materializeArticleChanges(documentId, before, [change(1, "A")]),
      ),
    ).toEqual({ available: false, reason: "NO_CONFLICT" });
  });
});
