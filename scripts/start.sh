#!/usr/bin/env bash
if [ -d "/run/systemd/system/" ]; then
    sudo systemctl start openclaw
else
    nohup openclaw gateway run --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
fi