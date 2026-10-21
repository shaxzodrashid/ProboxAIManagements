# Current authority at project mutation admission — 20 October 2026

This corrects an existing authorization race without adding capabilities or
changing production grants. The reproduced HTTP request authenticated with
projects.files.write, paused before admission, then lost that persisted grant
under the workspace lock. The previous service still returned201 and created a
folder. The corrected service rejects it with403 before issuing filesystem work.

## Admission contract

All20 methods using ActiveProjectMutation now declare the same existing capability
required by their controller: project metadata update, membership management,
file/folder writes, protected extension/deletion/restore operations, project
deletion actions, and initialization retry/cancel. No new permission key, default
grant, administrator override or API endpoint is introduced.

After resolving the project workspace, the shared fence acquires the existing
Workspace lock and reloads the current OPEN account, effective permission union
and roles. It checks the required capability and current owner/member/manage-all
scope before persisting the lifecycle execution fence. The callback receives this
fresh actor instead of the earlier guard snapshot. Revoked manage-all is not
retained; newly current grants are also passed correctly into existing helpers.
Role labels do not substitute for permission keys or resource scope.

Revocation, banning or membership removal that wins admission prevents the
mutation. The existing scheduled cleanup callback is actorless and retains its
server-owned path; an actor-bearing caller without an explicit required
capability fails closed. Lifecycle checks and durable unfinished-execution fences
remain in place. Admission releases its database connection before filesystem
work, preserving the existing transaction/unknown-outcome behavior.

This is an admission guarantee, not cancellation of an already admitted callback
or OS isolation. A later revocation does not prove a running filesystem await or
descendant process has stopped. External-writer exclusion, atomic identity-bound
no-overwrite publication, restore/expiry journaling and uncertain-executor
termination remain separate FILE03 requirements. No storage policy is selected.

## Validation scope

The real HTTP race fixture covers revoked write grants, a newly banned account,
revoked manage-all for a nonmember, current membership removal, fresh grants
reaching the callback and unchanged authorized folder creation. File paths and
accounts are synthetic and confined to an owned temporary project directory.

Existing filesystem, archive, deletion-journal and initialization regressions are
included. Positive unit/deletion fixtures now establish real persisted test grants
rather than relying only on caller-supplied permission arrays. The current
verification report records focused and full-suite results separately. This patch
adds no database migration and makes no production or live security-setting change.

## Files

- `src/projects/project-lifecycle-lock.ts`
- `src/projects/projects.service.ts`
- `src/projects/project-initialization.service.ts`
- `test/project-mutation-authority.http.spec.ts`
- `test/projects.service.spec.ts`
- `test/file-deletion-journal.persistence.spec.ts`
