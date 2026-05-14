#!/usr/bin/env bash
# ============================================================================
# Team Memory Engine — One-Click Demo
# ============================================================================
# Usage: bash scripts/demo.sh
#
# Demonstrates the full Memory OS pipeline without requiring a running
# Feishu gateway or WebSocket connection.
# ============================================================================

set -euo pipefail

# Colors for our own output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Strip ANSI color codes from openclaw output
strip_colors() { sed 's/\x1b\[[0-9;]*m//g'; }
# Remove plugin log lines
strip_plugin() { grep -v '^\[plugins\]' | grep -v '^$' || true; }
# Run openclaw command cleanly
oc() { openclaw "$@" 2>&1 | strip_colors | strip_plugin; }
# Run openclaw command and show first N lines (safe from SIGPIPE)
oc_head() { local n=$1; shift; oc "$@" | head -n "$n" || true; }

header() {
  echo ""
  echo -e "${BOLD}${BLUE}===========================================================${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${BLUE}===========================================================${NC}"
  echo ""
}

section() {
  echo -e "\n${BOLD}${GREEN}─── $1 ───${NC}\n"
}

# ============================================================================
# Step 0: Prerequisites
# ============================================================================
header "Team Memory Engine — 一键演示"

echo -e "  ${YELLOW}检查环境...${NC}"
if ! command -v openclaw &> /dev/null; then
  echo -e "  ${RED}错误: openclaw CLI 未安装${NC}"; exit 1
fi
echo -e "  ✅ openclaw CLI: $(openclaw --version 2>/dev/null | strip_colors || echo 'available')"
echo -e "  ✅ Node.js: $(node --version)"

# ============================================================================
# Step 1: Seed Data
# ============================================================================
header "Step 1: 注入演示数据"

LEDGER_PATH="$HOME/.openclaw-memory-ledger.json"

if [ -f "$LEDGER_PATH" ] && [ "$(wc -c < "$LEDGER_PATH")" -gt 100 ]; then
  COUNT=$(python3 -c "import json; print(len(json.load(open('$LEDGER_PATH'))))" 2>/dev/null || echo "?")
  echo -e "  ${YELLOW}数据已存在 ($COUNT 条记忆)，跳过种子注入${NC}"
else
  echo -e "  注入 26 条真实业务场景记忆数据..."
  cd "$PROJECT_ROOT/extensions/team-memory-engine"
  npx tsx scripts/seed-demo-data.ts 2>&1 | tail -15
  cd "$PROJECT_ROOT"
fi

# ============================================================================
# Step 2: Memory Status
# ============================================================================
header "Step 2: 记忆状态（含遗忘曲线）"
section "全部记忆"
oc_head 30 team-memory status

# ============================================================================
# Step 3: Conflict Detection
# ============================================================================
header "Step 3: 冲突检测"
section "冲突记忆"
python3 -c "
import json, sys
path = '$HOME/.openclaw-memory-ledger.json'
try:
    with open(path) as f:
        data = json.load(f)
    conflicts = [m for m in data.values() if any(c.get('status') == 'conflicting' for c in m.get('claims', []))]
    if conflicts:
        print(f'发现 {len(conflicts)} 个冲突记忆:\n')
        for m in conflicts:
            print(f'  ID: {m[\"id\"]}')
            print(f'  实体: {m[\"entity\"]}.{m[\"attribute\"]}')
            for c in m.get('claims', []):
                icon = {'active': '✅', 'conflicting': '⚠️', 'superseded': '❌'}.get(c.get('status', 'active'), '?')
                print(f'    v{c[\"version\"]} [{icon}] {c[\"value\"][:80]}')
            print()
    else:
        print('未发现冲突')
except Exception as e:
    print(f'(读取失败: {e})')
" 2>/dev/null || echo "  (跳过冲突分析)"

# ============================================================================
# Step 4: Risk Assessment
# ============================================================================
header "Step 4: 遗忘风险评估"
section "风险评分"
oc_head 30 team-memory risk

# ============================================================================
# Step 5: Dependency Graph
# ============================================================================
header "Step 5: 记忆依赖关系图"
section "依赖关系"
oc_head 20 team-memory graph

# ============================================================================
# Step 6: HTML Dashboard
# ============================================================================
header "Step 6: 生成可视化 Dashboard"
section "生成 HTML 报告"

OUTPUT="$PROJECT_ROOT/team-memory-demo-dashboard.html"
oc team-memory insight --format html --output "$OUTPUT" | tail -5 || true

if [ -f "$OUTPUT" ]; then
  SIZE=$(wc -c < "$OUTPUT")
  echo -e "\n  ✅ Dashboard 已生成: ${BOLD}$OUTPUT${NC}"
  echo -e "  文件大小: $SIZE bytes"
  echo -e "  用浏览器打开即可查看完整可视化报告"
else
  echo -e "  ${RED}Dashboard 生成失败${NC}"
fi

# ============================================================================
# Step 7: Departure Simulation
# ============================================================================
header "Step 7: 离职模拟（知识传承分析）"
section "模拟成员 'ou_zhangsan' 离职"
oc_head 30 team-memory simulate-departure "ou_zhangsan"

# ============================================================================
# Summary
# ============================================================================
header "演示完成"

echo -e "  ${BOLD}演示路径总结:${NC}"
echo -e ""
echo -e "  1. ${GREEN}数据注入${NC}     26 条记忆 (决策/安全/API/流程/经验)"
echo -e "  2. ${GREEN}记忆状态${NC}     含遗忘曲线强度显示"
echo -e "  3. ${GREEN}冲突检测${NC}     服务器域名配置冲突"
echo -e "  4. ${GREEN}风险评估${NC}     5 维遗忘风险模型"
echo -e "  5. ${GREEN}依赖图谱${NC}     跨记忆依赖关系"
echo -e "  6. ${GREEN}Dashboard${NC}    HTML 可视化报告"
echo -e "  7. ${GREEN}离职模拟${NC}     知识传承推荐"
echo -e ""
echo -e "  ${BOLD}后续命令 (可单独运行):${NC}"
echo -e ""
echo -e "    openclaw team-memory status          # 查看记忆状态"
echo -e "    openclaw team-memory risk            # 风险评估"
echo -e "    openclaw team-memory search \"API\"    # 搜索记忆"
echo -e "    openclaw team-memory insight html    # 生成 Dashboard"
echo -e "    openclaw team-memory list            # JSON 格式列出全部"
echo -e ""
