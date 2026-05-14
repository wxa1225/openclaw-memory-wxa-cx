#!/usr/bin/env bash

log() { echo "[restart.sh] $(date "+%Y-%m-%d %H:%M:%S") $*"; }

gw_alive() {
    pgrep -f "openclaw-gateway|openclaw gateway" | grep -vw "$$" >/dev/null 2>&1
}

if [ -d "/run/systemd/system/" ]; then
    log "systemd detected, restarting via systemctl..."
    sudo systemctl restart openclaw
    log "systemctl restart exit code: $?"
else
    log "killing openclaw-gateway processes..."
    PIDS_GW=$(pgrep -f "openclaw-gateway|openclaw gateway" | grep -vw "$$" || true)
    if [ -n "$PIDS_GW" ]; then
        log "killing gateway pids: $(echo $PIDS_GW | tr "\n" " ")"
        kill -9 $PIDS_GW 2>&1
    else
        log "no openclaw-gateway processes found"
    fi

    for i in $(seq 1 50); do
        gw_alive || break
        sleep 0.1
    done

    if gw_alive; then
        log "ERROR: openclaw-gateway still alive after 5s, abort"
        exit 1
    fi
    log "openclaw-gateway stopped"

    log "starting openclaw gateway..."
    nohup openclaw gateway run --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
    log "gateway started (pid=$!)"
fi
