// LedgerStorageBackend — persisted versioned memory ledger with in-memory indexes

import * as fs from "fs";
import * as path from "path";
import type { LedgerEntry } from "./types.js";

const DEFAULT_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-ledger.json"
);

/**
 * Cross-process file lock using a .lock sentinel file.
 *
 * This is a cooperative lock — all readers and writers of the ledger
 * file must use it. It uses a simple spin-lock with setTimeout to
 * avoid blocking the event loop.
 */
class CrossProcessLock {
  private lockPath: string;

  constructor(filePath: string) {
    this.lockPath = filePath + ".lock";
  }

  /** Acquire the lock, spinning with delays if already held */
  async acquire(maxRetries = 20, retryDelayMs = 50): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Try to create lock file with exclusive flag (fails if exists)
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
        return;
      } catch {
        // Lock held by another process, wait and retry
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    // Force acquire — stale lock
    fs.writeFileSync(this.lockPath, String(process.pid));
  }

  /** Release the lock */
  release(): void {
    try {
      fs.rmSync(this.lockPath, { force: true });
    } catch {
      // Lock already released
    }
  }
}

/** In-memory indexes for faster lookups.
 * Built lazily on first query and kept in sync with mutations. */
interface LedgerIndexes {
  /** entity → set of entry ids */
  byEntity: Map<string, Set<string>>;
  /** entity.attribute → set of entry ids */
  byEntityAttribute: Map<string, Set<string>>;
  /** tag → set of entry ids */
  byTag: Map<string, Set<string>>;
}

function createIndexes(): LedgerIndexes {
  return {
    byEntity: new Map(),
    byEntityAttribute: new Map(),
    byTag: new Map(),
  };
}

function indexEntry(indexes: LedgerIndexes, entry: LedgerEntry): void {
  const eaKey = `${entry.entity}.${entry.attribute}`;

  if (!indexes.byEntity.has(entry.entity)) indexes.byEntity.set(entry.entity, new Set());
  indexes.byEntity.get(entry.entity)!.add(entry.id);

  if (!indexes.byEntityAttribute.has(eaKey)) indexes.byEntityAttribute.set(eaKey, new Set());
  indexes.byEntityAttribute.get(eaKey)!.add(entry.id);

  for (const tag of entry.tags) {
    if (!indexes.byTag.has(tag)) indexes.byTag.set(tag, new Set());
    indexes.byTag.get(tag)!.add(entry.id);
  }
}

function removeEntryFromIndexes(indexes: LedgerIndexes, entry: LedgerEntry): void {
  const eaKey = `${entry.entity}.${entry.attribute}`;

  indexes.byEntity.get(entry.entity)?.delete(entry.id);
  indexes.byEntityAttribute.get(eaKey)?.delete(entry.id);
  for (const tag of entry.tags) {
    indexes.byTag.get(tag)?.delete(entry.id);
  }
}

function buildIndexes(entries: Map<string, LedgerEntry>): LedgerIndexes {
  const indexes = createIndexes();
  for (const entry of entries.values()) {
    indexEntry(indexes, entry);
  }
  return indexes;
}

export class LedgerStorageBackend {
  private filePath: string;
  private cache: Map<string, LedgerEntry> | null = null;
  private indexes: LedgerIndexes | null = null;
  // Write lock queue: chains writes sequentially to prevent race conditions
  private writeLock = Promise.resolve();
  // Cross-process lock for multi-process safety
  private lock: CrossProcessLock;

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath;
    this.lock = new CrossProcessLock(filePath);
  }

  async load(): Promise<Map<string, LedgerEntry>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      const data: Record<string, LedgerEntry> = JSON.parse(raw);
      this.cache = new Map(Object.entries(data));
      this.indexes = buildIndexes(this.cache);
    } catch {
      this.cache = new Map();
      this.indexes = createIndexes();
    }
    return this.cache;
  }

  async save(): Promise<void> {
    if (!this.cache) return;
    // Cross-process lock: prevents concurrent writes from separate Node.js processes
    await this.lock.acquire();
    try {
      const tmpPath = this.filePath + ".tmp";
      const data: Record<string, LedgerEntry> = {};
      this.cache.forEach((v, k) => { data[k] = v; });
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tmpPath, this.filePath);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Queue-based write lock: each write is chained through a promise queue
   * to prevent race conditions from concurrent async calls.
   */
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    let resolve: () => void;
    let reject: (err: unknown) => void;
    const nextLock = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const currentLock = this.writeLock;
    this.writeLock = nextLock;

    try {
      const result = await currentLock.then(fn);
      resolve!();
      return result;
    } catch (err) {
      reject!(err);
      throw err;
    }
  }

  async get(id: string): Promise<LedgerEntry | undefined> {
    const map = await this.load();
    return map.get(id);
  }

  async set(id: string, entry: LedgerEntry): Promise<void> {
    await this.withWriteLock(async () => {
      const map = await this.load();
      const oldEntry = map.get(id);
      if (oldEntry) {
        removeEntryFromIndexes(this.indexes!, oldEntry);
      }
      map.set(id, entry);
      indexEntry(this.indexes!, entry);
      await this.save();
    });
  }

  async delete(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const map = await this.load();
      const entry = map.get(id);
      if (entry) {
        removeEntryFromIndexes(this.indexes!, entry);
        map.delete(id);
      }
      await this.save();
    });
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
    await this.load(); // ensure cache is loaded
    const eaKey = `${entity}.${attribute}`;
    const ids = this.indexes!.byEntityAttribute.get(eaKey);
    if (!ids || ids.size === 0) return [];

    const map = this.cache!;
    let results = [...ids].map((id) => map.get(id)).filter(Boolean) as LedgerEntry[];
    if (teamId) results = results.filter((e) => e.teamId === teamId);
    return results;
  }

  async search(query: string, teamId?: string): Promise<Array<LedgerEntry & { relevanceScore: number }>> {
    const all = await this.getAll(teamId);
    const queryLower = query.toLowerCase();

    // Build query terms: use both whitespace split and character bigrams for Chinese support
    const spaceTerms = queryLower.split(/\s+/).filter(Boolean);
    const queryChars = [...queryLower];
    const charBigrams = new Set<string>();
    for (let i = 0; i < queryChars.length - 1; i++) {
      charBigrams.add(queryChars[i] + queryChars[i + 1]);
    }

    const scored = all.map((entry) => {
      const text = [
        entry.entity,
        entry.attribute,
        ...entry.claims.map((c) => c.value),
        entry.category,
        ...entry.tags,
      ].join(" ").toLowerCase();

      let score = 0;

      // Whitespace term matches (good for English and space-separated queries)
      for (const term of spaceTerms) {
        if (text.includes(term)) score += 2;
      }

      // Character bigram matches (works for Chinese without spaces)
      for (const bigram of charBigrams) {
        if (text.includes(bigram)) score += 1;
      }

      // Bonus for full query match in claim values (highest priority)
      for (const claim of entry.claims) {
        const claimValue = claim.value.toLowerCase();
        if (claimValue === queryLower) score += 10;
        else if (claimValue.includes(queryLower)) score += 5;
      }

      // Bonus for entity/attribute exact match
      if (entry.entity.toLowerCase().includes(queryLower)) score += 3;
      if (entry.attribute.toLowerCase().includes(queryLower)) score += 2;

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
