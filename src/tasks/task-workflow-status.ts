import { operationError } from "../openapi/operation-errors";
import { boardPalette, BoardColors } from "./task-boards.dto";

/** Match PostgreSQL length(TEXT); valid surrogate pairs count once. */
export function validWorkflowStatusName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 240 &&
    !!value.trim() &&
    Array.from(value).length <= 120
  );
}

/** One allowlisted display projection for boards and authorized human-task reads. */
export function workflowStatusSnapshot(status: {
  id: string;
  name: string;
  color: string;
  position: number;
}) {
  if (
    !validWorkflowStatusName(status.name) ||
    !Number.isInteger(status.position) ||
    status.position < 0 ||
    !BoardColors.includes(status.color as (typeof BoardColors)[number])
  )
    throw operationError(
      503,
      "TASK_BOARD_UNAVAILABLE",
      "Workflow metadata is unavailable",
      "readTaskBoard",
    );
  return {
    id: status.id,
    name: status.name,
    color: status.color,
    position: status.position,
    palette: boardPalette[status.color as keyof typeof boardPalette],
  };
}
