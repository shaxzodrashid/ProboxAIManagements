import { articleReviewDecision } from "../src/articles/article-review-decision";

describe("complete article electorate with inclusive exact60%", () => {
  it.each(Array.from({ length: 100 }, (_, i) => i + 1))(
    "checks every possible yes count for electorate size%i",
    (total) => {
      for (let yes = 0; yes <= total; yes++) {
        const votes = Array.from({ length: total }, (_, i) => i < yes);
        const minimumYes = Math.ceil((3 * total) / 5);
        expect(articleReviewDecision(votes)).toBe(
          yes >= minimumYes ? "APPROVED" : "REJECTED",
        );
        for (let missing = 0; missing < total; missing++) {
          const pending: (boolean | null)[] = [...votes];
          pending[missing] = null;
          expect(articleReviewDecision(pending)).toBe("PENDING");
        }
      }
    },
  );
  it("cannot decide an empty or oversized electorate", () => {
    expect(articleReviewDecision([])).toBe("PENDING");
    expect(articleReviewDecision(Array(101).fill(true))).toBe("PENDING");
  });
});
