#!/usr/bin/env bash
set -euo pipefail

log() { echo "[start.sh] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Check if already running
if pgrep -f "openclaw-gateway|openclaw gateway" > /dev/null 2>&1; then
  log "openclaw-gateway already running (pid=$(pgrep -f 'openclaw-gateway' | head -1))"
  exec "$(dirname "$0")/healthcheck.sh"
  exit 0
fi

log "starting openclaw gateway..."

if [ -d "/run/systemd/system/" ]; then
  sudo systemctl start openclaw
  log "systemd start initiated"
else
  nohup openclaw gateway run --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
  log "gateway process spawned (pid=$!)"
fi

# Wait for port to be listening (up to 15s)
for i in $(seq 1 30); do
  if lsof -nP -iTCP:18789 -sTCP:LISTEN > /dev/null 2>&1; then
    log "gateway port 18789 is listening"
    exec "$(dirname "$0")/healthcheck.sh"
    exit $?
  fi
  sleep 0.5
done

log "WARNING: gateway did not become ready within 15s"
echo "Check /tmp/openclaw-gateway.log for details:"
tail -20 /tmp/openclaw-gateway.log 2>/dev/null || true
exit 1