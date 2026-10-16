# Exact deadline sorting — October 14 approved decision

The owner selected explicit-time deadlines first, then date-only deadlines,
with unset last. This supersedes the pending viewer-timezone/day ordering proposal.
The new `deadline` / `-deadline` query sort keys close the exact-time limitation
without changing the established `deadlineDate` / `-deadlineDate` calendar-only
comparator, default sorting or response shape.

## Comparator and API

Use GET `/api/v1/projects/:projectId/tasks/query?sort=deadline` for ascending values
within buckets, or `sort=-deadline` for descending values. At the position of this
sort key, bucket precedence is always:

1. TIMED — compare the stored pinned instant, including its actual UTC offset.
2. DATE — compare the stored calendar date.
3. Unset — no deadline.

Direction never reverses bucket precedence. Earlier requested sort keys still
take precedence; later requested keys and final `id DESC` break equal-value ties.
For example `-priority,deadline` keeps task priority primary, while
`deadline,-priority` keeps deadline buckets primary. Sorting never changes the
task priority enum or stored priority.

2026-10-13 23:30 New York -04:00 precedes 2026-10-14 09:00 Tashkent +05:00 in
ascending exact order: their pinned instants are 03:30Z and 04:00Z on October 14.
The repeated New York 01:30 hour with -04:00 and -05:00 sorts as distinct 05:30Z
and 06:30Z instants. Midnight and explicitly chosen 00:01 are ordinary TIMED values.
Date-only 1999-01-01 still follows every timed deadline under the approved bucket
rule; it is not given a fictitious instant to interleave with them.

## Preserve semantic date-only values

Existing deadline JSON already has a DATE/TIMED discriminator. DATE keeps
`time`, `timeZone`, `utcOffset`, `instant` null. TIMED keeps the original civil
fields plus a pinned instant. The owner's permission to use 00:01 as a fallback
does not require overwriting this stronger existing semantic contract. No sentinel,
backfill, timezone inference, midnight conversion or historical rewrite is needed.
Real TIMED 00:01 remains distinguishable from DATE. Reads do not write deadline,
revision, attribution, audit or Task records. Existing validation remains unchanged.

## Compatibility, scope and recovery

The separate bounded query retains current OPEN/workspace/project-member checks,
allowlisted filters and ordered keys, default50/max100 pages, snapshot-scoped counts,
resource budgets and generation-bound cursors. Changing deadline type/value changes
the generation and yields explicit409 on continuation. Equal pinned instants in
different zones share an exact-time key; they still have deterministic ties.
Adding these two previously unsupported sort tokens does not invalidate existing
calendar-only cursors, whose comparator is unchanged. Clients must select the new
`deadline` key to request exact ordering. No viewer timezone query parameter is
introduced: instant ordering is independent of display timezone. Display preserves
date-only semantics and may localize TIMED instants under its existing contract.

No migration, authentication change, permission grant, membership picker or
conversation implementation is added. TASK03 still has separate UI/saved-view
dependencies; its known required exact deadline comparator is now implemented.
Parent owns checklist status.

## Verification and exact files

Independent read-only review found no actionable issues. Six new HTTP/database
cases exercise ascending/descending mixed zones, midnight and real00:01, old and
current DATE values, unset last, repeated DST hours/equal instants, priority/calendar
compatibility, paging/type-change conflicts and unchanged stored records. Final
verification passed **822 tests in 49 suites**, including **161 focused tests in
two suites**. TypeScript, ESLint, Prettier, Nest build and git diff checks passed.
Independent review found no runtime issues; a historical database-status sentence
in the conversation audit was corrected. The isolated PostgreSQL cluster was
stopped and preserved after testing. The existing staged patch fingerprint remained
unchanged.

- `src/tasks/human-task-query.ts`
- `src/tasks/human-task-query.dto.ts`
- `src/tasks/human-tasks.controller.ts`
- `test/human-task-actions.http.spec.ts`
- `Docs/exact-deadline-sort-contracts.md`
- `Docs/human-task-query-bio-evidence.md`
- `Docs/conversation-foundation-decisions.md`
- `README.md`

The conversation foundation audit is documentation-only. It records owner-managed
invitation powers and None/last100/last300/All history options, while leaving grant
granularity, creation/admission scope, agent principals and history admission/rejoin
details unapproved. No history default or new agent credential is inferred.

All prior staged/unstaged work is preserved. No staging, commit, push, deployment,
production migration or live security change.
