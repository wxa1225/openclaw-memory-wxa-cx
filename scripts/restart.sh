#!/usr/bin/env bash

log() { echo "[restart.sh] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

gw_alive() {
    pgrep -f "openclaw-gateway|openclaw gateway" | grep -vw "$$" >/dev/null 2>&1
}

if [ -d "/run/systemd/system/" ]; then
    log "systemd detected, restarting via systemctl..."
    sudo systemctl restart openclaw
    log "systemctl restart exit code: $?"
else
    log "stopping openclaw-gateway..."
    PIDS_GW=$(pgrep -f "openclaw-gateway|openclaw gateway" | grep -vw "$$" || true)
    if [ -n "$PIDS_GW" ]; then
        log "sending SIGTERM to $(echo $PIDS_GW | tr '\n' ' ')"
        echo "$PIDS_GW" | xargs kill -TERM 2>&1 || true
    else
        log "no openclaw-gateway processes found"
    fi

    # Wait up to 10s for graceful shutdown
    for i in $(seq 1 50); do
        gw_alive || break
        sleep 0.2
    done

    if gw_alive; then
        log "WARNING: gateway did not stop within 10s, sending SIGKILL"
        echo "$PIDS_GW" | xargs kill -9 2>&1 || true
        sleep 1
    fi

    log "openclaw-gateway stopped"
    log "starting openclaw gateway..."
    nohup openclaw gateway run --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
    log "gateway process spawned"

    # Wait for port to be listening (up to 15s)
    for i in $(seq 1 30); do
        if lsof -nP -iTCP:18789 -sTCP:LISTEN > /dev/null 2>&1; then
            log "gateway port 18789 is listening — restart complete"
            exit 0
        fi
        sleep 0.5
    done

    log "WARNING: gateway did not become ready within 15s"
    tail -20 /tmp/openclaw-gateway.log 2>/dev/null || true
    exit 1
fi
