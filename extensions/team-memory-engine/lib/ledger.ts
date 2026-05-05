// MemoryLedger — version chain management with conflict detection

import { randomUUID } from "crypto";
import { LedgerStorageBackend } from "./storage/ledger-storage.js";
import type {
  LedgerEntry,
  LedgerClaim,
  ConflictResult,
} from "./storage/types.js";

const DEFAULT_LEDGER_PATH = process.env.HOME
  ? `${process.env.HOME}/.openclaw-memory-ledger.json`
  : "/tmp/.openclaw-memory-ledger.json";

// Confidence thresholds for conflict resolution
const CONFIDENCE_AUTO_COVER_DELTA = 0.2;
const CONFIDENCE_MARK_DELTA = 0.15;
const CONFIDENCE_HIGH_THRESHOLD = 0.8;
const CONFIDENCE_LOW_THRESHOLD = 0.6;

export interface InjectClaimOptions {
  entity: string;
  attribute: string;
  value: string;
  confidence?: number;
  source?: string;
  injectedBy: string;
  category?: string;
  tags?: string[];
  teamId: string;
  recallHalfLife?: number;
}

export interface ConflictResolution {
  action: "confirm" | "update" | "dismiss";
  entryId: string;
  resolvedBy: string; // Feishu open_id of the resolver
}

export class MemoryLedger {
  private storage: LedgerStorageBackend;
  private teamId: string;

  constructor(teamId: string, ledgerPath?: string) {
    this.teamId = teamId;
    this.storage = new LedgerStorageBackend(ledgerPath ?? DEFAULT_LEDGER_PATH);
  }

  // ---- Core Operations ----

  /** Inject a new claim into the ledger. Creates new entry or adds claim to existing. */
  async injectClaim(options: InjectClaimOptions): Promise<LedgerEntry> {
    const now = new Date().toISOString();

    // Check if an entry for this entity+attribute already exists
    const existing = await this.storage.getByEntityAttribute(
      options.entity,
      options.attribute,
      this.teamId
    );

    // Check for conflicts before injecting
    const conflict = await this.detectConflict({
      version: 0, // will be set below
      value: options.value,
      valid_from: now,
      valid_to: null,
      confidence: options.confidence ?? 0.7,
      source: options.source,
      injected_by: options.injectedBy,
      confirmed_by: [],
      status: "active",
    }, existing);

    if (conflict) {
      return this._resolveConflictAndInject(conflict, options);
    }

    // No conflict: create new entry or add to existing with same value (review)
    if (existing.length > 0) {
      const target = existing[0];
      return this._addClaimToExisting(target, options, now);
    }

    // Create new entry
    const id = `mem-${this._generateShortId()}`;
    const claim: LedgerClaim = {
      version: 1,
      value: options.value,
      valid_from: now,
      valid_to: null,
      confidence: options.confidence ?? 0.7,
      source: options.source,
      injected_by: options.injectedBy,
      confirmed_by: [],
      status: "active",
    };

    const entry: LedgerEntry = {
      id,
      entity: options.entity,
      attribute: options.attribute,
      claims: [claim],
      current_version: 1,
      dependency_graph: [],
      recall_half_life: options.recallHalfLife ?? 14,
      category: options.category ?? "general",
      tags: options.tags ?? [],
      teamId: options.teamId,
      access_count: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.set(id, entry);
    return entry;
  }

  /** Supersede a specific version of an entry */
  async supersede(entryId: string, version: number): Promise<void> {
    const entry = await this.storage.get(entryId);
    if (!entry) throw new Error(`Ledger entry not found: ${entryId}`);

    const now = new Date().toISOString();
    const updated = { ...entry, updatedAt: now };

    for (const claim of updated.claims) {
      if (claim.version <= version && claim.status !== "superseded") {
        claim.status = "superseded";
        if (!claim.valid_to) claim.valid_to = now;
      }
    }

    await this.storage.set(entryId, updated);
  }

  /** Merge multiple source entries into a target entry */
  async merge(sourceIds: string[], targetId: string): Promise<void> {
    const target = await this.storage.get(targetId);
    if (!target) throw new Error(`Target ledger entry not found: ${targetId}`);

    const now = new Date().toISOString();
    let maxVersion = target.current_version;

    for (const sourceId of sourceIds) {
      const source = await this.storage.get(sourceId);
      if (!source) continue;

      for (const claim of source.claims) {
        if (claim.status === "active") {
          maxVersion++;
          target.claims.push({
            ...claim,
            version: maxVersion,
            valid_from: now,
            valid_to: null,
            status: "active",
          });
        }
      }

      // Mark source as superseded
      for (const claim of source.claims) {
        claim.status = "superseded";
        if (!claim.valid_to) claim.valid_to = now;
      }
      source.current_version = maxVersion;
      source.updatedAt = now;
      await this.storage.set(sourceId, source);
    }

    target.current_version = maxVersion;
    target.updatedAt = now;
    await this.storage.set(targetId, target);
  }

  // ---- Conflict Detection ----

  /** Detect conflict between a new claim and existing entries */
  async detectConflict(
    newClaim: LedgerClaim,
    existingEntries: LedgerEntry[]
  ): Promise<ConflictResult | null> {
    // Find the entry that matches this claim's entity+attribute
    const matchingEntry = existingEntries.find((e) => {
      const activeClaim = e.claims.find((c) => c.status === "active" || c.status === undefined);
      return activeClaim && this._timeOverlap(activeClaim, newClaim);
    });

    if (!matchingEntry) return null;

    const activeClaim = matchingEntry.claims.find(
      (c) => c.status === "active" || c.status === undefined
    );
    if (!activeClaim) return null;

    // Check if values are semantically different
    if (this._valuesSemanticallyEqual(activeClaim.value, newClaim.value)) {
      return null; // Same value, not a conflict (this is a review/confirmation)
    }

    const delta = Math.abs(newClaim.confidence - activeClaim.confidence);

    let type: ConflictResult["type"];
    if (newClaim.confidence > CONFIDENCE_HIGH_THRESHOLD && activeClaim.confidence < CONFIDENCE_LOW_THRESHOLD) {
      type = "auto-cover";
    } else if (delta < CONFIDENCE_MARK_DELTA) {
      type = "conflict-mark";
    } else {
      type = "human-confirm";
    }

    return {
      type,
      existingEntry: matchingEntry,
      newClaim,
      confidenceDelta: delta,
      reason: `Conflicting values for ${matchingEntry.entity}.${matchingEntry.attribute}: "${activeClaim.value}" vs "${newClaim.value}"`,
    };
  }

  /** Resolve a detected conflict */
  async resolveConflict(
    result: ConflictResult,
    resolution: ConflictResolution
  ): Promise<LedgerEntry> {
    const { existingEntry, newClaim } = result;

    switch (resolution.action) {
      case "confirm": {
        // Keep existing, dismiss new claim, add resolver to confirmed_by
        for (const claim of existingEntry.claims) {
          if (claim.status === "active" || claim.status === "conflicting" || claim.status === undefined) {
            if (!claim.confirmed_by.includes(resolution.resolvedBy)) {
              claim.confirmed_by.push(resolution.resolvedBy);
            }
            if (claim.status === "conflicting") claim.status = "active";
          }
        }
        existingEntry.updatedAt = new Date().toISOString();
        await this.storage.set(existingEntry.id, existingEntry);
        return existingEntry;
      }
      case "update": {
        // Supersede old claim, activate new claim, add resolver
        newClaim.confirmed_by = [resolution.resolvedBy];
        return this._applySupersede(existingEntry, newClaim);
      }
      case "dismiss": {
        // Remove conflicting state, keep existing
        for (const claim of existingEntry.claims) {
          if (claim.status === "conflicting") {
            claim.status = "active";
          }
        }
        existingEntry.updatedAt = new Date().toISOString();
        await this.storage.set(existingEntry.id, existingEntry);
        return existingEntry;
      }
    }
  }

  // ---- Queries ----

  async getEntry(id: string): Promise<LedgerEntry | undefined> {
    return this.storage.get(id);
  }

  async getAllEntries(teamId?: string): Promise<LedgerEntry[]> {
    return this.storage.getAll(teamId ?? this.teamId);
  }

  /** Get the current active value for an entity+attribute pair */
  async getCurrentValue(
    entity: string,
    attribute: string
  ): Promise<LedgerClaim | null> {
    const entries = await this.storage.getByEntityAttribute(
      entity,
      attribute,
      this.teamId
    );
    if (entries.length === 0) return null;

    const active = entries[0].claims.find(
      (c) => c.status === "active" || c.status === undefined
    );
    return active ?? null;
  }

  async getVersionHistory(entryId: string): Promise<LedgerClaim[]> {
    const entry = await this.storage.get(entryId);
    return entry?.claims ?? [];
  }

  async search(query: string): Promise<LedgerEntry[]> {
    const results = await this.storage.search(query, this.teamId);
    return results.map(({ relevanceScore: _, ...entry }) => entry);
  }

  /** Increment access count for tracking usage */
  /** Directly save an entry (used for in-place modifications like review/conflict resolution) */
  async saveEntry(id: string, entry: LedgerEntry): Promise<void> {
    await this.storage.set(id, entry);
  }

  async bumpAccess(entryId: string): Promise<void> {
    const entry = await this.storage.get(entryId);
    if (!entry) return;
    entry.access_count = (entry.access_count ?? 0) + 1;
    entry.updatedAt = new Date().toISOString();
    await this.storage.set(entryId, entry);
  }

  // ---- Internal Helpers ----

  private async _addClaimToExisting(
    target: LedgerEntry,
    options: InjectClaimOptions,
    now: string
  ): Promise<LedgerEntry> {
    // Check if this is a confirmation (same value)
    const activeClaim = target.claims.find(
      (c) => c.status === "active" || c.status === undefined
    );

    if (activeClaim && this._valuesSemanticallyEqual(activeClaim.value, options.value)) {
      // Same value: treat as confirmation, bump confidence
      if (!activeClaim.confirmed_by.includes(options.injectedBy)) {
        activeClaim.confirmed_by.push(options.injectedBy);
      }
      activeClaim.confidence = Math.min(1.0, activeClaim.confidence + 0.05);
      target.updatedAt = now;
      await this.storage.set(target.id, target);
      return target;
    }

    // Different value: supersede old, add new claim
    return this._applySupersede(target, {
      version: target.current_version + 1,
      value: options.value,
      valid_from: now,
      valid_to: null,
      confidence: options.confidence ?? 0.7,
      source: options.source,
      injected_by: options.injectedBy,
      confirmed_by: [],
      status: "active",
    });
  }

  private async _applySupersede(
    entry: LedgerEntry,
    newClaim: LedgerClaim
  ): Promise<LedgerEntry> {
    const now = new Date().toISOString();

    // Supersede all active claims
    for (const claim of entry.claims) {
      if (claim.status === "active" || claim.status === undefined) {
        claim.status = "superseded";
        claim.valid_to = now;
      }
    }

    newClaim.version = entry.current_version + 1;
    entry.claims.push(newClaim);
    entry.current_version = newClaim.version;
    entry.updatedAt = now;

    await this.storage.set(entry.id, entry);
    return entry;
  }

  private async _resolveConflictAndInject(
    conflict: ConflictResult,
    options: InjectClaimOptions
  ): Promise<LedgerEntry> {
    switch (conflict.type) {
      case "auto-cover": {
        // High confidence new claim overrides low confidence old
        return this._applySupersede(conflict.existingEntry, {
          version: conflict.existingEntry.current_version + 1,
          value: options.value,
          valid_from: new Date().toISOString(),
          valid_to: null,
          confidence: options.confidence ?? 0.7,
          source: options.source,
          injected_by: options.injectedBy,
          confirmed_by: [],
          status: "active",
        });
      }
      case "conflict-mark": {
        // Mark both as conflicting
        const entry = conflict.existingEntry;
        for (const claim of entry.claims) {
          if (claim.status === "active" || claim.status === undefined) {
            claim.status = "conflicting";
          }
        }
        // Still add the new claim as conflicting
        entry.claims.push({
          version: entry.current_version + 1,
          value: options.value,
          valid_from: new Date().toISOString(),
          valid_to: null,
          confidence: options.confidence ?? 0.7,
          source: options.source,
          injected_by: options.injectedBy,
          confirmed_by: [],
          status: "conflicting",
        });
        entry.current_version++;
        entry.updatedAt = new Date().toISOString();
        await this.storage.set(entry.id, entry);
        return entry;
      }
      case "human-confirm": {
        // Store as pending conflict — mark existing as conflicting
        const entry = conflict.existingEntry;
        for (const claim of entry.claims) {
          if (claim.status === "active" || claim.status === undefined) {
            claim.status = "conflicting";
          }
        }
        entry.claims.push({
          version: entry.current_version + 1,
          value: options.value,
          valid_from: new Date().toISOString(),
          valid_to: null,
          confidence: options.confidence ?? 0.7,
          source: options.source,
          injected_by: options.injectedBy,
          confirmed_by: [],
          status: "conflicting",
        });
        entry.current_version++;
        entry.updatedAt = new Date().toISOString();
        await this.storage.set(entry.id, entry);
        return entry;
      }
    }
  }

  private _generateShortId(): string {
    return randomUUID().slice(0, 8);
  }

  private _timeOverlap(claim1: LedgerClaim, claim2: LedgerClaim): boolean {
    // Two claims overlap if both are active, or their valid intervals overlap
    if (!claim1.valid_to && !claim2.valid_to) return true;
    if (!claim1.valid_to || !claim2.valid_to) return true;
    return claim1.valid_from < claim2.valid_to && claim2.valid_from < claim1.valid_to;
  }

  private _valuesSemanticallyEqual(v1: string, v2: string): boolean {
    return v1.trim().toLowerCase() === v2.trim().toLowerCase();
  }
}

// Re-export types used by consumers
export type { LedgerEntry, LedgerClaim, ConflictResult };
