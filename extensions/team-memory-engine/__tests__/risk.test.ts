// Unit tests for risk.ts — five-dimensional forgetting risk model

import { RiskModel } from "../lib/risk.js";
import {
  RISK_WEIGHTS,
  RISK_THRESHOLDS,
  CATEGORY_WEIGHTS,
  type LedgerEntry,
  type LedgerClaim,
} from "../lib/storage/types.js";

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const now = new Date().toISOString();
  return {
    id: "risk-test",
    entity: "TestEntity",
    attribute: "TestAttr",
    claims: [{
      version: 1,
      value: "test value",
      valid_from: now,
      valid_to: null,
      confidence: 0.7,
      source: "test",
      injected_by: "alice",
      confirmed_by: [],
      status: "active",
    }],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 14,
    category: "general",
    tags: [],
    teamId: "test-team",
    access_count: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("RiskModel", () => {
  let model: RiskModel;

  beforeEach(() => {
    model = new RiskModel({ teamSize: 5, expectedAccessCount: 10 });
  });

  // ---- Total risk computation ----

  test("computeRisk returns all five dimensions", async () => {
    const entry = makeEntry();
    const score = await model.computeRisk(entry);
    expect(score).toHaveProperty("memoryId");
    expect(score).toHaveProperty("totalRisk");
    expect(score).toHaveProperty("timeDecay");
    expect(score).toHaveProperty("businessImpact");
    expect(score).toHaveProperty("lowCoverage");
    expect(score).toHaveProperty("versionRisk");
    expect(score).toHaveProperty("lowUsage");
    expect(score).toHaveProperty("triggered");
    expect(score).toHaveProperty("timestamp");
  });

  test("totalRisk is weighted sum of dimensions", async () => {
    const entry = makeEntry();
    const score = await model.computeRisk(entry);
    const expected =
      RISK_WEIGHTS.timeDecay * score.timeDecay +
      RISK_WEIGHTS.businessImpact * score.businessImpact +
      RISK_WEIGHTS.lowCoverage * score.lowCoverage +
      RISK_WEIGHTS.versionRisk * score.versionRisk +
      RISK_WEIGHTS.lowUsage * score.lowUsage;
    expect(score.totalRisk).toBeCloseTo(Math.round(expected * 1000) / 1000, 3);
  });

  // ---- TimeDecay ----

  test("fresh entry has low timeDecay", async () => {
    const entry = makeEntry();
    const score = await model.computeRisk(entry);
    expect(score.timeDecay).toBeLessThan(0.1);
  });

  test("old entry has high timeDecay", async () => {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({
      claims: [{
        version: 1,
        value: "old value",
        valid_from: monthAgo,
        valid_to: null,
        confidence: 0.7,
        source: "test",
        injected_by: "alice",
        confirmed_by: [],
        status: "active",
      }],
    });
    const score = await model.computeRisk(entry);
    expect(score.timeDecay).toBeGreaterThan(0.5);
  });

  test("entry with no active claims has timeDecay=1.0", async () => {
    const entry = makeEntry({
      claims: [{
        version: 1,
        value: "superseded",
        valid_from: new Date().toISOString(),
        valid_to: new Date().toISOString(),
        confidence: 0.5,
        injected_by: "alice",
        confirmed_by: [],
        status: "superseded",
      }],
    });
    const score = await model.computeRisk(entry);
    expect(score.timeDecay).toBe(1.0);
  });

  // ---- BusinessImpact ----

  test("security category has highest business impact", async () => {
    const security = makeEntry({ category: "security" });
    const general = makeEntry({ category: "general" });
    const secScore = await model.computeRisk(security);
    const genScore = await model.computeRisk(general);
    expect(secScore.businessImpact).toBeGreaterThan(genScore.businessImpact);
  });

  test("critical tags increase business impact", async () => {
    const critical = makeEntry({ category: "api", tags: ["critical", "prod"] });
    const normal = makeEntry({ category: "api", tags: [] });
    const critScore = await model.computeRisk(critical);
    const normScore = await model.computeRisk(normal);
    expect(critScore.businessImpact).toBeGreaterThan(normScore.businessImpact);
  });

  // ---- LowCoverage ----

  test("single injector has high coverage risk", async () => {
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: [], status: "active", source: "test",
      }],
    });
    const score = await model.computeRisk(entry);
    // Only alice knows it, team size is 5, so coverage = 1/5, lowCoverage = 0.8
    expect(score.lowCoverage).toBeGreaterThan(0.5);
  });

  test("full team confirmation eliminates coverage risk", async () => {
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: ["bob", "charlie", "dave", "eve"],
        status: "active", source: "test",
      }],
    });
    const score = await model.computeRisk(entry);
    expect(score.lowCoverage).toBe(0);
  });

  // ---- VersionRisk ----

  test("conflicting claims have high version risk", async () => {
    const entry = makeEntry({
      claims: [
        { version: 1, value: "A", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.5, injected_by: "alice", confirmed_by: [], status: "conflicting", source: "test" },
        { version: 2, value: "B", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.5, injected_by: "bob", confirmed_by: [], status: "conflicting", source: "test" },
      ],
      current_version: 2,
    });
    const score = await model.computeRisk(entry);
    expect(score.versionRisk).toBe(0.6);
  });

  test("many versions increase version risk", async () => {
    const claims: LedgerClaim[] = [];
    for (let i = 1; i <= 7; i++) {
      claims.push({
        version: i, value: `v${i}`, valid_from: new Date().toISOString(),
        valid_to: i < 7 ? new Date().toISOString() : null,
        confidence: 0.7, injected_by: "alice", confirmed_by: [],
        status: i < 7 ? "superseded" : "active", source: "test",
      });
    }
    const entry = makeEntry({ claims, current_version: 7 });
    const score = await model.computeRisk(entry);
    expect(score.versionRisk).toBe(0.5); // >5 versions with recent clustering
  });

  test("moderate version count gives moderate risk", async () => {
    const claims: LedgerClaim[] = [];
    for (let i = 1; i <= 4; i++) {
      claims.push({
        version: i, value: `v${i}`, valid_from: new Date().toISOString(),
        valid_to: i < 4 ? new Date().toISOString() : null,
        confidence: 0.7, injected_by: "alice", confirmed_by: [],
        status: i < 4 ? "superseded" : "active", source: "test",
      });
    }
    const entry = makeEntry({ claims, current_version: 4 });
    const score = await model.computeRisk(entry);
    expect(score.versionRisk).toBe(0.3); // >2 versions
  });

  // ---- LowUsage ----

  test("never accessed entry has lowUsage=1.0", async () => {
    const entry = makeEntry({ access_count: 0 });
    const score = await model.computeRisk(entry);
    expect(score.lowUsage).toBe(1.0);
  });

  test("frequently accessed entry has low lowUsage", async () => {
    const entry = makeEntry({ access_count: 20 }); // expected is 10
    const score = await model.computeRisk(entry);
    expect(score.lowUsage).toBe(0);
  });

  // ---- Dual-threshold gating ----

  test("isAlertTriggered requires both totalRisk and businessImpact above thresholds", () => {
    const score = {
      memoryId: "test", totalRisk: 0.6, timeDecay: 0.5,
      businessImpact: 0.6, lowCoverage: 0.3, versionRisk: 0.2,
      lowUsage: 0.4, triggered: false, timestamp: new Date().toISOString(),
    };
    expect(model.isAlertTriggered(score)).toBe(true);

    score.businessImpact = 0.3; // below threshold
    expect(model.isAlertTriggered(score)).toBe(false);
  });

  test("fresh general entry does not trigger alert", async () => {
    const entry = makeEntry();
    const score = await model.computeRisk(entry);
    expect(score.triggered).toBe(false);
  });

  // ---- computeAllRisks / getTriggeredRisks ----

  test("computeAllRisks sorts by totalRisk descending", async () => {
    const entries = [
      makeEntry({ id: "a", category: "general" }),
      makeEntry({ id: "b", category: "security" }),
      makeEntry({ id: "c", category: "decision" }),
    ];
    const scores = await model.computeAllRisks(entries);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].totalRisk).toBeGreaterThanOrEqual(scores[i].totalRisk);
    }
  });

  // ---- formatRiskCard ----

  test("formatRiskCard returns valid JSON string", async () => {
    const entry = makeEntry();
    const score = await model.computeRisk(entry);
    const card = model.formatRiskCard(score, entry);
    const parsed = JSON.parse(card);
    expect(parsed).toHaveProperty("header");
    expect(parsed).toHaveProperty("elements");
  });

  test("formatRiskSummary returns string for empty triggered list", () => {
    const summary = model.formatRiskSummary([]);
    expect(summary).toContain("No memories exceed risk thresholds");
  });
});
