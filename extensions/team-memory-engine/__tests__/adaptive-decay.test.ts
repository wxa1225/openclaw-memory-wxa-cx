// Tests for Adaptive Decay Learner

import {
  getCategoryDefaultHalfLife,
  adjustHalfLifeFromReviews,
  recordReviewOutcome,
  getReviewHistorySummary,
  applyCategoryDefaults,
} from "../lib/adaptive-decay.js";
import type { LedgerEntry } from "../lib/storage/types.js";

function makeEntry(
  category: string,
  halfLife?: number,
  reviewHistory?: Array<{ date: string; stillValid: boolean; strengthAtReview: number }>
): LedgerEntry {
  const entry: LedgerEntry = {
    id: "mem-test",
    entity: "test",
    attribute: "test",
    claims: [{
      version: 1, value: "test", valid_from: new Date().toISOString(),
      valid_to: null, confidence: 0.8, injected_by: "test", confirmed_by: [], status: "active",
    }],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: halfLife ?? 14,
    category,
    tags: [],
    teamId: "test",
    access_count: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (reviewHistory) {
    (entry as any).reviewHistory = reviewHistory;
  }
  return entry;
}

describe("Adaptive Decay Learner", () => {
  describe("getCategoryDefaultHalfLife", () => {
    it("returns correct defaults for known categories", () => {
      expect(getCategoryDefaultHalfLife("decision")).toBe(21);
      expect(getCategoryDefaultHalfLife("api")).toBe(14);
      expect(getCategoryDefaultHalfLife("process")).toBe(14);
      expect(getCategoryDefaultHalfLife("security")).toBe(7);
      expect(getCategoryDefaultHalfLife("experience")).toBe(30);
    });

    it("falls back to general for unknown categories", () => {
      expect(getCategoryDefaultHalfLife("unknown")).toBe(7);
    });
  });

  describe("recordReviewOutcome", () => {
    it("records a review", () => {
      const entry = makeEntry("decision");
      recordReviewOutcome(entry, true, 0.7);
      const history: any[] = (entry as any).reviewHistory;
      expect(history.length).toBe(1);
      expect(history[0].stillValid).toBe(true);
      expect(history[0].strengthAtReview).toBe(0.7);
    });

    it("caps review history at 20 entries", () => {
      const entry = makeEntry("decision");
      for (let i = 0; i < 25; i++) {
        recordReviewOutcome(entry, true, 0.5);
      }
      const history: any[] = (entry as any).reviewHistory;
      expect(history.length).toBe(20);
    });
  });

  describe("adjustHalfLifeFromReviews", () => {
    it("uses category default when no reviews", () => {
      const entry = makeEntry("decision", 14);
      const hl = adjustHalfLifeFromReviews(entry);
      expect(hl).toBe(21); // decision default
    });

    it("increases half-life when review confirms memory still valid", () => {
      // Simulate: memory was reviewed as still valid at high strength after a long time
      const oldDate = new Date(Date.now() - 20 * 86400000).toISOString(); // 20 days ago
      const entry = makeEntry("decision", 14, [{
        date: oldDate,
        stillValid: true,
        strengthAtReview: 0.8, // Was still at 80% after 20 days — very stable
      }]);
      const hl = adjustHalfLifeFromReviews(entry);
      // EMA: 0.3 * observedHL + 0.7 * 14. If observed > 14, result > 14
      // strength=0.8 after 20 days => observedHL = 20/(-log2(0.8)) ≈ 62
      // EMA = 0.3 * 62 + 0.7 * 14 = 18.6 + 9.8 = 28.4
      expect(hl).toBeGreaterThan(14);
    });

    it("decreases half-life when review finds memory needs update", () => {
      const entry = makeEntry("api", 14, [{
        date: new Date(Date.now() - 5 * 86400000).toISOString(),
        stillValid: false,
        strengthAtReview: 0.3,
      }]);
      const hl = adjustHalfLifeFromReviews(entry);
      expect(hl).toBeLessThan(14); // Should decrease
    });
  });

  describe("getReviewHistorySummary", () => {
    it("returns 'no reviews' message when empty", () => {
      const entry = makeEntry("decision");
      expect(getReviewHistorySummary(entry)).toContain("无复习记录");
    });

    it("returns summary with review count and rate", () => {
      const entry = makeEntry("decision");
      recordReviewOutcome(entry, true, 0.7);
      recordReviewOutcome(entry, true, 0.5);
      recordReviewOutcome(entry, false, 0.2);
      const summary = getReviewHistorySummary(entry);
      expect(summary).toContain("复习 3 次");
      expect(summary).toContain("67%"); // 2 out of 3 valid
    });
  });

  describe("applyCategoryDefaults", () => {
    it("updates entries with generic half-life to category defaults", () => {
      const entries = [
        makeEntry("decision", 14),
        makeEntry("security", 14),
        makeEntry("experience", 14),
      ];
      const updated = applyCategoryDefaults(entries);
      expect(updated).toBe(3);
      expect(entries[0].recall_half_life).toBe(21);
      expect(entries[1].recall_half_life).toBe(7);
      expect(entries[2].recall_half_life).toBe(30);
    });

    it("skips entries that already have non-default half-life", () => {
      const entries = [
        makeEntry("decision", 21), // Already set
        makeEntry("security", 14), // Generic, should update
      ];
      const updated = applyCategoryDefaults(entries);
      expect(updated).toBe(1);
      expect(entries[0].recall_half_life).toBe(21); // Unchanged
    });
  });
});
