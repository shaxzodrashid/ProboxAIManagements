import { createHash } from "node:crypto";
import { operationError } from "../openapi/operation-errors";

export const CHECKLIST_MAX_DEPTH = 8;
export function checklistSectionId(taskId: string, boardId: string) {
  const hex = createHash("sha256")
    .update(`checklist-section-v1:${taskId}:${boardId}`)
    .digest("hex");
  // Opaque deterministic UUIDv4-shaped identifier; never an authorization token.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
type Item = {
  id: string;
  parentId: string | null;
  sectionBoardId: string | null;
  position: number;
};
const fail = (message: string) =>
  operationError(409, "CHECKLIST_TREE_REJECTED", message, "humanTask");
/** Validate the entire candidate tree before any write, including descendants. */
export function validateChecklistTree(items: Item[], sourceBoardId: string) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const seen = new Set([item.id]);
    let cursor = item;
    let depth = 1;
    while (cursor.parentId) {
      const parent = byId.get(cursor.parentId);
      if (!parent) throw fail("Checklist parent is unavailable");
      if (seen.has(parent.id)) throw fail("Checklist cycles are forbidden");
      if (
        (parent.sectionBoardId ?? sourceBoardId) !==
        (item.sectionBoardId ?? sourceBoardId)
      )
        throw fail("Checklist parent must belong to the same side section");
      seen.add(parent.id);
      if (++depth > CHECKLIST_MAX_DEPTH)
        throw fail(`Checklist depth exceeds ${CHECKLIST_MAX_DEPTH}`);
      cursor = parent;
    }
  }
}
export function checklistSections<T extends Item>(
  taskId: string,
  sourceBoardId: string,
  sharedBoardIds: string[],
  items: T[],
  currentBoardId = sourceBoardId,
) {
  const active = new Set([sourceBoardId, ...sharedBoardIds]);
  const boards = [
    sourceBoardId,
    ...new Set([
      ...sharedBoardIds,
      ...items.map((item) => item.sectionBoardId ?? sourceBoardId),
    ]),
  ].filter((id, i, all) => all.indexOf(id) === i);
  return boards.map((boardId) => {
    const build = (parentId: string | null): unknown[] =>
      items
        .filter(
          (item) =>
            (item.sectionBoardId ?? sourceBoardId) === boardId &&
            item.parentId === parentId,
        )
        .sort((a, b) => a.position - b.position)
        .map(({ sectionBoardId: _privateBoard, ...item }) => ({
          ...item,
          sectionId: checklistSectionId(taskId, boardId),
          children: build(item.id),
        }));
    return {
      id: checklistSectionId(taskId, boardId),
      original: boardId === sourceBoardId,
      currentSide: boardId === currentBoardId,
      active: active.has(boardId),
      items: build(null),
    };
  });
}
