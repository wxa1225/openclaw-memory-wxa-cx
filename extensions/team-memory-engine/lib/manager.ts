// TeamMemoryManager — orchestrates storage, decay, and Mem0 integration

import { randomUUID } from "crypto";
import type {
  Mem0Provider,
  StoredMemory,
  TeamMemoryMeta,
  InjectOptions,
  UpdateOptions,
  InjectResult,
  UpdateResult,
  SearchResult,
} from "./storage/types.js";
import {
  calculateStrength,
  getStrengthLabel,
  isDueForReview,
  formatReviewCard,
  getNextIntervalIndex,
} from "./decay.js";
import { LocalStorageBackend } from "./storage/local.js";

export type { Mem0Provider } from "./storage/types.js";

export interface ManagerOptions {
  teamId: string;
  defaultUserId: string;
  storagePath?: string;
  reviewThreshold?: number;
}

export class TeamMemoryManager {
  private mem0: Mem0Provider;
  private local: LocalStorageBackend;
  private teamId: string;
  private defaultUserId: string;
  private reviewThreshold: number;
  private hasMem0Key: boolean;

  constructor(mem0: Mem0Provider, options: ManagerOptions) {
    this.mem0 = mem0;
    this.local = new LocalStorageBackend(options.storagePath);
    this.teamId = options.teamId;
    this.defaultUserId = options.defaultUserId;
    this.reviewThreshold = options.reviewThreshold ?? 0.4;
    this.hasMem0Key = !!(mem0 as Record<string, unknown>).apiKey;
  }

  // ---- inject: store a new memory ----
  async inject(text: string, options: InjectOptions = {}): Promise<InjectResult> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const author = options.author ?? this.defaultUserId;

    const metadata: TeamMemoryMeta = {
      injectedAt: now,
      lastReviewedAt: now,
      reviewCount: 0,
      currentIntervalIndex: 0,
      version: 1,
      injectedBy: author,
      category: options.category ?? "general",
      tags: options.tags ?? [],
      versionHistory: [{ version: 1, text, updatedAt: now, updatedBy: author }],
    };

    const memory: StoredMemory = {
      id, memory: text, teamId: this.teamId, metadata, createdAt: now, updatedAt: now,
    };

    await this.local.set(id, memory);

    if (this.hasMem0Key) {
      try {
        await this.mem0.add(
          [{ role: "user", content: text }],
          { user_id: this.teamId, metadata: { team_memory_id: id, category: metadata.category, tags: metadata.tags, version: metadata.version } }
        );
      } catch { /* best-effort, local storage is source of truth */ }
    }

    return { id, memory: text, metadata };
  }

  // ---- update: search by query, replace content, bump version ----
  async update(query: string, newText: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    const results = await this.local.search(query, this.teamId);
    if (results.length === 0) {
      throw new Error(`No memory found matching query: "${query}"`);
    }

    const target = results[0];
    const now = new Date().toISOString();
    const previousVersion = target.metadata.version;
    const newVersion = previousVersion + 1;
    const author = options.author ?? this.defaultUserId;

    const updated: StoredMemory = {
      ...target,
      memory: newText,
      updatedAt: now,
      metadata: {
        ...target.metadata,
        version: newVersion,
        versionHistory: [
          ...target.metadata.versionHistory,
          { version: newVersion, text: newText, updatedAt: now, updatedBy: author },
        ],
        lastReviewedAt: now,
        currentIntervalIndex: 0,
        reviewCount: 0,
      },
    };

    await this.local.set(target.id, updated);

    if (this.hasMem0Key) {
      try {
        await this.mem0.add(
          [{ role: "user", content: newText }],
          { user_id: this.teamId, metadata: { team_memory_id: target.id } }
        );
      } catch { /* best-effort */ }
    }

    return { id: target.id, memory: newText, previousVersion, metadata: updated.metadata };
  }

  // ---- status: list all memories with decay info ----
  async status(category?: string): Promise<SearchResult[]> {
    const all = await this.local.getAll(this.teamId);
    const filtered = category ? all.filter((m) => m.metadata.category === category) : all;

    return filtered.map((m) => {
      const strength = calculateStrength(m);
      return {
        id: m.id, memory: m.memory, strength, strengthLabel: getStrengthLabel(strength), metadata: m.metadata,
      };
    });
  }

  // ---- search: text search with decay-weighted results ----
  async search(query: string): Promise<SearchResult[]> {
    if (this.hasMem0Key) {
      try {
        const mem0Results = await this.mem0.search(query, { user_id: this.teamId, top_k: 10 });
        const results: SearchResult[] = [];
        for (const r of (mem0Results ?? [])) {
          const localId = (r as Record<string, unknown>)?.metadata?.team_memory_id as string | undefined;
          if (localId) {
            const local = await this.local.get(localId);
            if (local) {
              const strength = calculateStrength(local);
              results.push({ id: local.id, memory: local.memory, strength, strengthLabel: getStrengthLabel(strength), metadata: local.metadata });
              continue;
            }
          }
          const score = (r as Record<string, unknown>)?.score as number | undefined;
          const s = score ?? 0.5;
          results.push({ id: (r as Record<string, unknown>)?.id as string ?? "", memory: (r as Record<string, unknown>)?.memory as string ?? "", strength: s, strengthLabel: getStrengthLabel(s), metadata: {} as TeamMemoryMeta });
        }
        if (results.length > 0) return results;
      } catch { /* fallback to local */ }
    }

    const localResults = await this.local.search(query, this.teamId);
    return localResults.map((m) => {
      const strength = calculateStrength(m);
      return { id: m.id, memory: m.memory, strength, strengthLabel: getStrengthLabel(strength), metadata: m.metadata };
    });
  }

  // ---- forceReview: reset decay curve to next interval ----
  async forceReview(memoryId: string): Promise<void> {
    const memory = await this.local.get(memoryId);
    if (!memory) throw new Error(`Memory not found: ${memoryId}`);

    const now = new Date().toISOString();
    const nextIndex = getNextIntervalIndex(memory);

    const updated: StoredMemory = {
      ...memory, updatedAt: now,
      metadata: { ...memory.metadata, lastReviewedAt: now, reviewCount: memory.metadata.reviewCount + 1, currentIntervalIndex: nextIndex },
    };

    await this.local.set(memoryId, updated);
  }

  // ---- checkAndFormatReminders: find decaying memories, format review cards ----
  async checkAndFormatReminders(): Promise<string | null> {
    const all = await this.local.getAll(this.teamId);
    const due = all.filter((m) => isDueForReview(m, this.reviewThreshold));

    if (due.length === 0) return null;

    due.sort((a, b) => calculateStrength(a) - calculateStrength(b));

    const lines = due.map((m) => {
      const strength = calculateStrength(m);
      const label = getStrengthLabel(strength);
      return `[${label.toUpperCase()}] (${Math.round(strength * 100)}%) ${m.memory.substring(0, 80)}${m.memory.length > 80 ? "..." : ""}`;
    });

    return `${due.length} memory/ies need review:\n\n${lines.join("\n")}`;
  }
}
