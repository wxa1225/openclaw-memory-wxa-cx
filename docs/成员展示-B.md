# 小组成员 B — 个人负责部分

## 负责内容

**记忆引擎认知层 + 架构编排 + AI 提取系统**

- `lib/extractor.ts`（320 行）— LLM 驱动的记忆提取、闲聊过滤、分类打标
- `lib/tms.ts`（198 行）— 专家画像系统、贡献度分析、信任度计算
- `lib/graph.ts`（285 行）— 知识图谱构建、实体关系网络、影响力传播
- `lib/risk.ts`（210 行）— 五维风险评估模型、双阈值门控
- `lib/decay.ts`（183 行）— 艾宾浩斯遗忘曲线、类别感知半衰期、复习卡片
- `lib/manager.ts`（563 行）— 系统编排（Ledger + Graph + Risk + Decay + TMS + Extractor）
- `index.ts` 部分 — CLI 命令注册、插件服务注册、心跳调度
- `docs/demo-final.sh`（450 行）— 全自动演示脚本

---

## Demo 演示

### 场景一：LLM 自动提取 + 闲聊过滤

```bash
# 5 条飞书消息，含 3 条关键决策 + 2 条闲聊
$ openclaw team-memory extract

Extracted 3 memories from 5 events

提取结果：
  [decision] PDF，禁止发送Markdown格式
        id=mem-7ab5edf3  confidence=0.85
  [api] v3版本，旧端点本周五失效
        id=mem-cb4c4620  confidence=0.85
  [process] 统一发送给李四，无需抄送王五
        id=mem-8317affd  confidence=0.85

共 3 条记忆，闲聊内容（"今天中午吃什么？"）已被自动过滤
```

### 场景二：TMS 专家画像 — 自动识别谁擅长什么

```bash
$ openclaw team-memory tms

--- TMS 谁擅长什么 ---
openclaw-user: expertise=[decision, 交付, 客户A, api], memories=28, trust=100%
memory-extractor: expertise=[decision, 交付, 客户A, api, 生产环境, process], memories=88, trust=100%

→ 系统自动分析了谁贡献了什么领域的记忆
→ 新人来了知道该问谁，不怕人员流动
```

### 场景三：五维风险评估

```bash
$ openclaw team-memory risk

--- 五维风险评估 ---
No memories exceed risk thresholds.

→ 当前所有记忆强度健康，无需复习提醒
→ 五维：TimeDecay, BusinessImpact, LowCoverage, VersionRisk, LowUsage
```

### 场景四：知识图谱 — 实体关系网络

```bash
$ openclaw team-memory graph

📊 图谱统计: 14 个节点, 18 条边

实体节点:
  • 客户A
  • 生产环境API
  • 团队周报

关系类型: ['current_value', 'derived_from', 'has_preference', 'injected_by', 'related_memory', 'supersedes']

→ 从记忆账本自动构建，无需人工标注
→ 可视化实体间的关联关系
```

---

## 核心代码展示

### 1. LLM 自动提取 — 从对话到结构化记忆

**问题背景**：团队群聊是自由文本，需要自动识别哪些是关键决策、哪些是闲聊，并提取为 entity.attribute.value 三元组。

```typescript
// lib/extractor.ts

async extract(events: EventLogEntry[], config: ExtractionConfig): Promise<ExtractedMemory[]> {
  // 1. 构建提取 prompt，附带已有记忆用于去重
  const prompt = buildExtractionPrompt(events, existingEntries);

  // 2. 调用大模型（doubao-seed-2.0-pro）
  const response = await this.llm.call(prompt, { model: "doubao-seed-2.0-pro" });

  // 3. 解析 JSON 响应，提取三元组
  const memories = this.parseResponse(response);

  // 4. 商业相关性过滤（闲聊、无关内容自动排除）
  return memories.filter(m => this._isBusinessRelevant(m));
}

/** 多模型容灾：主模型不可用时自动切换备用模型 */
private async _callWithFallback(prompt: string): Promise<string> {
  const models = ["doubao-seed-2.0-pro", "qwen-plus", "kimi-k2.6"];
  for (const model of models) {
    try {
      return await this.llm.call(prompt, { model });
    } catch (e) {
      console.warn(`Model ${model} failed, trying next...`);
    }
  }
  throw new Error("All LLM models failed");
}
```

**提取 prompt 设计**：

```typescript
function buildExtractionPrompt(events: EventLogEntry[], existing: LedgerEntry[]): string {
  return `你是团队记忆提取助手。请从以下对话中提取关键信息。

要求：
1. 只提取**团队决策、技术配置、流程规范、安全注意事项、经验教训**
2. 忽略闲聊（午饭、天气、问候语等）
3. 输出格式：entity.attribute.value 三元组
4. 为每条记忆分配 category: decision/api/process/security/experience
5. 参考已有记忆，避免重复提取

对话内容：
${events.map(e => `[${e.sender}] ${e.text}`).join('\n')}

已有记忆（用于去重）：
${existing.map(e => `${e.entity}.${e.attribute}: ${getActiveValue(e)}`).join('\n')}
`;
}
```

### 2. TMS 专家画像 — 谁擅长什么

```typescript
// lib/tms.ts

interface TMSProfile {
  userId: string;
  expertiseAreas: Map<string, number>;  // area -> contribution count
  trustScore: number;                    // 0.0 - 1.0
  totalMemories: number;
  lastActive: string;
}

/** 分析所有成员的贡献分布 */
export function analyzeExpertise(entries: LedgerEntry[]): TMSProfile[] {
  const profiles = new Map<string, TMSProfile>();

  for (const entry of entries) {
    for (const claim of entry.claims) {
      if (!claim.source?.userId) continue;

      const profile = profiles.get(claim.source.userId) ?? createProfile(claim.source.userId);
      profile.totalMemories++;

      // 按 category + tags 统计专业领域
      const areas = [entry.category, ...(entry.tags || [])];
      for (const area of areas) {
        profile.expertiseAreas.set(area, (profile.expertiseAreas.get(area) || 0) + 1);
      }

      // 信任度 = 活跃贡献 / 总贡献（考虑衰减）
      profile.trustScore = computeTrustScore(profile);
      profiles.set(claim.source.userId, profile);
    }
  }

  return [...profiles.values()].sort((a, b) => b.totalMemories - a.totalMemories);
}
```

### 3. 五维风险模型 — 双阈值门控

```typescript
// lib/risk.ts

/** 五个风险维度 */
enum RiskDimension {
  TimeDecay = "timeDecay",         // 艾宾浩斯衰减分数
  BusinessImpact = "businessImpact", // 类别重要性（decision > process > general）
  LowCoverage = "lowCoverage",     // 确认人数不足
  VersionRisk = "versionRisk",     // 版本冲突状态
  LowUsage = "lowUsage",           // 长期未被检索
}

/** 风险权重：decision 类遗忘风险最大 */
const DIMENSION_WEIGHTS = {
  timeDecay: 0.30,
  businessImpact: 0.25,
  lowCoverage: 0.15,
  versionRisk: 0.15,
  lowUsage: 0.15,
};

/** 双阈值门控：risk > threshold 且 strength < reviewThreshold 才触发 */
async computeAllRisks(entries: LedgerEntry[]): Promise<RiskScore[]> {
  return entries.map(entry => {
    const scores = {
      timeDecay: this._timeDecayScore(entry),
      businessImpact: this._businessImpactScore(entry),
      lowCoverage: this._lowCoverageScore(entry),
      versionRisk: this._versionRiskScore(entry),
      lowUsage: this._lowUsageScore(entry),
    };

    const totalRisk = weightedSum(scores, DIMENSION_WEIGHTS);
    const strength = calculateStrengthFromLedger(entry);

    return {
      memoryId: entry.id,
      ...scores,
      totalRisk,
      strength,
      triggered: totalRisk > RISK_THRESHOLD && strength < REVIEW_THRESHOLD,
    };
  });
}
```

### 4. 知识图谱构建 — 五阶段算法

```typescript
// lib/graph.ts

/** 从账本自动构建知识图谱 */
async buildGraph(): Promise<MemoryGraph> {
  const graph = new MemoryGraph();

  // Phase 1: 创建实体节点（entity）和属性节点（attribute）
  for (const entry of entries) {
    graph.addEntityNode(entry.entity);
    graph.addAttributeNode(entry.entity, entry.attribute);
  }

  // Phase 2: 版本链连线（同一 entity.attribute 的不同版本）
  for (const entry of entries) {
    if (entry.claims.length > 1) {
      for (let i = 1; i < entry.claims.length; i++) {
        graph.addEdge(entry.claims[i - 1].id, entry.claims[i].id, "version_chain");
      }
    }
  }

  // Phase 3: 溯源连线（谁贡献了什么）
  for (const entry of entries) {
    for (const claim of entry.claims) {
      if (claim.source?.userId) {
        graph.addEdge(`user:${claim.source.userId}`, entry.id, "injected_by");
      }
    }
  }

  // Phase 4: 社交连线（共同贡献者）
  // Phase 5: 影响力传播（高置信度版本影响关联节点）
  this._propagateInfluence(graph);

  return graph;
}
```

### 5. 系统编排 — Manager 统一管理

```typescript
// lib/manager.ts

export class MemoryManager {
  private ledger: MemoryLedger;
  private graph: MemoryGraphBuilder;
  private risk: RiskModel;
  private decay: DecayModel;
  private tms: TMSAnalyzer;
  private extractor: MemoryExtractor;

  /** 注入记忆：LLM 提取 → 账本存储 → 冲突检测 → 图谱更新 */
  async inject(text: string, options: InjectOptions): Promise<InjectResult> {
    // 1. LLM 提取（或手动 inject）
    const memories = await this.extractor.extractFromText(text);

    // 2. 写入账本（含 fuzzy lookup + conflict detection）
    const result = await this.ledger.injectClaim({ ...memories[0], ...options });

    // 3. 更新图谱
    await this.graph.rebuild();

    // 4. 检查风险
    const risks = await this.risk.computeAllRisks([result]);

    return {
      id: result.id,
      memory: getActiveValue(result),
      conflict: detectConflict(result),
    };
  }

  /** 遗忘预警：衰减检测 → 风险评分 → 推送提醒 */
  async checkDecayAlerts(): Promise<DecayAlert[]> {
    const entries = await this.ledger.getAllEntries();
    const alerts: DecayAlert[] = [];

    for (const entry of entries) {
      const strength = this.decay.calculateStrength(entry);
      const label = this.decay.getStrengthLabel(strength);

      if (label === "fading" || label === "weak" || label === "critical") {
        alerts.push({ entry, strength, label });
      }
    }

    return alerts;
  }
}
```

---

## 技术深度说明

### 设计决策 1：为什么 LLM 提取是主路径但不是唯一路径？

LLM 提取能自动从对话中识别关键信息，但模型可能波动、超时、返回错误。系统设计为：LLM 是主路径，手动 inject 是降级兜底。即使 LLM 完全不工作，用户仍可通过 CLI 手动注入记忆，系统始终可用。

### 设计决策 2：为什么用五维风险而不是单一衰减阈值？

单一"强度低于 X 就提醒"太粗糙。decision 类记忆（客户交付格式）遗忘的风险远大于 general 类（办公室 Wi-Fi 密码）。五维模型综合考虑：衰减程度、业务重要性、确认人数、版本状态、使用频率，确保推送的是真正重要的遗忘预警。

### 设计决策 3：为什么 TMS 要自动画像？

团队知识断层的核心原因是"不知道谁知道"。人员离职/调动后，新来的人不知道某个领域该问谁。TMS 通过分析谁贡献了什么领域的记忆，自动识别专家。不需要人工填写技能表，系统从贡献行为自动推导。

### 设计决策 4：为什么知识图谱是自动构建的？

人工维护知识图谱成本太高。系统从账本的 entity/attribute/version/source 信息自动构建图谱：实体节点 = entity，属性节点 = attribute，版本链 = 同一 entity.attribute 的不同 claim，溯源 = source.userId，社交 = 共同贡献者。零人工标注。
