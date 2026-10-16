import {
  validWorkflowStatusName,
  workflowStatusSnapshot,
} from "../src/tasks/task-workflow-status";

describe("shared workflow display projection", () => {
  const status = { id: "status", name: "Review", color: "TEAL", position: 1 };
  it("honors Unicode character boundaries rather than UTF-16 units or grapheme counts", () => {
    for (const name of ["😀".repeat(61), "🧪".repeat(120), "❤️".repeat(60)]) {
      expect(validWorkflowStatusName(name)).toBe(true);
      expect(workflowStatusSnapshot({ ...status, name }).name).toBe(name);
    }
    expect(validWorkflowStatusName("🧪".repeat(121))).toBe(false);
    expect(validWorkflowStatusName("❤️".repeat(61))).toBe(false);
  });
  it("allowlists display fields and derives the existing palette instead of accepting attached metadata", () => {
    const result = workflowStatusSnapshot({
      ...status,
      board: { project: { homePath: "private", members: ["private"] } },
      palette: { foreground: "untrusted", background: "untrusted" },
    } as any);
    expect(result).toEqual({
      ...status,
      palette: { foreground: "#08695f", background: "#d9efeb" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|untrusted|board|members/,
    );
  });
  it.each([
    { color: "url(private)" },
    { name: " " },
    { name: "x".repeat(121) },
    { position: -1 },
    { position: 0.5 },
  ])(
    "fails unavailable for invalid persisted metadata %# without disclosing it",
    (invalid) => {
      try {
        workflowStatusSnapshot({ ...status, ...invalid });
        throw new Error("Expected unavailable workflow metadata");
      } catch (error: any) {
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toMatchObject({
          code: "TASK_BOARD_UNAVAILABLE",
          message: "Workflow metadata is unavailable",
        });
        expect(JSON.stringify(error.getResponse())).not.toContain("private");
      }
    },
  );
});
