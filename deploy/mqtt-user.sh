#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <username> [password]" >&2
  exit 2
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/deploy/compose-lib.sh"
secret_dir="$repo_dir/infrastructure/mosquitto/secrets"
password_file="$secret_dir/passwd"
username="$1"
password="${2:-}"

if [[ -z "$password" ]]; then
  password="$(openssl rand -base64 32 | tr -d '\n')"
fi

mkdir -p "$secret_dir"
touch "$password_file"

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$secret_dir:/mosquitto/config" \
  eclipse-mosquitto:2.0.22 \
  mosquitto_passwd -b /mosquitto/config/passwd "$username" "$password"

# Mosquitto runs as uid 1883 inside the container and must read this file.
# It only holds salted hashes, so world-readable is acceptable on a single-user host.
chmod 644 "$password_file"

build_compose_command "$repo_dir"
if "${COMPOSE_CMD[@]}" ps --status running --services 2>/dev/null | grep -qx mqtt; then
  "${COMPOSE_CMD[@]}" kill -s HUP mqtt >/dev/null
fi

printf 'MQTT user: %s\nMQTT password (shown once): %s\n' "$username" "$password"
