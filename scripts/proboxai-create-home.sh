#!/usr/bin/env bash
set -euo pipefail

allowlist_file="${PROBOXAI_ALLOWED_ROOTS_FILE:-/etc/proboxai/allowed-workspace-roots}"
service_user="${PROBOXAI_SERVICE_USER:-proboxai}"
service_group="${PROBOXAI_SERVICE_GROUP:-proboxai}"
requested="${1:-}"

if [[ -z "$requested" || "$requested" != /* || ! -r "$allowlist_file" ]]; then
  echo "A valid absolute path and readable allowlist are required" >&2
  exit 64
fi

target="$(realpath -m -- "$requested")"
matched_root=""
while IFS= read -r configured_root; do
  [[ -z "$configured_root" || "$configured_root" == \#* ]] && continue
  root="$(realpath -m -- "$configured_root")"
  if [[ "$target" == "$root" || "$target" == "$root/"* ]]; then
    matched_root="$root"
    break
  fi
done < "$allowlist_file"

if [[ -z "$matched_root" ]]; then
  echo "Requested path is outside the root-owned allowlist" >&2
  exit 65
fi

current="/"
IFS='/' read -r -a segments <<< "${target#/}"
for segment in "${segments[@]}"; do
  [[ -z "$segment" ]] && continue
  current="${current%/}/$segment"
  if [[ -L "$current" ]]; then
    echo "Symbolic links are forbidden in department home paths" >&2
    exit 66
  fi
  if [[ -e "$current" && ! -d "$current" ]]; then
    echo "A path component is not a directory" >&2
    exit 67
  fi
  if [[ ! -e "$current" ]]; then
    install -d -o "$service_user" -g "$service_group" -m 0750 -- "$current"
  fi
done

chown "$service_user:$service_group" -- "$target"
chmod 0750 -- "$target"
