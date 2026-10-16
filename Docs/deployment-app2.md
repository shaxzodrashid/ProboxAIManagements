# app2 deployment CLI setup

This is an operator runbook, not a record of completed server changes. The observed
unit runs as `proboxai:proboxai`, with `/usr/local/bin/node`, source checkout
`/srv/proboxai/api` and five required environment files in this order:

1. `/etc/proboxai/proboxai.env`
2. `/etc/proboxai/database.env`
3. `/etc/proboxai/minio.env`
4. `/etc/proboxai/anthropic.env`
5. `/etc/proboxai/telegram.env`

Use a separate state root `/srv/proboxai/deploy` and operator CLI directory
`/srv/proboxai/operator`. Do not update/build in the live source checkout before
preserving the current artifact. CLI setup does not require deploying remote main
or changing its version. The observed remote main version `0.2.0-dev.2` is rejected
by `restart`/`deploy` until a stable release is explicitly prepared and published.

## 1. Read-only preflight

Run as root on app2. Share only this output, never environment file contents or
the process environment. `--no-pager` avoids suspending `systemctl` in a pager.

```bash
systemctl --no-pager show proboxai.service \
  -p ActiveState -p MainPID -p User -p Group -p WorkingDirectory \
  -p ExecStart -p EnvironmentFiles -p FragmentPath -p DropInPaths
runuser -u proboxai -- git -C /srv/proboxai/api status --short --branch
runuser -u proboxai -- git -C /srv/proboxai/api rev-parse HEAD
stat -c '%a %U:%G %n' /etc/proboxai/{proboxai,database,minio,anthropic,telegram}.env
runuser -u proboxai -- /usr/local/bin/node --version
runuser -u proboxai -- sh -c 'command -v pnpm; command -v shellcheck; command -v sudo'
ls -ld /srv/proboxai/api/dist /srv/proboxai/api/node_modules
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  http://127.0.0.1:3000/api/v1/health/ready
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  http://127.0.0.1:3000/api/v1/docs-json |
  /usr/local/bin/node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>console.log("OpenAPI version:",JSON.parse(s).info.version))'
```

Confirm every environment file is readable by `proboxai`, has no permissions for
other users, and that Node can read the same ordered files with `--env-file`.
Validate `NODE_ENV=production`, the matching port, and absolute external archive,
upload and workspace paths without printing credentials. The CLI checks production
mode/port on each invocation. An unset archive path defaults relative to the working
directory: resolve that before moving the service; do not abandon existing archives.

Inspect source cleanliness, running process age and artifact timestamps/provenance
before recording a baseline source SHA. A clean Git tree does not prove that an
ignored `dist` artifact was built from HEAD. Record the observed Swagger version;
legacy `v1` is allowed for the baseline and must not be replaced with a guessed
package version. Pause lifecycle changes if active coding work needs to finish.

## 2. Preserve the baseline and original unit

After preflight establishes the actual artifact/source relationship:

- Create `/srv/proboxai/deploy` mode0700, owned by `proboxai:proboxai`.
- Preserve the original unit and existing drop-ins in a root-only backup directory
  outside the checkout. Never dump or copy credential contents into chat.
- Create a new, nonexisting `/srv/proboxai/deploy/releases/baseline-<verified-SHA>`.
  Copy only the verified existing `dist`, `node_modules`, `package.json` and
  `pnpm-lock.yaml` using `cp -a`, retaining pnpm's internal symlinks and generated
  Prisma client. Do not rebuild/reinstall dependencies for this baseline.
- Check that dependency symlinks resolve within the copied release; stop if they
  refer back to the mutable source checkout or an unpreserved external location.
- Write the verified full source SHA to `.deployment-commit` and the actual observed
  Swagger version to `.deployment-openapi-version`. Record artifact checksums in the
  private setup backup. Recheck the original inputs after copying.
- Point `/srv/proboxai/deploy/current` at that baseline. Do not overwrite an existing
  state/current directory or release.

The known-good runtime and dependencies must be preserved before source changes.
PostgreSQL, MinIO, runner installation, workspace storage and all environment files
remain external to releases. No database migration or seed is part of this setup.

## 3. Install the tested CLI and operator configuration

Install the reviewed multi-environment-file `deploy.sh` in
`/srv/proboxai/operator/deploy.sh`, root-owned mode0755. It can be transferred from
the local checkout and independently compared by SHA256 before installation. Keep
it outside the backend source tree so setup need not advance the running checkout.
Do not run the older single-file CLI against this five-file unit.

Create a root-owned mode0644 `/srv/proboxai/operator/config.sh` containing only:

```bash
export PROBOX_DEPLOY_REPO=/srv/proboxai/api
export PROBOX_DEPLOY_STATE=/srv/proboxai/deploy
unset PROBOX_DEPLOY_ENV_FILE
export PROBOX_DEPLOY_ENV_FILES='/etc/proboxai/proboxai.env
/etc/proboxai/database.env
/etc/proboxai/minio.env
/etc/proboxai/anthropic.env
/etc/proboxai/telegram.env'
export PROBOX_DEPLOY_SERVICE=proboxai.service
export PROBOX_DEPLOY_NODE=/usr/local/bin/node
export PROBOX_DEPLOY_HEALTH_URL=http://127.0.0.1:3000/api/v1/health/ready
export PROBOX_DEPLOY_USE_SUDO=1
```

Create root-owned mode0755 `/srv/proboxai/operator/proboxai-deploy`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source /srv/proboxai/operator/config.sh
exec /srv/proboxai/operator/deploy.sh "$@"
```

Using the actual absolute paths returned by `command -v systemctl`, validate a
dedicated sudoers entry with `visudo -cf` before installing it under
`/etc/sudoers.d/` mode0440. Permit only these exact commands for `proboxai`:

```text
proboxai ALL=(root) NOPASSWD: /usr/bin/systemctl start proboxai.service, /usr/bin/systemctl stop proboxai.service
```

Use `/usr/bin/systemctl` only if that is the verified host path. Confirm effective
permissions via `runuser -u proboxai -- sudo -n -l`. Do not grant all systemctl
operations, shell commands or wildcard unit access. `logs` additionally needs the
operator's existing journal access policy.

## 4. Cut over the same runtime

Create a dedicated, previously absent systemd drop-in after backing up the unit:

```ini
[Service]
WorkingDirectory=/srv/proboxai/deploy/current
ExecStart=
ExecStart=/usr/local/bin/node dist/main.js
```

Keep the existing User, Group, all five EnvironmentFile entries, sandbox settings
and other service options intact. Inspect path-dependent `ReadWritePaths`,
`ReadOnlyPaths`, `ProtectSystem`, `InaccessiblePaths`, `RootDirectory` and
`ExecStartPre`/`ExecStartPost` before cutover. Do not change them speculatively.

Run `systemctl daemon-reload`, re-read the resolved settings with `--no-pager`, and
confirm exact working directory, ExecStart and environment-file order. This reload
alone does not restart the existing process. Then run, as root:

```bash
runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy status
runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy stop &&
runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy resume
```

The first status validates configuration and selection, but does not prove the
existing PID already runs from the symlink. After stop/resume succeeds, independently
verify readiness, Swagger baseline version, `systemctl` active state and the new
MainPID's `/proc/<PID>/cwd` resolving to the baseline release. Check public readiness
through the existing hostname as well. A failed resume attempts to leave the backend
stopped; inspect private diagnostics before another lifecycle attempt.

If setup fails, restore/remove only the newly introduced drop-in, restore any
explicitly changed original settings, run daemon-reload and start the untouched
original runtime. Verify readiness and Swagger again. Preserve the baseline, logs
and failed setup evidence; never reset Git or change the database as recovery.

## 5. Future updates

Once the live baseline cutover is verified, attach the clean source checkout to its
existing local main branch only after checking it still equals the verified old
HEAD. Do not fast-forward the source as part of attaching the branch. The CLI will
prepare remote main in a separate release before advancing source with ff-only.

`restart`/`deploy` will still reject the observed `0.2.0-dev.2` on main. Prepare and
publish a deliberate stable release with consistent package/changelog/catalog
metadata, review the migration delta, complete the documented database backup,
preflight/reconciliation and separately approved migration procedure first. Then:

```bash
runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy restart
```

No production update, schema migration, Git publication or release promotion is
claimed by this local runbook or its sandbox tests.
