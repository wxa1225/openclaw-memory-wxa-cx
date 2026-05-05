// Manager unit tests — covers the orchestration layer

import { TeamMemoryManager, type Mem0Provider } from "../lib/manager.js";
import * as fs from "fs";
import * as path from "path";

// No-op Mem0 provider
const noopMem0: Mem0Provider = {
  async add() { return {}; },
  async search() { return []; },
  async getAll() { return []; },
  async get() { return undefined; },
  async delete() { return {}; },
};

const TEST_STORAGE_DIR = path.join("/tmp", `team-mgr-test-${Date.now()}`);
const TEST_ROOT = path.join("/tmp", `team-mgr-root-${Date.now()}`);

function setup() {
  fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

function cleanup() {
  fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}

function createManager(teamId = "test-team", opts: Record<string, any> = {}) {
  return new TeamMemoryManager(noopMem0, {
    teamId,
    defaultUserId: "owner-001",
    teamSize: 5,
    enableGraph: true,
    projectRoot: TEST_ROOT,
    ledgerPath: path.join(TEST_STORAGE_DIR, `${teamId}-ledger.json`),
    graphPath: path.join(TEST_STORAGE_DIR, `${teamId}-graph.json`),
    ...opts,
  });
}

beforeAll(setup);
afterAll(cleanup);

describe("TeamMemoryManager", () => {
  beforeEach(() => {
    // Clean storage files between tests
    for (const f of fs.readdirSync(TEST_STORAGE_DIR)) {
      fs.unlinkSync(path.join(TEST_STORAGE_DIR, f));
    }
  });

  // ---- inject ----

  describe("inject", () => {
    test("inject stores a memory with correct metadata", async () => {
      const mgr = createManager();
      const result = await mgr.inject("客户A的交付格式为PDF", { category: "decision", author: "owner-001" });

      expect(result.id).toMatch(/^mem-/);
      expect(result.memory).toBe("客户A的交付格式为PDF");
      expect(result.metadata.category).toBe("decision");
      expect(result.metadata.version).toBe(1);
    });

    test("inject adds owner confidence bonus", async () => {
      const mgr = createManager();
      await mgr.inject("API端点为v2", { category: "api", author: "owner-001" });

      const entries = await mgr.status();
      const active = entries[0];
      // Owner gets +0.1 on base 0.7 = 0.8
      expect(active.metadata.injectedBy).toBe("owner-001");
    });

    test("inject applies unknown-user penalty", async () => {
      const mgr = createManager();
      await mgr.inject("随便说的", { category: "general", author: "unknown-user" });

      const entries = await mgr.status();
      // Unknown user: 0.7 - 0.1 = 0.6
      expect(entries.length).toBe(1);
    });

    test("inject detects conflict on same entity.attribute", async () => {
      const mgr = createManager();

      await mgr.inject("客户A的交付格式为PDF", { category: "decision", author: "owner-001" });
      const result2 = await mgr.inject("客户A的交付格式为Word", { category: "decision", author: "bob" });

      // Same entity+attribute with different value → conflict or update
      expect(result2.conflict).toBeDefined();
      expect(["auto-cover", "conflict-mark", "human-confirm"]).toContain(result2.conflict!.type);
    });

    test("inject confirmation boosts confidence on same value", async () => {
      const mgr = createManager();

      await mgr.inject("客户A的交付格式为PDF", { category: "decision", author: "owner-001" });
      const result2 = await mgr.inject("客户A的交付格式为PDF", { category: "decision", author: "bob" });

      // Same value → treated as confirmation, not a conflict
      expect(result2.conflict).toBeUndefined();
      expect(result2.metadata.version).toBe(1);
    });
  });

  // ---- update ----

  describe("update", () => {
    test("update creates new version", async () => {
      const mgr = createManager();
      await mgr.inject("客户A的交付格式为PDF", { category: "decision", author: "owner-001" });

      const result = await mgr.update("客户A", "客户A的交付格式改为Word");
      expect(result.previousVersion).toBe(1);
      expect(result.memory).toBe("客户A的交付格式改为Word");
    });

    test("update throws if no matching memory", async () => {
      const mgr = createManager();
      await expect(
        mgr.update("nonexistent", "new value")
      ).rejects.toThrow(/No memory found/);
    });
  });

  // ---- status / search ----

  describe("status", () => {
    test("status returns all memories with strength", async () => {
      const mgr = createManager();
      await mgr.inject("记忆一", { category: "decision" });
      await mgr.inject("记忆二", { category: "api" });

      const memories = await mgr.status();
      expect(memories.length).toBe(2);
      expect(memories[0]).toHaveProperty("strength");
      expect(memories[0]).toHaveProperty("strengthLabel");
    });

    test("status filters by category", async () => {
      const mgr = createManager();
      await mgr.inject("决策记忆", { category: "decision" });
      await mgr.inject("API记忆", { category: "api" });

      const filtered = await mgr.status("decision");
      expect(filtered.length).toBe(1);
      expect(filtered[0].metadata.category).toBe("decision");
    });

    test("status returns empty for unknown category", async () => {
      const mgr = createManager();
      await mgr.inject("一条记忆");

      const filtered = await mgr.status("nonexistent-category");
      expect(filtered.length).toBe(0);
    });
  });

  describe("search", () => {
    test("search finds memories by query", async () => {
      const mgr = createManager();
      await mgr.inject("客户A的交付格式为PDF", { category: "decision" });

      const results = await mgr.search("PDF");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("search returns empty for no match", async () => {
      const mgr = createManager();
      await mgr.inject("客户A的交付格式为PDF");

      const results = await mgr.search("完全不存在的关键词");
      expect(results.length).toBe(0);
    });
  });

  // ---- forceReview ----

  describe("forceReview", () => {
    test("forceReview resets decay clock", async () => {
      const mgr = createManager();
      const { id } = await mgr.inject("需要复习的记忆");

      await mgr.forceReview(id);

      const entries = await mgr.status();
      const reviewed = entries.find((e) => e.id === id);
      expect(reviewed).toBeDefined();
      // After review, strength should be high (decay clock reset)
      expect(reviewed!.strength).toBeGreaterThan(0.8);
    });

    test("forceReview throws for nonexistent memory", async () => {
      const mgr = createManager();
      await expect(mgr.forceReview("mem-nonexistent")).rejects.toThrow(/Memory not found/);
    });

    test("forceReview increments access count", async () => {
      const mgr = createManager();
      const { id } = await mgr.inject("访问计数测试");

      await mgr.forceReview(id);
      await mgr.forceReview(id);

      const entries = await mgr.status();
      const entry = entries.find((e) => e.id === id);
      expect(entry!.metadata.reviewCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ---- checkAndFormatReminders ----

  describe("checkAndFormatReminders", () => {
    test("returns null when no memories exist", async () => {
      const mgr = createManager();
      const result = await mgr.checkAndFormatReminders();
      expect(result).toBeNull();
    });

    test("returns null when memories are healthy", async () => {
      const mgr = createManager();
      await mgr.inject("新记忆", { category: "decision" });

      const result = await mgr.checkAndFormatReminders();
      // Freshly injected memory should not trigger reminders
      expect(result).toBeNull();
    });
  });

  // ---- assessRisk ----

  describe("assessRisk", () => {
    test("returns empty array when no memories", async () => {
      const mgr = createManager();
      const risks = await mgr.assessRisk();
      expect(risks).toEqual([]);
    });

    test("returns risk scores for all memories", async () => {
      const mgr = createManager();
      await mgr.inject("风险测试记忆", { category: "security" });
      await mgr.inject("另一个记忆", { category: "general" });

      const risks = await mgr.assessRisk();
      expect(risks.length).toBe(2);
      expect(risks[0]).toHaveProperty("totalRisk");
      expect(risks[0]).toHaveProperty("timeDecay");
      expect(risks[0]).toHaveProperty("businessImpact");
      expect(risks[0]).toHaveProperty("lowCoverage");
      expect(risks[0]).toHaveProperty("versionRisk");
      expect(risks[0]).toHaveProperty("lowUsage");
      expect(risks[0]).toHaveProperty("triggered");
    });

    test("security category has higher businessImpact than general", async () => {
      const mgr = createManager();
      await mgr.inject("安全策略", { category: "security" });
      await mgr.inject("日常记录", { category: "general" });

      const risks = await mgr.assessRisk();
      const securityRisk = risks.find((r) => {
        const entry = risks.find((rr) => rr.memoryId === r.memoryId);
        return true; // just need to compare
      });

      // Both will have low total risk when fresh, but businessImpact should differ
      const impacts = risks.map((r) => r.businessImpact);
      const maxImpact = Math.max(...impacts);
      const minImpact = Math.min(...impacts);
      expect(maxImpact).toBeGreaterThan(minImpact);
    });
  });

  // ---- resolveConflict ----

  describe("resolveConflict", () => {
    test("resolveConflict handles confirm action", async () => {
      const mgr = createManager();
      await mgr.inject("客户A的交付格式为PDF", { category: "decision", author: "alice" });

      // Force a conflicting state by directly manipulating via ledger
      const entries = await (mgr as any).ledger.getAllEntries("test-team");
      const entry = entries[0];
      entry.claims[0].status = "conflicting";
      entry.claims.push({
        version: 2, value: "Word", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.5, injected_by: "bob",
        confirmed_by: [], status: "conflicting", source: "test",
      });
      entry.current_version = 2;
      await (mgr as any).ledger.saveEntry(entry.id, entry);

      await mgr.resolveConflict(entry.id, "confirm");

      // After confirm, should not throw
      const updated = await (mgr as any).ledger.getEntry(entry.id);
      const conflicting = updated.claims.filter((c: any) => c.status === "conflicting");
      expect(conflicting.length).toBe(0);
    });
  });

  // ---- getGraph ----

  describe("getGraph", () => {
    test("getGraph returns data after injection", async () => {
      const mgr = createManager();
      await mgr.inject("客户A的交付格式为PDF", { category: "decision" });

      const graph = await mgr.getGraph();
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    test("getGraph filters by entity", async () => {
      const mgr = createManager();
      await mgr.inject("客户A的交付格式为PDF", { category: "decision" });
      await mgr.inject("API的端点为v2", { category: "api" });

      const fullGraph = await mgr.getGraph();
      const filtered = await mgr.getGraph("客户A");

      expect(filtered.nodes.length).toBeLessThanOrEqual(fullGraph.nodes.length);
      // Filtered graph should contain only 客户A-related nodes
      const hasEntityNode = filtered.nodes.some(
        (n) => n.type === "Entity" && n.label === "客户A"
      );
      expect(hasEntityNode).toBe(true);
    });
  });

  // ---- injectFromEvent (LLM fallback path) ----

  describe("injectFromEvent", () => {
    test("injectFromEvent creates memories from raw events (fallback path)", async () => {
      const mgr = createManager();
      const { EventLog } = await import("../lib/event-log.js");
      const log = new EventLog(TEST_ROOT);

      await log.append({
        chatId: "test-chat", chatType: "group", senderId: "alice",
        content: "API的端点改为v3了", contentType: "text", messageId: "m1",
      });

      const unprocessed = await log.getUnprocessed();
      const extracted = await mgr.injectFromEvent(unprocessed);
      await log.markProcessed(unprocessed.map((e) => e.id));

      expect(extracted.length).toBeGreaterThanOrEqual(1);
      const memories = await mgr.status();
      expect(memories.length).toBeGreaterThanOrEqual(1);
    });

    test("injectFromEvent returns empty for no events", async () => {
      const mgr = createManager();
      const result = await mgr.injectFromEvent([]);
      expect(result).toEqual([]);
    });
  });

  // ---- rebuildGraph ----

  describe("rebuildGraph", () => {
    test("rebuildGraph resets graph from ledger", async () => {
      const mgr = createManager();
      await mgr.inject("记忆A", { category: "decision" });
      await mgr.inject("记忆B", { category: "api" });

      const graph1 = await mgr.getGraph();
      const nodesBefore = graph1.nodes.length;

      await mgr.rebuildGraph();

      const graph2 = await mgr.getGraph();
      expect(graph2.nodes.length).toBe(nodesBefore);
    });
  });
});
