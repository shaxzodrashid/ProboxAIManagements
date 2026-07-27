import { runLimited } from "../src/projects/project-initialization.service";

describe("project initialization parallel stages", () => {
  it("honors the configured concurrency barrier", async () => {
    let active = 0;
    let maximum = 0;
    const completed: number[] = [];
    await runLimited([0, 1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed.push(item);
      active -= 1;
    });
    expect(maximum).toBe(2);
    expect(completed).toHaveLength(6);
  });
});
