// AI Conflict Explainer — generates human-readable conflict analysis using LLM
// When a conflict is detected, this module calls the LLM to explain:
// - What the conflict is about
// - Timeline comparison (who said what, when)
// - Confidence assessment and recommended resolution

import type { LedgerEntry, LedgerClaim } from "./storage/types.js";
import type { ConflictResult } from "./ledger.js";

export interface ConflictExplanation {
  summary: string;         // One-line summary of the conflict
  timeline: string[];      // Timeline of statements
  analysis: string;        // Detailed analysis
  recommendation: string;  // Recommended action and why
  recommendedVersion: number; // Recommended version to keep (0 = unclear)
}

export interface ConflictExplainerConfig {
  modelEndpoint: string;
  modelApiKey: string;
  modelName: string;
  xApiKey?: string;
}

/** JSON Schema for conflict explanation output — sent via response_format */
const CONFLICT_EXPLAIN_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "一句话总结矛盾" },
    timeline: { type: "array", items: { type: "string" } },
    analysis: { type: "string", description: "详细分析，包括时间顺序、确认情况、置信度对比" },
    recommendation: { type: "string", description: "推荐保留哪个版本，以及为什么" },
    recommendedVersion: { type: "number", description: "版本号数字（如果不明确推荐则写 0）" },
  },
  required: ["summary", "timeline", "analysis", "recommendation", "recommendedVersion"],
  additionalProperties: false,
};

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Uses LLM to generate a detailed explanation of a detected conflict.
 * Falls back to rule-based explanation if LLM is unavailable.
 */
export class ConflictExplainer {
  private config: ConflictExplainerConfig | null;

  constructor(config?: ConflictExplainerConfig) {
    this.config = config ?? null;
  }

  /** Generate a conflict explanation for a given entry */
  async explainConflict(
    entry: LedgerEntry,
    conflict: ConflictResult
  ): Promise<ConflictExplanation> {
    if (this.config) {
      try {
        return await this._callLLM(entry, conflict);
      } catch {
        // Fallback to rule-based explanation
      }
    }
    return this._ruleBasedExplanation(entry, conflict);
  }

  /** Generate explanations for all conflicting entries */
  async explainAllConflicts(entries: LedgerEntry[]): Promise<ConflictExplanation[]> {
    const explanations: ConflictExplanation[] = [];
    for (const entry of entries) {
      const conflictingClaims = entry.claims.filter(c => c.status === "conflicting");
      if (conflictingClaims.length >= 2) {
        const activeClaim = entry.claims.find(c => c.status === "active");
        const latestClaim = entry.claims[entry.claims.length - 1];
        const conflict: ConflictResult = {
          type: "conflict-mark",
          existingEntry: entry,
          newClaim: latestClaim ?? { version: 0, value: "", valid_from: "", valid_to: null, confidence: 0.5, injected_by: "", confirmed_by: [], status: "conflicting" },
          confidenceDelta: 0,
          reason: `Conflicting values for ${entry.entity}.${entry.attribute}`,
        };
        const explanation = await this.explainConflict(entry, conflict);
        explanations.push(explanation);
      }
    }
    return explanations;
  }

  private async _callLLM(
    entry: LedgerEntry,
    conflict: ConflictResult
  ): Promise<ConflictExplanation> {
    const prompt = this._buildPrompt(entry, conflict);
    const response = await this._callModelWithRetry(prompt);
    return this._parseResponse(response, entry);
  }

  private _buildPrompt(entry: LedgerEntry, conflict: ConflictResult): string {
    const claims = entry.claims;
    const claimsText = claims
      .map((c, i) => {
        const time = c.valid_from ? new Date(c.valid_from).toLocaleString("zh-CN") : "未知时间";
        const who = c.injected_by || "未知";
        const confirmedBy = c.confirmed_by?.length > 0 ? `（已确认：${c.confirmed_by.join("、")}）` : "";
        return `v${c.version} [${c.status}]: "${c.value}" — ${who} 于 ${time} 提出${confirmedBy}，置信度 ${(c.confidence ?? 0).toFixed(2)}`;
      })
      .join("\n");

    return `你是一个团队决策分析助手。以下是一条团队记忆的版本链，其中存在矛盾。请分析这些版本，解释矛盾的原因，并给出推荐。

## 记忆条目
实体：${entry.entity}
属性：${entry.attribute}
类别：${entry.category}
标签：${entry.tags.join(", ") || "无"}

## 版本链
${claimsText}

## 冲突信息
冲突类型：${conflict.type}
原因：${conflict.reason}

请分析以下内容：
1. 矛盾的本质是什么（为什么前后不一致）
2. 从时间顺序、确认人数、置信度角度，哪个版本更可能是当前正确的
3. 推荐保留哪个版本，以及理由

返回 JSON 格式：
{
  "summary": "一句话总结矛盾",
  "timeline": ["时间线条目1", "时间线条目2"],
  "analysis": "详细分析，包括时间顺序、确认情况、置信度对比",
  "recommendation": "推荐保留哪个版本，以及为什么",
  "recommendedVersion": 版本号数字（如果不明确推荐则写 0）
}

只返回 JSON，不要其他文字。`;
  }

  private async _callModelWithRetry(prompt: string): Promise<string> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this._callModel(prompt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY_MS * 2 ** attempt * (0.75 + Math.random() * 0.5);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError ?? new Error("Conflict explainer API call failed after retries");
  }

  protected async _callModel(prompt: string): Promise<string> {
    if (!this.config) throw new Error("No model config");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.modelApiKey}`,
    };
    if (this.config.xApiKey) {
      headers["x-api-key"] = this.config.xApiKey;
    }

    const response = await fetch(this.config.modelEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.modelName,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "conflict_explanation",
            schema: CONFLICT_EXPLAIN_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Conflict explainer API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  private _parseResponse(response: string, entry: LedgerEntry): ConflictExplanation {
    if (!response.trim()) return this._ruleBasedExplanation(entry, {
      type: "human-confirm",
      existingEntry: entry,
      newClaim: entry.claims[entry.claims.length - 1],
      confidenceDelta: 0,
      reason: "",
    });

    let jsonStr = response.trim();
    const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeFenceMatch) {
      jsonStr = codeFenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        summary: String(parsed.summary || "").trim(),
        timeline: Array.isArray(parsed.timeline) ? parsed.timeline.map(String) : [],
        analysis: String(parsed.analysis || "").trim(),
        recommendation: String(parsed.recommendation || "").trim(),
        recommendedVersion: typeof parsed.recommendedVersion === "number" ? parsed.recommendedVersion : 0,
      };
    } catch {
      return this._ruleBasedExplanation(entry, {
        type: "human-confirm",
        existingEntry: entry,
        newClaim: entry.claims[entry.claims.length - 1],
        confidenceDelta: 0,
        reason: "",
      });
    }
  }

  /** Rule-based fallback explanation (no LLM needed) */
  private _ruleBasedExplanation(
    entry: LedgerEntry,
    conflict: ConflictResult
  ): ConflictExplanation {
    const conflictingClaims = entry.claims.filter(c => c.status === "conflicting" || c.status === "active");
    if (conflictingClaims.length < 2) {
      // Try all claims for a meaningful explanation
      const allClaims = entry.claims;
      if (allClaims.length < 2) {
        return {
          summary: `${entry.entity}的${entry.attribute}存在待确认信息`,
          timeline: allClaims.map(c => `v${c.version}: "${c.value}"`),
          analysis: "该条目有新旧两个版本，需要人工确认哪个是当前有效的。",
          recommendation: "请根据最新团队讨论决定保留哪个版本。",
          recommendedVersion: 0,
        };
      }
    }

    const sorted = [...conflictingClaims].sort((a, b) => a.version - b.version);
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];

    const timeline = sorted.map(c => {
      const time = c.valid_from ? new Date(c.valid_from).toLocaleString("zh-CN") : "未知时间";
      const who = c.injected_by || "未知";
      const confirmedBy = c.confirmed_by?.length > 0 ? `（${c.confirmed_by.length}人确认）` : "";
      return `v${c.version}（${time}）：${who} 提出"${c.value}"${confirmedBy}`;
    });

    // Rule-based recommendation
    let recommendedVersion = 0;
    let recommendation = "";

    const oldestConfirmedCount = (oldest.confirmed_by ?? []).length;
    const newestConfirmedCount = (newest.confirmed_by ?? []).length;

    if (newest.confidence > oldest.confidence && newestConfirmedCount >= oldestConfirmedCount) {
      recommendedVersion = newest.version;
      recommendation = `推荐保留 v${newest.version}：置信度更高（${newest.confidence.toFixed(2)} vs ${oldest.confidence.toFixed(2)}）`;
      if (newestConfirmedCount > 0) {
        recommendation += `，且有 ${newestConfirmedCount} 人确认`;
      }
      recommendation += "。";
    } else if (oldestConfirmedCount > newestConfirmedCount) {
      recommendedVersion = oldest.version;
      recommendation = `推荐保留 v${oldest.version}：有更多人确认（${oldestConfirmedCount}人 vs ${newestConfirmedCount}人），虽然版本较旧但团队共识更强。`;
    } else {
      recommendation = "两个版本的确认情况相当，请人工根据最新团队讨论决定保留哪个版本。";
    }

    return {
      summary: `${entry.entity}的${entry.attribute}存在矛盾：${oldest.value} vs ${newest.value}`,
      timeline,
      analysis: `该条目关于"${entry.entity}"的"${entry.attribute}"有两个不同说法。从时间顺序看，${oldestConfirmedCount > 0 ? `v${oldest.version} 有 ${oldestConfirmedCount} 人确认` : `v${oldest.version} 未经多人确认`}，${newestConfirmedCount > 0 ? `v${newest.version} 有 ${newestConfirmedCount} 人确认` : `v${newest.version} 未经多人确认`}。`,
      recommendation,
      recommendedVersion,
    };
  }

  /** Format a conflict explanation for CLI display */
  formatForCLI(explanation: ConflictExplanation): string {
    const lines: string[] = [];
    lines.push("━".repeat(50));
    lines.push("  🔍 AI 冲突分析报告");
    lines.push("━".repeat(50));
    lines.push("");
    lines.push(`  📋 ${explanation.summary}`);
    lines.push("");

    if (explanation.timeline.length > 0) {
      lines.push("  📅 时间线：");
      for (const t of explanation.timeline) {
        lines.push(`    • ${t}`);
      }
      lines.push("");
    }

    if (explanation.analysis) {
      lines.push("  📝 分析：");
      lines.push(`    ${explanation.analysis}`);
      lines.push("");
    }

    if (explanation.recommendation) {
      lines.push("  💡 推荐：");
      lines.push(`    ${explanation.recommendation}`);
      lines.push("");
    }

    lines.push("━".repeat(50));
    return lines.join("\n");
  }

  /** Format a conflict explanation for Feishu card */
  formatForCard(explanation: ConflictExplanation, entry: LedgerEntry): string {
    const claims = entry.claims.filter(c => c.status === "conflicting" || c.status === "active");
    const summary = explanation.summary || `${entry.entity}的${entry.attribute}存在矛盾`;

    return JSON.stringify({
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: { tag: "plain_text", content: `⚠️ 冲突裁决 — ${entry.entity}.${entry.attribute}` },
        template: "red",
      },
      elements: [
        {
          tag: "markdown",
          content: `**${summary}**`,
        },
        { tag: "hr" },
        {
          tag: "markdown",
          content: explanation.analysis ? `**分析**\n${explanation.analysis}` : "",
        },
        {
          tag: "action",
          actions: [
            ...claims.map((c) => ({
              tag: "button",
              text: { tag: "plain_text", content: `保留 v${c.version}: ${c.value.slice(0, 15)}...` },
              type: "primary",
              value: { action: "review", entryId: entry.id, version: c.version },
            })),
            {
              tag: "button",
              text: { tag: "plain_text", content: "两个都保留" },
              type: "default",
              value: { action: "keep_both", entryId: entry.id },
            },
          ] as Array<Record<string, unknown>>,
        },
      ],
    });
  }
}
