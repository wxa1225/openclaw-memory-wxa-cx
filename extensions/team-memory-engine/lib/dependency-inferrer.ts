// AI-Powered Graph Dependency Inference — LLM-driven cross-memory dependency detection
//
// When a new memory is created or during background processing, the LLM scans
// existing memories and identifies dependencies between them. These dependencies
// populate the `dependency_graph` field on each ledger entry.
//
// This enables:
// - Impact analysis: if memory A changes, which other memories are affected?
// - Conflict propagation: if A conflicts with B, and B is depended on by C, C is also at risk
// - Graph centrality: memories with many dependencies are structurally important

import type { LedgerEntry } from "./storage/types.js";

export interface MemoryDependency {
  sourceId: string;    // The memory that depends on another
  targetId: string;    // The memory being depended on
  relation: string;    // e.g., "references", "depends_on", "contradicts", "implements"
  reason: string;      // Explanation of why this dependency exists
}

export interface DependencyInferenceResult {
  dependencies: MemoryDependency[];
  updatedEntries: LedgerEntry[];
}

export interface DependencyInferenceConfig {
  modelEndpoint: string;
  modelApiKey: string;
  modelName: string;
  xApiKey?: string;
  /** Maximum number of entries to process in one batch (to avoid huge prompts) */
  batchSize?: number;
}

/**
 * Uses LLM to infer cross-memory dependencies from existing ledger entries.
 */
export class DependencyInferrer {
  private config: DependencyInferenceConfig | null;

  constructor(config?: DependencyInferenceConfig) {
    this.config = config ?? null;
  }

  /**
   * Infer dependencies for a set of ledger entries.
   * The LLM analyzes relationships between all entries and identifies dependencies.
   */
  async inferDependencies(entries: LedgerEntry[]): Promise<DependencyInferenceResult> {
    if (!this.config || entries.length < 2) {
      return { dependencies: [], updatedEntries: entries };
    }

    const batchSize = this.config.batchSize ?? 20;
    const allDependencies: MemoryDependency[] = [];

    // Process in batches to avoid huge prompts
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const dependencies = await this._inferBatch(batch);
      allDependencies.push(...dependencies);
    }

    // Update entries with their inferred dependencies
    const updatedEntries = this._applyDependencies(entries, allDependencies);

    return { dependencies: allDependencies, updatedEntries };
  }

  /**
   * Incrementally infer dependencies for newly added entries against existing ones.
   */
  async inferNewEntryDependencies(
    newEntry: LedgerEntry,
    existingEntries: LedgerEntry[]
  ): Promise<MemoryDependency[]> {
    if (!this.config || existingEntries.length === 0) return [];

    // Only send the new entry + relevant existing entries (same entity/category/tags)
    const relevant = this._findRelevantEntries(newEntry, existingEntries, 10);
    if (relevant.length === 0) return [];

    const prompt = this._buildIncrementalPrompt(newEntry, relevant);
    try {
      const response = await this._callModel(prompt);
      return this._parseDependencies(response, newEntry.id);
    } catch {
      return [];
    }
  }

  /**
   * Compute graph centrality scores (PageRank-like).
   * A memory with high centrality is structurally important.
   */
  computeCentrality(entries: LedgerEntry[]): Map<string, number> {
    // Build adjacency list from dependency_graph
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const entry of entries) {
      inDegree.set(entry.id, 0);
      outDegree.set(entry.id, entry.dependency_graph?.length ?? 0);
    }

    for (const entry of entries) {
      for (const targetId of (entry.dependency_graph ?? [])) {
        inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);
      }
    }

    // Simple centrality: in_degree + 0.5 * out_degree (normalized)
    const maxDegree = Math.max(1, ...inDegree.values(), ...outDegree.values());
    const centrality = new Map<string, number>();
    for (const entry of entries) {
      const score = (inDegree.get(entry.id) ?? 0) + 0.5 * (outDegree.get(entry.id) ?? 0);
      centrality.set(entry.id, score / maxDegree);
    }

    return centrality;
  }

  /**
   * Detect conflict propagation: if entry A conflicts with B, and B is depended on by C,
   * then C's reliability is also compromised.
   */
  detectConflictPropagation(
    entries: LedgerEntry[],
    conflictingEntryId: string
  ): LedgerEntry[] {
    const affected: LedgerEntry[] = [];

    // Build a reverse dependency map
    const dependsOn = new Map<string, string[]>();
    for (const entry of entries) {
      for (const targetId of (entry.dependency_graph ?? [])) {
        if (!dependsOn.has(targetId)) dependsOn.set(targetId, []);
        dependsOn.get(targetId)!.push(entry.id);
      }
    }

    // BFS from the conflicting entry
    const visited = new Set<string>();
    const queue = [conflictingEntryId];
    visited.add(conflictingEntryId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = dependsOn.get(current) ?? [];
      for (const depId of dependents) {
        if (!visited.has(depId)) {
          visited.add(depId);
          const depEntry = entries.find(e => e.id === depId);
          if (depEntry) affected.push(depEntry);
          queue.push(depId);
        }
      }
    }

    return affected;
  }

  private async _inferBatch(entries: LedgerEntry[]): Promise<MemoryDependency[]> {
    if (entries.length < 2) return [];

    const prompt = this._buildBatchPrompt(entries);
    try {
      const response = await this._callModel(prompt);
      return this._parseDependencies(response);
    } catch {
      return [];
    }
  }

  private _buildBatchPrompt(entries: LedgerEntry[]): string {
    const entriesText = entries
      .map(e => {
        const activeClaim = e.claims.find(c => c.status === "active") ?? e.claims[e.claims.length - 1];
        return `${e.id}: [${e.category}] ${e.entity}.${e.attribute} = "${activeClaim?.value ?? "N/A"}" (tags: ${e.tags.join(",") || "none"})`;
      })
      .join("\n");

    return `你是一个团队记忆关系分析系统。以下是一组团队记忆条目，请分析它们之间的依赖关系。

## 记忆条目
${entriesText}

## 任务
找出这些记忆条目之间的依赖关系。依赖关系类型包括：
- references: 一个记忆引用了另一个记忆中的实体（如"客户A"的项目和"客户A"的交付格式）
- depends_on: 一个记忆的实现或执行依赖于另一个记忆（如"部署流程"依赖于"API端点"）
- contradicts: 两个记忆存在潜在矛盾（需要人工进一步确认）
- implements: 一个记忆是另一个记忆的具体实现（如"技术方案"实现了"架构决策"）
- updates: 一个记忆更新了另一个记忆的部分信息

返回 JSON 数组，每个元素如下：
[
  {
    "sourceId": "依赖方的记忆ID",
    "targetId": "被依赖的记忆ID",
    "relation": "references|depends_on|contradicts|implements|updates",
    "reason": "为什么存在这个依赖关系，一句话解释"
  }
]

注意：
- 只返回实际存在的依赖关系，不要编造
- 如果找不到任何依赖关系，返回空数组
- 每个依赖对只返回一次（不要重复）

只返回 JSON 数组，不要其他文字。`;
  }

  private _buildIncrementalPrompt(newEntry: LedgerEntry, existingEntries: LedgerEntry[]): string {
    const newText = this._entryToText(newEntry);
    const existingText = existingEntries
      .map(e => `${e.id}: ${this._entryToText(e)}`)
      .join("\n");

    return `你是一个团队记忆关系分析系统。团队新增了一条记忆，请分析它与现有记忆之间的依赖关系。

## 新记忆
${newEntry.id}: ${newText}

## 现有记忆
${existingText}

## 任务
找出新记忆与现有记忆之间的依赖关系。依赖关系类型：
- references: 新记忆引用了现有记忆中的实体
- depends_on: 新记忆的执行依赖于现有记忆
- contradicts: 新记忆与现有记忆存在潜在矛盾
- implements: 新记忆是现有记忆的具体实现
- updates: 新记忆更新了现有记忆的部分信息

返回 JSON 数组，格式同上。只返回 JSON，不要其他文字。`;
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
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Dependency inference API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  private _parseDependencies(response: string, filterSourceId?: string): MemoryDependency[] {
    if (!response.trim()) return [];

    let jsonStr = response.trim();
    const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeFenceMatch) {
      jsonStr = codeFenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((d: any) => d.sourceId && d.targetId && d.relation && d.reason)
        .map((d: any) => ({
          sourceId: String(d.sourceId).trim(),
          targetId: String(d.targetId).trim(),
          relation: String(d.relation).trim(),
          reason: String(d.reason).trim(),
        }))
        .filter((d: MemoryDependency) => {
          // Don't create self-dependencies
          if (d.sourceId === d.targetId) return false;
          // Filter by source ID if specified
          if (filterSourceId && d.sourceId !== filterSourceId) return false;
          return true;
        });
    } catch {
      return [];
    }
  }

  private _applyDependencies(
    entries: LedgerEntry[],
    dependencies: MemoryDependency[]
  ): LedgerEntry[] {
    const entryMap = new Map(entries.map(e => [e.id, e]));

    // Clear old dependency_graph (it was always empty anyway)
    for (const entry of entries) {
      entry.dependency_graph = [];
    }

    // Populate from inferred dependencies
    for (const dep of dependencies) {
      const source = entryMap.get(dep.sourceId);
      if (source) {
        if (!source.dependency_graph) source.dependency_graph = [];
        if (!source.dependency_graph.includes(dep.targetId)) {
          source.dependency_graph.push(dep.targetId);
        }
      }
    }

    return entries;
  }

  private _findRelevantEntries(
    newEntry: LedgerEntry,
    existingEntries: LedgerEntry[],
    maxCount: number
  ): LedgerEntry[] {
    const relevant: Array<{ entry: LedgerEntry; score: number }> = [];

    for (const entry of existingEntries) {
      let score = 0;
      // Same entity
      if (entry.entity === newEntry.entity) score += 10;
      // Same category
      if (entry.category === newEntry.category) score += 3;
      // Shared tags
      const sharedTags = entry.tags.filter(t => newEntry.tags.includes(t));
      score += sharedTags.length * 2;
      // Entity substring match
      if (entry.entity.includes(newEntry.entity) || newEntry.entity.includes(entry.entity)) score += 5;

      if (score > 0) {
        relevant.push({ entry, score });
      }
    }

    return relevant
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCount)
      .map(r => r.entry);
  }

  private _entryToText(entry: LedgerEntry): string {
    const parts: string[] = [];
    parts.push(`${entry.entity}的${entry.attribute}`);
    for (const claim of entry.claims) {
      if (claim.status === "active" || claim.status === "conflicting") {
        parts.push(claim.value);
      }
    }
    if (entry.category && entry.category !== "general") parts.push(entry.category);
    if (entry.tags.length > 0) parts.push(entry.tags.join(", "));
    return parts.join("，");
  }
}
