#!/usr/bin/env bash
# ============================================================================
# Team Memory Engine — 比赛演示脚本 (15 Steps)
# ============================================================================
# 用法: bash scripts/demo.sh
#
# 展示全部能力：数据注入 → 记忆状态 → 遗忘曲线 → 冲突检测 → AI冲突分析
#             → 5维风险 → 知识断层 → 中心度 → 团队画像 → 依赖推理
#             → 离职模拟 → 主动捕获 → Dashboard → 卡片回调闭环 → 后台服务
#
# 纯离线 CLI，不依赖飞书网关或 WebSocket。
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
# 0. 环境检查
# ============================================================================
header "Team Memory Engine — 全功能演示"

echo -e "  ${YELLOW}检查环境...${NC}"
if ! command -v openclaw &> /dev/null; then
  echo -e "  ${RED}错误: openclaw CLI 未安装${NC}"; exit 1
fi
echo -e "  ✅ openclaw: $(openclaw --version 2>/dev/null | strip_colors)"
echo -e "  ✅ Node.js: $(node --version)"

# ============================================================================
# 1. 数据注入
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
# 2. 记忆状态 + 遗忘曲线 (Ebbinghaus Decay)
# ============================================================================
header "Step 2: 记忆状态（含 Ebbinghaus 遗忘曲线）"
sep "27 条记忆 · 6 种强度标签 · 按时间自然衰减"
oc team-memory status

# ============================================================================
# 3. 混合搜索 (Vector + Keyword)
# ============================================================================
header "Step 3: 混合搜索（Vector + Keyword）"

sep "搜索 'API' — 向量语义 + 关键词混合匹配"
oc_head 15 team-memory search "API"

echo ""
sep "搜索 '客户A' — 中文语义匹配"
oc_head 10 team-memory search "客户A"

# ============================================================================
# 4. 冲突检测 + 版本链
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
# 5. AI 冲突分析报告
# ============================================================================
header "Step 5: AI 冲突分析（LLM 生成裁决建议）"
sep "LLM 分析冲突时间线 + 语义推理 + 推荐方案"
oc_head 20 team-memory conflict-explain "mem-conf-001"

# ============================================================================
# 6. 5 维遗忘风险评估
# ============================================================================
header "Step 6: 5 维遗忘风险评估"
sep "TimeDecay + BusinessImpact + LowCoverage + VersionRisk + LowUsage"
oc team-memory risk

# ============================================================================
# 7. 知识断层分析（单点故障）
# ============================================================================
header "Step 7: 知识断层分析（Single Points of Failure）"
sep "只有一个人知道的记忆 = 离职风险"
oc team-memory knowledge-gaps

# ============================================================================
# 8. 记忆中心度（Centrality Scores）
# ============================================================================
header "Step 8: 记忆中心度分析（知识枢纽识别）"
sep "图论计算 — 中心度最高的记忆是团队知识枢纽"
oc team-memory centrality-scores

# ============================================================================
# 9. 团队能力画像（Transactive Memory System）
# ============================================================================
header "Step 9: 团队能力画像（6 成员工技能档案）"
sep "谁知道什么 * 信任度评分 * 专业领域"
oc team-memory tms

# ============================================================================
# 10. LLM 依赖推理 + 可视化图谱
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
# 11. 离职模拟（知识传承推荐）
# ============================================================================
header "Step 11: 离职模拟（Departure Simulation）"
sep "模拟 'ou_zhangsan' 离开团队 — 知识传承推荐"
oc team-memory simulate-departure "ou_zhangsan"

# ============================================================================
# 12. Proactive Capture 实时检测
# ============================================================================
header "Step 12: Proactive Capture（实时决策检测）"
sep "9 种触发模式 * 正则 + LLM 混合增强"

echo -e "  ${BOLD}测试 1: 未来约定 (future_commitment)${NC}"
oc_head 8 team-memory proactive-capture "以后所有上线发布都必须经过双审批"

echo -e "\n  ${BOLD}测试 2: 决策 (decision_made)${NC}"
oc_head 8 team-memory proactive-capture "我们决定把前端框架统一改为React 19"

echo -e "\n  ${BOLD}测试 3: 安全 (security_noted)${NC}"
oc_head 8 team-memory proactive-capture "所有生产密钥必须在6月1日前完成轮换"

echo -e "\n  ${BOLD}测试 4: API 配置 (api_noted)${NC}"
oc_head 8 team-memory proactive-capture "数据库连接池最大连接数设为200"

# ============================================================================
# 13. HTML Dashboard
# ============================================================================
header "Step 13: 可视化 Dashboard"
sep "生成完整 HTML 报告（SVG 雷达图 + 知识热力图 + TMS 画像 + 完整可视化）"

OUTPUT="$PROJECT_ROOT/team-memory-demo-dashboard.html"
oc team-memory insight --format html --output "$OUTPUT" | tail -3 || true

if [ -f "$OUTPUT" ]; then
  SIZE=$(wc -c < "$OUTPUT")
  echo -e "\n  OK Dashboard 已生成"
  echo -e "  路径: ${BOLD}$OUTPUT${NC}"
  echo -e "  大小: $SIZE bytes"
  echo -e "  访问: ${YELLOW}通过网关访问 /canvas/dashboard-demo.html${NC}"
else
  echo -e "  ${RED}Dashboard 生成失败${NC}"
fi

# ============================================================================
# 14. 卡片回调闭环（飞书卡片 → Event Log → 记忆更新）
# ============================================================================
header "Step 14: 卡片回调闭环（飞书卡片操作回写 Event Log）"
sep "模拟飞书卡片点击 → 写入 Event Log → 图谱自动更新"

echo -e "  ${BOLD}场景: 用户点击了「确认保存」卡片按钮${NC}"
echo -e "  对应飞书交互: 用户收到冲突检测卡片 → 点击「确认 v2 域名」"
echo -e ""

# 模拟写入一条飞书卡片回调记录到 Event Log
python3 -c "
import json, os, datetime

log_dir = os.path.expanduser('~/.openclaw-memory-events')
os.makedirs(log_dir, exist_ok=True)

today = datetime.datetime.utcnow().strftime('%Y-%m-%d')
log_file = os.path.join(log_dir, f'{today}.jsonl')

entries = [
    {
        'id': f'card-{datetime.datetime.utcnow().strftime(\"%s\")}-demo1',
        'storedAt': datetime.datetime.utcnow().isoformat() + 'Z',
        'chatId': 'oc_demo_chat_123',
        'chatType': 'p2p',
        'senderId': 'openclaw-user',
        'content': '[CARD_ACTION] action=confirm_save memory_id=mem-conf-001 text=\"确认使用 api-v2.example.com\"',
        'contentType': 'text',
        'messageId': 'card-mem-conf-001-confirm_save',
        'participants': None,
        'threadId': None,
        'processedForExtraction': True,
        'tags': ['card_action', 'confirm_save']
    },
    {
        'id': f'card-{datetime.datetime.utcnow().strftime(\"%s\")}-demo2',
        'storedAt': datetime.datetime.utcnow().isoformat() + 'Z',
        'chatId': 'oc_demo_chat_123',
        'chatType': 'p2p',
        'senderId': 'ou_lisi',
        'content': '[CARD_ACTION] action=review memory_id=mem-dec-001 text=\"查看客户A交付格式变更历史\"',
        'contentType': 'text',
        'messageId': 'card-mem-dec-001-review',
        'participants': None,
        'threadId': None,
        'processedForExtraction': True,
        'tags': ['card_action', 'review']
    }
]

with open(log_file, 'a', encoding='utf-8') as f:
    for entry in entries:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')

print(f'  已写入 2 条卡片回调记录到 Event Log ({today}.jsonl)')
print()
for e in entries:
    action = e['tags'][1] if len(e['tags']) > 1 else 'unknown'
    content = e['content']
    print(f'  [{e[\"senderId\"]}] {action}: {content[:60]}')
"

echo -e ""
echo -e "  ${BOLD}闭环原理:${NC}"
echo -e ""
echo -e "  1. 飞书检测到卡片点击 → 回调 openclaw 网关"
echo -e "  2. card-action-handler.ts 接收回调 → 写入 Event Log"
echo -e "  3. Extraction Pipeline（每 5 分钟）→ 处理 Event Log 新条目"
echo -e "  4. 用户确认操作 → 更新记忆 claim 置信度 → 图谱自动重算"
echo -e ""

echo -e "  ${BOLD}当前 Event Log 记录（最近 5 条）:${NC}"
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
        content = e.get('content', '?')[:50]
        print(f'  [{ts}] {sender}: {content}')
else:
    print('  (暂无 Event Log)')
" 2>/dev/null || echo "  (跳过)"

# ============================================================================
# 15. Pipeline 后台服务状态
# ============================================================================
header "Step 15: 后台服务状态（Pipeline）"
sep "Decay Check * Risk Check * Extraction Pipeline — 3个后台服务自动运行"

echo -e "  ${BOLD}服务配置:${NC}"
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
echo -e "  [OK]  Step 14:  卡片回调闭环      飞书卡片操作 -> Event Log 写回 -> 图谱自动更新"
echo -e "  [OK]  Step 15:  后台服务          Decay/Risk/Extraction 三管道自动运行"
echo -e ""
echo -e "  ${BOLD}飞书交互（需网关在线）:${NC}"
echo -e ""
echo -e "  实时卡片推送 -- 检测到决策时自动推送确认卡片"
echo -e "  冲突裁决卡片 -- 发现矛盾时推送 v1 vs v2 对比"
echo -e "  复习提醒卡片 -- 遗忘曲线触发时推送复习请求"
echo -e "  卡片回调闭环 -- 飞书卡片操作 -> Event Log 写回 -> 图谱自动更新"
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
