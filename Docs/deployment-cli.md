# Production deployment operator CLI

Available since the tracked **0.2.0-dev.2** checkpoint. Artifact and sandbox
verification only; no production service, deployment, credential or database
migration was used during implementation. This CLI targets the documented
ProboxAI Linux/systemd stack. ProCare's Compose script was read only as a shape
reference; no ProCare configuration, credential, Redis or receiver service is used.

## Commands and results

| Command               | Behavior                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./deploy.sh help`    | Usage and required configuration; no side effects                                                                                                       |
| `./deploy.sh status`  | Current service state and selected package/source commit; exit3 when stopped/unavailable                                                                |
| `./deploy.sh logs`    | Last100 unit journal entries; operator journal permissions required                                                                                     |
| `./deploy.sh stop`    | Stop and confirm only the backend; preserve PostgreSQL, MinIO and releases                                                                              |
| `./deploy.sh resume`  | Start selected immutable release and verify readiness/version; never fetch/build/migrate                                                                |
| `./deploy.sh restart` | Fetch main, build/test candidate before stopping, read-only schema check, ff-only checkout update, switch/start, bounded readiness/version verification |
| `./deploy.sh deploy`  | Same update pipeline; permits initial deployment when the service is stopped                                                                            |

Exit0 means confirmed success;1 is operation/preparation/health failure;2 is invalid
input/configuration or source policy rejection;3 is inactive/unavailable status;
75 is lifecycle lock busy;130/143 are interruption/termination. No bypass/force
operation exists. Dirty/untracked or divergent source is rejected rather than
reset, stashed or erased. Production source must be main and a stable semantic
package version; dev/prereleases are rejected even if found on main.

## One-time operator setup

The existing README unit uses `/opt/proboxai-api` directly. To enable isolated
release preparation and rollback, the operator must explicitly change it to the
release symlink. This script never edits/reloads systemd units or security settings.

Prepare a private state directory outside the clean production source checkout,
owned by the existing service user; keep the existing private environment files and
absolute storage/workspace paths outside release directories. State contains
`current`, `releases/`, `logs/`, `deploy.lock` and `deployments.log`. Releases, logs
and failed candidates are retained; retention/pruning is an explicit operator task.
Do not discard the known-good runtime to reclaim space.

If a current deployment exists, preserve its verified package.json, exact
dependencies and dist artifact under `STATE/releases/baseline`, with
`.deployment-commit` recording its actual verified source SHA. Record its observed
Swagger `info.version` in `.deployment-openapi-version`: older source may use v1,
which is a compatibility label, not package release0.1.0. Do not guess either value.
Create `STATE/current` pointing to this baseline. This requires an explicit
operator-controlled one-time service cutover; do not copy an environment file,
workspace contents, production credentials or arbitrary dirty source into a release.
For a new stopped installation there is no baseline rollback; a failed first start
is stopped, its failed candidate retained and no release selected.

Use the documented unit user/group and environment file, changing only:

```ini
WorkingDirectory=/opt/proboxai-deploy/current
EnvironmentFile=/etc/proboxai/proboxai.env
ExecStart=/usr/bin/node dist/main.js
```

The operator must apply/reload and verify that unit outside this CLI. CLI validates
WorkingDirectory, User, EnvironmentFiles and ExecStart before lifecycle commands.
Run as the configured service user, not root. If unit management requires elevation,
`PROBOX_DEPLOY_USE_SUDO=1` uses noninteractive sudo only for start/stop; the operator
must separately authorize those two exact commands for this unit. No broad sudo or
system settings are installed. Unit journal access is likewise an operator policy.

Example invocation after setup:

```sh
export PROBOX_DEPLOY_REPO=/opt/proboxai-api
export PROBOX_DEPLOY_STATE=/opt/proboxai-deploy
export PROBOX_DEPLOY_ENV_FILE=/etc/proboxai/proboxai.env
export PROBOX_DEPLOY_SERVICE=proboxai.service
export PROBOX_DEPLOY_NODE=/usr/bin/node
export PROBOX_DEPLOY_HEALTH_URL=http://127.0.0.1:3000/api/v1/health/ready
export PROBOX_DEPLOY_USE_SUDO=1
./deploy.sh restart
```

Environment file must be readable by the service user and not accessible to other
users (typically0640 with the existing service group or0600). The CLI parses it
with Node's `--env-file` support, never sources it as shell code or prints secrets.
NODE_ENV must be production and PORT must match the loopback health URL. Health
timeout defaults120seconds, range1..600; port1..65535. No credential/query-bearing
or external health URL is accepted. Readiness must report ProboxAI and both
PostgreSQL/MinIO ok; Swagger info.version must match the selected release's recorded
public version. Curl connection/body/time limits bound retries and response size.

For units with multiple `EnvironmentFile=` entries, set
`PROBOX_DEPLOY_ENV_FILES` instead of `PROBOX_DEPLOY_ENV_FILE`: one absolute path
per line, in exactly the same order as systemd. Paths containing whitespace and
blank entries are rejected. Every file must be readable and private. The CLI checks
the entire ordered list, including required-file semantics, and passes every file
to Node in that order for configuration validation and migration status. Later
files override earlier files. Neither variable contains the file contents; do not
source or merge credential files. Setting both variables is rejected.

See [the app2 setup runbook](deployment-app2.md) for the existing `/srv/proboxai/api`
installation, five environment files and `/usr/local/bin/node`. CLI setup can retain
the existing 0.1.0 runtime; updating to a dev prerelease remains rejected.

Required Linux tools are Bash, Git, systemd, util-linux flock, coreutils, curl,
tar, pnpm and a Node runtime supporting the backend and `--env-file`. Update preparation
and development verification also require ShellCheck. The entire lifecycle command holds one exclusive lock.
Production source/remote selection is operator configuration, not a new integration.

## Preparation, failure and rollback

Git archive extracts a specific remote-main commit to a new immutable candidate.
Frozen-lockfile dependency install, Prisma client generation, release consistency,
deployment syntax/lint/sandbox checks, type/lint/test/build happen there while the existing service runs. Build/test
processes get a scrubbed environment with a deliberately nonconnecting build-only
database URL; production environment/provider variables and isolated-test database
credentials are not passed to dependency scripts or tests. Unit tests run;
integration tests requiring a separate isolated database remain skipped in this
production preparation. They must pass in development/CI before merging main.

Read-only `prisma migrate status` runs from the candidate with its explicit schema
and migrations, using a clean process environment plus the exact ordered service environment
files. Pending/failed/unconfirmed migration state blocks update
before service switch. Source HEAD/dirty state is checked again after preparation;
only a fast-forward to the prepared main commit is allowed. Runtime source checkout
may advance even if subsequent health fails; rollback never resets Git history.

After successful preparation the backend alone is stopped and confirmed inactive,
the release symlink is atomically replaced, and the new unit is started. A failure
restores the previous release and its prior running/stopped state, then verifies
rollback health. An unconfirmed stop prevents pointer changes/restart and requires
operator intervention. Resume health failure attempts a confirmed stop. Failed
health never returns success. Build/fetch/migration failures leave the active release
untouched. Private preparation logs retain diagnostics; readiness bodies/errors and
environment values are not printed. Systemd journal commands are operator-only.

## Database and in-flight work policy

There is **no automatic migration, reset, bootstrap seed, cleanup or SQL history
table creation**. Before a stable main rollout, the operator must review the
committed migration set, back up PostgreSQL, run the documented preflight/duplicate
reconciliation and constraint validation, coordinate every writer/binary cutover,
then explicitly apply approved migrations outside the CLI. Existing NOT VALID
constraints and mixed-writer hazards do not disappear because the script builds.
Stop/maintenance sequencing for an incompatible migration is an operator decision;
resume of an older binary after schema changes requires a compatibility assessment.

Runtime rollback preserves code/dependencies; it cannot reverse schema/data changes
or reconstruct in-flight work. Systemd shutdown can stop coding workers; durable
session/execution recovery remains governed by its existing contracts. Keep storage,
workspace and logs outside immutable releases. No rollback of an external service,
provider invocation or task/session state is promised.

## Local verification

`pnpm deploy:check`: Bash syntax and ShellCheck warning-level lint.
`pnpm deploy:test`: sandbox lifecycle/update/failure/health/configuration scenarios.
All Git/network/systemd/pnpm/migration operations are mocked. On Windows, symlink
creation/rename/canonicalization actuators are mocked around actual NTFS fixture
junctions; real Linux atomic rename and kernel flock behavior remain deployment-host
integration checks. No production service or secret is contacted. Fixture roots are
validated under Temp before recursive cleanup. Independent review and actual
precommit/full backend checks cover the committed checkpoint, without claiming
that production deployment was exercised.
