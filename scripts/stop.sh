#!/usr/bin/env bash
set -euo pipefail

log() { echo "[stop.sh] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

gw_alive() {
    pgrep -f "openclaw-gateway|openclaw gateway" | grep -vw "$$" >/dev/null 2>&1
}

if [ -d "/run/systemd/system/" ]; then
  log "systemd detected, stopping via systemctl..."
  sudo systemctl stop openclaw
  log "systemd stop completed"
  exit 0
fi

PIDS=$(pgrep -f "openclaw-gateway|openclaw gateway" | grep -vw "$$" || true)
if [ -z "$PIDS" ]; then
  log "no openclaw-gateway processes found"
  exit 0
fi

log "sending SIGTERM to $(echo $PIDS | tr '\n' ' ')"
echo "$PIDS" | xargs kill -TERM 2>&1 || true

# Wait up to 10s for graceful shutdown
for i in $(seq 1 50); do
  gw_alive || break
  sleep 0.2
done

if gw_alive; then
  log "WARNING: gateway did not stop within 10s, sending SIGKILL"
  echo "$PIDS" | xargs kill -9 2>&1 || true
  sleep 1
  if gw_alive; then
    log "ERROR: gateway still running after SIGKILL"
    exit 1
  fi
fi

log "openclaw-gateway stopped"