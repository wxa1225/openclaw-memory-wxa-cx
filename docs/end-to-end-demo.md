# 飞书端到端数据流演示

> 本文档展示从飞书群聊消息到记忆提取、存储、风险预警的完整数据流向。
> 由于当前环境无法运行真实飞书实例，以下用代码模拟的端到端 trace 替代。

---

## 完整数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                        飞书 WebSocket                               │
│  张三: "客户A那边确认了，以后交付都用PDF格式，不要再发Markdown了"     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ open-apis/im/v1/messages
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  openclaw-lark plugin (channel)                                     │
│  1. WebSocket 接收消息                                              │
│  2. 解析 sender_id (ou_23ab1a...)                                   │
│  3. 策略过滤（允许名单检查）                                          │
│  4. 内容解析（text/image/file）                                      │
│  5. 分发到 Agent                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ dispatchToAgent
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  OpenClaw Gateway                                                   │
│  触发 before_agent_start hook                                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  team-memory-engine → before_agent_start hook                       │
│  ┌─────────────────────────────────────────────┐                    │
│  │ EventLog.append({                           │                    │
│  │   chatId: "oc_83d25a...",                   │                    │
│  │   chatType: "group",                        │                    │
│  │   senderId: "ou_23ab1a...",                 │                    │
│  │   senderName: "张三",                       │                    │
│  │   content: "客户A那边确认了，以后交付都用...", │                    │
│  │   messageId: "msg-1777988599",              │                    │
│  │   processedForExtraction: false             │                    │
│  │ })                                          │                    │
│  └─────────────────────────────────────────────┘                    │
│  → 写入 memory/event-log/2026-05-05.json                            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ (Agent 处理对话，回复用户)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  OpenClaw Gateway                                                   │
│  Agent 回复："已记录，客户A的交付格式将改为PDF"                         │
│  触发 agent_end hook                                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  team-memory-engine → agent_end hook                                │
│  ┌─────────────────────────────────────────────┐                    │
│  │ EventLog.append({                           │                    │
│  │   senderId: "agent",                        │                    │
│  │   senderName: "AI",                         │                    │
│  │   content: "已记录，客户A的交付格式将改为PDF"  │                    │
│  │ })                                          │                    │
│  └─────────────────────────────────────────────┘                    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  team-memory-pipeline service (每5分钟轮询)                           │
│  1. EventLog.getUnprocessed() → 获取未处理事件                        │
│  2. MemoryExtractor.extract(events, context)                        │
│     → LLM 分析对话内容                                               │
│     → 提取: entity="客户A", attribute="交付格式", value="PDF"         │
│     → confidence=0.85, category="decision"                          │
│  3. Ledger.injectClaim(...)                                         │
│     → 检测冲突: 发现旧值 "Markdown" (v1)                             │
│     → 冲突判定: delta=0.25 > 0.2, new > 0.8, old < 0.6 → auto-cover │
│     → v1 → superseded, 创建 v2 = "PDF" (active)                     │
│  4. Graph.incrementalUpdate(entry)                                  │
│     → 更新认知图谱: Entity→Attribute→Memory 节点和边                  │
│  5. TMS.syncFromLedger()                                            │
│     → 更新张三的专业领域: [decision, 交付, 客户A]                      │
│  6. EventLog.markProcessed(eventIds)                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Decay check service (每30分钟)                                       │
│  计算每条记忆的遗忘强度:                                             │
│  mem-ab6e7f71: strength = 2^(-14d / 14d) = 0.5 → STRONG            │
│  → 未低于阈值 (0.4)，不触发提醒                                       │
│                                                                      │
│  Risk check service (每60分钟)                                        │
│  计算五维风险分数:                                                   │
│  mem-ab6e7f71: totalRisk=0.15, triggered=false → healthy            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ (假设30天后，记忆遗忘)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Risk check service — 触发预警                                       │
│  mem-ab6e7f71:                                                     │
│    TimeDecay: 0.92 (30天未确认)                                     │
│    BusinessImpact: 0.68 (decision 类别, 含"交付"标签)                 │
│    LowCoverage: 0.40 (仅2人确认)                                    │
│    VersionRisk: 0.10                                                │
│    LowUsage: 0.80                                                   │
│    Total: 0.35*0.92 + 0.25*0.68 + 0.20*0.40 + 0.10*0.10 + 0.10*0.80 │
│         = 0.322 + 0.170 + 0.080 + 0.010 + 0.080 = 0.662            │
│                                                                      │
│  → totalRisk(0.662) > 0.55 && businessImpact(0.68) > 0.50          │
│  → TRIGGERED                                                        │
│                                                                      │
│  发送飞书交互式卡片:                                                  │
│  ┌────────────────────────────────────────────┐                     │
│  │ ⚠️ Risk Alert [66%] — 客户A.交付格式         │                     │
│  │                                            │                     │
│  │ Current value (v2): PDF                    │                     │
│  │                                            │                     │
│  │ Risk sources:                              │                     │
│  │ - TimeDecay: 30 days since last update (92) │                    │
│  │ - LowCoverage: only 2/5 members aware (40)  │                     │
│  │                                            │                     │
│  │ [✅ Still Valid] [🔄 Update] [👁 Dismiss]   │                     │
│  └────────────────────────────────────────────┘                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ 用户点击 "Still Valid"
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Card Action Handler                                                 │
│  1. handleMemoryReviewAction({                                      │
│       action: "confirm",                                            │
│       memory_id: "mem-ab6e7f71",                                    │
│       operator: { open_id: "ou_23ab1a..." }                         │
│     })                                                              │
│  2. Ledger.resolveConflict(conflict, {                              │
│       action: "confirm",                                            │
│       resolvedBy: "ou_23ab1a..."                                    │
│     })                                                              │
│     → 添加确认者: confirmed_by.push(ou_23ab1a...)                    │
│  3. 飞书显示 Toast: "已确认: 已确认有效"                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CLI 端到端复现

以下步骤可在终端完整复现上述流程（无需飞书）：

```bash
# 1. 注入记忆（模拟飞书消息触发）
$ openclaw team-memory inject "客户A的交付格式改为PDF，张三确认过" --category decision --tags 交付,客户A
Stored: "客户A的交付格式改为PDF，张三确认过" (id: mem-xxxxxx, v1)

# 2. 确认注入结果
$ openclaw team-memory status
1 team memories:

1. 客户A的交付格式改为PDF，张三确认过 [decision] v1
   Strength: ●●●○○ (63%)

# 3. 矛盾更新测试
$ openclaw team-memory inject "客户A的交付格式改为Markdown" --category decision --tags 交付,客户A
Stored: "客户A的交付格式改为Markdown" (id: mem-yyyyyy, v2)
# → 系统检测冲突，创建 v2

# 4. 搜索验证
$ openclaw team-memory search "客户A PDF"
[STRONG] ●●●●○ 80%
  客户A的交付格式改为PDF

# 5. 风险评估
$ openclaw team-memory risk
No memories exceed risk thresholds. Team cognitive state is healthy.

# 6. 团队能力画像
$ openclaw team-memory tms
1 team members:
openclaw-user: expertise=[decision, 交付, 客户A], memories=1, trust=53%

# 7. 图谱统计
$ openclaw team-memory graph | jq '{nodes: (.nodes | length), edges: (.edges | length)}'
{
  "nodes": 15,
  "edges": 18
}
```

---

## 数据持久化验证

运行 CLI 后，可在磁盘上验证所有数据：

```bash
# Ledger 文件（版本化记忆账本）
$ ls -la ~/.openclaw-memory-ledger.json
-rw-r--r--  1 gem  gem  21205 May  5 13:49 .openclaw-memory-ledger.json

# 查看原始数据
$ cat ~/.openclaw-memory-ledger.json | jq '.["mem-xxxxxx"].claims | length'
2  # v1 和 v2 两个版本

$ cat ~/.openclaw-memory-ledger.json | jq '.["mem-xxxxxx"].claims[] | {version, value, status}'
[
  { "version": 1, "value": "Markdown", "status": "superseded" },
  { "version": 2, "value": "PDF",      "status": "active" }
]

# Graph 文件（认知图谱）
$ ls -la ~/.openclaw-memory-graph.json
-rw-r--r--  1 gem  gem  53214 May  5 13:49 .openclaw-memory-graph.json
```
