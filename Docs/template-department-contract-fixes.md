# TEMPLATE 03 and DEPT 02

Verified the exact Space checklist entries against this checkout before editing.
Both existing-contract fixes are implemented and tested locally on 11 October 2026. The parent owns checklist updates. No new permissions, storage integration
or production migration is introduced.

## TEMPLATE 03

Structured command requests with omitted `arguments` now persist `[]`.
Explicit null, non-array values, non-string elements and arguments longer than
the existing 4096-character limit are rejected before manifest replacement.
Manifest publication and execution use the same argument-shape validation.
Shell commands retain the rule forbidding `executable` and `arguments` inputs;
publication also checks the equivalent persisted definition.

Previous manifests encoded omitted arguments as JSON/SQL null. Persisted
readers deliberately treat that encoding as `[]`: old published definitions
can execute without rewriting immutable records, and copying an old version
into a new draft materializes `[]`. Invalid arrays are not silently repaired.
No data migration is needed for this compatibility treatment.

## DEPT 02

Department PATCH name/homePath validators skip only omitted fields, not null.
The service also rejects null, blank and wrong-type fields before reads,
provisioning or mutation, with a field-specific 400. Omitted values retain
their existing values; empty PATCH remains supported. Existing name/path
constraints and the project-count blocker on home changes remain in place.
This does not address the separate DEPT 03 concurrency task.

## Verification

The complete suite passes **155 tests in 23 suites** with isolated PostgreSQL
enabled. Typecheck, ESLint, production build, changed-file Prettier checks and
`git diff --check` pass. Database tests use only the task-created
`127.0.0.1:55439/profile_test` cluster, which is stopped after verification.
All nine migrations had already been applied to that fresh database; schema
comparison reported no difference. No production service/database was used.

Tests cover request DTOs, pre-mutation invalid-input rejection, existing shell
rejections, publication rejection of invalid persisted arguments, PostgreSQL
save/publish/draft copying, existing department home blockers, and real harmless
`hostname` subprocess execution with `[]` for both newly saved and legacy-null
commands. The execution test invokes the real command runner with step bookkeeping
stubbed; it does not claim a complete project materialization/storage test.

The first account/profile batch passed a separate read-only review. One seed
compatibility issue was fixed: rerunning the bootstrap seed no longer replaces
composed fullName while retaining structured components. A real PostgreSQL
regression verifies structured-name retention and legacy seed behavior. Bio
remains provisional and self-only pending the owner's policy decision.

## Exact file changes in this follow-up

First-batch review correction:

- `prisma/seed.ts`
- `prisma/bootstrap-user.ts` (new)
- `test/self-profile.persistence.spec.ts`
- `Docs/self-profile-contract.md`

TEMPLATE 03 and DEPT 02:

- `src/configuration-templates/command-arguments.ts` (new)
- `src/configuration-templates/configuration-templates.dto.ts`
- `src/configuration-templates/configuration-templates.service.ts`
- `src/projects/project-initialization.service.ts`
- `src/departments/departments.dto.ts`
- `src/departments/departments.service.ts`
- `src/departments/departments.controller.ts`
- `test/template-command-arguments.spec.ts` (new)
- `test/template-command.persistence.spec.ts` (new)
- `test/departments.update.spec.ts` (new)
- `Docs/template-department-contract-fixes.md` (new)

The original account/profile files remain safely uncommitted alongside these
changes. No push, merge, deployment or Space checkbox mutation was performed.
