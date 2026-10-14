# Backend contract review and dev checkpoint

Reviewed cumulative tracked, staged and later unstaged backend-gap scope against
the source, local contract reports and current Space checklist. The original191
staged files belong to the same documented backend-gap effort; later changes extend
the same contracts. No unrelated changed/untracked files were found in the staged
source/test/schema/documentation inventory. Existing main and other local worktrees
were retained; the new dev branch starts at the clean source baseline
`31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`. Do not delete the preexisting worktree
branches to force a two-name convention. New progress goes only to dev.

## Concrete corrections

- Ordinary project list/detail and templated creation now select only initialization
  identity, status, sequence and public timestamps. Paths, worker leases and raw
  errors are absent, even for public-read nonmembers. Dedicated initialization
  reads remain subject to their separate initialization-read authority.
- Deletion operation UUIDs are case-insensitive identities. New keys are stored
  lowercase; legacy mixed-case records remain readable, and ambiguous legacy
  aliases fail closed instead of silently selecting a record. Completed replay
  cannot delete a replacement file by changing UUID casing. Same-key actor/path
  checks repeat inside the project-row lock, covering concurrent prior misses.
- Permitted project member discovery requires fresh membership-management scope,
  excludes inactive/foreign accounts, and supports literal search, membership
  filters, six validated sort modes, keyset continuation and exact scoped totals.
  Selection does not grant membership; add-member revalidates after discovery.
- Public release metadata follows package semantic version, separately from v1
  routing. A generated Available-since catalog links real bounded contracts to
  immutable release tags and treats unknown legacy provenance explicitly.

## Listing and projection inventory

| Surface                                                         | Verified contract / boundary                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human task query                                                | Literal q; priority/status/assignee filters; ordered sort keys; exact deadline buckets; scoped counts/status/priority summaries; generation-bound cursor; default50/max100; size and time budgets                                                                                                                   |
| Project member candidates                                       | Literal public-name/username q; current membership filter; id/name/username directions; default50/max100; exact eligible total; actor/workspace/project/filter/sort-bound keyset cursor; statement/transaction budgets                                                                                              |
| Profile recipient picker                                        | Own-workspace browsing, outside public-account search, explicit recipient/workspace selection; bounded continuation; owner-private alias; hidden foreign affiliation                                                                                                                                                |
| Assigned session index                                          | Persisted status and optional task filter; bounded pagination and safe task/session projection; every page rechecks current assigned manager and permission; mutable continuation documented                                                                                                                        |
| Initialization recovery events                                  | Ordered bounded stream/readback, cursor/gap/state handling and allowlisted event projections; separate initialization-read authority                                                                                                                                                                                |
| Legacy task and human-task arrays                               | Existing response shape preserved. New bounded human query is the supported scalable board/table path; runner criteria/status/session access remains separate                                                                                                                                                       |
| Legacy projects, users, roles, departments and templates arrays | Existing consumer shapes and authorization retained; no fabricated totals or speculative filters. They remain unpaginated compatibility endpoints; departments support archived inclusion and templates support authorized department/status scope. They are not claimed to provide frozen or fully scalable paging |
| Trash and operation/history arrays                              | Existing authorized recovery projections retained. Deletion operation history currently caps100 without a cursor; Trash/older history arrays remain compatibility limitations, not complete inventory guarantees                                                                                                    |

Review does not imply exhaustive proof or that every legacy list is now paginated.
Consumers requiring scalable legacy directory/history lists need additive bounded
query contracts, preserving existing array callers. No user-directory grant,
workspace-role shortcut, private execution projection or speculative filter is
introduced to satisfy UI shape alone. Counts describe only their documented
authorized scope; cursor possession never substitutes for current authorization.

## Verification process

Configured ESLint detects unused source/test variables, with deliberate underscore
exceptions for framework validation bindings. Unused variables do not by themselves
prove runtime memory leaks. Actual Husky precommit runs lint-staged serially,
release consistency, TypeScript and the full applicable Jest suite. Initial hook
execution found two unused fixture variables; these were removed, not suppressed.
Inspect/restage any hook changes before rerunning. Global lint/build, migration
validation, isolated database verification and independent review supplement hooks.
Runtime test or deployment claims belong to actual recorded results, not DTO compile
success. Production rollout still requires the existing migration/preflight/writer
coordination policy; no production migration, service change or deployment occurs
as part of this dev checkpoint.

Final staged-content verification for `0.2.0-dev.1`: the actual Husky hook passed
serial lint-staged, release metadata consistency, TypeScript and **887 tests across
51 suites**, including the31 project-member picker cases and actual isolated
deletion replacement/concurrency regressions. Global lint (zero warnings) and Nest
build passed. Independent review confirmed all three concrete findings resolved.
The deployment CLI is a separate subsequent checkpoint; no service lifecycle command
or production migration was executed during this release's verification.
