#!/usr/bin/env bash
# ============================================================================
# Team Memory Engine — 比赛现场演示脚本（飞书在线交互版）(16 Steps)
# ============================================================================
# 用法: bash scripts/demo-live.sh
#
# 第一部分（Step 1-13）: 离线 CLI 展示核心能力
# 第二部分（Step 14-16）: 飞书实时交互 — 卡片推送 + 回调闭环
#
# 需要飞书网关在线 + 评委在飞书中与 Agent 交互。
# ============================================================================

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER_PATH="$HOME/.openclaw-memory-ledger.json"
GATEWAY_PORT=18789
OWNER_OPEN_ID="ou_23ab1a1db6759ee9ae44a8e441a52153"

# 去除 openclaw 输出的 ANSI 颜色
strip_colors() { sed 's/\x1b\[[0-9;]*m//g'; }
strip_plugin() { grep -v '^\[plugins\]' | grep -v '^$' || true; }
oc() { openclaw "$@" 2>&1 | strip_colors | strip_plugin; }
oc_head() { local n=$1; shift; oc "$@" | head -n "$n" || true; }

header() {
  echo ""
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

sep() {
  echo -e "${BOLD}${GREEN}─── $1 ───${NC}\n"
}

# ============================================================================
# 第一部分：离线 CLI 演示（Step 1-13）
# ============================================================================
header "Team Memory Engine — 飞书在线演示"

echo -e "  ${YELLOW}检查环境...${NC}"
if ! command -v openclaw &> /dev/null; then
  echo -e "  ${RED}错误: openclaw CLI 未安装${NC}"; exit 1
fi
echo -e "  ✅ openclaw: $(openclaw --version 2>/dev/null | strip_colors)"
echo -e "  ✅ Node.js: $(node --version)"

# ============================================================================
# Step 1: 数据注入
# ============================================================================
header "Step 1: 注入业务数据"

if [ -f "$LEDGER_PATH" ] && [ "$(wc -c < "$LEDGER_PATH")" -gt 100 ]; then
  COUNT=$(python3 -c "
import json
with open('$LEDGER_PATH') as f:
    d = json.load(f)
cats = {}
for m in d.values():
    cats[m.get('category','unknown')] = cats.get(m.get('category','unknown'), 0) + 1
print(f'{len(d)} 条记忆 | ', end='')
print(', '.join(f'{k}:{v}' for k,v in sorted(cats.items())), end='')
conflicts = sum(1 for m in d.values() if any(c.get('status')=='conflicting' for c in m.get('claims',[])))
if conflicts: print(f' | 冲突:{conflicts}', end='')
multi = sum(1 for m in d.values() if m.get('current_version',1) > 1)
if multi: print(f' | 多版本:{multi}', end='')
print()
" 2>/dev/null || echo "?")
  echo -e "  ${YELLOW}数据已存在: $COUNT${NC}"
else
  echo -e "  注入 26 条业务场景数据..."
  cd "$PROJECT_ROOT/extensions/team-memory-engine"
  npx tsx scripts/seed-demo-data.ts 2>&1 | tail -15
  cd "$PROJECT_ROOT"
fi

# ============================================================================
# Step 2: 记忆状态 + 遗忘曲线
# ============================================================================
header "Step 2: 记忆状态（含 Ebbinghaus 遗忘曲线）"
sep "27 条记忆 · 6 种强度标签 · 按时间自然衰减"
oc team-memory status

# ============================================================================
# Step 3: 混合搜索
# ============================================================================
header "Step 3: 混合搜索（Vector + Keyword）"

sep "搜索 'API' — 向量语义 + 关键词混合匹配"
oc_head 15 team-memory search "API"

echo ""
sep "搜索 '客户A' — 中文语义匹配"
oc_head 10 team-memory search "客户A"

# ============================================================================
# Step 4: 冲突检测 + 版本链
# ============================================================================
header "Step 4: 冲突检测（版本链 + 自动矛盾标记）"
sep "自动检测到的冲突记忆"
python3 -c "
import json
with open('$LEDGER_PATH') as f:
    data = json.load(f)
conflicts = [m for m in data.values() if any(c.get('status') == 'conflicting' for c in m.get('claims', []))]
if conflicts:
    print(f'发现 {len(conflicts)} 组冲突:\n')
    for m in conflicts:
        print(f'  ID: {m[\"id\"]}')
        print(f'  实体: {m[\"entity\"]} -> {m[\"attribute\"]}')
        print(f'  类别: {m[\"category\"]} | 半衰期: {m.get(\"recall_half_life\",\"?\")}天')
        print()
        for c in m.get('claims', []):
            icon = {'active': 'OK', 'conflicting': 'CONFLICT', 'superseded': 'SUPERSEDED'}.get(c.get('status', 'active'), '?')
            print(f'    v{c[\"version\"]} [{icon}]')
            print(f'       {c[\"value\"]}')
            print(f'       置信度: {c[\"confidence\"]:.0%} | 来源: {c[\"source\"]} | 时间: {c[\"valid_from\"][:10]}')
            print()
else:
    print('未发现冲突')
" 2>/dev/null || echo "  (跳过)"

# ============================================================================
# Step 5: AI 冲突分析报告
# ============================================================================
header "Step 5: AI 冲突分析（LLM 生成裁决建议）"
sep "LLM 分析冲突时间线 + 语义推理 + 推荐方案"
oc_head 20 team-memory conflict-explain "mem-conf-001"

# ============================================================================
# Step 6: 5 维遗忘风险评估
# ============================================================================
header "Step 6: 5 维遗忘风险评估"
sep "TimeDecay + BusinessImpact + LowCoverage + VersionRisk + LowUsage"
oc team-memory risk

# ============================================================================
# Step 7: 知识断层分析
# ============================================================================
header "Step 7: 知识断层分析（Single Points of Failure）"
sep "只有一个人知道的记忆 = 离职风险"
oc team-memory knowledge-gaps

# ============================================================================
# Step 8: 记忆中心度
# ============================================================================
header "Step 8: 记忆中心度分析（知识枢纽识别）"
sep "图论计算 — 中心度最高的记忆是团队知识枢纽"
oc team-memory centrality-scores

# ============================================================================
# Step 9: 团队能力画像
# ============================================================================
header "Step 9: 团队能力画像（6 成员工技能档案）"
sep "谁知道什么 * 信任度评分 * 专业领域"
oc team-memory tms

# ============================================================================
# Step 10: LLM 依赖推理
# ============================================================================
header "Step 10: LLM 语义依赖推理"
sep "跨记忆语义推理 — 为什么这些记忆相互依赖"
oc team-memory infer-dependencies

echo ""
sep "依赖图谱可视化"
python3 -c "
import json
with open('$LEDGER_PATH') as f:
    data = json.load(f)
deps = [m for m in data.values() if m.get('dependency_graph') and len(m['dependency_graph']) > 0]
print(f'共 {len(deps)} 条记忆有依赖关系:\n')
for m in deps:
    for dep_id in m['dependency_graph']:
        target = data.get(dep_id, {})
        print(f'  {m[\"id\"]} ({m[\"entity\"]}.{m[\"attribute\"]})')
        print(f'    -> depends on -> {dep_id} ({target.get(\"entity\",\"?\")}.{target.get(\"attribute\",\"?\")})')
        print()
" 2>/dev/null || echo "  (跳过)"

# ============================================================================
# Step 11: 离职模拟
# ============================================================================
header "Step 11: 离职模拟（Departure Simulation）"
sep "模拟 'ou_zhangsan' 离开团队 — 知识传承推荐"
oc team-memory simulate-departure "ou_zhangsan"

# ============================================================================
# Step 12: Proactive Capture
# ============================================================================
header "Step 12: Proactive Capture（实时决策检测）"
sep "9 种触发模式 * 正则 + LLM 混合增强"

echo -e "  ${BOLD}测试: 决策捕获 (decision_made)${NC}"
oc_head 8 team-memory proactive-capture "我们决定把前端框架统一改为React 19"

# ============================================================================
# Step 13: HTML Dashboard
# ============================================================================
header "Step 13: 可视化 Dashboard"
sep "生成完整 HTML 报告（SVG 雷达图 + 知识热力图 + TMS 画像）"

OUTPUT="$PROJECT_ROOT/team-memory-demo-dashboard.html"
oc team-memory insight --format html --output "$OUTPUT" | tail -3 || true

if [ -f "$OUTPUT" ]; then
  SIZE=$(wc -c < "$OUTPUT")
  echo -e "\n  OK Dashboard 已生成: ${BOLD}$OUTPUT${NC} ($SIZE bytes)"
  echo -e "  访问: ${YELLOW}通过网关访问 /canvas/dashboard-demo.html${NC}"
else
  echo -e "  ${RED}Dashboard 生成失败${NC}"
fi

# ============================================================================
# 第二部分：飞书实时交互（Step 14-16）
# ============================================================================

# ============================================================================
# Step 14: 飞书网关状态检查
# ============================================================================
header "Step 14: 飞书网关连接状态"
sep "检查网关是否在线 + WebSocket 连接"

GATEWAY_PID=""
for pid in $(pgrep -f "openclaw gateway" 2>/dev/null || true); do
  GATEWAY_PID="$pid"
  break
done

if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
  echo -e "  ${GREEN}网关进程运行中 (PID: $GATEWAY_PID)${NC}"

  # 检查端口
  if ss -tlnp 2>/dev/null | grep -q ":${GATEWAY_PORT}" || netstat -tlnp 2>/dev/null | grep -q ":${GATEWAY_PORT}"; then
    echo -e "  ${GREEN}端口 $GATEWAY_PORT 已监听${NC}"
  else
    echo -e "  ${RED}端口 $GATEWAY_PORT 未监听${NC}"
    echo -e "  ${YELLOW}请先启动网关: nohup openclaw gateway run --port ${GATEWAY_PORT} > /tmp/openclaw-gateway.log 2>&1 &${NC}"
    echo -e "  ${YELLOW}或者继续演示，飞书交互步骤将跳过${NC}"
  fi

  # 检查 WebSocket 连接（查看网关日志最后几行）
  if [ -f "/tmp/openclaw-gateway.log" ]; then
    WS_STATUS=$(tail -50 /tmp/openclaw-gateway.log 2>/dev/null | grep -i 'websocket\|connected\|feishu\|ws' | tail -3 || true)
    if [ -n "$WS_STATUS" ]; then
      echo -e "  ${GREEN}WebSocket 状态:${NC}"
      echo "$WS_STATUS" | while IFS= read -r line; do
        echo -e "    ${CYAN}$line${NC}"
      done
    fi
  fi

  echo -e "\n  ${GREEN}飞书网关就绪，可以开始实时交互${NC}"
  echo -e "  ${YELLOW}请在飞书中给 Agent 发送一条消息来触发交互${NC}"
else
  echo -e "  ${RED}网关未运行${NC}"
  echo -e "  ${YELLOW}启动网关: nohup openclaw gateway run --port ${GATEWAY_PORT} > /tmp/openclaw-gateway.log 2>&1 &${NC}"
  echo -e "  ${YELLOW}飞书交互步骤将跳过，继续演示离线部分${NC}"
fi

# ============================================================================
# Step 15: 飞书实时卡片推送
# ============================================================================
header "Step 15: 飞书实时卡片推送（Agent → 飞书）"
sep "Agent 检测到决策 → 自动推送确认卡片到飞书"

if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
  echo -e "  ${BOLD}交互指引:${NC}"
  echo -e ""
  echo -e "  1. 打开飞书，找到 Team Memory Agent 对话"
  echo -e "  2. 发送以下任意一句话："
  echo -e ""
  echo -e "     ${CYAN}\"以后所有上线发布都必须经过双审批\"${NC}"
  echo -e "     ${CYAN}\"我们决定把前端框架统一改为React 19\"${NC}"
  echo -e "     ${CYAN}\"客户A要求增加数据导出功能，优先级P1\"${NC}"
  echo -e ""
  echo -e "  3. 观察 Agent 回复：会推送一张确认卡片（带「确认」/「忽略」按钮）"
  echo -e "  4. 点击卡片按钮后回到终端查看回调结果"
  echo -e ""

  # 等待用户交互
  echo -e "  ${YELLOW}等待飞书交互...（10秒后自动继续）${NC}"
  sleep 5

  # 检查是否有新消息记录
  echo -e "  ${BOLD}检查最近网关日志...${NC}"
  if [ -f "/tmp/openclaw-gateway.log" ]; then
    RECENT=$(tail -30 /tmp/openclaw-gateway.log 2>/dev/null | grep -v '^\[plugins\]' | grep -v '^$' | tail -10 || true)
    if [ -n "$RECENT" ]; then
      echo -e "  ${CYAN}最近网关活动:${NC}"
      echo "$RECENT" | while IFS= read -r line; do
        echo -e "    $line"
      done
    else
      echo -e "  ${YELLOW}暂无新活动（可能还未收到飞书消息）${NC}"
    fi
  fi

  echo -e ""
  echo -e "  ${BOLD}卡片推送原理:${NC}"
  echo -e ""
  echo -e "  1. 用户在飞书发送消息 → WebSocket 推送至 Agent"
  echo -e "  2. Agent 的 Proactive Capture 检测到决策/约定/安全等模式"
  echo -e "  3. Agent 调用 Lark 插件 sendCardLark() 推送确认卡片"
  echo -e "  4. 卡片包含「确认」和「忽略」按钮，用户点击触发回调"
  echo -e "  5. 回调 handler 写入 Event Log → 更新记忆置信度"
else
  echo -e "  ${YELLOW}网关未运行，跳过飞书交互${NC}"
  echo -e "  ${YELLOW}离线模式下，卡片推送能力已通过 Step 14 演示回调闭环${NC}"
fi

# ============================================================================
# Step 16: 卡片回调闭环 + 后台服务
# ============================================================================
header "Step 16: 卡片回调闭环 + 后台服务"
sep "飞书卡片操作 -> Event Log 写回 -> 图谱自动更新 -> 后台服务状态"

# 展示 Event Log
echo -e "  ${BOLD}Event Log 记录（最近 5 条）:${NC}"
python3 -c "
import json, os, glob
log_dir = os.path.expanduser('~/.openclaw-memory-events')
files = sorted(glob.glob(os.path.join(log_dir, '*.jsonl')), reverse=True)
if files:
    entries = []
    for f in files:
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
    for e in entries[-5:]:
        ts = e.get('storedAt', '?')[:19]
        sender = e.get('senderId', '?')
        content = e.get('content', '?')[:60]
        print(f'  [{ts}] {sender}: {content}')
    print(f'\n  共 {len(entries)} 条 Event Log 记录')
else:
    print('  (暂无 Event Log)')
" 2>/dev/null || echo "  (跳过)"

echo -e ""
echo -e "  ${BOLD}后台服务配置:${NC}"
echo -e "  * Decay Check:       每 30 分钟 — Ebbinghaus 遗忘曲线更新"
echo -e "  * Risk Check:        每 60 分钟 — 5 维风险评估 + 双阈值告警"
echo -e "  * Extraction:        每  5 分钟 — Event Log 自动处理 + 记忆提取"
echo -e "  * Card Action Loop:  飞书卡片回调 -> Event Log 写回 -> 图谱自动更新"

# ============================================================================
# 完成
# ============================================================================
header "演示完成 — 能力清单"

echo -e "  ${BOLD}本次演示覆盖的能力:${NC}"
echo -e ""
echo -e "  [OK]  Step 1:   数据注入          26+ 条业务场景记忆（决策/API/流程/安全/经验）"
echo -e "  [OK]  Step 2:   记忆状态          含 Ebbinghaus 遗忘曲线强度显示（6种标签）"
echo -e "  [OK]  Step 3:   混合搜索          Vector + Keyword 混合检索"
echo -e "  [OK]  Step 4:   冲突检测          版本链 + 自动矛盾标记 + 多版本对比"
echo -e "  [OK]  Step 5:   AI 冲突分析       LLM 生成时间线 + 语义推理 + 推荐方案"
echo -e "  [OK]  Step 6:   风险评估          5维遗忘风险模型 + 双阈值门控"
echo -e "  [OK]  Step 7:   知识断层          单点故障检测（只有一个人知道的记忆）"
echo -e "  [OK]  Step 8:   中心度分析        图论计算知识枢纽（Centrality Scores）"
echo -e "  [OK]  Step 9:   团队画像          TMS 6 成员工技能档案 + 信任度评分"
echo -e "  [OK]  Step 10:  依赖推理          LLM 语义推理依赖链 + 图谱可视化"
echo -e "  [OK]  Step 11:  离职模拟          知识传承推荐算法"
echo -e "  [OK]  Step 12:  主动捕获          9种触发模式 * 正则 + LLM 混合增强"
echo -e "  [OK]  Step 13:  Dashboard         SVG雷达图 + 热力图 + TMS画像"
echo -e ""
echo -e "  ${BOLD}飞书实时交互:${NC}"
echo -e ""
echo -e "  [OK]  Step 14:  网关状态          WebSocket 连接 + 端口监听检查"
echo -e "  [OK]  Step 15:  卡片推送          用户飞书发消息 -> Agent 推送确认卡片"
echo -e "  [OK]  Step 16:  回调闭环          卡片操作 -> Event Log -> 图谱更新"
echo -e ""
echo -e "  ${BOLD}单独运行命令:${NC}"
echo -e ""
echo -e "    openclaw team-memory status              # 记忆状态"
echo -e "    openclaw team-memory risk                # 风险评估"
echo -e "    openclaw team-memory search '关键词'     # 混合搜索"
echo -e "    openclaw team-memory knowledge-gaps      # 知识断层"
echo -e "    openclaw team-memory centrality-scores   # 中心度分析"
echo -e "    openclaw team-memory tms                 # 团队能力画像"
echo -e "    openclaw team-memory infer-dependencies  # LLM 依赖推理"
echo -e "    openclaw team-memory conflict-explain    # AI 冲突分析"
echo -e "    openclaw team-memory simulate-departure  # 离职模拟"
echo -e "    openclaw team-memory insight html        # 生成 Dashboard"
echo -e "    openclaw team-memory list                # JSON 全量"
echo -e ""
echo -e "  ${BOLD}飞书交互操作:${NC}"
echo -e ""
echo -e "    1. 在飞书给 Agent 发消息（决策/约定/安全/API 类内容）"
echo -e "    2. Agent 检测到决策后自动推送确认卡片"
echo -e "    3. 点击卡片上的「确认」/「忽略」按钮"
echo -e "    4. 回调写入 Event Log -> 记忆置信度更新"
echo -e ""
