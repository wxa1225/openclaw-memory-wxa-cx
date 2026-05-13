# Team Memory Engine — 飞书 OpenClaw 赛道参赛作品

## 企业级长程协作 Memory 系统 | 方向 D

---

## 一、解决什么问题？

### 痛点：团队知识在对话中流失

在企业团队协作中，大量的**关键决策、技术约定、流程规范**散落在飞书群聊的对话流中。当：
- 新成员加入时，无法快速了解"为什么这样设计"
- 老成员离开时，带走大量隐性知识（Single Point of Failure）
- 时间推移后，团队对既有决策的记忆逐渐模糊（遗忘曲线）
- 同一问题反复讨论，因为之前的结论"找不到"

**传统方案的局限：**
- Wiki/文档 → 需要主动维护，容易过时
- 搜索聊天记录 → 噪音大，无法结构化
- 云笔记 → 缺乏版本管理和冲突检测

### AI 的关键作用

我们构建了一个 **Memory OS（记忆操作系统）**，让 AI 成为团队的"第二大脑"：

1. **自动捕获** — 实时检测对话中的决策性语句，主动提示保存
2. **结构化存储** — 六元组模型 (entity, attribute, value) + 版本链
3. **遗忘管理** — 基于艾宾浩斯遗忘曲线的强度衰减，自动提醒复习
4. **风险评估** — 5 维遗忘风险模型 + 双阈值门控，防止关键信息丢失
5. **知识传承** — Transactive Memory System（跨个体记忆系统），追踪"谁知道什么"
6. **离职模拟** — 分析成员离开对团队知识的影响，推荐传承对象

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    飞书 (Feishu)                         │
│  群聊/DM → WebSocket → Message Processing → Card UI     │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│              Team Memory Engine Plugin                   │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Event Log   │→ │ LLM Extract  │→ │  Memory       │  │
│  │ 事件日志     │  │ 记忆提取      │  │  Ledger       │  │
│  └─────────────┘  └──────────────┘  │  版本链管理    │  │
│                                     └───────┬───────┘  │
│  ┌─────────────┐  ┌──────────────┐         │          │
│  │ Proactive   │  │ Conflict     │         ▼          │
│  │ Capture     │→ │ Resolver     │  ┌───────────────┐ │
│  │ 主动捕获     │  │ 冲突解决      │  │ Memory Graph  │ │
│  └─────────────┘  └──────────────┘  │ 认知关系图谱   │ │
│                                     └───────┬───────┘ │
│                                             │          │
│  ┌─────────────┐  ┌──────────────┐         ▼          │
│  │ Decay Model │  │ Risk Model   │  ┌───────────────┐ │
│  │ 遗忘曲线     │  │ 风险评估      │→ │  TMS          │ │
│  └─────────────┘  └──────────────┘  │ 跨个体记忆系统  │ │
│                                     └───────┬───────┘ │
│                                             │          │
│  ┌─────────────────────────────────────────┐│          │
│  │       Insight Engine + HTML Report      ││          │
│  │       洞察引擎 + 可视化仪表盘            ││          │
│  └─────────────────────────────────────────┘│          │
└─────────────────────────────────────────────┼──────────┘
                                              │
                                    ┌─────────▼───────┐
                                    │  Background      │
                                    │  Services        │
                                    │  后台定时服务     │
                                    │  · Decay Check   │
                                    │  · Risk Check    │
                                    │  · Extract Pipe  │
                                    └─────────────────┘
```

---

## 三、核心创新点

### 1. 艾宾浩斯遗忘曲线 + 自适应半衰期

不同类别的记忆有不同的遗忘速度：
- Security（安全配置）：30 天半衰期 — 重要且不应遗忘
- Decision（决策）：21 天半衰期
- General（通用）：7 天半衰期 — 允许自然遗忘

强度公式：`S(t) = 2^(-t / τ)`，其中 τ 为类别自适应半衰期。

### 2. 五维遗忘风险模型

| 维度 | 权重 | 说明 |
|------|------|------|
| TimeDecay | 35% | 基于遗忘曲线的回忆概率 |
| BusinessImpact | 25% | Sigmoid(类别权重, 标签权重) |
| LowCoverage | 20% | 1 - 确认人数/团队规模 |
| VersionRisk | 10% | 冲突/版本数量 |
| LowUsage | 10% | 访问频率低的风险 |

**双阈值门控**：只有 `totalRisk > 0.55` 且 `businessImpact > 0.50` 才触发告警，避免告警疲劳。

### 3. 版本链 + 冲突检测

当两条记忆对同一 entity.attribute 有不同值时：
- **Auto-cover**：高置信度自动覆盖低置信度
- **Conflict-mark**：相似置信度标记为冲突，待人工确认
- **Human-confirm**：显著差异时通过飞书卡片通知人工裁决

### 4. Transactive Memory System (TMS)

追踪团队成员的知识分布：
- 每个人知道哪些记忆
- 专长领域图谱
- 信任度评分（基于贡献和确认行为）
- **知识断层检测**：识别单人知识点（Single Point of Failure）
- **离职模拟**：量化成员离开对团队知识的影响

### 5. Proactive Memory Capture

实时检测对话中的"值得记忆"的语句：
- 10 种触发模式（决策、承诺、政策变更、API 配置等）
- 正则检测 + LLM 结构化提取
- 飞书卡片交互：确认/忽略/编辑后保存

---

## 四、技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js + TypeScript (ESM) |
| 框架 | OpenClaw Plugin System |
| 通信 | Feishu WebSocket |
| 存储 | JSON 文件（带 writeLock 队列 + 原子写入） |
| AI | 多模型路由（豆包/GLM/Qwen/Kimi/MiniMax） |
| 测试 | Jest（13 个测试文件，3459 行） |

---

## 五、快速体验

### 方式一：一键 Demo（无需 API）

```bash
# 在项目根目录执行
npx tsx extensions/team-memory-engine/scripts/run-demo.ts
```

这将在终端展示：
- 30 条团队记忆目录（覆盖 6 个类别）
- 遗忘强度分布
- 风险告警
- 冲突检测
- TMS 知识分布
- 离职模拟分析
- 生成 HTML 可视化报告

### 方式二：CLI 命令

```bash
# 注入测试数据
npx tsx extensions/team-memory-engine/scripts/seed-demo-data.ts

# 查看记忆状态
openclaw team-memory status

# 查看风险
openclaw team-memory risk

# 查看图谱
openclaw team-memory graph

# 生成洞察报告
openclaw team-memory insight html
```

### 方式三：飞书交互

1. 启动 Gateway：`sh scripts/start.sh`
2. 在飞书群聊中发送包含决策内容的消息
3. AI 会自动检测并提示保存为团队记忆
4. 点击卡片按钮进行确认/忽略/编辑

---

## 六、量化价值

| 指标 | 传统方式 | Memory Engine |
|------|---------|---------------|
| 决策可追溯性 | 依赖记忆和搜索 | 版本链完整记录 |
| 知识流失风险 | 无法量化 | 5 维风险评分 + 离职模拟 |
| 新人上手速度 | 数周 | 通过记忆图谱快速了解 |
| 重复讨论率 | 高（找不到之前的结论） | 低（混合搜索：keyword + embedding） |
| 知识分布可见性 | 无 | TMS 热力图 + 知识断层检测 |

---

## 七、代码结构

```
extensions/team-memory-engine/
├── index.ts                      # 插件入口
├── lib/
│   ├── ledger.ts                 # 版本链管理 + 冲突检测
│   ├── graph.ts                  # 认知关系图谱（5 阶段构建）
│   ├── risk.ts                   # 5 维风险模型
│   ├── decay.ts                  # 艾宾浩斯遗忘曲线
│   ├── adaptive-decay.ts         # 自适应半衰期
│   ├── extractor.ts              # LLM 驱动的记忆提取
│   ├── vector-search.ts          # 混合检索（keyword + embedding）
│   ├── tms.ts                    # 跨个体记忆系统
│   ├── knowledge-analyzer.ts     # 知识断层 + 离职模拟
│   ├── dependency-inferrer.ts    # LLM 关系推断
│   ├── conflict-explainer.ts     # AI 冲突解释
│   ├── insight-engine.ts         # 洞察聚合引擎
│   ├── html-report.ts            # HTML 可视化报告
│   ├── proactive-capture.ts      # 实时决策检测
│   ├── card-action-handler.ts    # 飞书卡片交互处理
│   ├── plugin-*.ts               # 插件配置/工具/CLI/服务
│   └── storage/                  # 存储后端
├── __tests__/                    # 13 个测试文件
└── scripts/
    ├── seed-demo-data.ts         # 数据注入
    ├── run-demo.ts               # 一键演示
    └── EVALUATION.md             # 评测方案
```

---

## 八、团队

- **赵晨旭** — 架构设计、核心引擎
- **王小明** — 飞书集成、前端卡片
- **李婷婷** — 风险管理、测试
- **张伟** — 存储层、图谱构建
- **陈芳** — 洞察引擎、可视化

---

> "写下来，不要记在脑子里。"
> — Team Memory Engine 设计哲学
