#!/usr/bin/env bash
# Health check for the OpenClaw gateway + team-memory-engine
# Returns 0 if healthy, 1 if degraded, 2 if down
# Usage: scripts/healthcheck.sh [--wait SECONDS]
# NOTE: no set -e; individual checks may fail without aborting the script

GATEWAY_PORT=18789
HEALTHY=0
DEGRADED=1
DOWN=2

# Colors (only if stdout is a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  NC='\033[0m'
else
  GREEN='' RED='' YELLOW='' NC=''
fi

status=0
checks_passed=0
checks_failed=0
checks_degraded=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; checks_passed=$((checks_passed + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; checks_failed=$((checks_failed + 1)); status=$DOWN; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; checks_degraded=$((checks_degraded + 1)); [ "$status" -lt "$DEGRADED" ] && status=$DEGRADED; }

echo "=== OpenClaw Health Check ==="
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 1. Gateway process alive
echo "Gateway Process:"
if pgrep -f "openclaw gateway|openclaw-gateway" > /dev/null 2>&1; then
  PID=$(pgrep -f "openclaw-gateway" | head -1)
  pass "openclaw-gateway running (pid=$PID)"
else
  fail "openclaw-gateway not running"
fi

# 2. Port listening
echo "Gateway Port ($GATEWAY_PORT):"
if command -v lsof > /dev/null 2>&1 && lsof -nP -iTCP:$GATEWAY_PORT -sTCP:LISTEN > /dev/null 2>&1; then
  pass "port $GATEWAY_PORT is listening"
else
  # Fallback: try curl
  if curl -sf "http://127.0.0.1:$GATEWAY_PORT/" > /dev/null 2>&1; then
    pass "port $GATEWAY_PORT responding to HTTP"
  else
    fail "port $GATEWAY_PORT not reachable"
  fi
fi

# 3. Gateway HTTP health
echo "Gateway HTTP:"
if command -v curl > /dev/null 2>&1; then
  HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:$GATEWAY_PORT/" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ]; then
    pass "HTTP $HTTP_CODE on http://127.0.0.1:$GATEWAY_PORT/"
  else
    # Gateway may not expose a root path; check if any response at all
    HTTP_BODY=$(curl -s -m 3 "http://127.0.0.1:$GATEWAY_PORT/" 2>/dev/null || true)
    if [ -n "$HTTP_BODY" ]; then
      pass "gateway responding (content length=$(echo -n "$HTTP_BODY" | wc -c))"
    else
      warn "gateway not responding to HTTP requests (may be still starting up)"
    fi
  fi
fi

# 4. Team-memory-engine pipeline
echo "Memory Engine:"
# Ledger may live at the project root or in the home directory
for CANDIDATE in "$MEM_DIR/.openclaw-memory-ledger.json" "$HOME/.openclaw-memory-ledger.json"; do
  if [ -f "$CANDIDATE" ]; then
    LEDGER_FILE="$CANDIDATE"
    break
  fi
done
if [ -n "${LEDGER_FILE:-}" ] && [ -f "$LEDGER_FILE" ]; then
  MEM_COUNT=$(python3 -c "
import json, sys
try:
    with open('$LEDGER_FILE') as f:
        data = json.load(f)
    if isinstance(data, list): print(len(data))
    elif isinstance(data, dict):
        # Could be {entries: [...]} or flat {id: {...}, ...}
        if 'entries' in data: print(len(data['entries']))
        else: print(len(data))  # flat dict: count keys
    else: print(0)
except: print(-1)
" 2>/dev/null || echo "-1")
  if [ "$MEM_COUNT" -gt 0 ] 2>/dev/null; then
    pass "ledger has $MEM_COUNT entries"
  elif [ "$MEM_COUNT" = "0" ] 2>/dev/null; then
    warn "ledger is empty (no memories yet)"
  else
    warn "ledger file exists but unreadable"
  fi
else
  warn "no ledger file found"
fi

# 5. Event log
echo "Event Log:"
TODAY=$(date '+%Y-%m-%d')
# Event log may be in workspace/memory/ or memory/ under the project root
for CANDIDATE in "$MEM_DIR/workspace/memory/event-log/$TODAY.json" "$MEM_DIR/memory/event-log/$TODAY.json"; do
  if [ -f "$CANDIDATE" ]; then
    EVENT_LOG="$CANDIDATE"
    break
  fi
done
if [ -n "${EVENT_LOG:-}" ] && [ -f "$EVENT_LOG" ]; then
  EVENT_COUNT=$(python3 -c "
import json
with open('$EVENT_LOG') as f:
    data = json.load(f)
if isinstance(data, list): print(len(data))
else: print(0)
" 2>/dev/null || echo "0")
  pass "today's event log has $EVENT_COUNT entries"
else
  warn "no event log for today ($TODAY)"
fi

# 6. Disk space
echo "Disk:"
DISK_USAGE=$(df -h /home 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%' || echo "?")
if [ "$DISK_USAGE" != "?" ] && [ "$DISK_USAGE" -lt 90 ] 2>/dev/null; then
  pass "disk usage ${DISK_USAGE}%"
elif [ "$DISK_USAGE" != "?" ]; then
  fail "disk usage critical: ${DISK_USAGE}%"
else
  pass "disk check skipped"
fi

# 7. Gateway log for recent errors
echo "Recent Errors (last 200 lines of gateway log):"
if [ -f /tmp/openclaw-gateway.log ]; then
  ERROR_COUNT=$(tail -200 /tmp/openclaw-gateway.log | grep -ci "error\|fail\|exception" 2>/dev/null || echo "0")
  if [ "$ERROR_COUNT" -gt 10 ]; then
    fail "$ERROR_COUNT error lines in recent gateway log"
  elif [ "$ERROR_COUNT" -gt 0 ]; then
    warn "$ERROR_COUNT error lines in recent gateway log (may be expected)"
  else
    pass "no errors in recent gateway log"
  fi
else
  warn "no gateway log at /tmp/openclaw-gateway.log"
fi

echo ""
echo "--- Summary ---"
echo "  Passed: $checks_passed"
echo "  Warnings: $checks_degraded"
echo "  Failed: $checks_failed"

if [ $status -eq $HEALTHY ]; then
  echo -e "  Status: ${GREEN}HEALTHY${NC}"
elif [ $status -eq $DEGRADED ]; then
  echo -e "  Status: ${YELLOW}DEGRADED${NC}"
else
  echo -e "  Status: ${RED}DOWN${NC}"
fi

exit $status
