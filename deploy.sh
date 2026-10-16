#!/usr/bin/env bash
# Linux/systemd operator CLI. Never applies database migrations or seeds.
set -Eeuo pipefail
umask 077

help() {
  cat <<'USAGE'
Usage: ./deploy.sh {help|status|logs|stop|resume|restart|deploy}
  stop      Stop only the backend; keep PostgreSQL/MinIO and releases.
  resume    Start the selected release and verify health; no Git/build/migration.
  restart   Fetch main, prepare/test a release, switch service and verify health.
  deploy    Same update pipeline, including first deployment of a stopped service.
  status    Show service state, selected release and source commit.
  logs      Show the last 100 service journal entries (operator access required).

Required: PROBOX_DEPLOY_STATE (absolute directory outside the source checkout),
          PROBOX_DEPLOY_ENV_FILE (one private absolute environment file), or
          PROBOX_DEPLOY_ENV_FILES (newline-separated files in systemd order).
Optional: PROBOX_DEPLOY_REPO (this script's checkout),
          PROBOX_DEPLOY_SERVICE=proboxai.service, PROBOX_DEPLOY_REMOTE=origin,
          PROBOX_DEPLOY_NODE=/usr/bin/node, PROBOX_DEPLOY_USE_SUDO=0,
          PROBOX_DEPLOY_HEALTH_URL=http://127.0.0.1:3000/api/v1/health/ready,
          PROBOX_DEPLOY_HEALTH_TIMEOUT=120 (seconds; maximum 600).

Run as the systemd service user. Service WorkingDirectory must be STATE/current
and ExecStart must be NODE dist/main.js. Limited passwordless systemctl stop/start
may be used with USE_SUDO=1. See Docs/deployment-cli.md before first use.
Production update source is main only; dirty/divergent repositories and dev
prereleases are rejected. Pending/failed migrations require an explicit operator
procedure outside this CLI. Runtime rollback does not reverse database changes.
USAGE
}
command_name=${1:-help}
[[ $# -le 1 ]] || { help >&2; exit 2; }
case "$command_name" in help|-h|--help) help; exit 0 ;; status|logs|stop|resume|restart|deploy) ;; *) help >&2; exit 2 ;; esac
log() { printf '[proboxai-deploy] %s\n' "$*"; }
die() { log "ERROR: $1" >&2; exit "${2:-1}"; }
require() { command -v "$1" >/dev/null 2>&1 || die "Required command unavailable: $1" 2; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo=${PROBOX_DEPLOY_REPO:-$script_dir}
state=${PROBOX_DEPLOY_STATE:-}
environment_files=${PROBOX_DEPLOY_ENV_FILES:-${PROBOX_DEPLOY_ENV_FILE:-}}
[[ -z "${PROBOX_DEPLOY_ENV_FILES:-}" || -z "${PROBOX_DEPLOY_ENV_FILE:-}" ]] || { printf '%s\n' 'Configure ENV_FILE or ENV_FILES, not both' >&2; exit 2; }
service=${PROBOX_DEPLOY_SERVICE:-proboxai.service}
remote=${PROBOX_DEPLOY_REMOTE:-origin}
node=${PROBOX_DEPLOY_NODE:-/usr/bin/node}
use_sudo=${PROBOX_DEPLOY_USE_SUDO:-0}
health_url=${PROBOX_DEPLOY_HEALTH_URL:-http://127.0.0.1:3000/api/v1/health/ready}
health_timeout=${PROBOX_DEPLOY_HEALTH_TIMEOUT:-120}
[[ "$state" = /* && "$state" != / && -n "$environment_files" && "$node" = /* ]] || die 'Absolute state/environment/node paths are required' 2
[[ "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*\.service$ && "$remote" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die 'Invalid service or Git remote name' 2
[[ "$use_sudo" = 0 || "$use_sudo" = 1 ]] || die 'USE_SUDO must be 0 or 1' 2
[[ "$health_timeout" =~ ^[1-9][0-9]{0,2}$ && "$health_timeout" -le 600 ]] || die 'Health timeout must be 1..600 seconds' 2
[[ "$health_url" =~ ^http://(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})/api/v1/health/ready$ ]] || die 'Health URL must target the loopback backend readiness endpoint' 2
health_port=${BASH_REMATCH[2]}
(( 10#$health_port >= 1 && 10#$health_port <= 65535 )) || die 'Health port must be 1..65535' 2
for tool in git systemctl flock curl tar readlink ln mv stat id pnpm mkdir chmod cat date mktemp rm sleep env bash "$node"; do require "$tool"; done
[[ "$(id -u)" != 0 ]] || die 'Run as the non-root configured service user' 2
node_env_args=()
expected_environment_files=''
while IFS= read -r environment_file || [[ -n "$environment_file" ]]; do
  [[ "$environment_file" = /* && ! "$environment_file" =~ [[:space:]] ]] || die 'Environment paths must be absolute and contain no whitespace' 2
  [[ -r "$environment_file" && -f "$environment_file" ]] || die 'Service environment file is not readable' 2
  env_mode=$(stat -c '%a' -- "$environment_file")
  [[ "$env_mode" =~ ^[0-7]{3,4}$ ]] || die 'Cannot inspect environment file mode' 2
  (( (8#$env_mode & 7) == 0 )) || die 'Environment file must not be accessible to other users' 2
  node_env_args+=("--env-file=$environment_file")
  expected_environment_files+="${expected_environment_files:+ }$environment_file (ignore_errors=no)"
done <<< "$environment_files"
repo=$(cd -- "$repo" && pwd -P)
mkdir -p -- "$state"
state=$(cd -- "$state" && pwd -P)
[[ "$state" != "$repo" && "$state" != "$repo/"* ]] || die 'State/releases must be outside the source checkout' 2
chmod 700 -- "$state"
mkdir -p -- "$state/releases" "$state/logs"
current="$state/current"
[[ ! -e "$current" || -L "$current" ]] || die 'STATE/current must be a release symlink' 2
exec 9>"$state/deploy.lock"
flock -n 9 || die 'Another lifecycle/deployment operation is running' 75
[[ "$(systemctl show --property=WorkingDirectory --value "$service")" = "$current" ]] || die 'Service WorkingDirectory must be STATE/current' 2
[[ "$(systemctl show --property=User --value "$service")" = "$(id -un)" ]] || die 'Run this CLI as the configured service user' 2
configured_environment_files=$(systemctl show --property=EnvironmentFiles --value "$service")
[[ "${configured_environment_files//$'\n'/ }" = "$expected_environment_files" ]] || die 'Service EnvironmentFiles must match the configured files in order' 2
exec_start=$(systemctl show --property=ExecStart --value "$service")
[[ "$exec_start" == *"argv[]=$node dist/main.js ;"* ]] || die 'Service ExecStart must be configured NODE dist/main.js' 2
configured_port=$(env -i PATH="$PATH" HOME="$HOME" "$node" "${node_env_args[@]}" -p 'process.env.NODE_ENV === "production" ? (process.env.PORT ?? "3000") : ""' 2>/dev/null) || die 'Node cannot read the production environment files' 2
[[ "$configured_port" =~ ^[0-9]{1,5}$ ]] && (( 10#$configured_port == 10#$health_port )) || die 'Production NODE_ENV and environment PORT must match the health endpoint' 2
manage() { if [[ "$use_sudo" = 1 ]]; then sudo -n systemctl "$@"; else systemctl "$@"; fi; }
if [[ "$use_sudo" = 1 ]]; then require sudo; fi
selected() {
  [[ -L "$current" ]] || return 1
  local target
  target=$(readlink -f -- "$current")
  [[ "$target" = "$state/releases/"* && -f "$target/dist/main.js" && -f "$target/package.json" && -f "$target/.deployment-commit" && -f "$target/.deployment-openapi-version" ]] || return 1
  printf '%s\n' "$target"
}
version() { "$node" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version' "$1/package.json"; }
health_version() {
  local value
  value=$(cat "$1/.deployment-openapi-version")
  [[ "$value" =~ ^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,127}$ ]] || return 1
  printf '%s\n' "$value"
}
health() {
  local expected=$1 deadline=$((SECONDS + health_timeout))
  while (( SECONDS < deadline )); do
    if systemctl is-active --quiet "$service" &&
      curl --fail --silent --connect-timeout 2 --max-time 3 --max-filesize 1048576 "$health_url" >"$state/logs/health.json" &&
      "$node" -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(v.status==="ok"&&v.service==="proboxai"&&v.dependencies?.postgres==="ok"&&v.dependencies?.minio==="ok"?0:1)' "$state/logs/health.json" 2>/dev/null &&
      curl --fail --silent --connect-timeout 2 --max-time 3 --max-filesize 4194304 "${health_url%/health/ready}/docs-json" >"$state/logs/openapi.json" &&
      "$node" -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(v.info?.version===process.argv[2]?0:1)' "$state/logs/openapi.json" "$expected" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
activate() {
  ln -s -- "$1" "$current.next.$$"
  mv -Tf -- "$current.next.$$" "$current"
}
switched=0
was_running=0
previous=''
finish() {
  local result=$?
  trap - EXIT INT TERM
  if (( result != 0 && switched == 1 )); then
    log 'Candidate failed; stopping it and restoring the previous runtime selection' >&2
    if ! manage stop "$service" || systemctl is-active --quiet "$service"; then
      log 'ERROR: candidate stop could not be confirmed; runtime selection retained, operator intervention required' >&2
    elif [[ -n "$previous" ]]; then
      if activate "$previous"; then
        if (( was_running == 1 )); then
          if manage start "$service" && health "$(health_version "$previous")"; then log 'Previous runtime restored and healthy';
          else log 'ERROR: rollback health failed; operator intervention required' >&2; fi
        else log 'Previous release restored; service remains stopped'; fi
      else log 'ERROR: previous release selection could not be restored' >&2; fi
    else
      rm -f -- "$current"
      log 'No previous release existed; service left stopped and failed candidate retained' >&2
    fi
  fi
  rm -f -- "$current.next.$$"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$command_name" in
  status)
    systemctl is-active "$service" || exit 3
    target=$(selected) || die 'No verified release selection exists' 3
    log "Selected release $(version "$target"), source $(cat "$target/.deployment-commit")"
    ;;
  logs) require journalctl; journalctl --unit "$service" --no-pager --lines 100 ;;
  stop) manage stop "$service"; if systemctl is-active --quiet "$service"; then die 'Backend stop could not be confirmed'; fi; log 'Backend stopped; persistent dependencies and releases retained' ;;
  resume)
    target=$(selected) || die 'No known release to resume; use deploy after operator setup' 2
    manage start "$service"
    if ! health "$(health_version "$target")"; then
      if manage stop "$service" && ! systemctl is-active --quiet "$service"; then die 'Resume health verification failed; backend left stopped';
      else die 'Resume health failed and stop could not be confirmed; operator intervention required'; fi
    fi
    log 'Selected release resumed and healthy; no update or migration performed'
    ;;
  restart|deploy)
    require shellcheck
    [[ "$(git -C "$repo" branch --show-current)" = main ]] || die 'Production source checkout must be main' 2
    [[ -z "$(git -C "$repo" status --porcelain --untracked-files=all)" ]] || die 'Source checkout has local changes; preserve/reconcile them first' 2
    base=$(git -C "$repo" rev-parse HEAD)
    [[ "$base" =~ ^[0-9a-f]{40}$ ]] || die 'Source HEAD is not a commit' 2
    if systemctl is-active --quiet "$service"; then was_running=1; fi
    previous=$(selected || true)
    (( was_running == 0 )) || [[ -n "$previous" ]] || die 'Running service has no known-good selected release; establish baseline first' 2
    operation_log="$state/logs/prepare-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
    log 'Fetching main; the current service remains available during preparation'
    git -C "$repo" fetch --quiet "$remote" "refs/heads/main:refs/remotes/$remote/main" >>"$operation_log" 2>&1 || die "Fetch failed; inspect private log $operation_log"
    revision=$(git -C "$repo" rev-parse "refs/remotes/$remote/main")
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || die 'Remote main does not resolve to a commit' 2
    git -C "$repo" merge-base --is-ancestor "$base" "$revision" || die 'Source checkout diverges from remote main; no reset or force update performed' 2
    candidate=$(mktemp -d "$state/releases/$revision.XXXXXX")
    git -C "$repo" archive "$revision" | tar -xf - -C "$candidate"
    release_version=$(version "$candidate")
    [[ "$release_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die 'Production rejects dev/prerelease versions; select a stable main release first' 2
    printf '%s\n' "$revision" >"$candidate/.deployment-commit"
    printf '%s\n' "$release_version" >"$candidate/.deployment-openapi-version"
    # Do not inherit credentials/provider variables into dependency scripts/tests.
    env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test DATABASE_URL='postgresql://build_only@127.0.0.1:1/build_only' bash -e -c '
      cd -- "$1"
      pnpm install --frozen-lockfile --prod=false
      pnpm prisma:generate
      pnpm release:check -- --artifact
      pnpm deploy:check
      pnpm deploy:test
      pnpm typecheck
      pnpm lint
      pnpm test
      pnpm build
    ' _ "$candidate" >>"$operation_log" 2>&1 || die "Preparation failed; existing service untouched. Inspect private log $operation_log"
    [[ -f "$candidate/dist/main.js" ]] || die 'Build did not produce dist/main.js'
    # Read-only schema readiness. Never applies migrations, resets or bootstrap seeds.
    [[ -f "$candidate/prisma/schema.prisma" && -d "$candidate/prisma/migrations" && -f "$candidate/node_modules/prisma/build/index.js" ]] || die 'Candidate schema, migrations or Prisma CLI is missing'
    (
      cd -- "$candidate"
      env -i PATH="$PATH" HOME="$HOME" "$node" "${node_env_args[@]}" "$candidate/node_modules/prisma/build/index.js" migrate status --schema "$candidate/prisma/schema.prisma"
    ) >>"$operation_log" 2>&1 || die "Database migration status is not ready; use the explicit operator migration policy. Inspect private log $operation_log"
    [[ "$(git -C "$repo" rev-parse HEAD)" = "$base" && -z "$(git -C "$repo" status --porcelain --untracked-files=all)" ]] || die 'Source checkout changed during preparation; service untouched' 2
    git -C "$repo" merge --ff-only "$revision" >>"$operation_log" 2>&1 || die "Fast-forward update failed; service untouched. Inspect private log $operation_log"
    log "Prepared stable release $release_version at $revision; switching backend"
    switched=1
    manage stop "$service"
    if systemctl is-active --quiet "$service"; then die 'Backend stop could not be confirmed before release activation'; fi
    activate "$candidate"
    manage start "$service"
    health "$release_version" || die "New backend failed bounded health/version verification; inspect private log $operation_log"
    switched=0
    printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$release_version" "$revision" >>"$state/deployments.log"
    log "Deployment healthy: $release_version. Previous release retained; database rollback is not implied"
    ;;
esac
