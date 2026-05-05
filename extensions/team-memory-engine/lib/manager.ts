// TeamMemoryManager v2 — orchestrates Ledger + Graph + Risk + Decay + Mem0 + Extractor + TMS

import { randomUUID } from "crypto";
import type {
  Mem0Provider,
  StoredMemory,
  SearchResult,
  InjectOptions,
  UpdateOptions,
  InjectResult,
  UpdateResult,
  LedgerEntry,
  RiskScore,
  GraphNode,
  GraphEdge,
  GraphData,
  ManagerV2Options,
  EventLogEntry,
} from "./storage/types.js";
import {
  calculateStrengthFromLedger,
  getStrengthLabel,
  getActiveClaim,
  FORGETTING_CURVE_INTERVALS,
} from "./decay.js";
import { MemoryLedger, type InjectClaimOptions } from "./ledger.js";
import { MemoryGraph } from "./graph.js";
import { RiskModel } from "./risk.js";
import { runMigration } from "./migrate.js";
import { MemoryExtractor, type ExtractedMemory, type ExtractionConfig } from "./extractor.js";
import { TeamCapabilityModel } from "./tms.js";
import { extractEntityAttribute, roleConfidenceAdjustment } from "./extract-utils.js";

export type { Mem0Provider } from "./storage/types.js";

export interface ReminderOutput {
  type: "decay" | "risk";
  content: string;
  cards: string[];
}

export class TeamMemoryManager {
  private ledger: MemoryLedger;
  private graph: MemoryGraph;
  private risk: RiskModel;
  private mem0: Mem0Provider;
  private extractor: MemoryExtractor | null;
  private tms: TeamCapabilityModel | null;
  private projectRoot: string;
  private teamId: string;
  private defaultUserId: string;
  private reviewThreshold: number;
  private hasMem0Key: boolean;
  private teamSize: number;
  private enableGraph: boolean;


  constructor(mem0: Mem0Provider, options: ManagerV2Options) {
    this.teamId = options.teamId;
    this.defaultUserId = options.defaultUserId;
    this.reviewThreshold = options.reviewThreshold ?? 0.4;
    this.teamSize = options.teamSize ?? 5;
    this.enableGraph = options.enableGraph ?? true;
    this.hasMem0Key = !!(mem0 as unknown as Record<string, unknown>).apiKey;
    this.projectRoot = options.projectRoot ?? "";

    this.ledger = new MemoryLedger(options.teamId, options.ledgerPath);
    this.graph = new MemoryGraph(options.teamId, options.graphPath);
    this.risk = new RiskModel({
      weights: options.riskWeights,
      teamSize: this.teamSize,
    });
    this.mem0 = mem0;

    // LLM extractor (only if endpoint configured)
    if (options.modelEndpoint && options.modelApiKey) {
      this.extractor = new MemoryExtractor({
        modelEndpoint: options.modelEndpoint,
        modelApiKey: options.modelApiKey,
        modelName: options.modelName ?? "qwen-plus",
      });
    } else {
      this.extractor = null;
    }

    // TMS (only if project root configured)
    if (this.projectRoot) {
      this.tms = new TeamCapabilityModel(options.teamId, this.projectRoot);
    } else {
      this.tms = null;
    }
  }

  // ---- Lifecycle ----

  /** Check for v1 data and run migration if needed */
  async initialize(): Promise<void> {
    const isEmpty = await this.ledgerIsEmpty();
    if (isEmpty) {
      // Try migration from v1
      const result = await runMigration(undefined, undefined, this.teamId);
      if (result.migrated > 0) {
        // Rebuild graph after migration
        const entries = await this.ledger.getAllEntries(this.teamId);
        if (this.enableGraph && entries.length > 0) {
          await this.graph.rebuildFromLedger(entries);
        }
      }
    }
  }

  private async ledgerIsEmpty(): Promise<boolean> {
    const entries = await this.ledger.getAllEntries(this.teamId);
    return entries.length === 0;
  }

  // ---- Core Operations ----

  /** Inject memories extracted from event log entries using LLM */
  async injectFromEvent(entries: EventLogEntry[]): Promise<LedgerEntry[]> {
    if (entries.length === 0) return [];

    if (this.extractor) {
      const extracted = await this.extractor.extract(entries, {
        existingEntries: await this.ledger.getAllEntries(this.teamId),
        teamId: this.teamId,
      });
      const results: LedgerEntry[] = [];
      for (const mem of extracted) {
        const entry = await this.ledger.injectClaim({
          entity: mem.entity,
          attribute: mem.attribute,
          value: mem.value,
          confidence: mem.confidence,
          source: "llm_extraction",
          injectedBy: "memory-extractor",
          category: mem.category,
          tags: mem.tags,
          teamId: this.teamId,
          recallHalfLife: 14,
        });
        results.push(entry);
        await this._syncToMem0(entry, mem.value);
        if (this.enableGraph) await this.graph.incrementalUpdate(entry);
        for (const evt of entries) {
          if (!evt.extractedMemoryIds) evt.extractedMemoryIds = [];
          evt.extractedMemoryIds.push(entry.id);
        }
      }
      await this._syncTms();
      return results;
    }

    // Fallback: inject each event content as a raw memory (regex extraction)
    const results: LedgerEntry[] = [];
    for (const evt of entries) {
      const entry = await this.ledger.injectClaim({
        entity: "general",
        attribute: "message",
        value: evt.content,
        confidence: 0.5,
        source: "event_log_fallback",
        injectedBy: evt.senderId || "unknown",
        category: "general",
        tags: [],
        teamId: this.teamId,
        recallHalfLife: 14,
      });
      results.push(entry);
      if (this.enableGraph) await this.graph.incrementalUpdate(entry);
    }
    await this._syncTms();
    return results;
  }

  /** Inject a new team memory (ledger-backed) */
  async inject(text: string, options: InjectOptions = {}): Promise<InjectResult> {
    const author = options.author ?? this.defaultUserId;
    const category = options.category ?? "general";
    const tags = options.tags ?? [];

    // Extract entity/attribute from text (heuristic)
    const { entity, attribute, value } = extractEntityAttribute(text, category);

    const ledgerOptions: InjectClaimOptions = {
      entity,
      attribute,
      value,
      confidence: 0.7 + roleConfidenceAdjustment(author, this.defaultUserId), // Role-adjusted base confidence
      source: "manual_inject",
      injectedBy: author,
      category,
      tags,
      teamId: this.teamId,
      recallHalfLife: 14,
    };

    const entry = await this.ledger.injectClaim(ledgerOptions);

    // Check if a conflict was detected and resolved
    const conflict = this.ledger.lastConflict;
    this.ledger.lastConflict = null; // Clear for next call

    // Sync to Mem0 (best-effort)
    await this._syncToMem0(entry, text);

    // Update graph
    if (this.enableGraph) {
      await this.graph.incrementalUpdate(entry);
    }

    // Sync TMS
    await this._syncTms();

    const result: InjectResult = {
      id: entry.id,
      memory: text,
      metadata: this._entryToMeta(entry),
    };
    if (conflict) {
      result.conflict = {
        type: conflict.type,
        reason: conflict.reason,
      };
    }
    return result;
  }

  /** Update an existing team memory (ledger-backed) */
  async update(query: string, newText: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    const entries = await this.ledger.search(query);
    if (entries.length === 0) {
      throw new Error(`No memory found matching query: "${query}"`);
    }

    const target = entries[0];
    const author = options.author ?? this.defaultUserId;
    const previousVersion = target.current_version;

    // Inject as new claim (ledger handles conflict detection)
    const { entity, attribute, value } = extractEntityAttribute(newText, target.category);

    const updated = await this.ledger.injectClaim({
      entity: target.entity,
      attribute: target.attribute,
      value,
      confidence: 0.75,
      source: "update",
      injectedBy: author,
      category: target.category,
      tags: target.tags,
      teamId: this.teamId,
      recallHalfLife: target.recall_half_life,
    });

    // Sync to Mem0
    await this._syncToMem0(updated, newText);

    // Update graph
    if (this.enableGraph) {
      await this.graph.incrementalUpdate(updated);
    }

    // Sync TMS
    await this._syncTms();

    return {
      id: updated.id,
      memory: newText,
      previousVersion,
      metadata: this._entryToMeta(updated),
    };
  }

  /** List all memories with decay info */
  async status(category?: string): Promise<SearchResult[]> {
    const entries = await this.ledger.getAllEntries(this.teamId);
    const filtered = category ? entries.filter((e) => e.category === category) : entries;

    return filtered.map((e) => {
      const strength = calculateStrengthFromLedger(e);
      const activeClaim = getActiveClaim(e);
      const latestClaim = e.claims.length > 0 ? e.claims[e.claims.length - 1] : undefined;
      const displayClaim = activeClaim ?? latestClaim;
      return {
        id: e.id,
        memory: displayClaim?.value ?? e.id,
        strength,
        strengthLabel: getStrengthLabel(strength),
        metadata: this._entryToMeta(e),
      };
    });
  }

  /** Search memories (ledger search, strength-weighted) */
  async search(query: string): Promise<SearchResult[]> {
    if (this.hasMem0Key) {
      try {
        const mem0Results = await this.mem0.search(query, { user_id: this.teamId, top_k: 10 });
        const results: SearchResult[] = [];
        for (const r of (mem0Results ?? [])) {
          const localId = (r as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined;
          const localIdStr = localId?.team_memory_id as string | undefined;
          if (localIdStr) {
            const local = await this.ledger.getEntry(localIdStr);
            if (local) {
              const strength = calculateStrengthFromLedger(local);
              results.push({
                id: local.id,
                memory: getActiveClaim(local)?.value ?? local.id,
                strength,
                strengthLabel: getStrengthLabel(strength),
                metadata: this._entryToMeta(local),
              });
              continue;
            }
          }
        }
        if (results.length > 0) return results;
      } catch { /* fallback to local */ }
    }

    const entries = await this.ledger.search(query);
    return entries.map((e) => {
      const strength = calculateStrengthFromLedger(e);
      const activeClaim = getActiveClaim(e);
      const latestClaim = e.claims.length > 0 ? e.claims[e.claims.length - 1] : undefined;
      const displayClaim = activeClaim ?? latestClaim;
      return {
        id: e.id,
        memory: displayClaim?.value ?? e.id,
        strength,
        strengthLabel: getStrengthLabel(strength),
        metadata: this._entryToMeta(e),
      };
    });
  }

  /** Mark a memory as reviewed (bump confidence, reset decay) */
  async forceReview(memoryId: string): Promise<void> {
    const entry = await this.ledger.getEntry(memoryId);
    if (!entry) throw new Error(`Memory not found: ${memoryId}`);

    // Bump confidence of active claim (+0.05, consistent with ledger confirmation)
    for (const claim of entry.claims) {
      if (claim.status === "active" || claim.status === undefined) {
        claim.confidence = Math.min(1.0, claim.confidence + 0.05);
        claim.valid_from = new Date().toISOString(); // Reset decay clock
      }
    }

    // Bump access count
    entry.access_count = (entry.access_count ?? 0) + 1;
    entry.updatedAt = new Date().toISOString();

    await this.ledger.saveEntry(memoryId, entry);
  }

  /** Check and format reminders (decay + risk) */
  async checkAndFormatReminders(): Promise<ReminderOutput | null> {
    const entries = await this.ledger.getAllEntries(this.teamId);
    if (entries.length === 0) return null;

    // Compute risk scores
    const riskScores = await this.risk.computeAllRisks(entries);
    const triggered = riskScores.filter((s) => s.triggered);

    // Also check decay-based reminders
    const dueEntries = entries.filter(
      (e) => calculateStrengthFromLedger(e) < this.reviewThreshold
    );

    if (triggered.length === 0 && dueEntries.length === 0) return null;

    const cards: string[] = [];

    // Format risk alert cards
    for (const score of triggered) {
      const entry = entries.find((e) => e.id === score.memoryId);
      if (entry) {
        cards.push(this.risk.formatRiskCard(score, entry));
      }
    }

    // Build summary text
    let content = "";
    if (triggered.length > 0) {
      content += `${triggered.length} risk alert(s):\n\n`;
      for (const score of triggered.slice(0, 5)) {
        const entry = entries.find((e) => e.id === score.memoryId);
        const value = entry ? getActiveClaim(entry)?.value ?? "?" : "?";
        content += `[Risk=${(score.totalRisk * 100).toFixed(0)}%] ${entry?.entity}.${entry?.attribute}: ${value.substring(0, 60)}\n`;
      }
    }

    if (dueEntries.length > 0) {
      if (content) content += "\n";
      content += `${dueEntries.length} memory/ies need decay review:\n\n`;
      for (const e of dueEntries.slice(0, 5)) {
        const strength = calculateStrengthFromLedger(e);
        const label = getStrengthLabel(strength);
        const value = getActiveClaim(e)?.value ?? e.id;
        content += `[${label.toUpperCase()}] (${(strength * 100).toFixed(0)}%) ${value.substring(0, 60)}\n`;
      }
    }

    return { type: triggered.length > 0 ? "risk" : "decay", content, cards };
  }

  // ---- New v2 Operations ----

  /** Assess risk for all memories */
  async assessRisk(): Promise<RiskScore[]> {
    const entries = await this.ledger.getAllEntries(this.teamId);
    return this.risk.computeAllRisks(entries);
  }

  /** Resolve a conflict (user action: confirm/update/dismiss) */
  async resolveConflict(memoryId: string, action: "confirm" | "update" | "dismiss"): Promise<void> {
    const entry = await this.ledger.getEntry(memoryId);
    if (!entry) throw new Error(`Memory not found: ${memoryId}`);

    const conflictingClaims = entry.claims.filter((c) => c.status === "conflicting");
    if (conflictingClaims.length === 0) return;

    switch (action) {
      case "confirm": {
        // Keep the oldest conflicting claim, dismiss others
        const keepVersion = conflictingClaims[0].version;
        for (const claim of conflictingClaims) {
          claim.status = claim.version === keepVersion ? "active" : "superseded";
          if (claim.status === "superseded") {
            claim.valid_to = new Date().toISOString();
          }
        }
        break;
      }
      case "update": {
        // Keep most recent, dismiss others
        const keepVersion = conflictingClaims[conflictingClaims.length - 1].version;
        for (const claim of conflictingClaims) {
          claim.status = claim.version === keepVersion ? "active" : "superseded";
          if (claim.status === "superseded") {
            claim.valid_to = new Date().toISOString();
          }
        }
        break;
      }
      case "dismiss": {
        // Dismiss the newest conflicting claim (highest version), restore
        // existing conflicting claims to "active" — the original values.
        const maxVersion = Math.max(...entry.claims.map((c) => c.version));
        for (const claim of conflictingClaims) {
          claim.status = claim.version === maxVersion ? "superseded" : "active";
          if (claim.status === "superseded") {
            claim.valid_to = new Date().toISOString();
          }
        }
        break;
      }
    }

    entry.updatedAt = new Date().toISOString();
    await this.ledger.saveEntry(memoryId, entry);

    // Update graph
    if (this.enableGraph) {
      await this.graph.incrementalUpdate(entry);
    }
  }

  /** Get graph data (optionally filtered by entity) */
  async getGraph(entity?: string): Promise<GraphData> {
    const all = await this.graph.getAll();

    if (!entity) return all;

    // Filter to entity's subgraph
    const entityNodeId = `entity:${entity.replace(/[^a-zA-Z0-9一-鿿]/g, "_")}`;
    const relevantNodeIds = new Set<string>([entityNodeId]);

    // BFS one hop
    for (const edge of all.edges) {
      if (relevantNodeIds.has(edge.source)) relevantNodeIds.add(edge.target);
      if (relevantNodeIds.has(edge.target)) relevantNodeIds.add(edge.source);
    }

    return {
      nodes: all.nodes.filter((n) => relevantNodeIds.has(n.id)),
      edges: all.edges.filter(
        (e) => relevantNodeIds.has(e.source) && relevantNodeIds.has(e.target)
      ),
    };
  }

  /** Rebuild graph from current ledger state */
  async rebuildGraph(): Promise<void> {
    const entries = await this.ledger.getAllEntries(this.teamId);
    await this.graph.rebuildFromLedger(entries);
  }

  // ---- Internal Helpers ----

  /** Sync TMS from current ledger state (best-effort) */
  private async _syncTms(): Promise<void> {
    if (!this.tms) return;
    try {
      const entries = await this.ledger.getAllEntries(this.teamId);
      await this.tms.syncFromLedger(entries);
    } catch {
      // TMS sync failure — non-critical
    }
  }

  private async _syncToMem0(entry: LedgerEntry, text: string): Promise<void> {
    if (!this.hasMem0Key) return;
    try {
      await this.mem0.add(
        [{ role: "user", content: text }],
        {
          user_id: this.teamId,
          metadata: {
            team_memory_id: entry.id,
            category: entry.category,
            tags: entry.tags,
            version: entry.current_version,
          },
        }
      );
    } catch {
      // best-effort, local ledger is source of truth
    }
  }

  /** Convert LedgerEntry to v1-compatible TeamMemoryMeta for SearchResult */
  private _entryToMeta(entry: LedgerEntry) {
    const activeClaim = getActiveClaim(entry);
    const versionHistory = entry.claims.map((c) => ({
      version: c.version,
      text: c.value,
      updatedAt: c.valid_from,
      updatedBy: c.injected_by,
    }));

    return {
      injectedAt: entry.createdAt,
      lastReviewedAt: activeClaim?.valid_from ?? entry.createdAt,
      reviewCount: entry.access_count ?? 0,
      currentIntervalIndex: 0, // will be computed by decay from recall_half_life
      version: entry.current_version,
      injectedBy: activeClaim?.injected_by ?? "unknown",
      category: entry.category,
      tags: entry.tags,
      versionHistory,
    };
  }
}
