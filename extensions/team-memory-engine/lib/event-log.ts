// Event Log — date-partitioned raw conversation capture (Layer 1)
//
// Processed IDs are tracked in a separate `processed-ids.json` file to avoid
// rewriting daily log files when marking entries as processed.

import * as fs from "fs";
import * as path from "path";
import type { EventLogEntry } from "./storage/types.js";

// Module-level write locks keyed by date file path.
// This prevents concurrent appends from overwriting each other (read-modify-write race).
const writeLocks = new Map<string, Promise<void>>();

function withWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  let resolve: () => void;
  let reject: (err: unknown) => void;
  const nextLock = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const currentLock = writeLocks.get(filePath) ?? Promise.resolve();
  writeLocks.set(filePath, nextLock);

  return currentLock.then(async () => {
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }).catch(async (err) => {
    reject!(err);
    throw err;
  });
}

export class EventLog {
  private logDir: string;
  private processedIdsPath: string;
  private processedIdsCache: Set<string> | null = null;

  constructor(projectRoot: string) {
    this.logDir = path.join(projectRoot, "memory", "event-log");
    this.processedIdsPath = path.join(projectRoot, "memory", "event-log", "processed-ids.json");
  }

  /** Append a message to the event log */
  async append(
    entry: Omit<EventLogEntry, "id" | "storedAt" | "processedForExtraction">
  ): Promise<EventLogEntry> {
    await fs.promises.mkdir(this.logDir, { recursive: true });

    const fullEntry: EventLogEntry = {
      ...entry,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      storedAt: new Date().toISOString(),
      processedForExtraction: false,
    };
    await this.appendToDailyFile(fullEntry);
    return fullEntry;
  }

  /** Get all events for a date range */
  async query(options: {
    startDate?: string;
    endDate?: string;
    chatId?: string;
    senderId?: string;
  }): Promise<EventLogEntry[]> {
    const files = await this.listFiles();
    const results: EventLogEntry[] = [];

    for (const file of files) {
      const date = path.basename(file, ".json");
      if (options.startDate && date < options.startDate) continue;
      if (options.endDate && date > options.endDate) continue;

      const entries = await this.readDailyFile(date);
      for (const e of entries) {
        if (options.chatId && e.chatId !== options.chatId) continue;
        if (options.senderId && e.senderId !== options.senderId) continue;
        results.push(e);
      }
    }

    return results;
  }

  /** Get events not yet processed for memory extraction */
  async getUnprocessed(): Promise<EventLogEntry[]> {
    const processed = await this.loadProcessedIds();
    const all = await this.query({});
    return all.filter((e) => !processed.has(e.id));
  }

  /** Mark events as processed — appends IDs to processed-ids.json */
  async markProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const processed = await this.loadProcessedIds();
    for (const id of ids) processed.add(id);
    await this.saveProcessedIds(processed);
  }

  /** Append a card action result (user interaction with memory cards) to the event log */
  async appendCardAction(entry: {
    chatId: string;
    chatType: "p2p" | "group";
    senderId: string;
    action: string;
    memoryId: string;
    memoryText?: string;
    category?: string;
  }): Promise<void> {
    await fs.promises.mkdir(this.logDir, { recursive: true });

    const cardEntry: EventLogEntry = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      storedAt: new Date().toISOString(),
      chatId: entry.chatId,
      chatType: entry.chatType,
      senderId: entry.senderId,
      content: `[CARD_ACTION] action=${entry.action} memory_id=${entry.memoryId}${entry.memoryText ? ` text="${entry.memoryText}"` : ""}`,
      contentType: "text",
      messageId: `card-${entry.memoryId}-${entry.action}`,
      threadId: undefined,
      participants: undefined,
      processedForExtraction: true, // Already processed, don't re-extract
      tags: ["card_action", entry.action],
    };

    await this.appendToDailyFile(cardEntry);
  }

  // ---- Internal ----

  private dateFilePath(date: string): string {
    return path.join(this.logDir, `${date}.json`);
  }

  private async readDailyFile(date: string): Promise<EventLogEntry[]> {
    const filePath = this.dateFilePath(date);
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private async writeDailyFile(date: string, entries: EventLogEntry[]): Promise<void> {
    const filePath = this.dateFilePath(date);
    const tmpPath = filePath + ".tmp";
    await fs.promises.writeFile(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
    await fs.promises.rename(tmpPath, filePath);
  }

  private async appendToDailyFile(entry: EventLogEntry): Promise<void> {
    const date = entry.storedAt.slice(0, 10);
    const filePath = this.dateFilePath(date);
    await withWriteLock(filePath, async () => {
      const entries = await this.readDailyFile(date);
      entries.push(entry);
      await this.writeDailyFile(date, entries);
    });
  }

  private async listFiles(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.logDir);
      return files
        .filter((f) => f.endsWith(".json") && f !== "processed-ids.json")
        .map((f) => path.join(this.logDir, f))
        .sort();
    } catch {
      return [];
    }
  }

  // ---- Processed IDs (separate file to avoid rewriting daily logs) ----

  private async loadProcessedIds(): Promise<Set<string>> {
    if (this.processedIdsCache) return this.processedIdsCache;

    try {
      const raw = await fs.promises.readFile(this.processedIdsPath, "utf-8");
      const ids: string[] = JSON.parse(raw);
      this.processedIdsCache = new Set(ids);
    } catch {
      this.processedIdsCache = new Set();
    }
    return this.processedIdsCache;
  }

  private async saveProcessedIds(ids: Set<string>): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.processedIdsPath), { recursive: true });
    await withWriteLock(this.processedIdsPath, async () => {
      const tmpPath = this.processedIdsPath + ".tmp";
      await fs.promises.writeFile(tmpPath, JSON.stringify(Array.from(ids)), "utf-8");
      await fs.promises.rename(tmpPath, this.processedIdsPath);
      this.processedIdsCache = ids;
    });
  }
}
