#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$script_dir/.." && pwd)}"
lock_file="${DEPLOY_LOCK_FILE:-$DEPLOY_DIR/.deploy.lock}"
health_timeout="${DEPLOY_HEALTH_TIMEOUT:-180}"
skip_cloudflared="${DEPLOY_SKIP_CLOUDFLARED_HEALTH:-0}"

cd "$DEPLOY_DIR"
# shellcheck source=deploy/compose-lib.sh
source "$DEPLOY_DIR/deploy/compose-lib.sh"
build_compose_command "$DEPLOY_DIR"

command -v flock >/dev/null 2>&1 || { echo "flock is required (package util-linux)." >&2; exit 1; }
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another deployment is already running: $lock_file" >&2
  exit 75
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy: tracked files contain uncommitted changes." >&2
  exit 2
fi

PREV="$(git rev-parse HEAD)"
rollback_required=0
rollback_in_progress=0

compose_logs() {
  echo "--- Container status at failure ---" >&2
  "${COMPOSE_CMD[@]}" ps --all >&2 || true
  echo "--- Last 100 log lines ---" >&2
  "${COMPOSE_CMD[@]}" logs --tail=100 --no-color >&2 || true
}

rollback() {
  rollback_in_progress=1
  echo "Deployment failed; rolling application files back to $PREV" >&2
  echo "Database migrations are not reversed automatically. Restore the backup created before this deployment if the migration is incompatible." >&2
  git reset --keep "$PREV"
  build_compose_command "$DEPLOY_DIR"
  "${COMPOSE_CMD[@]}" up -d --build --remove-orphans
  echo "Previous application revision is running again: $(git rev-parse HEAD)" >&2
}

on_error() {
  local code=$?
  trap - ERR
  if (( rollback_in_progress == 0 )); then
    compose_logs
    if (( rollback_required == 1 )); then
      rollback || echo "Automatic application rollback also failed; operator action is required." >&2
    fi
  fi
  exit "$code"
}
trap on_error ERR

wait_for_services() {
  local deadline=$((SECONDS + health_timeout))
  local service id state health exit_code all_ready
  mapfile -t services < <("${COMPOSE_CMD[@]}" config --services)
  while (( SECONDS < deadline )); do
    all_ready=1
    for service in "${services[@]}"; do
      if [[ "$service" == "cloudflared" && "$skip_cloudflared" == "1" ]]; then
        continue
      fi
      id="$("${COMPOSE_CMD[@]}" ps -q "$service" 2>/dev/null || true)"
      if [[ -z "$id" ]]; then
        all_ready=0
        continue
      fi
      state="$(docker inspect --format '{{.State.Status}}' "$id")"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")"
      exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$id")"
      if [[ -n "$health" ]]; then
        [[ "$health" == "healthy" ]] || all_ready=0
      elif [[ "$state" == "running" ]]; then
        :
      elif [[ "$state" == "exited" && "$exit_code" == "0" ]]; then
        :
      else
        all_ready=0
      fi
    done
    if (( all_ready == 1 )); then
      return 0
    fi
    sleep 5
  done
  echo "Services did not become healthy within ${health_timeout}s." >&2
  return 1
}

echo "Updating production from $PREV"
git fetch origin main
git merge --ff-only origin/main
rollback_required=1

bash "$DEPLOY_DIR/deploy/backup-db.sh"
"${COMPOSE_CMD[@]}" up -d --build --remove-orphans

# Test hook for the local rollback drill. Never set this in production.
if [[ "${DEPLOY_TEST_FAIL_AFTER_UP:-0}" == "1" ]]; then
  echo "Simulated post-start failure requested." >&2
  false
fi

wait_for_services
"${COMPOSE_CMD[@]}" exec -T frontend wget --quiet --tries=1 --spider http://127.0.0.1/health

rollback_required=0
trap - ERR
docker image prune -f
echo "Deployment successful: $(git rev-parse HEAD)"
