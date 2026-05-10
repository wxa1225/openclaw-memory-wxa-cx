// Unit tests for knowledge-analyzer.ts — knowledge gap detection, departure simulation, transfer recommendation

import { TMSKnowledgeAnalyzer } from "../lib/knowledge-analyzer.js";
import type {
  LedgerEntry,
  TeamCapabilityProfile,
  KnowledgeGap,
  DepartureSimulationResult,
} from "../lib/storage/types.js";

function makeEntry(overrides: Partial<LedgerEntry> & {
  injected_by?: string;
  confirmed_by?: string[];
  value?: string;
} = {}): LedgerEntry {
  const now = new Date().toISOString();
  const { injected_by, confirmed_by, value, ...restOverrides } = overrides;

  const claim = {
    version: 1,
    value: value ?? "test value",
    valid_from: now,
    valid_to: null,
    confidence: 0.7,
    source: "test",
    injected_by: injected_by ?? "alice",
    confirmed_by: confirmed_by ?? [],
    status: "active" as const,
  };

  return {
    id: "test-mem-1",
    entity: "TestEntity",
    attribute: "TestAttr",
    claims: [claim],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 14,
    category: "general",
    tags: [],
    teamId: "test-team",
    access_count: 0,
    createdAt: now,
    updatedAt: now,
    ...restOverrides,
  };
}

function makeProfile(overrides: Partial<TeamCapabilityProfile> = {}): TeamCapabilityProfile {
  const now = new Date().toISOString();
  return {
    teamId: "test-team",
    members: {
      alice: {
        memberId: "alice",
        displayName: "Alice",
        expertiseAreas: ["decision", "api"],
        knownMemoryIds: ["test-mem-1", "test-mem-2", "test-mem-3"],
        trustScore: 0.8,
        lastActiveAt: now,
        contributionCount: 15,
        confirmationCount: 5,
      },
      bob: {
        memberId: "bob",
        displayName: "Bob",
        expertiseAreas: ["decision", "process"],
        knownMemoryIds: ["test-mem-2", "test-mem-4"],
        trustScore: 0.6,
        lastActiveAt: now,
        contributionCount: 8,
        confirmationCount: 2,
      },
      charlie: {
        memberId: "charlie",
        displayName: "Charlie",
        expertiseAreas: ["security", "api"],
        knownMemoryIds: ["test-mem-2", "test-mem-5"],
        trustScore: 0.7,
        lastActiveAt: now,
        contributionCount: 10,
        confirmationCount: 3,
      },
    },
    updatedAt: now,
    ...overrides,
  };
}

describe("TMSKnowledgeAnalyzer", () => {
  let analyzer: TMSKnowledgeAnalyzer;
  let profile: TeamCapabilityProfile;

  beforeEach(() => {
    profile = makeProfile();
    analyzer = new TMSKnowledgeAnalyzer("test-team", profile);
  });

  // ---- Single Points of Failure ----

  test("findSinglePointsOfFailure returns memories known by exactly one person", () => {
    // test-mem-3 and test-mem-5 are only known by alice and charlie respectively
    // test-mem-1: only alice knows (injected_by alice, no confirmers in profile)
    const entries = [
      makeEntry({ id: "test-mem-1", injected_by: "alice", confirmed_by: [] }),
      makeEntry({ id: "test-mem-3", injected_by: "alice", confirmed_by: ["external-user"] }),
      makeEntry({ id: "test-mem-5", injected_by: "charlie", confirmed_by: [] }),
      // test-mem-2 is known by alice + bob + charlie (not a single point)
      makeEntry({ id: "test-mem-2", injected_by: "alice", confirmed_by: ["bob", "charlie"] }),
    ];

    const gaps = analyzer.findSinglePointsOfFailure(entries);
    const gapIds = gaps.map((g) => g.memoryId);

    // test-mem-1 and test-mem-3 should be single points (only alice in profile knows them)
    expect(gapIds).toContain("test-mem-1");
    expect(gapIds).toContain("test-mem-3");
    expect(gapIds).toContain("test-mem-5");
    // test-mem-2 is known by 3 people, NOT a single point
    expect(gapIds).not.toContain("test-mem-2");
  });

  test("findSinglePointsOfFailure returns empty array when knowledge is well distributed", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: ["bob", "charlie"] }),
      makeEntry({ id: "mem-2", injected_by: "bob", confirmed_by: ["alice", "charlie"] }),
    ];
    const gaps = analyzer.findSinglePointsOfFailure(entries);
    expect(gaps).toHaveLength(0);
  });

  test("single points of failure are sorted by riskScore descending", () => {
    const entries = [
      makeEntry({
        id: "low-risk",
        entity: "LowEntity",
        attribute: "attr",
        injected_by: "alice",
        confirmed_by: [],
        category: "general",
        tags: [],
      }),
      makeEntry({
        id: "high-risk",
        entity: "HighEntity",
        attribute: "attr",
        injected_by: "charlie",
        confirmed_by: [],
        category: "security",
        tags: ["critical"],
      }),
    ];
    const gaps = analyzer.findSinglePointsOfFailure(entries);
    expect(gaps[0].memoryId).toBe("high-risk");
    expect(gaps[0].riskScore).toBeGreaterThanOrEqual(gaps[1].riskScore);
  });

  test("KnowledgeGap contains correct fields", () => {
    const entries = [
      makeEntry({
        id: "gap-test",
        entity: "MyEntity",
        attribute: "MyAttr",
        value: "MyValue",
        category: "decision",
        tags: ["important"],
        injected_by: "alice",
        confirmed_by: [],
      }),
    ];
    const gaps = analyzer.findSinglePointsOfFailure(entries);
    expect(gaps).toHaveLength(1);
    const gap = gaps[0];
    expect(gap.memoryId).toBe("gap-test");
    expect(gap.entity).toBe("MyEntity");
    expect(gap.attribute).toBe("MyAttr");
    expect(gap.value).toBe("MyValue");
    expect(gap.category).toBe("decision");
    expect(gap.tags).toContain("important");
    expect(gap.currentHolder).toBe("alice");
    expect(gap.riskScore).toBeGreaterThan(0);
    expect(gap.businessImpact).toBeGreaterThan(0);
  });

  // ---- Departure Simulation ----

  test("simulateDeparture returns null for unknown member", () => {
    const result = analyzer.simulateDeparture("unknown-person", []);
    expect(result).toBeNull();
  });

  test("simulateDeparture returns null for single-person team", () => {
    const singleProfile = makeProfile({
      members: {
        onlyone: {
          memberId: "onlyone",
          displayName: "Only One",
          expertiseAreas: ["general"],
          knownMemoryIds: ["mem-1"],
          trustScore: 0.5,
          lastActiveAt: new Date().toISOString(),
          contributionCount: 1,
          confirmationCount: 0,
        },
      },
    });
    const singleAnalyzer = new TMSKnowledgeAnalyzer("test-team", singleProfile);
    const entries = [makeEntry({ id: "mem-1", injected_by: "onlyone", confirmed_by: [] })];
    const result = singleAnalyzer.simulateDeparture("onlyone", entries);
    expect(result).toBeNull();
  });

  test("simulateDeparture identifies single point failures correctly", () => {
    // Alice knows mem-1 (only her), mem-2 (shared with bob), mem-3 (only her)
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
      makeEntry({ id: "mem-2", injected_by: "alice", confirmed_by: ["bob"] }),
      makeEntry({ id: "mem-3", injected_by: "alice", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    expect(result!.impact.singlePointFailures.length).toBe(2);
    const spfIds = result!.impact.singlePointFailures.map((s) => s.memoryId);
    expect(spfIds).toContain("mem-1");
    expect(spfIds).toContain("mem-3");
    expect(spfIds).not.toContain("mem-2"); // bob also knows this
  });

  test("simulateDeparture computes risk increase", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: ["bob"] }),
      makeEntry({ id: "mem-2", injected_by: "bob", confirmed_by: ["charlie"] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    expect(result!.beforeRiskScores.length).toBe(2);
    expect(result!.afterRiskScores.length).toBe(2);
    // After alice leaves, the team size drops from 3 to 2.
    // The knowledge loss percentage should reflect single-point failures
    expect(result!.impact.singlePointFailures.length).toBe(0); // alice shares mem-1 with bob
    expect(result!.impact.totalMemoriesKnown).toBe(1); // alice only knows mem-1
  });

  test("simulateDeparture computes knowledge loss percentage", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
      makeEntry({ id: "mem-2", injected_by: "bob", confirmed_by: ["alice"] }),
      makeEntry({ id: "mem-3", injected_by: "charlie", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    // Only mem-1 is exclusively known by alice
    expect(result!.impact.singlePointFailures.length).toBe(1);
    expect(result!.impact.knowledgeLossPercentage).toBeGreaterThan(0);
  });

  test("simulateDeparture identifies affected categories", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [], category: "security" }),
      makeEntry({ id: "mem-2", injected_by: "alice", confirmed_by: [], category: "api" }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    expect(result!.impact.affectedCategories).toContain("security");
    expect(result!.impact.affectedCategories).toContain("api");
  });

  test("simulateDeparture generates transfer recommendations", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    expect(result!.recommendations.length).toBeGreaterThan(0);
    // Bob and charlie should be candidates
    const recIds = result!.recommendations.map((r) => r.recommendedMemberId);
    expect(recIds).toContain("bob");
    expect(recIds).toContain("charlie");
  });

  test("transfer recommendations are sorted by transferScore descending", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    const recs = result!.recommendations;
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].transferScore).toBeGreaterThanOrEqual(recs[i].transferScore);
    }
  });

  test("TransferRecommendation has correct fields", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    const rec = result!.recommendations[0];
    expect(rec).toHaveProperty("recommendedMemberId");
    expect(rec).toHaveProperty("recommendedDisplayName");
    expect(rec).toHaveProperty("transferScore");
    expect(rec).toHaveProperty("reason");
    expect(rec).toHaveProperty("expertiseOverlap");
    expect(rec).toHaveProperty("currentKnowledgeOverlap");
    expect(rec).toHaveProperty("trustScore");
    expect(rec.transferScore).toBeGreaterThanOrEqual(0);
    expect(rec.transferScore).toBeLessThanOrEqual(1);
  });

  test("simulateDeparture builds summary text", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Alice");
    expect(result!.summary).toContain("知识断层");
    expect(result!.summary).toContain("风险增加");
  });

  // ---- Knowledge Distribution ----

  test("getKnowledgeDistribution returns category-level knowledge counts", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: ["bob"], category: "decision" }),
      makeEntry({ id: "mem-2", injected_by: "charlie", confirmed_by: [], category: "security" }),
      makeEntry({ id: "mem-3", injected_by: "alice", confirmed_by: [], category: "decision" }),
    ];

    const dist = analyzer.getKnowledgeDistribution(entries);
    expect(dist["decision"]).toBe(3); // alice knows both, bob knows one
    expect(dist["security"]).toBe(1); // only charlie
  });

  // ---- Shared Knowledge ----

  test("getSharedKnowledge returns memories known by both members", () => {
    // alice knows mem-1, mem-2, mem-3
    // bob knows mem-2, mem-4
    // shared: mem-2
    const shared = analyzer.getSharedKnowledge("alice", "bob");
    expect(shared).toContain("test-mem-2");
    expect(shared).not.toContain("test-mem-1");
    expect(shared).not.toContain("test-mem-3");
    expect(shared).not.toContain("test-mem-4");
  });

  test("getSharedKnowledge returns empty for non-overlapping members", () => {
    // Create profile with no overlap
    const noOverlapProfile = makeProfile({
      members: {
        alice: {
          memberId: "alice",
          displayName: "Alice",
          expertiseAreas: ["api"],
          knownMemoryIds: ["mem-a"],
          trustScore: 0.8,
          lastActiveAt: new Date().toISOString(),
          contributionCount: 10,
          confirmationCount: 0,
        },
        bob: {
          memberId: "bob",
          displayName: "Bob",
          expertiseAreas: ["process"],
          knownMemoryIds: ["mem-b"],
          trustScore: 0.6,
          lastActiveAt: new Date().toISOString(),
          contributionCount: 5,
          confirmationCount: 0,
        },
      },
    });
    const noOverlapAnalyzer = new TMSKnowledgeAnalyzer("test-team", noOverlapProfile);
    const shared = noOverlapAnalyzer.getSharedKnowledge("alice", "bob");
    expect(shared).toHaveLength(0);
  });

  test("getSharedKnowledge returns empty for unknown member", () => {
    const shared = analyzer.getSharedKnowledge("alice", "unknown");
    expect(shared).toHaveLength(0);
  });

  // ---- Edge Cases ----

  test("empty entries produce empty results", () => {
    const gaps = analyzer.findSinglePointsOfFailure([]);
    expect(gaps).toHaveLength(0);
  });

  test("security category has higher single-point risk than general", () => {
    const entries = [
      makeEntry({ id: "sec", injected_by: "alice", confirmed_by: [], category: "security", tags: ["critical"] }),
      makeEntry({ id: "gen", injected_by: "alice", confirmed_by: [], category: "general", tags: [] }),
    ];

    const gaps = analyzer.findSinglePointsOfFailure(entries);
    const secGap = gaps.find((g) => g.memoryId === "sec");
    const genGap = gaps.find((g) => g.memoryId === "gen");
    expect(secGap!.riskScore).toBeGreaterThan(genGap!.riskScore);
    expect(secGap!.businessImpact).toBeGreaterThan(genGap!.businessImpact);
  });

  test("DepartureSimulationResult has all required fields", () => {
    const entries = [
      makeEntry({ id: "mem-1", injected_by: "alice", confirmed_by: [] }),
    ];

    const result = analyzer.simulateDeparture("alice", entries);
    expect(result).not.toBeNull();
    expect(result!).toHaveProperty("impact");
    expect(result!).toHaveProperty("recommendations");
    expect(result!).toHaveProperty("beforeRiskScores");
    expect(result!).toHaveProperty("afterRiskScores");
    expect(result!).toHaveProperty("summary");

    // Check impact fields
    const impact = result!.impact;
    expect(impact).toHaveProperty("memberId");
    expect(impact).toHaveProperty("displayName");
    expect(impact).toHaveProperty("totalMemoriesKnown");
    expect(impact).toHaveProperty("singlePointFailures");
    expect(impact).toHaveProperty("totalRiskIncrease");
    expect(impact).toHaveProperty("affectedCategories");
    expect(impact).toHaveProperty("knowledgeLossPercentage");
  });
});
