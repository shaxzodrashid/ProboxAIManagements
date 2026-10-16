# Approved priority, active-account and bio contracts — October 14

## Human task priority: TASK03/04 subset

The owner approved Urgent / High / Medium / Low, legacy unset values and owner-only
editing with the existing relevant permission. PATCH
`/api/v1/projects/:projectId/tasks/:taskId/details` adds optional nullable `priority`:
`URGENT`, `HIGH`, `MEDIUM`, `LOW`. Omission retains; null clears. No `NORMAL` alias,
case coercion, inferred priority or automatic default. Unknown/invalid values and
mass-assigned fields are rejected. Priority-only updates are valid; title and
description remain optional with their established limits.

Fresh OPEN actor, same workspace, current project membership, persisted task
creator ownership and `tasks.details.manage` are all required. Assignment, role
labels, execution manager and read-all/manage-all do not bypass ownership. The
same quoted human `If-Match`, request UUID, workspace lock, shared revision,
immutable before/after audit and frozen retry outcome apply. New archived/deleting
project writes are rejected; saved outcomes remain available under existing fresh
authority. A failure rolls priority, detail edits, revision and audit back together.

Priority belongs to `TaskHumanState`, not runner `Task.status` or session state.
Priority-only edits do not change any execution Task scalar. Current human detail
and list responses add nullable `priority`. Missing state/priority projects null.
Old immutable outcomes retain their original shapes; clients must tolerate an
absent priority field there. Legacy `/tasks` response shapes and creation input
remain unchanged. Link then edit through the human API to set a priority.

The compatibility human list orders priority Urgent, High, Medium, Low, unset;
then `createdAt DESC`, `id DESC`. It remains a project-member-only, unpaginated
array. The creation tie-breaker makes equal timestamps deterministic. This closes
priority persistence/editing and highest-first list ordering only: TASK03/04 remain
partial. Bounded queries, search/filter, configurable multiple sort keys, pagination,
scoped counts and three-view integration remain open; no complete count or frozen
list snapshot is claimed. Avatar projections remain API03-dependent.

Migration `20261014010000_human_task_priority` transactionally adds PostgreSQL
`TaskPriority` in the approved order and one nullable `TaskHumanState.priority`
column. No backfill, new role grants, legacy Task scalar change or history rewrite.
Apply after the preceding 26 migrations. Upgrade fixtures compared existing
human revisions/state, whole Task rows, checklist rows, audits and grants before
and after; all remained unchanged, and all legacy priorities stayed null.
Prisma schema validation and isolated schema parity passed. The source permission
catalogue description now includes priority; deployment/bootstrap metadata refresh
must preserve existing explicit grants. No live migration or settings change.

## Active accounts: PROJECT01 eligibility subset

The repository has `UserStatus` PENDING / OPEN / BANNED / DELETED. OPEN is the
registered active authenticated-account state used by guards and staff workflows;
there is no separate employment-status or authenticated-agent classification. The
approved active-account rule uses OPEN and does not invent an HR lifecycle.

New human task assignees already require same-workspace OPEN project members.
New checklist assignees additionally must belong to that task's human assignee
set. Those checks remain unchanged. Retained inactive assignments exist only for
explicit handoff and never restore action authority or erase past completion.

POST `/projects/:id/members` now admits a new membership only for a same-workspace
OPEN account. Existing inactive memberships return unchanged until explicitly
removed; a retry cannot reactivate the account. Missing/foreign/ineligible new
targets return the same 404. Existing membership-management permission/member or
manage-all scope, workspace locking and archive gates remain. No automatic cleanup,
role change, attribution removal or membership migration is performed. This
closes eligibility enforcement, not PROJECT01's bounded permitted member picker.

## Approved bio: API11 contract verification

The existing self profile DTO/storage/viewer policy matches the newly approved
contract: plain text up to 1,000 characters, private until the owner explicitly
chooses an audience. Omission retains, null clears, empty string is retained.
Markup-looking characters remain literal text; clients must render as text rather
than execute HTML. Private owner reads use `/users/me`; viewer/public projections
apply the chosen audience, including for requests identifying the owner as viewer.
No audience is silently published by writing bio. Explicit previously selected
audiences remain intact. No runtime profile implementation change was needed.

New HTTP/database verification checks exact 1,000-character round-trip, self read,
anonymous/other-viewer private defaults, 1,001-character rejection without storage
change, explicit Everyone publication and null clearing. Existing privacy tests
cover Contacts/Custom/Noone, workspace changes, revocation and transactional policy
updates. API02 and other profile umbrellas retain their separate unfinished avatar,
status and birthday dependencies; the parent owns checklist status.

## Verification and files

Independent read-only review found no actionable issues. Final verification passed
**785 tests in 49 suites**, including **127 focused tests in three suites** and
18 new priority/eligibility/bio cases. TypeScript, ESLint, Prettier, Nest build,
Prisma validation/schema parity and git diff checks passed. The first combined
focused run identified an incorrect test expectation using the public projection
for private self data; it was corrected to `/users/me`, and the bio suite and full
regression then passed. No runtime privacy behavior was changed for that correction.
Tests use only isolated localhost PostgreSQL, fake provider/worker integrations and
fixture-owned records. The cluster was stopped and preserved after verification.
The existing staged patch fingerprint remained unchanged.

Exact files changed in this increment:

- `prisma/schema.prisma`
- `prisma/migrations/20261014010000_human_task_priority/migration.sql`
- `src/authorization/permission.catalog.ts`
- `src/tasks/human-task-state.ts`
- `src/tasks/human-task-actions.service.ts`
- `src/tasks/human-task-actions.controller.ts`
- `src/tasks/human-tasks.service.ts`
- `src/tasks/human-tasks.controller.ts`
- `src/tasks/human-tasks.dto.ts`
- `src/projects/projects.service.ts`
- `src/projects/projects.controller.ts`
- `test/human-task-actions.http.spec.ts`
- `test/project-archive-human-tasks.http.spec.ts`
- `test/profile-privacy.http.spec.ts`
- `test/fixtures/task-priority-upgrade-before.sql`
- `test/fixtures/task-priority-upgrade-after.sql`
- `Docs/task-priority-active-bio-contracts.md`
- `README.md`

Staged and other unfinished work are preserved; this increment is unstaged. No
commit, push, deployment or production migration. Reaction cardinality is now
approved as multiple distinct emoji per account/message, at most one of each,
with independent removal of own emoji. Conversation invitation/history policy and
authenticated-agent/access foundations remain pending; no reaction foundation or
grant is invented here.
