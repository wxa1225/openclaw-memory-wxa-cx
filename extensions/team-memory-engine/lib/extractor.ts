// Memory Extractor — LLM-driven structured memory extraction from event log

import type { EventLogEntry, LedgerEntry } from "./storage/types.js";

export interface ExtractedMemory {
  entity: string;
  attribute: string;
  value: string;
  confidence: number;
  category: string;
  tags: string[];
  sourceEventIds: string[];
}

export interface ExtractionConfig {
  modelEndpoint: string;
  modelApiKey: string;
  modelName: string;
}

const CATEGORIES = ["decision", "api", "process", "experience", "security", "general"] as const;

/**
 * LLM-driven extraction from event log entries.
 * Calls an OpenAI-compatible endpoint to analyze conversations and
 * extract structured team memories.
 */
export class MemoryExtractor {
  private config: ExtractionConfig;

  constructor(config: ExtractionConfig) {
    this.config = config;
  }

  /** Extract memories from a batch of event log entries */
  async extract(
    entries: EventLogEntry[],
    context: { existingEntries: LedgerEntry[]; teamId: string }
  ): Promise<ExtractedMemory[]> {
    if (entries.length === 0) return [];

    const prompt = this.buildPrompt(entries, context);
    const response = await this.callModel(prompt);
    return this.parseResponse(response);
  }

  private buildPrompt(
    entries: EventLogEntry[],
    context: { existingEntries: LedgerEntry[]; teamId: string }
  ): string {
    const conversationText = entries
      .map((e) => {
        const name = e.senderName || e.senderId.substring(0, 8);
        return `[${name}]: ${e.content}`;
      })
      .join("\n");

    const existingContext = context.existingEntries
      .slice(-15)
      .map((e) => {
        const active = e.claims.find((c) => c.status === "active");
        return `${e.entity}.${e.attribute} = "${active?.value ?? "N/A"}" [${e.category}]`;
      })
      .join("\n");

    return `你是一个团队记忆提取系统。分析以下团队对话，提取结构化的团队记忆。

## 现有记忆上下文（用于冲突检测，不要重复提取）
${existingContext || "（无现有记忆）"}

## 对话内容
${conversationText}

## 提取规则
- 只提取团队相关的信息：决策、偏好、事实、流程、安全问题
- 忽略闲聊、玩笑、短暂讨论
- 如果不确定，使用较低置信度（0.3-0.5）
- 如果对话明确说明了对现有记忆的变更，提取为新版本
- 不要提取与现有记忆相同的内容（除非对话中有更新）

## 输出格式
返回 JSON 数组，每个元素如下：
[
  {
    "entity": "人物/项目/概念名称",
    "attribute": "属性/偏好/决策",
    "value": "提取的值",
    "confidence": 0.7,
    "category": "decision|api|process|experience|security|general",
    "tags": ["相关标签"]
  }
]

只返回 JSON 数组，不要其他文字。`;
  }

  private async callModel(prompt: string): Promise<string> {
    const response = await fetch(this.config.modelEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.modelApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Extraction API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  private parseResponse(response: string): ExtractedMemory[] {
    if (!response.trim()) return [];

    // Extract JSON from code fences if present
    let jsonStr = response.trim();
    const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeFenceMatch) {
      jsonStr = codeFenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((m: any) => m.entity && m.attribute && m.value)
        .map((m: any) => ({
          entity: String(m.entity).trim(),
          attribute: String(m.attribute).trim(),
          value: String(m.value).trim(),
          confidence: Math.max(0, Math.min(1, m.confidence ?? 0.5)),
          category: CATEGORIES.includes(m.category) ? m.category : "general",
          tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
          sourceEventIds: [], // Filled in by caller
        }));
    } catch {
      return [];
    }
  }
}
