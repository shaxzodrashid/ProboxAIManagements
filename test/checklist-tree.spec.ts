import { randomUUID } from "node:crypto";
import {
  checklistSectionId,
  checklistSections,
  validateChecklistTree,
} from "../src/tasks/checklist-tree";

describe("canonical checklist structural projection", () => {
  const taskId = randomUUID(),
    source = randomUUID(),
    side = randomUUID();
  const item = (
    id: string,
    parentId: string | null = null,
    sectionBoardId: string | null = null,
    position = 0,
  ) => ({ id, parentId, sectionBoardId, position });
  it("keeps opaque section IDs stable across order and source/destination views", () => {
    const sourceView = checklistSections(taskId, source, [side], []);
    const sideView = checklistSections(taskId, source, [side], [], side);
    expect(sourceView.map((s) => s.id)).toEqual(sideView.map((s) => s.id));
    expect(sourceView.filter((s) => s.currentSide)[0]!.id).toBe(
      checklistSectionId(taskId, source),
    );
    expect(sideView.filter((s) => s.currentSide)[0]!.id).toBe(
      checklistSectionId(taskId, side),
    );
    expect(checklistSectionId(randomUUID(), side)).not.toBe(
      checklistSectionId(taskId, side),
    );
  });
  it("uses relative global positions for sibling order while preserving cross-level identity", () => {
    const rows = [
      item("root", null, null, 2),
      item("later", "root", null, 9),
      item("earlier", "root", null, 1),
    ];
    validateChecklistTree(rows, source);
    const tree = checklistSections(taskId, source, [], rows);
    expect(tree[0]!.items).toMatchObject([
      { id: "root", children: [{ id: "earlier" }, { id: "later" }] },
    ]);
    expect(JSON.stringify(tree)).not.toContain("sectionBoardId");
  });
  it.each([
    ["self", [item("a", "a")]],
    ["two-node cycle", [item("a", "b"), item("b", "a")]],
    ["descendant cycle", [item("a", "c"), item("b", "a"), item("c", "b")]],
    ["missing parent", [item("a", "unknown")]],
    ["cross-side parent", [item("a"), item("b", "a", side)]],
    [
      "deep subtree",
      Array.from({ length: 9 }, (_, index) =>
        item(String(index), index ? String(index - 1) : null),
      ),
    ],
  ])("rejects %s without changing the input", (_label, rows) => {
    const before = JSON.stringify(rows);
    expect(() => validateChecklistTree(rows, source)).toThrow();
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("accepts the depth boundary and retains inactive side sections with content", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      item(String(index), index ? String(index - 1) : null, side, index),
    );
    expect(() => validateChecklistTree(rows, source)).not.toThrow();
    const tree = checklistSections(taskId, source, [], rows);
    expect(tree).toHaveLength(2);
    expect(tree[1]).toMatchObject({
      id: checklistSectionId(taskId, side),
      active: false,
      currentSide: false,
      items: [{ id: "0" }],
    });
  });
});
