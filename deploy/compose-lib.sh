#!/usr/bin/env bash

# Build COMPOSE_CMD from COMPOSE_FILE/COMPOSE_FILES without sourcing secrets.
build_compose_command() {
  local repo_dir="$1"
  local env_file="$repo_dir/.env.prod"
  local selected="${COMPOSE_FILES:-${COMPOSE_FILE:-}}"

  if [[ -z "$selected" && -f "$env_file" ]]; then
    selected="$(sed -n 's/^[[:space:]]*COMPOSE_FILE[[:space:]]*=[[:space:]]*//p' "$env_file" | tail -n 1 | tr -d '\r')"
  fi
  if [[ -z "$selected" ]]; then
    selected='compose.yaml:compose.prod.yaml:compose.tunnel.yaml'
  fi

  COMPOSE_CMD=(docker compose)
  local file
  local old_ifs="$IFS"
  IFS=':'
  for file in $selected; do
    [[ "$file" = /* ]] || file="$repo_dir/$file"
    COMPOSE_CMD+=(-f "$file")
  done
  IFS="$old_ifs"
  if [[ -f "$env_file" ]]; then
    COMPOSE_CMD+=(--env-file "$env_file")
  fi
}

