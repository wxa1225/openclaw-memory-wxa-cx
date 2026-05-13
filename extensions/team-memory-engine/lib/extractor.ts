// Memory Extractor — LLM-driven structured memory extraction from event log
// Uses response_format JSON Schema (OpenAI-compatible) for guaranteed structured output.
// Includes exponential backoff retry with jitter for resilience.

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
  xApiKey?: string;
}

/** Classified extraction error — lets callers decide retry / pause / fallback */
export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "model" | "network" | "parse"
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

const CATEGORIES = ["decision", "api", "process", "experience", "security", "general"] as const;

/** JSON Schema for the extraction output — sent via response_format to the LLM */
const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entity: { type: "string", description: "具体的人物/项目/系统/客户名称" },
          attribute: { type: "string", description: "具体的属性名称" },
          value: { type: "string", description: "提取的值" },
          confidence: { type: "number", description: "0.0-1.0，反映确定程度" },
          category: { type: "string", enum: [...CATEGORIES] as string[] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["entity", "attribute", "value", "confidence", "category", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["memories"],
  additionalProperties: false,
};

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

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
    const response = await this.callModelWithRetry(prompt);
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
- 如果对话明确说明了对现有记忆的变更，提取为新版本
- 不要提取与现有记忆相同的内容（除非对话中有更新）

## entity 提取规则（重要！）
entity 必须是具体的名称，不要用 "general" 作为 entity：
- 人名/角色：如 "张三"、"产品经理"、"前端负责人"
- 项目名：如 "Alpha项目"、"官网改版"
- 系统/服务：如 "API网关"、"数据库"、"CI流水线"
- 客户/组织：如 "客户A"、"法务部"
- 具体概念：如 "代码审查流程"、"发布规范"
只有当对话中没有具体主体时，才使用对话的主题作为 entity。

## attribute 提取规则
attribute 是 entity 的某个具体方面：
- 如 "交付格式"、"部署方式"、"API端点"、"代码风格"、"会议时间"
- 不要使用和 entity 相同的内容

## confidence 置信度指南
confidence 反映你对提取内容的确定程度：
- 0.8-0.9：对话中明确陈述，多人确认，或反复提及
- 0.7：对话中明确提到，但没有确认
- 0.5-0.6：推断出来的，或讨论中不太确定的内容
- 0.3-0.4：模糊提及，或可能有其他含义
- 如果不确定，宁可低一些也不要高估

## 示例
对话："客户A的交付格式改为PDF了，张三确认过"
→ {"entity": "客户A", "attribute": "交付格式", "value": "PDF", "confidence": 0.85, "category": "decision", "tags": ["交付", "客户A"]}

对话："我们以后用TypeScript写吧"
→ {"entity": "开发团队", "attribute": "编程语言", "value": "TypeScript", "confidence": 0.7, "category": "decision", "tags": ["技术栈"]}

对话："API端口好像是8080？不太确定"
→ {"entity": "API网关", "attribute": "端口", "value": "8080", "confidence": 0.4, "category": "api", "tags": ["配置"]}`;
  }

  /**
   * Call the LLM with exponential backoff retry.
   * Retries up to MAX_RETRIES times on network/5xx errors.
   */
  private async callModelWithRetry(prompt: string): Promise<string> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.callModel(prompt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Auth errors are not retried — the token is broken, not the network
        if (err instanceof ExtractionError && err.kind === "auth") {
          throw err;
        }
        if (attempt < MAX_RETRIES) {
          const delay = this._jitterDelay(BASE_RETRY_DELAY_MS * 2 ** attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError ?? new Error("Extraction API call failed after retries");
  }

  private _jitterDelay(baseMs: number): number {
    // ±25% jitter to avoid thundering herd
    return baseMs * (0.75 + Math.random() * 0.5);
  }

  protected async callModel(prompt: string): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.modelApiKey}`,
    };
    if (this.config.xApiKey) {
      headers["x-api-key"] = this.config.xApiKey;
    }

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_memories",
          schema: EXTRACTION_JSON_SCHEMA,
        },
      },
    };

    const response = await fetch(this.config.modelEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      // 401 = auth token expired/revoked, 403 = quota exceeded or permission
      if (response.status === 401 || response.status === 403) {
        throw new ExtractionError(
          `Extraction API auth error ${response.status}: ${text}`,
          "auth"
        );
      }
      // 429 = rate limit, 5xx = server error (transient)
      if (response.status === 429 || response.status >= 500) {
        throw new ExtractionError(
          `Extraction API error ${response.status}: ${text}`,
          "network"
        );
      }
      // 400/422 = bad request (model name wrong, schema invalid)
      if (response.status === 400 || response.status === 422) {
        throw new ExtractionError(
          `Extraction API model error ${response.status}: ${text}`,
          "model"
        );
      }
      throw new ExtractionError(
        `Extraction API error ${response.status}: ${text}`,
        "network"
      );
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

      // Support both wrapped ({ memories: [...] }) and bare array formats
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.memories)
          ? parsed.memories
          : [];

      return items
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
