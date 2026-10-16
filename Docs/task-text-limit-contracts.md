# Task text limit compatibility

Available since **0.3.0-dev.6**; local development checkpoint, not deployed.

TASK04 requires preserving existing task title, description and execution
criteria limits. Existing `POST /tasks` accepts title240, description16000 and
optional criteria8000. Human `PATCH /projects/:projectId/tasks/:taskId/details`
previously narrowed title/description to200/8000, rejecting valid existing tasks
on unchanged saves. It now shares the creation limits through
`src/tasks/task-text-limits.ts`; both DTO/OpenAPI contracts declare240/16000.

All lengths retain the existing class-validator `MaxLength` semantics, including
its Unicode surrogate-pair and variation-selector handling. Direct service
guards call the same `maxLength` validator rather than counting UTF-16 code
units. This preserves existing creation acceptance; it does not introduce a new
grapheme or storage byte limit. Task columns are PostgreSQL text without a new
length constraint. The existing HTTP request-body size cap also applies;
individually valid fields can exceed it when combined.

Human titles still trim outer whitespace and must be nonblank. Descriptions
remain literal strings. Human edits cannot set execution criteria; its existing
creation limit remains8000. Checklist titles retain their independent200 limit.
Current ownership, project membership, permission, workspace isolation,
optimistic revision, audit and request replay checks are unchanged. A successful
unchanged edit follows the existing revision/audit behavior; replay returns the
frozen original outcome without another revision.

Verification in `test/human-task-actions.http.spec.ts` covers real HTTP creation
at the existing maximum, explicit board linking, unchanged edit/read/replay,
ASCII, astral and variation-selector text; oversized HTTP/direct-service edits
leave the task row, revision and audit count unchanged. It also verifies current
criteria isolation, checklist boundaries and OpenAPI declarations. Existing
task/project, creation-recovery and authorization regressions remain required.

No schema change, backfill, data rewrite, production migration or permission
grant is needed. This closes only TASK04's text-limit compatibility subset, not
the entire Task Manager checklist item.
