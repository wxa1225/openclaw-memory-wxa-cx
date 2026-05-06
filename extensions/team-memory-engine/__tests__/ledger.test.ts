// Unit tests for ledger.ts — version chain management with conflict detection

import * as fs from "fs";
import * as path from "path";
import { MemoryLedger } from "../lib/ledger.js";

const TEST_DIR = path.join("/tmp", `ledger-test-${Date.now()}`);
const TEST_LEDGER_PATH = path.join(TEST_DIR, "ledger.json");

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function makeLedger(teamId = "test") {
  return new MemoryLedger(teamId, TEST_LEDGER_PATH);
}

describe("MemoryLedger", () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  // ---- injectClaim ----

  test("injects a new claim for a non-existent entity+attribute", async () => {
    const ledger = makeLedger();
    const entry = await ledger.injectClaim({
      entity: "客户A",
      attribute: "交付格式",
      value: "PDF",
      confidence: 0.8,
      source: "meeting",
      injectedBy: "alice",
      category: "decision",
      tags: ["delivery"],
      teamId: "test",
    });
    expect(entry.id).toMatch(/^mem-/);
    expect(entry.entity).toBe("客户A");
    expect(entry.attribute).toBe("交付格式");
    expect(entry.claims).toHaveLength(1);
    expect(entry.claims[0].value).toBe("PDF");
    expect(entry.claims[0].confidence).toBe(0.8);
    expect(entry.current_version).toBe(1);
  });

  test("adds confirmation when same value is injected again", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "客户A",
      attribute: "交付格式",
      value: "PDF",
      confidence: 0.8,
      source: "meeting",
      injectedBy: "alice",
      category: "decision",
      tags: [],
      teamId: "test",
    });

    const entry2 = await ledger.injectClaim({
      entity: "客户A",
      attribute: "交付格式",
      value: "PDF", // same value
      confidence: 0.7,
      source: "chat",
      injectedBy: "bob",
      category: "decision",
      tags: [],
      teamId: "test",
    });

    expect(entry2.claims).toHaveLength(1);
    expect(entry2.claims[0].confirmed_by).toContain("bob");
    expect(entry2.claims[0].confidence).toBeGreaterThan(0.8); // bumped
  });

  test("supersedes old claim when different value is injected", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "客户A",
      attribute: "交付格式",
      value: "Markdown",
      confidence: 0.5, // < 0.6 (strict less than in auto-cover check)
      source: "meeting",
      injectedBy: "alice",
      category: "decision",
      tags: [],
      teamId: "test",
    });

    const entry = await ledger.injectClaim({
      entity: "客户A",
      attribute: "交付格式",
      value: "PDF",
      confidence: 0.9, // > 0.8 and delta > 0.2 => auto-cover
      source: "chat",
      injectedBy: "bob",
      category: "decision",
      tags: [],
      teamId: "test",
    });

    const statuses = entry.claims.map((c) => c.status);
    expect(statuses).toContain("superseded");
    expect(statuses).toContain("active");
    expect(entry.current_version).toBe(2);
  });

  // ---- Conflict detection ----

  test("auto-cover: high confidence new claim overrides low confidence old", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "old",
      confidence: 0.4,
      source: "s1",
      injectedBy: "alice",
      category: "general",
      tags: [],
      teamId: "test",
    });

    // New claim: confidence 0.85, old was 0.4, delta = 0.45 > 0.2
    // And new > 0.8, old < 0.6 => auto-cover
    const entry = await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "new",
      confidence: 0.85,
      source: "s2",
      injectedBy: "bob",
      category: "general",
      tags: [],
      teamId: "test",
    });

    // Auto-cover: new claim should be active, old superseded
    const activeClaims = entry.claims.filter((c) => c.status === "active");
    expect(activeClaims).toHaveLength(1);
    expect(activeClaims[0].value).toBe("new");
  });

  test("conflict-mark: similar confidence values are marked as conflicting", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "A",
      confidence: 0.5,
      source: "s1",
      injectedBy: "alice",
      category: "general",
      tags: [],
      teamId: "test",
    });

    const entry = await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "B",
      confidence: 0.55, // delta = 0.05 < 0.15
      source: "s2",
      injectedBy: "bob",
      category: "general",
      tags: [],
      teamId: "test",
    });

    const conflictingClaims = entry.claims.filter((c) => c.status === "conflicting");
    expect(conflictingClaims.length).toBeGreaterThan(0);
  });

  // ---- resolveConflict ----

  test("resolve conflict with 'confirm' keeps existing and adds resolver", async () => {
    const ledger = makeLedger();
    const entry = await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "A",
      confidence: 0.5,
      source: "s1",
      injectedBy: "alice",
      category: "general",
      tags: [],
      teamId: "test",
    });

    // Create a conflict scenario
    const conflictResult = await ledger.detectConflict({
      version: 2,
      value: "B",
      valid_from: new Date().toISOString(),
      valid_to: null,
      confidence: 0.55,
      source: "s2",
      injected_by: "bob",
      confirmed_by: [],
      status: "active",
    }, [entry]);

    expect(conflictResult).not.toBeNull();
    expect(conflictResult!.type).toBe("conflict-mark");

    const resolved = await ledger.resolveConflict(conflictResult!, {
      action: "confirm",
      entryId: entry.id,
      resolvedBy: "resolver-001",
    });

    const allConfirmed = resolved.claims.flatMap((c) => c.confirmed_by);
    expect(allConfirmed).toContain("resolver-001");
  });

  test("resolve conflict with 'dismiss' restores conflicting claims", async () => {
    const ledger = makeLedger();
    const entry = await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "A",
      confidence: 0.5,
      source: "s1",
      injectedBy: "alice",
      category: "general",
      tags: [],
      teamId: "test",
    });

    const conflictResult = await ledger.detectConflict({
      version: 2,
      value: "B",
      valid_from: new Date().toISOString(),
      valid_to: null,
      confidence: 0.55,
      source: "s2",
      injected_by: "bob",
      confirmed_by: [],
      status: "active",
    }, [entry]);

    const resolved = await ledger.resolveConflict(conflictResult!, {
      action: "dismiss",
      entryId: entry.id,
      resolvedBy: "resolver-002",
    });

    // After dismiss, no claims should be in "conflicting" state
    const conflicting = resolved.claims.filter((c) => c.status === "conflicting");
    expect(conflicting).toHaveLength(0);
  });

  // ---- Queries ----

  test("getCurrentValue returns the active claim's value", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "DB",
      attribute: "pool",
      value: "10",
      confidence: 0.7,
      source: "s1",
      injectedBy: "alice",
      category: "api",
      tags: [],
      teamId: "test",
    });

    const current = await ledger.getCurrentValue("DB", "pool");
    expect(current).not.toBeNull();
    expect(current!.value).toBe("10");
  });

  test("getCurrentValue returns null for non-existent entity+attribute", async () => {
    const ledger = makeLedger();
    const current = await ledger.getCurrentValue("NonExistent", "attr");
    expect(current).toBeNull();
  });

  test("search returns entries matching the query", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "API",
      attribute: "endpoint",
      value: "https://staging-api.example.com/v2",
      confidence: 0.8,
      source: "s1",
      injectedBy: "alice",
      category: "api",
      tags: ["staging", "critical"],
      teamId: "test",
    });

    const results = await ledger.search("staging API");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entity).toBe("API");
  });

  test("bumpAccess increments access_count", async () => {
    const ledger = makeLedger();
    const entry = await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "test",
      confidence: 0.7,
      source: "s1",
      injectedBy: "alice",
      category: "general",
      tags: [],
      teamId: "test",
    });

    await ledger.bumpAccess(entry.id);
    const updated = await ledger.getEntry(entry.id);
    expect(updated!.access_count).toBe(1);
  });

  // ---- Supersede ----

  test("supersede marks old versions as superseded", async () => {
    const ledger = makeLedger();
    const entry = await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "v1",
      confidence: 0.5,
      source: "s1",
      injectedBy: "alice",
      category: "general",
      tags: [],
      teamId: "test",
    });

    await ledger.injectClaim({
      entity: "X",
      attribute: "Y",
      value: "v2",
      confidence: 0.9,
      source: "s2",
      injectedBy: "bob",
      category: "general",
      tags: [],
      teamId: "test",
    });

    const updated = await ledger.getEntry(entry.id);
    const v1Claim = updated!.claims.find((c) => c.version === 1);
    expect(v1Claim!.status).toBe("superseded");
    expect(v1Claim!.valid_to).not.toBeNull();
  });

  // ---- Version history ----

  test("getVersionHistory returns all claims", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "X", attribute: "Y", value: "v1",
      confidence: 0.7, source: "s1", injectedBy: "alice",
      category: "general", tags: [], teamId: "test",
    });
    await ledger.injectClaim({
      entity: "X", attribute: "Y", value: "v2",
      confidence: 0.8, source: "s2", injectedBy: "bob",
      category: "general", tags: [], teamId: "test",
    });

    const entry = await ledger.getAllEntries("test");
    const history = await ledger.getVersionHistory(entry[0].id);
    expect(history).toHaveLength(2);
    expect(history.map((c) => c.version)).toEqual([1, 2]);
  });

  // ---- Fuzzy entity/attribute lookup ----

  test("fuzzy lookup finds matching entry when attribute names differ slightly", async () => {
    const ledger = makeLedger();
    // LLM extraction stored this entry
    await ledger.injectClaim({
      entity: "客户A",
      attribute: "交付格式",
      value: "PDF",
      confidence: 0.8,
      source: "llm_extraction",
      injectedBy: "memory-extractor",
      category: "decision",
      tags: ["delivery"],
      teamId: "test",
    });

    // CLI inject with slightly different attribute should still find it
    const entry2 = await ledger.injectClaim({
      entity: "客户A",
      attribute: "格式",
      value: "Markdown",
      confidence: 0.7,
      source: "manual_inject",
      injectedBy: "demo",
      category: "decision",
      tags: ["delivery"],
      teamId: "test",
    });

    // Should have found the existing entry and added a new claim (not created a new entry)
    expect(entry2.entity).toBe("客户A");
    expect(entry2.attribute).toBe("交付格式");
    expect(entry2.claims).toHaveLength(2);
    expect(entry2.claims[1].value).toBe("Markdown");
  });

  test("fuzzy lookup does not match unrelated entries", async () => {
    const ledger = makeLedger();
    await ledger.injectClaim({
      entity: "生产环境",
      attribute: "API端点",
      value: "v3",
      confidence: 0.8,
      source: "llm_extraction",
      injectedBy: "memory-extractor",
      category: "api",
      tags: [],
      teamId: "test",
    });

    // Completely unrelated entity+attribute should create new entry
    const entry2 = await ledger.injectClaim({
      entity: "团队周报",
      attribute: "收件人",
      value: "李四",
      confidence: 0.7,
      source: "manual_inject",
      injectedBy: "demo",
      category: "process",
      tags: [],
      teamId: "test",
    });

    expect(entry2.entity).toBe("团队周报");
    expect(entry2.attribute).toBe("收件人");
    expect(entry2.claims).toHaveLength(1);
  });
});
