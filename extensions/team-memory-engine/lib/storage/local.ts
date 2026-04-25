// Local JSON file storage backend

import * as fs from "fs";
import * as path from "path";
import type { StoredMemory } from "./types.js";

const DEFAULT_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-team-memory.json"
);

export class LocalStorageBackend {
  private filePath: string;
  private cache: Map<string, StoredMemory> | null = null;
  private savePromise: Promise<void> | null = null;

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath;
  }

  async load(): Promise<Map<string, StoredMemory>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      const data: Record<string, StoredMemory> = JSON.parse(raw);
      this.cache = new Map(Object.entries(data));
    } catch {
      this.cache = new Map();
    }
    return this.cache;
  }

  async save(): Promise<void> {
    if (!this.cache) return;
    if (this.savePromise) return this.savePromise;
    this.savePromise = this._save();
    return this.savePromise;
  }

  private async _save(): Promise<void> {
    if (!this.cache) return;
    const tmpPath = this.filePath + ".tmp";
    const data: Record<string, StoredMemory> = {};
    this.cache.forEach((v, k) => { data[k] = v; });
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.promises.rename(tmpPath, this.filePath);
    this.savePromise = null;
  }

  async get(id: string): Promise<StoredMemory | undefined> {
    const map = await this.load();
    return map.get(id);
  }

  async set(id: string, memory: StoredMemory): Promise<void> {
    const map = await this.load();
    map.set(id, memory);
    await this.save();
  }

  async delete(id: string): Promise<void> {
    const map = await this.load();
    map.delete(id);
    await this.save();
  }

  async getAll(teamId?: string): Promise<StoredMemory[]> {
    const map = await this.load();
    let items = Array.from(map.values());
    if (teamId) items = items.filter((m) => m.teamId === teamId);
    return items;
  }

  /** Full-text search over memory content, tags, and category */
  async search(query: string, teamId?: string): Promise<Array<StoredMemory & { relevanceScore: number }>> {
    const all = await this.getAll(teamId);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = all.map((memory) => {
      const text = `${memory.memory} ${memory.metadata.tags.join(" ")} ${memory.metadata.category}`.toLowerCase();
      const memoryLower = memory.memory.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 1;
        if (memoryLower.includes(query.toLowerCase())) score += 2;
        if (memory.metadata.tags.some((t) => t.toLowerCase().includes(term))) score += 1.5;
      }
      return { ...memory, relevanceScore: score };
    });

    return scored
      .filter((m) => m.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
