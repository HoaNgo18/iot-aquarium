#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/deploy/compose-lib.sh"
build_compose_command "$repo_dir"
backup_dir="${BACKUP_DIR:-$repo_dir/backups}"
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$backup_dir/aquasense-$timestamp.sql.gz"
"${COMPOSE_CMD[@]}" exec -T db sh -ec \
  'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-owner --no-acl' \
  | gzip -9 > "$output"

mapfile -t old_backups < <(find "$backup_dir" -maxdepth 1 -type f -name '*.sql.gz' -printf '%T@ %p\n' | sort -nr | tail -n +8 | cut -d' ' -f2-)
if (( ${#old_backups[@]} )); then
  rm -- "${old_backups[@]}"
fi

echo "Backup created: $output"
