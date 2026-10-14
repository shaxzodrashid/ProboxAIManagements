# Bounded human task query and API11 evidence — October 14

Subsequent approved [exact deadline sorting](exact-deadline-sort-contracts.md)
adds `deadline` / `-deadline` with TIMED-first pinned-instant ordering, then DATE,
unset last. References below to that comparator as pending describe the earlier
checkpoint; existing `deadlineDate` semantics remain unchanged.

## TASK03 project-scoped query

GET `/api/v1/projects/:projectId/tasks/query` adds a separate bounded response.
The existing `/projects/:projectId/tasks` array and single-task routes remain
compatible. Current OPEN account, same workspace and current project membership
are checked in the same RepeatableRead transaction as data and counts. No task
read/assignment grant is needed; role labels, public project access, execution
manager, read-all and manage-all do not substitute for membership. Archived
projects remain readable. No runner, provider, file operation or mutation starts.

Query fields are allowlisted:

| Field        | Contract                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`          | Trimmed literal case-insensitive title/description substring, 1–200 characters; no wildcards, comments or execution content                                                |
| `priorities` | Comma-separated/repeated unique set of URGENT, HIGH, MEDIUM, LOW, UNSET; omit for all                                                                                      |
| `statusIds`  | Comma-separated/repeated unique UUIDv4 set, at most 100; unknown/inaccessible IDs yield no matching rows                                                                   |
| `assigneeId` | Optional human assignee UUIDv4; no account discovery; unknown/inaccessible IDs yield empty scope                                                                           |
| `sort`       | Ordered list of up to three distinct fields: priority, deadlineDate, createdAt; prefix `-` for descending. Default `-priority,-createdAt`. Final ID descending tie-breaker |
| `limit`      | Canonical integer 1–100, default 50                                                                                                                                        |
| `cursor`     | Opaque continuation, at most 2,048 characters; changing page size is allowed                                                                                               |

Priority strength is Urgent > High > Medium > Low; unset is last in either
direction. `deadlineDate` sorts stored calendar date only, with unset last. It
does not convert date-only values to midnight, compare local times across zones,
or claim chronological instant ordering for timed deadlines. An exact time-aware
mixed deadline comparator remains outside this bounded subset. Creation sorting
uses persisted creation time, not lease/update activity. Invalid/duplicate sort
fields or unknown request fields return 400 with no action.

Response: `{items,total,priorityCounts,statusCounts,hasMore,nextCursor,asOf}`.
Items use the existing narrow human task projection, at most 100. `total` and
both grouping summaries use exactly the same filtered authorized scope at the
page's snapshot, including rows beyond the loaded page. All five priority bands
include zero counts. Status summaries expose only referenced status IDs/counts,
not empty columns, labels, colors or board configuration; those retain the board
API's separate read authority. No foreign titles, actor profiles, prompts,
criteria, execution status, sessions, credentials or filesystem paths are exposed.

## Paging, freshness and operational limits

The cursor binds caller, workspace, project, normalized filter sets, search and
ordered sort keys to an observed result-generation fingerprint and row rank.
Identical cursor reads reconcile unchanged pages. New/removed rows, human revisions,
priority/status/task-deadline changes or board/archive changes invalidate continuation
with 409 `HUMAN_TASK_QUERY_CHANGED`; clients refresh from page one and replace the
loaded generation. Do not silently combine generations. Removed anchors also
conflict, rather than silently skip data. Fresh membership/account checks precede
query delivery; revocation returns 404. Cursor input is untrusted and is never
an access credential. Filter/caller/sort mismatch, invalid or future dates and
out-of-range ranks return 400. No retained database snapshot or lifetime permission
is created. `asOf` is the initial observation clock, retained for unchanged-generation
continuation; later reads still reevaluate authorization.

Counts, generation computation and ranking scan the filtered set. This is bounded
HTTP output, not constant-cost database work. Generation serialization is capped
at 8 MiB before aggregate materialization; larger scopes return 503
`HUMAN_TASK_QUERY_SCOPE_LIMIT` with guidance to refine filters. The transaction uses
10-second duration / 2-second acquisition budgets and a transaction-local 5-second
statement timeout. Those do not change global database configuration. Other
database failures/timeouts return sanitized 503 without raw SQL or credentials.
These conservative limits protect this initial implementation; index/plan and
larger-scale performance work remain separate, and no throughput guarantee is
claimed. Transport cancellation initiates no work; an issued read may finish.

TASK03 remains partial for time-aware deadline semantics, broader three-view UI
integration and any selected saved views. This endpoint supplies common filters,
multiple sort keys, bounded paging and scoped priority/kanban counts without
changing legacy response shapes or introducing shared-task semantics.

## API11 test-to-acceptance mapping

The owner approved optional plain-text bio up to 1,000 characters, private until
an explicit audience is chosen. No new runtime bio behavior was needed. Evidence
below maps the coordinator's requested backend acceptance criteria to tests.

| Acceptance                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved-content readback                 | `profile-privacy.http.spec.ts`: “round-trips approved 1000-character plain text bio…” saves literal markup-looking text, checks exact saved response, authenticated `/users/me` read and stored value. `self-profile.spec.ts`: “round-trips multiword names… clears bio explicitly” checks read/edit compatibility                                                                       |
| Optional clearing                      | The same privacy HTTP case clears with null, verifies storage null and audience-authorized projection null after Everyone selection. Existing self-profile tests also verify stored null. Omission retains and empty string remains supported by the established DTO/service contract                                                                                                    |
| Private default and unauthorized reads | Privacy HTTP private-default case and 1000-character case hide bio from anonymous/other viewers. `profile-picker.http.spec.ts`: “redacts biography…”, “publishes names… private fields hidden by default”, and “Contacts is unilateral… viewer query input cannot forge identity” exercise shipping public profile endpoints, including Noone and non-OPEN/invalid authenticated viewers |
| Authorized audience behavior           | Privacy HTTP Everyone/Contacts/Custom cases and shipping profile-picker Contacts/Custom cases check directed contacts, explicit account versus current-workspace grants, moves/removal and revocation. Everyone explicitly publishes; no bio write silently publishes an audience                                                                                                        |
| Unauthorized edit rejection            | New privacy HTTP “rejects unauthorized bio edits and forged owner selectors…” verifies missing JWT401, inactive actor401, forged other-owner body400 and unchanged stored owner content. Existing self-profile protected-field cases reject identity/workspace/role selectors; writes derive actor solely from current authentication                                                    |
| Actionable validation                  | 1001-character input returns400 with `bio` and `1000` in the field message; existing saved content remains unchanged. The approved 1000-character value succeeds. Default validation errors retain the field name rather than claiming a save succeeded                                                                                                                                  |
| Safe coherent Save                     | Privacy HTTP “saves staged profile and audiences coherently…” and rollback/failure cases verify allowlisting, atomic field/policy writes and sanitized failure; shipping picker reads fail closed on dependencies                                                                                                                                                                        |

Markup-looking characters remain literal plain text, not HTML. Clients must render
bio as text. No viewer or administrative grant permits self-profile editing on
another account's behalf. API02/other profile umbrellas retain their independent
avatar/status/birthday dependencies. The parent/coordinator owns API11 checkbox
closure; this report provides backend evidence rather than changing Space status.

## Verification and files

Final verification passed **816 tests in 49 suites**, including 31 new query/bio
cases. The corrected focused run passed **185 tests in four suites**; subsequently
added default/max page-size and forged-cursor tests also passed in the final full
run. TypeScript, ESLint, Prettier, Nest build and git diff checks passed. The first
query-focused run exposed a fixture fault-injection restoration bug, corrected
before those passing runs; it was not counted as successful verification.
Independent read-only source/budget/evidence review found no actionable issues and
confirmed API11's resolved backend criteria are covered. The isolated database
cluster was stopped and preserved after verification. The existing staged patch
fingerprint remained unchanged. No migration, grants, employment semantics, member
picker or conversation foundation is introduced by this batch.

Exact changed files:

- `src/tasks/human-task-query.ts`
- `src/tasks/human-task-query.dto.ts`
- `src/tasks/human-tasks.service.ts`
- `src/tasks/human-tasks.controller.ts`
- `src/openapi/api-docs.ts`
- `test/human-task-actions.http.spec.ts`
- `test/profile-privacy.http.spec.ts`
- `Docs/human-task-query-bio-evidence.md`
- `README.md`

Earlier staged/unstaged work is preserved. This batch remains unstaged; no commit,
push, deployment, production migration or live security changes. All database
verification uses isolated localhost PostgreSQL and fake providers/workers.
