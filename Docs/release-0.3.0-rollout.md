# Stable backend 0.3.0 rollout

This release promotes the code merged in PR #4 to stable package version 0.3.0.
The annotated `v0.3.0` tag identifies the final release commit on main. Git
publication does not establish production deployment. `/api/v1` remains the API
compatibility prefix; OpenAPI `info.version` reads the package version.

## Scope and metadata

The changelog summarizes the development checkpoints and later merged contracts.
The release catalog preserves the introduction versions and scope recorded in the
previous feature availability document. The missing catalog was reconstructed
from that document, with feature IDs based on their contract filenames; historical
machine IDs were not available. New catalog entries use 0.3.0 as their first tracked
release and retain bounded or foundation scope. The JSON file is now explicitly
tracked so release validation cannot silently fall back to version/changelog only
in a fresh checkout.

Browser sessions require the explicit configuration in
[the browser session contract](browser-session-local-implementation.md); version
publication does not enable them. Native directory restore requires the supported
Windows runtime and fixed NTFS volume documented in
[the restore contract](windows-directory-restore-contracts.md). It remains
unsupported on app2's Linux platform. Foundation and inactive delegated-agent
contracts remain incomplete or inactive as documented.

## Database upgrade boundary

There are 21 new migration directories relative to v0.2.2, from
`20261016000000_task_creation_receipts` through
`20261020120000_article_canonical_publication`. They cover task receipts, profile
availability/save/media/lookup, shared tasks, browser sessions, group admission
and messaging, session history/follow-up, file Trash, shared checklist trees and
article draft/review/publication data. Compare the actual production migration
ledger with this release; do not assume the server still runs v0.2.2.

The deployment CLI performs a read-only migration check. It does not apply
migrations or seeds. Pending or failed migrations stop deployment before runtime
cutover. Coordinate writers, take and verify a private database backup, review the
migrations and explicitly apply them from the verified candidate using the
existing operator configuration. Recheck migration status before cutover. Never
use migrate dev, reset or bootstrap seeds in production. Runtime rollback cannot
undo schema or data changes. See the
[operator CLI](deployment-cli.md) and [app2 configuration](deployment-app2.md).

## Operator command

After migration readiness is established, run from app2's root shell:

```bash
runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy restart
```

This fetches main, builds/tests the candidate and checks migration readiness
before switching the runtime. Wait for `Deployment healthy: 0.3.0`. Confirm the
selected release afterward:

```bash
runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy status
```

Independently verify readiness and OpenAPI version 0.3.0 on the actual deployed
endpoint before announcing deployment. Local checks and tag publication do not
prove production readiness or migrated database state.

## Local release verification

The isolated loopback profile_test fixture has all 49 migrations applied and no
Prisma schema difference. The 107-suite regression exercised all 2,090 tests with
zero skips: 106 suites passed, and the article suite exposed one incorrect status
expectation. After correcting that test to match the existing authentication
contract, the complete 35-test article HTTP/persistence suite passed on rerun.
No production code or migration changed to accommodate the test.

The full run used one recycled worker, a 128 MB idle-memory limit, isolated
ts-jest compilation and a 30-second Jest case budget. Strict TypeScript checking
ran separately. Release validation covers 51 bounded contracts; the 33 existing
titles, introduction versions, scope and contract paths were compared with the
previous committed document. Whole-project lint, build, Bash/ShellCheck and all
38 sandbox deployment scenarios passed. These are local results, not production
deployment or live provider verification.
