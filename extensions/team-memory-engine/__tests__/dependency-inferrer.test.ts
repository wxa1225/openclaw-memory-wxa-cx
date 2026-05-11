// Tests for Dependency Inferrer — rule-based centrality and propagation (LLM is mocked)

import { DependencyInferrer } from "../lib/dependency-inferrer.js";
import type { LedgerEntry } from "../lib/storage/types.js";

function makeEntry(
  id: string,
  entity: string,
  attribute: string,
  value: string,
  category: string,
  tags: string[] = [],
  deps: string[] = []
): LedgerEntry {
  return {
    id,
    entity,
    attribute,
    claims: [{
      version: 1, value, valid_from: new Date().toISOString(),
      valid_to: null, confidence: 0.8, injected_by: "test", confirmed_by: [], status: "active",
    }],
    current_version: 1,
    dependency_graph: deps,
    recall_half_life: 14,
    category,
    tags,
    teamId: "test",
    access_count: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Dependency Inferrer", () => {
  let inferrer: DependencyInferrer;

  beforeEach(() => {
    // No LLM config — rule-based fallback only
    inferrer = new DependencyInferrer();
  });

  describe("computeCentrality", () => {
    it("returns zero centrality for entries with no dependencies", () => {
      const entries = [
        makeEntry("mem-1", "A", "x", "val1", "decision", [], []),
        makeEntry("mem-2", "B", "y", "val2", "api", [], []),
      ];
      const centrality = inferrer.computeCentrality(entries);
      expect(centrality.get("mem-1")).toBe(0);
      expect(centrality.get("mem-2")).toBe(0);
    });

    it("gives higher centrality to entries with many dependents", () => {
      // mem-1, mem-2, mem-3 all depend on mem-core (dependency_graph = ["mem-core"])
      const entries = [
        makeEntry("mem-1", "服务A", "部署", "k8s", "api", [], ["mem-core"]),
        makeEntry("mem-2", "服务B", "部署", "k8s", "api", [], ["mem-core"]),
        makeEntry("mem-3", "服务C", "监控", "prometheus", "process", [], ["mem-core"]),
        makeEntry("mem-core", "核心", "架构", "microservices", "decision", [], []),
      ];
      const centrality = inferrer.computeCentrality(entries);
      // mem-core has 3 entries pointing to it → in-degree=3 → highest centrality
      const coreCentrality = centrality.get("mem-core") ?? 0;
      expect(coreCentrality).toBeGreaterThan(0);
      expect(coreCentrality).toBeGreaterThan(centrality.get("mem-1") ?? 0);
    });
  });

  describe("detectConflictPropagation", () => {
    it("returns empty list when no dependencies", () => {
      const entries = [
        makeEntry("mem-1", "A", "x", "val1", "decision", [], []),
        makeEntry("mem-2", "B", "y", "val2", "api", [], []),
      ];
      const affected = inferrer.detectConflictPropagation(entries, "mem-1");
      expect(affected.length).toBe(0);
    });

    it("propagates through dependency chain", () => {
      // mem-1 depends on mem-core, mem-2 depends on mem-core, mem-3 depends on mem-1
      const entries = [
        makeEntry("mem-core", "核心", "API端点", "v3", "api", [], []),
        makeEntry("mem-1", "服务A", "部署", "依赖mem-core", "api", [], ["mem-core"]),
        makeEntry("mem-2", "服务B", "部署", "依赖mem-core", "api", [], ["mem-core"]),
        makeEntry("mem-3", "监控", "告警", "依赖mem-1", "process", [], ["mem-1"]),
      ];
      const affected = inferrer.detectConflictPropagation(entries, "mem-core");
      expect(affected.length).toBe(3);
      expect(affected.find(e => e.id === "mem-1")).toBeDefined();
      expect(affected.find(e => e.id === "mem-2")).toBeDefined();
      expect(affected.find(e => e.id === "mem-3")).toBeDefined();
    });

    it("does not propagate to unrelated entries", () => {
      const entries = [
        makeEntry("mem-core", "核心", "API端点", "v3", "api", [], []),
        makeEntry("mem-1", "服务A", "部署", "依赖mem-core", "api", [], ["mem-core"]),
        makeEntry("mem-unrelated", "不相关", "午餐", "黄焖鸡", "general", [], []),
      ];
      const affected = inferrer.detectConflictPropagation(entries, "mem-core");
      expect(affected.length).toBe(1);
      expect(affected.find(e => e.id === "mem-unrelated")).toBeUndefined();
    });
  });

  describe("inferDependencies (no LLM)", () => {
    it("returns empty dependencies when no LLM configured", async () => {
      const entries = [
        makeEntry("mem-1", "A", "x", "val1", "decision", [], []),
        makeEntry("mem-2", "B", "y", "val2", "api", [], []),
      ];
      const result = await inferrer.inferDependencies(entries);
      expect(result.dependencies.length).toBe(0);
      expect(result.updatedEntries.length).toBe(2);
    });
  });

  describe("inferNewEntryDependencies (no LLM)", () => {
    it("returns empty when no LLM configured", async () => {
      const newEntry = makeEntry("mem-new", "新", "功能", "new feature", "decision", [], []);
      const existing = [
        makeEntry("mem-1", "A", "x", "val1", "decision", [], []),
      ];
      const result = await inferrer.inferNewEntryDependencies(newEntry, existing);
      expect(result.length).toBe(0);
    });
  });
});
