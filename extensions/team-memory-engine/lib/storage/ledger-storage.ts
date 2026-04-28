// LedgerStorageBackend — persisted versioned memory ledger

import * as fs from "fs";
import * as path from "path";
import type { LedgerEntry } from "./types.js";

const DEFAULT_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-ledger.json"
);

export class LedgerStorageBackend {
  private filePath: string;
  private cache: Map<string, LedgerEntry> | null = null;

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath;
  }

  async load(): Promise<Map<string, LedgerEntry>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      const data: Record<string, LedgerEntry> = JSON.parse(raw);
      this.cache = new Map(Object.entries(data));
    } catch {
      this.cache = new Map();
    }
    return this.cache;
  }

  async save(): Promise<void> {
    if (!this.cache) return;
    const tmpPath = this.filePath + ".tmp";
    const data: Record<string, LedgerEntry> = {};
    this.cache.forEach((v, k) => { data[k] = v; });
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.promises.rename(tmpPath, this.filePath);
  }

  async get(id: string): Promise<LedgerEntry | undefined> {
    const map = await this.load();
    return map.get(id);
  }

  async set(id: string, entry: LedgerEntry): Promise<void> {
    const map = await this.load();
    map.set(id, entry);
    await this.save();
  }

  async delete(id: string): Promise<void> {
    const map = await this.load();
    map.delete(id);
    await this.save();
  }

  async getAll(teamId?: string): Promise<LedgerEntry[]> {
    const map = await this.load();
    let items = Array.from(map.values());
    if (teamId) items = items.filter((m) => m.teamId === teamId);
    return items;
  }

  async getByEntityAttribute(
    entity: string,
    attribute: string,
    teamId?: string
  ): Promise<LedgerEntry[]> {
    const all = await this.getAll(teamId);
    return all.filter(
      (e) => e.entity === entity && e.attribute === attribute
    );
  }

  async search(query: string, teamId?: string): Promise<Array<LedgerEntry & { relevanceScore: number }>> {
    const all = await this.getAll(teamId);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = all.map((entry) => {
      const text = [
        entry.entity,
        entry.attribute,
        ...entry.claims.map((c) => c.value),
        entry.category,
        ...entry.tags,
      ].join(" ").toLowerCase();

      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 1;
      }
      // Bonus for exact query match in claim values
      const queryLower = query.toLowerCase();
      for (const claim of entry.claims) {
        if (claim.value.toLowerCase().includes(queryLower)) score += 2;
      }
      return { ...entry, relevanceScore: score };
    });

    return scored
      .filter((m) => m.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /** Check if this storage has any data */
  async isEmpty(): Promise<boolean> {
    const map = await this.load();
    return map.size === 0;
  }
}
