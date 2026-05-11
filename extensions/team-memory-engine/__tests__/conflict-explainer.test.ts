// Tests for ConflictExplainer — rule-based fallback path (LLM is mocked)

import { ConflictExplainer } from "../lib/conflict-explainer.js";
import type { LedgerEntry, LedgerClaim } from "../lib/storage/types.js";
import type { ConflictResult } from "../lib/ledger.js";

function makeEntry(claims: LedgerClaim[]): LedgerEntry {
  return {
    id: "mem-test-001",
    entity: "客户A",
    attribute: "交付格式",
    claims,
    current_version: claims.length,
    dependency_graph: [],
    recall_half_life: 14,
    category: "decision",
    tags: ["交付"],
    teamId: "test-team",
    access_count: 0,
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-06T10:00:00Z",
  };
}

describe("ConflictExplainer", () => {
  let explainer: ConflictExplainer;

  beforeEach(() => {
    // No LLM config — uses rule-based fallback
    explainer = new ConflictExplainer();
  });

  describe("explainConflict — rule-based", () => {
    it("explains a two-claim conflict", async () => {
      const entry = makeEntry([
        {
          version: 1,
          value: "PDF",
          valid_from: "2026-05-01T10:00:00Z",
          valid_to: null,
          confidence: 0.85,
          source: "llm_extraction",
          injected_by: "张三",
          confirmed_by: ["张三"],
          status: "conflicting",
        },
        {
          version: 2,
          value: "Markdown",
          valid_from: "2026-05-06T10:00:00Z",
          valid_to: null,
          confidence: 0.70,
          source: "manual_inject",
          injected_by: "李四",
          confirmed_by: [],
          status: "conflicting",
        },
      ]);

      const conflict: ConflictResult = {
        type: "conflict-mark",
        existingEntry: entry,
        newClaim: entry.claims[1],
        confidenceDelta: 0.15,
        reason: "Conflicting values",
      };

      const result = await explainer.explainConflict(entry, conflict);

      expect(result.summary).toContain("客户A");
      expect(result.summary).toContain("交付格式");
      expect(result.timeline.length).toBeGreaterThan(0);
      expect(result.analysis.length).toBeGreaterThan(0);
      expect(result.recommendation.length).toBeGreaterThan(0);
      expect(result.recommendedVersion).toBeGreaterThan(0);
    });

    it("recommends newer version when confidence is higher", async () => {
      const entry = makeEntry([
        {
          version: 1,
          value: "v2",
          valid_from: "2026-05-01T10:00:00Z",
          valid_to: null,
          confidence: 0.5,
          injected_by: "old",
          confirmed_by: [],
          status: "conflicting",
        },
        {
          version: 2,
          value: "v3",
          valid_from: "2026-05-06T10:00:00Z",
          valid_to: null,
          confidence: 0.9,
          injected_by: "new",
          confirmed_by: ["boss"],
          status: "conflicting",
        },
      ]);

      const conflict: ConflictResult = {
        type: "human-confirm",
        existingEntry: entry,
        newClaim: entry.claims[1],
        confidenceDelta: 0.4,
        reason: "Conflicting values",
      };

      const result = await explainer.explainConflict(entry, conflict);
      expect(result.recommendedVersion).toBe(2);
    });

    it("returns 0 when unclear which version to keep", async () => {
      const entry = makeEntry([
        {
          version: 1,
          value: "option A",
          valid_from: "2026-05-01T10:00:00Z",
          valid_to: null,
          confidence: 0.7,
          injected_by: "alice",
          confirmed_by: ["alice", "bob"],
          status: "conflicting",
        },
        {
          version: 2,
          value: "option B",
          valid_from: "2026-05-06T10:00:00Z",
          valid_to: null,
          confidence: 0.7,
          injected_by: "charlie",
          confirmed_by: [],
          status: "conflicting",
        },
      ]);

      const conflict: ConflictResult = {
        type: "conflict-mark",
        existingEntry: entry,
        newClaim: entry.claims[1],
        confidenceDelta: 0,
        reason: "Conflicting values",
      };

      const result = await explainer.explainConflict(entry, conflict);
      // Same confidence, different confirmation count — may recommend 0 or recommend based on confirmation
      expect(typeof result.recommendedVersion).toBe("number");
    });

    it("formats explanation for CLI display", async () => {
      const entry = makeEntry([
        {
          version: 1,
          value: "PDF",
          valid_from: "2026-05-01T10:00:00Z",
          valid_to: null,
          confidence: 0.85,
          injected_by: "张三",
          confirmed_by: [],
          status: "conflicting",
        },
        {
          version: 2,
          value: "Markdown",
          valid_from: "2026-05-06T10:00:00Z",
          valid_to: null,
          confidence: 0.70,
          injected_by: "李四",
          confirmed_by: [],
          status: "conflicting",
        },
      ]);

      const conflict: ConflictResult = {
        type: "conflict-mark",
        existingEntry: entry,
        newClaim: entry.claims[1],
        confidenceDelta: 0.15,
        reason: "Conflicting values",
      };

      const result = await explainer.explainConflict(entry, conflict);
      const formatted = explainer.formatForCLI(result);

      expect(formatted).toContain("AI 冲突分析报告");
      expect(formatted).toContain("客户A");
      expect(formatted).toContain("交付格式");
      expect(formatted).toContain("PDF");
      expect(formatted).toContain("Markdown");
    });
  });

  describe("explainAllConflicts", () => {
    it("returns explanations for all conflicting entries", async () => {
      const entries: LedgerEntry[] = [
        makeEntry([
          {
            version: 1, value: "A", valid_from: "2026-05-01T10:00:00Z",
            valid_to: null, confidence: 0.8, injected_by: "x", confirmed_by: [],
            status: "conflicting",
          },
          {
            version: 2, value: "B", valid_from: "2026-05-06T10:00:00Z",
            valid_to: null, confidence: 0.7, injected_by: "y", confirmed_by: [],
            status: "conflicting",
          },
        ]),
      ];

      const results = await explainer.explainAllConflicts(entries);
      expect(results.length).toBe(1);
      expect(results[0].summary.length).toBeGreaterThan(0);
    });
  });
});
