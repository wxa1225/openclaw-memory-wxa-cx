// Insight report demo script — generates a sample report with synthetic data
// Run: npx tsx scripts/insight-demo.ts

import { MemoryInsightEngine } from "../lib/insight-engine.js";
import { renderHtmlReport } from "../lib/html-report.js";
import type {
  LedgerEntry,
  RiskScore,
  TeamCapabilityProfile,
  DepartureSimulationResult,
} from "../lib/storage/types.js";

// Synthetic data
const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const entries: LedgerEntry[] = [
  {
    id: "mem-001", entity: "api-gateway", attribute: "endpoint",
    claims: [{ version: 1, value: "https://staging-api.example.com/v3", valid_from: new Date(now - 7 * day).toISOString(), valid_to: null, confidence: 0.8, source: "llm_extraction", injected_by: "alice", confirmed_by: ["bob"], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 14, category: "api", tags: ["prod", "critical"],
    teamId: "openclaw-team", access_count: 5, createdAt: new Date(now - 7 * day).toISOString(), updatedAt: new Date(now - 7 * day).toISOString(),
  },
  {
    id: "mem-002", entity: "deployment", attribute: "strategy",
    claims: [{ version: 1, value: "Beijing DC — grayscale", valid_from: new Date(now - 10 * day).toISOString(), valid_to: new Date(now - 3 * day).toISOString(), confidence: 0.7, source: "manual_inject", injected_by: "bob", confirmed_by: [], status: "superseded" },
             { version: 2, value: "Shanghai DC — blue/green", valid_from: new Date(now - 3 * day).toISOString(), valid_to: null, confidence: 0.85, source: "manual_inject", injected_by: "bob", confirmed_by: ["alice"], status: "active" }],
    current_version: 2, dependency_graph: [], recall_half_life: 14, category: "decision", tags: ["prod"],
    teamId: "openclaw-team", access_count: 8, createdAt: new Date(now - 10 * day).toISOString(), updatedAt: new Date(now - 3 * day).toISOString(),
  },
  {
    id: "mem-003", entity: "weekly-report", attribute: "recipient",
    claims: [{ version: 1, value: "Send to LiSi, do not CC WangWu", valid_from: new Date(now - 2 * day).toISOString(), valid_to: null, confidence: 0.7, source: "manual_inject", injected_by: "charlie", confirmed_by: [], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 7, category: "process", tags: [],
    teamId: "openclaw-team", access_count: 1, createdAt: new Date(now - 2 * day).toISOString(), updatedAt: new Date(now - 2 * day).toISOString(),
  },
  {
    id: "mem-004", entity: "db", attribute: "pool-size",
    claims: [{ version: 1, value: "Max pool size = 50", valid_from: new Date(now - 14 * day).toISOString(), valid_to: null, confidence: 0.6, source: "llm_extraction", injected_by: "alice", confirmed_by: [], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 14, category: "api", tags: [],
    teamId: "openclaw-team", access_count: 0, createdAt: new Date(now - 14 * day).toISOString(), updatedAt: new Date(now - 14 * day).toISOString(),
  },
  {
    id: "mem-005", entity: "security", attribute: "api-key-rotation",
    claims: [{ version: 1, value: "Rotate prod API keys every 30 days", valid_from: new Date(now - 20 * day).toISOString(), valid_to: null, confidence: 0.9, source: "manual_inject", injected_by: "alice", confirmed_by: ["bob", "charlie"], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 14, category: "security", tags: ["compliance", "critical"],
    teamId: "openclaw-team", access_count: 3, createdAt: new Date(now - 20 * day).toISOString(), updatedAt: new Date(now - 20 * day).toISOString(),
  },
  {
    id: "mem-006", entity: "customer-a", attribute: "delivery-format",
    claims: [{ version: 1, value: "Customer A requires PDF format, confirmed by ZhangSan", valid_from: new Date(now - 5 * day).toISOString(), valid_to: null, confidence: 0.75, source: "llm_extraction", injected_by: "bob", confirmed_by: [], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 7, category: "decision", tags: ["customer-a"],
    teamId: "openclaw-team", access_count: 2, createdAt: new Date(now - 5 * day).toISOString(), updatedAt: new Date(now - 5 * day).toISOString(),
  },
  {
    id: "mem-007", entity: "monitoring", attribute: "alert-threshold",
    claims: [{ version: 1, value: "P99 latency alert threshold: 500ms", valid_from: new Date(now - 1 * day).toISOString(), valid_to: null, confidence: 0.7, source: "manual_inject", injected_by: "diana", confirmed_by: [], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 3, category: "general", tags: [],
    teamId: "openclaw-team", access_count: 0, createdAt: new Date(now - 1 * day).toISOString(), updatedAt: new Date(now - 1 * day).toISOString(),
  },
  {
    id: "mem-008", entity: "ci", attribute: "pipeline-timeout",
    claims: [{ version: 1, value: "CI pipeline timeout set to 15 minutes", valid_from: new Date(now - 30 * day).toISOString(), valid_to: null, confidence: 0.5, source: "llm_extraction", injected_by: "alice", confirmed_by: [], status: "active" }],
    current_version: 1, dependency_graph: [], recall_half_life: 3, category: "experience", tags: [],
    teamId: "openclaw-team", access_count: 0, createdAt: new Date(now - 30 * day).toISOString(), updatedAt: new Date(now - 30 * day).toISOString(),
  },
];

// Compute simple risk scores
const riskScores: RiskScore[] = entries.map((e) => {
  const activeClaim = e.claims.find((c) => c.status === "active");
  const elapsed = activeClaim ? Date.now() - new Date(activeClaim.valid_from).getTime() : 0;
  const halfLifeMs = e.recall_half_life * day;
  const pRecall = Math.pow(2, -elapsed / halfLifeMs);
  const timeDecay = 1 - pRecall;
  const coverage = Math.min((activeClaim?.confirmed_by.length ?? 0) / 5, 1);
  const lowCoverage = 1 - coverage;
  const businessImpact = e.category === "security" ? 0.7 : e.category === "api" ? 0.55 : 0.4;
  const totalRisk = 0.35 * timeDecay + 0.25 * businessImpact + 0.20 * lowCoverage + 0.10 * 0.1 + 0.10 * (1 - (e.access_count ?? 0) / 10);

  return {
    memoryId: e.id,
    totalRisk: Math.round(totalRisk * 1000) / 1000,
    timeDecay: Math.round(timeDecay * 1000) / 1000,
    businessImpact: Math.round(businessImpact * 1000) / 1000,
    lowCoverage: Math.round(lowCoverage * 1000) / 1000,
    versionRisk: 0.1,
    lowUsage: Math.round((1 - Math.min((e.access_count ?? 0) / 10, 1)) * 1000) / 1000,
    triggered: totalRisk > 0.55 && businessImpact > 0.50,
    timestamp: new Date().toISOString(),
  };
});

// TMS profile
const tmsProfile: TeamCapabilityProfile = {
  teamId: "openclaw-team",
  updatedAt: new Date().toISOString(),
  members: {
    alice: {
      memberId: "alice", displayName: "Alice",
      expertiseAreas: ["api", "security"],
      knownMemoryIds: ["mem-001", "mem-004", "mem-005", "mem-008"],
      trustScore: 0.85, lastActiveAt: new Date().toISOString(),
      contributionCount: 3, confirmationCount: 2,
    },
    bob: {
      memberId: "bob", displayName: "Bob",
      expertiseAreas: ["decision", "api"],
      knownMemoryIds: ["mem-001", "mem-002", "mem-005", "mem-006"],
      trustScore: 0.78, lastActiveAt: new Date().toISOString(),
      contributionCount: 2, confirmationCount: 2,
    },
    charlie: {
      memberId: "charlie", displayName: "Charlie",
      expertiseAreas: ["process"],
      knownMemoryIds: ["mem-003"],
      trustScore: 0.55, lastActiveAt: new Date().toISOString(),
      contributionCount: 1, confirmationCount: 0,
    },
    diana: {
      memberId: "diana", displayName: "Diana",
      expertiseAreas: ["general", "experience"],
      knownMemoryIds: ["mem-007", "mem-008"],
      trustScore: 0.60, lastActiveAt: new Date().toISOString(),
      contributionCount: 1, confirmationCount: 0,
    },
  },
};

// Simulate departures
const departureSims: Record<string, DepartureSimulationResult | null> = {};
for (const [memberId, member] of Object.entries(tmsProfile.members)) {
  const known = entries.filter((e) => member.knownMemoryIds.includes(e.id));
  const spfs = known.filter((e) => {
    const holders = new Set<string>();
    for (const claim of e.claims) {
      holders.add(claim.injected_by);
      for (const c of claim.confirmed_by) holders.add(c);
    }
    return [...holders].length === 1 && holders.has(memberId);
  });

  departureSims[memberId] = {
    impact: {
      memberId,
      displayName: member.displayName,
      totalMemoriesKnown: known.length,
      singlePointFailures: spfs.map((e) => {
        const active = e.claims.find((c) => c.status === "active");
        const rs = riskScores.find((r) => r.memoryId === e.id);
        return {
          memoryId: e.id, entity: e.entity, attribute: e.attribute,
          value: active?.value ?? "", category: e.category, tags: e.tags,
          currentHolder: memberId, riskScore: rs?.totalRisk ?? 0, businessImpact: rs?.businessImpact ?? 0,
        };
      }),
      totalRiskIncrease: spfs.length > 0 ? 0.15 * spfs.length : 0,
      affectedCategories: [...new Set(spfs.map((e) => e.category))],
      knowledgeLossPercentage: entries.length > 0 ? Math.round((spfs.length / entries.length) * 1000) / 10 : 0,
    },
    recommendations: [],
    beforeRiskScores: riskScores,
    afterRiskScores: riskScores,
    summary: `${member.displayName} departure would lose ${spfs.length} memories`,
  };
}

// Generate report
const engine = new MemoryInsightEngine({ teamId: "openclaw-team", teamSize: 4 });
const report = await engine.generateReport(entries, riskScores, tmsProfile, departureSims);

const html = renderHtmlReport(report);

import * as fs from "fs";
import * as path from "path";
const outputPath = path.join(process.cwd(), "team-memory-report.html");
fs.writeFileSync(outputPath, html, "utf-8");

console.log(`\n=== Memory Insight Demo ===`);
console.log(`Report generated: ${outputPath}`);
console.log(`File size: ${(Buffer.byteLength(html, "utf-8") / 1024).toFixed(1)} KB`);
console.log(`\n--- Summary ---`);
console.log(`Team Health Score: ${report.summary.teamHealthScore}/100`);
console.log(`Total Memories: ${report.summary.totalMemories}`);
console.log(`Avg Strength: ${(report.lifecycle.avgStrength * 100).toFixed(0)}%`);
console.log(`Avg Risk: ${(report.lifecycle.avgRiskScore * 100).toFixed(0)}%`);
console.log(`Team Resilience: ${(report.departureOverview.teamResilienceScore * 100).toFixed(0)}%`);
console.log(`\n--- Top Risks ---`);
for (const r of report.summary.topRisks) console.log(`  • ${r}`);
console.log(`\n--- Recommendations ---`);
for (const r of report.summary.recommendations) console.log(`  • ${r}`);
console.log(`\n--- Knowledge Loss Ranking ---`);
for (const r of report.lossRanking.rankings) {
  console.log(`  ${r.displayName}: ${r.singlePointCount} single points, risk ${(r.riskScore * 100).toFixed(0)}%`);
}
