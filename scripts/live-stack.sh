#!/usr/bin/env bash
# scripts/live-stack.sh — one script to bring up (and tear down) every
# always-on service Level 1 of docs/WALKTHROUGH.md needs, instead of
# starting Speculos and the Broker by hand in separate terminals.
#
# This only manages the two long-running dependencies (Speculos, Broker).
# It deliberately does NOT run `pnpm e2e:live` or the TUI dashboard itself —
# those are the thing you actually record, run as many times as you want
# against the same up-once infra, and are unaffected by this script (see
# apps/tui-dashboard/README.md for why the dashboard is independent of
# everything it watches).
#
# Usage:
#   scripts/live-stack.sh up [--auto-approve]
#   scripts/live-stack.sh down
#   scripts/live-stack.sh status
#   scripts/live-stack.sh logs <broker|speculos|auto-approve>
#
# --auto-approve starts a poller that clicks through Speculos's "review
# transaction" screens for you (scripts/speculos-auto-approve.mjs) — handy
# for solo rehearsal, but skip it for the actual recording: a human
# pressing the real Ledger approval is part of the demo's own story.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BROKER_DIR="$REPO_ROOT/apps/broker"
BROKER_ENV_FILE="$BROKER_DIR/.env.local"
RUN_DIR="$REPO_ROOT/.live-stack"
LOG_DIR="$RUN_DIR/logs"

BROKER_PID_FILE="$RUN_DIR/broker.pid"
AUTO_APPROVE_PID_FILE="$RUN_DIR/auto-approve.pid"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

# Reads KEY=value out of an .env-style file without sourcing it (so this
# script never executes arbitrary content from a local env file). Prints
# the default if the file or key is missing.
read_env_var() {
  local file="$1" key="$2" default="${3:-}"
  if [[ -f "$file" ]]; then
    local value
    value="$(grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2-)"
    if [[ -n "$value" ]]; then
      echo "$value"
      return
    fi
  fi
  echo "$default"
}

tcp_open() {
  local host="$1" port="$2"
  (exec 3<>"/dev/tcp/${host}/${port}") >/dev/null 2>&1
}

wait_for() {
  local description="$1" timeout_s="$2" check_fn="$3"
  local waited=0
  until "$check_fn"; do
    if (( waited >= timeout_s )); then
      echo "✗ Timed out after ${timeout_s}s waiting for ${description}." >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "✓ ${description} is up (${waited}s)."
}

pid_alive() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

BROKER_PORT="$(read_env_var "$BROKER_ENV_FILE" "PORT" "3000")"
BROKER_HEALTH_URL="http://127.0.0.1:${BROKER_PORT}/health"
LEDGER_SIGNING_ENABLED="$(read_env_var "$BROKER_ENV_FILE" "LEDGER_SIGNING_ENABLED" "true")"
LEDGER_TRANSPORT="$(read_env_var "$BROKER_ENV_FILE" "LEDGER_TRANSPORT" "speculos")"
SPECULOS_HOST="$(read_env_var "$BROKER_ENV_FILE" "LEDGER_SPECULOS_HOST" "127.0.0.1")"
SPECULOS_PORT="$(read_env_var "$BROKER_ENV_FILE" "LEDGER_SPECULOS_PORT" "9999")"
SPECULOS_API_PORT="$(read_env_var "$BROKER_ENV_FILE" "LEDGER_SPECULOS_API_PORT" "5000")"
SPECULOS_MANAGED=false
if [[ "$LEDGER_SIGNING_ENABLED" == "true" && "$LEDGER_TRANSPORT" == "speculos" ]]; then
  SPECULOS_MANAGED=true
fi

speculos_reachable() {
  tcp_open "$SPECULOS_HOST" "$SPECULOS_PORT" && tcp_open "$SPECULOS_HOST" "$SPECULOS_API_PORT"
}

broker_reachable() {
  curl -s -m 2 -o /dev/null "$BROKER_HEALTH_URL"
}

# ---------------------------------------------------------------------------
# up
# ---------------------------------------------------------------------------

cmd_up() {
  local auto_approve=false
  for arg in "$@"; do
    [[ "$arg" == "--auto-approve" ]] && auto_approve=true
  done

  if [[ ! -f "$BROKER_ENV_FILE" ]]; then
    echo "✗ $BROKER_ENV_FILE does not exist yet." >&2
    echo "  cp apps/broker/.env.example apps/broker/.env.local, fill in Hedera/HCS credentials, then retry." >&2
    exit 1
  fi

  mkdir -p "$LOG_DIR"

  # --- Speculos ---
  if [[ "$SPECULOS_MANAGED" == "true" ]]; then
    if speculos_reachable; then
      echo "✓ Speculos already reachable at ${SPECULOS_HOST}:${SPECULOS_PORT} — leaving it as-is."
    else
      if ! command -v docker >/dev/null 2>&1; then
        echo "✗ Docker is required to start Speculos (LEDGER_SIGNING_ENABLED=true, LEDGER_TRANSPORT=speculos)." >&2
        echo "  Install/start Docker, or set LEDGER_SIGNING_ENABLED=false in apps/broker/.env.local to skip it." >&2
        exit 1
      fi
      echo "Starting Speculos..."
      bash "$REPO_ROOT/packages/ledger-signer/speculos/start.sh" --detach
      wait_for "Speculos" 30 speculos_reachable
    fi
  else
    echo "– Ledger signing disabled or non-Speculos transport (LEDGER_SIGNING_ENABLED=${LEDGER_SIGNING_ENABLED}, LEDGER_TRANSPORT=${LEDGER_TRANSPORT}) — skipping Speculos."
  fi

  # --- Broker ---
  if pid_alive "$BROKER_PID_FILE"; then
    echo "✓ Broker already running (pid $(cat "$BROKER_PID_FILE"), managed by this script)."
  elif broker_reachable; then
    echo "✓ Broker already reachable at ${BROKER_HEALTH_URL} (started outside this script — leaving it alone, 'down' won't stop it)."
  else
    echo "Starting Broker (dev:live)..."
    (
      cd "$BROKER_DIR"
      nohup node --env-file=.env.local --import tsx/esm src/index.ts >"$LOG_DIR/broker.log" 2>&1 &
      echo $! >"$BROKER_PID_FILE"
    )
    wait_for "Broker" 30 broker_reachable
  fi

  # --- Seed ---
  echo "Seeding task/registry entry (idempotent)..."
  (cd "$BROKER_DIR" && node --env-file=.env.local --import tsx/esm scripts/seed-live-agent-run.ts)

  # --- optional auto-approve ---
  if [[ "$auto_approve" == "true" ]]; then
    if [[ "$SPECULOS_MANAGED" != "true" ]]; then
      echo "– --auto-approve requested but Speculos isn't in use — ignoring."
    elif pid_alive "$AUTO_APPROVE_PID_FILE"; then
      echo "✓ Speculos auto-approve poller already running (pid $(cat "$AUTO_APPROVE_PID_FILE"))."
    else
      echo "Starting Speculos auto-approve poller (rehearsal only — see this script's top comment)..."
      LEDGER_SPECULOS_HOST="$SPECULOS_HOST" LEDGER_SPECULOS_API_PORT="$SPECULOS_API_PORT" \
        nohup node "$REPO_ROOT/scripts/speculos-auto-approve.mjs" >"$LOG_DIR/auto-approve.log" 2>&1 &
      echo $! >"$AUTO_APPROVE_PID_FILE"
    fi
  fi

  cat <<EOF

Live stack is up.
  Broker:   ${BROKER_HEALTH_URL}
  Speculos: ${SPECULOS_MANAGED} (${SPECULOS_HOST}:${SPECULOS_PORT}, API :${SPECULOS_API_PORT})
  Logs:     ${LOG_DIR}

Next, from a separate terminal, run the thing you actually want to record/verify — as many times as you like:
  pnpm e2e:live                              # plain terminal output
  pnpm --filter tui-dashboard dev            # the live TUI dashboard

Tear down when done:
  scripts/live-stack.sh down
EOF
}

# ---------------------------------------------------------------------------
# down
# ---------------------------------------------------------------------------

cmd_down() {
  if pid_alive "$AUTO_APPROVE_PID_FILE"; then
    echo "Stopping Speculos auto-approve poller (pid $(cat "$AUTO_APPROVE_PID_FILE"))..."
    kill "$(cat "$AUTO_APPROVE_PID_FILE")" 2>/dev/null || true
  fi
  rm -f "$AUTO_APPROVE_PID_FILE"

  if pid_alive "$BROKER_PID_FILE"; then
    echo "Stopping Broker (pid $(cat "$BROKER_PID_FILE"))..."
    kill "$(cat "$BROKER_PID_FILE")" 2>/dev/null || true
  else
    echo "– Broker isn't running under this script's management (nothing to stop here)."
  fi
  rm -f "$BROKER_PID_FILE"

  if [[ "$SPECULOS_MANAGED" == "true" ]]; then
    bash "$REPO_ROOT/packages/ledger-signer/speculos/stop.sh"
  fi

  echo "Live stack is down."
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

cmd_status() {
  if [[ "$SPECULOS_MANAGED" == "true" ]]; then
    if speculos_reachable; then
      echo "✓ Speculos reachable at ${SPECULOS_HOST}:${SPECULOS_PORT}"
    else
      echo "✗ Speculos not reachable"
    fi
  else
    echo "– Speculos not in use (LEDGER_SIGNING_ENABLED=${LEDGER_SIGNING_ENABLED}, LEDGER_TRANSPORT=${LEDGER_TRANSPORT})"
  fi

  if broker_reachable; then
    if pid_alive "$BROKER_PID_FILE"; then
      echo "✓ Broker reachable at ${BROKER_HEALTH_URL} (pid $(cat "$BROKER_PID_FILE"), managed by this script)"
    else
      echo "✓ Broker reachable at ${BROKER_HEALTH_URL} (not managed by this script)"
    fi
  else
    echo "✗ Broker not reachable"
  fi

  if pid_alive "$AUTO_APPROVE_PID_FILE"; then
    echo "✓ Speculos auto-approve poller running (pid $(cat "$AUTO_APPROVE_PID_FILE"))"
  else
    echo "– Speculos auto-approve poller not running"
  fi
}

# ---------------------------------------------------------------------------
# logs
# ---------------------------------------------------------------------------

cmd_logs() {
  local service="${1:-}"
  case "$service" in
    broker) tail -f "$LOG_DIR/broker.log" ;;
    auto-approve) tail -f "$LOG_DIR/auto-approve.log" ;;
    speculos) docker logs -f paybound-speculos ;;
    *)
      echo "Usage: scripts/live-stack.sh logs <broker|speculos|auto-approve>" >&2
      exit 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  *)
    echo "Usage: scripts/live-stack.sh <up [--auto-approve]|down|status|logs <service>>" >&2
    exit 1
    ;;
esac
