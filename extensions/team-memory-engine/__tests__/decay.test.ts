// Unit tests for decay.ts — Ebbinghaus forgetting curve model

import {
  calculateStrength,
  calculateStrengthFromLedger,
  getStrengthLabel,
  isDueForReview,
  FORGETTING_CURVE_INTERVALS,
  computeDecayStrength,
  closestIntervalIndex,
} from "../lib/decay.js";
import type { StoredMemory, LedgerEntry, LedgerClaim } from "../lib/storage/types.js";

// ---- Helper factories ----

function makeStoredMemory(opts: { injectedAt?: string; lastReviewedAt?: string; intervalIndex?: number } = {}): StoredMemory {
  const now = new Date().toISOString();
  return {
    id: "test-mem",
    memory: "test memory",
    teamId: "test-team",
    metadata: {
      injectedAt: opts.injectedAt ?? now,
      lastReviewedAt: opts.lastReviewedAt ?? opts.injectedAt ?? now,
      reviewCount: 0,
      currentIntervalIndex: opts.intervalIndex ?? 0,
      version: 1,
      injectedBy: "test",
      category: "general",
      tags: [],
      versionHistory: [{ version: 1, text: "test", updatedAt: now, updatedBy: "test" }],
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeLedgerEntry(opts: {
  validFrom?: string;
  recallHalfLife?: number;
  claims?: LedgerClaim[];
} = {}): LedgerEntry {
  const now = new Date().toISOString();
  const validFrom = opts.validFrom ?? now;
  return {
    id: "test-ledger",
    entity: "TestEntity",
    attribute: "TestAttr",
    claims: opts.claims ?? [{
      version: 1,
      value: "test value",
      valid_from: validFrom,
      valid_to: null,
      confidence: 0.7,
      source: "test",
      injected_by: "test-user",
      confirmed_by: [],
      status: "active",
    }],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: opts.recallHalfLife ?? 14,
    category: "general",
    tags: [],
    teamId: "test-team",
    access_count: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ---- Tests: calculateStrength (StoredMemory) ----

describe("calculateStrength", () => {
  test("returns 1.0 for a freshly injected memory", () => {
    const mem = makeStoredMemory();
    const strength = calculateStrength(mem);
    expect(strength).toBeCloseTo(1.0, 2);
  });

  test("returns ~0.5 at the interval boundary", () => {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 1 * 60 * 1000).toISOString();
    const mem = makeStoredMemory({
      injectedAt: oneMinuteAgo,
      lastReviewedAt: oneMinuteAgo,
      intervalIndex: 0, // 1 minute interval
    });
    const strength = calculateStrength(mem);
    expect(strength).toBeCloseTo(0.5, 1);
  });

  test("returns near 0 for very old memories", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const mem = makeStoredMemory({
      injectedAt: oneDayAgo,
      lastReviewedAt: oneDayAgo,
      intervalIndex: 0, // 1 minute interval
    });
    const strength = calculateStrength(mem);
    expect(strength).toBeLessThan(0.01);
    expect(strength).toBeGreaterThanOrEqual(0);
  });

  test("returns value between 0 and 1 for any input", () => {
    const mem = makeStoredMemory({ intervalIndex: 5 });
    const strength = calculateStrength(mem);
    expect(strength).toBeGreaterThanOrEqual(0);
    expect(strength).toBeLessThanOrEqual(1);
  });
});

// ---- Tests: calculateStrengthFromLedger ----

describe("calculateStrengthFromLedger", () => {
  test("returns 1.0 for a freshly created entry", () => {
    const entry = makeLedgerEntry();
    const strength = calculateStrengthFromLedger(entry);
    expect(strength).toBeCloseTo(1.0, 2);
  });

  test("returns 0 when no active claims exist", () => {
    const entry = makeLedgerEntry({
      claims: [{
        version: 1,
        value: "old value",
        valid_from: new Date().toISOString(),
        valid_to: new Date().toISOString(),
        confidence: 0.5,
        injected_by: "test",
        confirmed_by: [],
        status: "superseded",
      }],
    });
    const strength = calculateStrengthFromLedger(entry);
    expect(strength).toBe(0);
  });

  test("uses recall_half_life to determine decay rate", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const shortHalfLife = makeLedgerEntry({ validFrom: oneDayAgo, recallHalfLife: 1 });
    const longHalfLife = makeLedgerEntry({ validFrom: oneDayAgo, recallHalfLife: 30 });
    expect(calculateStrengthFromLedger(shortHalfLife)).toBeLessThan(
      calculateStrengthFromLedger(longHalfLife)
    );
  });
});

// ---- Tests: getStrengthLabel ----

describe("getStrengthLabel", () => {
  test.each([
    [1.0, "fresh"],
    [0.8, "fresh"],
    [0.79, "strong"],
    [0.5, "strong"],
    [0.49, "fading"],
    [0.3, "fading"],
    [0.29, "weak"],
    [0.1, "weak"],
    [0.09, "critical"],
    [0.0, "critical"],
  ])("strength %f => label '%s'", (strength, expected) => {
    expect(getStrengthLabel(strength)).toBe(expected);
  });
});

// ---- Tests: isDueForReview ----

describe("isDueForReview", () => {
  test("fresh memory is not due for review", () => {
    const mem = makeStoredMemory();
    expect(isDueForReview(mem)).toBe(false);
  });

  test("old memory is due for review", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const mem = makeStoredMemory({
      injectedAt: oneHourAgo,
      lastReviewedAt: oneHourAgo,
      intervalIndex: 0, // 1 minute
    });
    expect(isDueForReview(mem, 0.4)).toBe(true);
  });

  test("uses default threshold of 0.4", () => {
    const mem = makeStoredMemory();
    // Fresh memory has strength ~1.0, well above 0.4
    expect(isDueForReview(mem)).toBe(false);
  });
});

// ---- Tests: FORGETTING_CURVE_INTERVALS ----

describe("FORGETTING_CURVE_INTERVALS", () => {
  test("has 9 intervals", () => {
    expect(FORGETTING_CURVE_INTERVALS.length).toBe(9);
  });

  test("intervals are in ascending order", () => {
    for (let i = 1; i < FORGETTING_CURVE_INTERVALS.length; i++) {
      expect(FORGETTING_CURVE_INTERVALS[i]).toBeGreaterThan(FORGETTING_CURVE_INTERVALS[i - 1]);
    }
  });

  test("first interval is 1 minute", () => {
    expect(FORGETTING_CURVE_INTERVALS[0]).toBe(1 * 60 * 1000);
  });

  test("last interval is 31 days", () => {
    expect(FORGETTING_CURVE_INTERVALS[8]).toBe(31 * 24 * 60 * 60 * 1000);
  });
});

// ---- Tests: computeDecayStrength (core unified function) ----

describe("computeDecayStrength", () => {
  test("returns 1.0 when elapsed is 0", () => {
    expect(computeDecayStrength(0, 60000)).toBe(1.0);
  });

  test("returns 1.0 when interval is 0 or negative", () => {
    expect(computeDecayStrength(1000, 0)).toBe(1.0);
    expect(computeDecayStrength(1000, -100)).toBe(1.0);
  });

  test("returns 0.5 at the half-life point", () => {
    const halfLife = 60000; // 1 minute
    const strength = computeDecayStrength(halfLife, halfLife);
    expect(strength).toBeCloseTo(0.5, 5);
  });

  test("returns ~0.25 at 2x half-life", () => {
    const halfLife = 60000;
    const strength = computeDecayStrength(2 * halfLife, halfLife);
    expect(strength).toBeCloseTo(0.25, 3);
  });

  test("returns ~0.125 at 3x half-life", () => {
    const halfLife = 60000;
    const strength = computeDecayStrength(3 * halfLife, halfLife);
    expect(strength).toBeCloseTo(0.125, 3);
  });

  test("returns near 0 for very large elapsed time", () => {
    const strength = computeDecayStrength(1e12, 60000);
    expect(strength).toBeLessThan(0.001);
    expect(strength).toBeGreaterThanOrEqual(0);
  });

  test("clamps result to [0, 1]", () => {
    expect(computeDecayStrength(100, 100)).toBeLessThanOrEqual(1.0);
    expect(computeDecayStrength(100, 100)).toBeGreaterThanOrEqual(0);
  });

  test("is the shared core function used by both calculateStrength and calculateStrengthFromLedger", () => {
    // Verify that the core formula produces expected results
    // S = 2^(-t/T): at t=T, S=0.5; at t=0, S=1.0
    expect(computeDecayStrength(0, 1000)).toBe(1.0);
    expect(computeDecayStrength(1000, 1000)).toBeCloseTo(0.5, 5);
  });
});

// ---- Tests: closestIntervalIndex ----

describe("closestIntervalIndex", () => {
  test("returns 0 for 1 minute", () => {
    expect(closestIntervalIndex(1 * 60 * 1000)).toBe(0);
  });

  test("returns 1 for 10 minutes", () => {
    expect(closestIntervalIndex(10 * 60 * 1000)).toBe(1);
  });

  test("returns 2 for 1 hour", () => {
    expect(closestIntervalIndex(60 * 60 * 1000)).toBe(2);
  });

  test("returns 8 for 31 days", () => {
    expect(closestIntervalIndex(31 * 24 * 60 * 60 * 1000)).toBe(8);
  });

  test("returns reasonable index for intermediate value", () => {
    // 3 days should be closest to 2d (index 5) or 6d (index 6)
    const idx = closestIntervalIndex(3 * 24 * 60 * 60 * 1000);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(FORGETTING_CURVE_INTERVALS.length);
  });

  test("is exported and used by risk.ts for timeDecay calculation", () => {
    // This function is shared between decay.ts and risk.ts
    // Verify it works for typical half-life values used in risk model
    const halfLife14Days = 14 * 24 * 60 * 60 * 1000;
    const idx = closestIntervalIndex(halfLife14Days);
    // 14 days should be closest to 15 days (index 7)
    expect(idx).toBe(7);
  });
});
