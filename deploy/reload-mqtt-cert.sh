#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/deploy/compose-lib.sh"
build_compose_command "$repo_dir"

if [[ ! " ${COMPOSE_CMD[*]} " =~ compose\.vps\.yaml ]]; then
  echo "MQTT certificate sync is only needed in VPS/Caddy mode"
  exit 0
fi

set +e
output="$("${COMPOSE_CMD[@]}" run --rm --no-deps mqtt-cert-sync 2>&1)"
status=$?
set -e

if [[ $status -eq 10 ]]; then
  echo "MQTT certificate unchanged"
  exit 0
fi
if [[ $status -ne 0 ]]; then
  echo "$output" >&2
  exit "$status"
fi

"${COMPOSE_CMD[@]}" kill -s HUP mqtt >/dev/null
echo "MQTT certificate updated; broker reloaded"
