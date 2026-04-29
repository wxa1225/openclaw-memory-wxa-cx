# Team Memory OS 评测方案

## 一、评测层次

### Level 1: 单元测试（已有 ✅）
运行 `npx tsx scripts/benchmark.ts`，8 项算法测试全部通过。
验证内容：Ledger、Graph、Risk、Decay、Extractor、TMS 的核心算法正确性。

### Level 2: 集成测试（需创建）
不依赖 LLM API，用 mock 数据验证端到端链路。

### Level 3: 完整评测（需配置 API）
接入真实 LLM 模型，验证 LLM 驱动的记忆提取质量。

---

## 二、Level 2：集成测试方案

新建 `scripts/integration-test.ts`，覆盖以下场景：

### 测试 1：Event Log 写入与查询
- 创建 EventLog 实例（projectRoot=/tmp/test-memory-<timestamp>）
- append 3 条模拟消息（不同 sender、不同 chatType）
- query 验证按 chatId/senderId 过滤
- getUnprocessed 验证未处理条目
- markProcessed 验证标记
- 验证文件存储在 `memory/event-log/YYYY-MM-DD.json`

### 测试 2：Ledger → Graph 增量更新
- 注入 3 条记忆到 Ledger
- 重建 Graph
- 验证节点数 = 3 个 Entity + 3 个 Attribute + 对应 Memory/Person/Event
- 注入第 4 条记忆（incrementalUpdate）
- 验证只增加了新节点，旧节点未被重建

### 测试 3：Card Action Handler
- 创建一个冲突场景（v1:Markdown vs v2:PDF）
- 模拟 confirm 按钮点击
- 验证 confirmed_by 包含 resolver
- 模拟 dismiss 按钮点击
- 验证 conflicting 状态清除

### 测试 4：TMS 同步
- 注入 3 条记忆（不同 injectedBy）
- 创建 TMS 实例，syncFromLedger
- 验证 3 个成员被创建
- 验证 expertiseAreas 根据 category 生成
- 验证 knownMemoryIds 正确关联

### 测试 5：完整 Pipeline（无 LLM）
- EventLog 写入 5 条消息
- 运行 pipeline（extractor 为 null 时 fallback 到 regex）
- 验证 EventLog 标记为已处理
- 验证 Ledger 中有新条目（regex fallback 产物）
- 验证 Graph 已更新

---

## 三、Level 3：LLM 提取质量评测

### 前置条件
在 `openclaw.json` 的 `plugins.entries["team-memory-engine"].config` 中添加：
```json
{
  "projectRoot": "/home/gem/workspace/agent",
  "modelEndpoint": "https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy",
  "modelApiKey": "<从 miaoda-provider 读取>",
  "modelName": "doubao-seed-2.0-pro"
}
```

### 评测方法

运行 `scripts/llm-extraction-eval.ts`（需新建），包含：

#### 测试 1：单轮对话提取
输入：3 人讨论"客户 A 的交付格式从 Markdown 改为 PDF"
期望提取：
- entity: "客户A", attribute: "交付格式", value: "PDF", category: "decision", confidence >= 0.7
- entity: "客户A", attribute: "交付格式", value: "Markdown", 不应提取（已被替代）

#### 测试 2：多话题混合
输入：包含决策、闲聊、技术问题、流程讨论的 20 条消息
期望：
- 只提取决策/事实/流程类记忆
- 闲聊类不被提取
- 提取数量合理（2-6 条）

#### 测试 3：冲突检测
输入：对话中说"之前说的 Markdown 不用了，以后都用 PDF"
期望：
- 提取 PDF 版本
- 如果现有 Ledger 有 Markdown，提取为更新而非重复

---

## 四、运行方式

```bash
# Level 1: 算法 benchmark
npx tsx extensions/team-memory-engine/scripts/benchmark.ts

# Level 2: 集成测试（不需要 API）
npx tsx extensions/team-memory-engine/scripts/integration-test.ts

# Level 3: LLM 提取质量评测（需要 API 配置）
npx tsx extensions/team-memory-engine/scripts/llm-extraction-eval.ts

# CLI 级快速验证
openclaw team-memory inject "测试记忆一条"
openclaw team-memory status
openclaw team-memory risk
openclaw team-memory graph
```

## 五、合格标准

| 层级 | 通过标准 |
|------|---------|
| Level 1 | 8/8 benchmark 通过 |
| Level 2 | 5/5 集成测试通过 |
| Level 3 | LLM 提取准确率 >= 70%（人工判断） |
