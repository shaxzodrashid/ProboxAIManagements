// Only complete fixed electorates produce a decision. Integers are bounded at100.
export function articleReviewDecision(votes: readonly (boolean | null)[]) {
  if (
    votes.length < 1 ||
    votes.length > 100 ||
    votes.some((vote) => vote === null)
  )
    return "PENDING" as const;
  return votes.filter((vote) => vote === true).length * 5 >= votes.length * 3
    ? ("APPROVED" as const)
    : ("REJECTED" as const);
}
