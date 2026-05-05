// v1 → v2 Migration: StoredMemory[] → LedgerEntry[]

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { StoredMemory, LedgerEntry, LedgerClaim, MigrationResult } from "./storage/types.js";
import { extractEntityAttribute } from "./extract-utils.js";

const DEFAULT_V1_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-team-memory.json"
);

const DEFAULT_LEDGER_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-ledger.json"
);

/** Convert a single v1 StoredMemory to v2 LedgerEntry */
function storedMemoryToLedgerEntry(
  memory: StoredMemory,
  teamId: string
): LedgerEntry {
  const extracted = extractEntityAttribute(
    memory.memory,
    memory.metadata.category
  );

  const claims: LedgerClaim[] = memory.metadata.versionHistory.map((vh, idx) => {
    const isLast = idx === memory.metadata.versionHistory.length - 1;
    // v1 had no confidence tracking. Use 0.7 as base,
    // +0.05 per review (up to 0.2 bonus) to reflect historical validation.
    const reviewBonus = Math.min(0.2, (memory.metadata.reviewCount ?? 0) * 0.05);
    return {
      version: vh.version,
      value: vh.text,
      valid_from: vh.updatedAt,
      valid_to: isLast
        ? null
        : memory.metadata.versionHistory[idx + 1].updatedAt,
      confidence: isLast ? 0.7 + reviewBonus : 0.5,
      source: "migration_v1",
      injected_by: vh.updatedBy,
      confirmed_by: [],
      status: isLast ? "active" : "superseded",
    };
  });

  const now = new Date().toISOString();

  return {
    id: memory.id,
    entity: extracted.entity,
    attribute: extracted.attribute,
    claims,
    current_version: memory.metadata.version,
    dependency_graph: [],
    recall_half_life: 14, // default 14 days (midpoint of v1 intervals)
    category: memory.metadata.category,
    tags: memory.metadata.tags,
    teamId: memory.teamId || teamId,
    access_count: memory.metadata.reviewCount,
    createdAt: memory.metadata.injectedAt,
    updatedAt: now,
  };
}

/** Run full v1 → v2 migration */
export async function runMigration(
  v1Path: string = DEFAULT_V1_PATH,
  ledgerPath: string = DEFAULT_LEDGER_PATH,
  teamId: string = "openclaw-team"
): Promise<MigrationResult> {
  const result: MigrationResult = {
    migrated: 0,
    errors: [],
    backupPath: null,
  };

  // Check if ledger already exists (migration already done)
  try {
    await fs.promises.access(ledgerPath);
    result.errors.push("Ledger file already exists, skipping migration");
    return result;
  } catch {
    // No ledger file, proceed with migration
  }

  // Load v1 data
  let v1Data: Record<string, StoredMemory>;
  try {
    const raw = await fs.promises.readFile(v1Path, "utf-8");
    v1Data = JSON.parse(raw);
  } catch {
    result.errors.push("No v1 memory file found");
    return result;
  }

  // Convert each v1 memory to v2 ledger entry
  const entries: LedgerEntry[] = [];
  for (const [id, memory] of Object.entries(v1Data)) {
    try {
      const entry = storedMemoryToLedgerEntry(memory, teamId);
      entries.push(entry);
      result.migrated++;
    } catch (err) {
      result.errors.push(`Failed to migrate ${id}: ${String(err)}`);
    }
  }

  // Write ledger file
  if (entries.length > 0) {
    const ledgerData: Record<string, LedgerEntry> = {};
    for (const entry of entries) {
      ledgerData[entry.id] = entry;
    }
    await fs.promises.writeFile(ledgerPath, JSON.stringify(ledgerData, null, 2), "utf-8");
  }

  // Backup v1 file
  const backupPath = v1Path + ".v1.bak";
  try {
    await fs.promises.rename(v1Path, backupPath);
    result.backupPath = backupPath;
  } catch {
    result.errors.push("Failed to backup v1 file");
  }

  return result;
}
