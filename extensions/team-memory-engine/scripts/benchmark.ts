// Team Memory Engine v2 Benchmark Script
// Tests: anti-interference, conflict resolution, efficiency, risk model, conflict detection

import { TeamMemoryManager, type Mem0Provider } from "../lib/manager.js";
import { MemoryLedger } from "../lib/ledger.js";
import { RiskModel } from "../lib/risk.js";
import { RISK_WEIGHTS } from "../lib/storage/types.js";

// No-op Mem0 provider for benchmark
const noopMem0: Mem0Provider = {
  async add() { return {}; },
  async search() { return []; },
  async getAll() { return []; },
  async get() { return undefined; },
  async delete() { return {}; },
};

function createTestManager(teamId: string, tmpDir: string): TeamMemoryManager {
  return new TeamMemoryManager(noopMem0, {
    teamId,
    defaultUserId: "benchmark",
    ledgerPath: `${tmpDir}/ledger-${Date.now()}.json`,
    graphPath: `${tmpDir}/graph-${Date.now()}.json`,
    teamSize: 5,
    enableGraph: false, // disable graph for speed in benchmarks
  });
}

// ---- Test 1: Anti-Interference ----
async function testAntiInterference(): Promise<{ passed: boolean; details: string }> {
  const mgr = createTestManager("bench-team", "/tmp");

  const keyResult = await mgr.inject(
    "CRITICAL: The API endpoint for staging is https://staging-api.example.com/v2",
    { category: "api", tags: ["critical", "endpoint", "staging"] }
  );

  const topics = ["meeting notes", "code review", "deployment", "design discussion", "bug report"];
  for (let i = 0; i < 50; i++) {
    const topic = topics[i % topics.length];
    await mgr.inject(
      `${topic} #${i}: Some discussion about ${topic} that is completely unrelated to API endpoints`,
      { category: topic, tags: [topic, `item-${i}`] }
    );
  }

  const results = await mgr.search("API endpoint staging");
  const found = results.find((r) => r.id === keyResult.id);

  if (!found) {
    return { passed: false, details: `Key memory not found after 50 interference injections. Total memories: 51` };
  }

  return {
    passed: true,
    details: `Key memory found at position ${results.indexOf(found) + 1}/${results.length} with strength ${Math.round(found.strength * 100)}%`,
  };
}

// ---- Test 2: Conflict Resolution ----
async function testConflictResolution(): Promise<{ passed: boolean; details: string }> {
  const mgr = createTestManager("bench-team", "/tmp");

  const r1 = await mgr.inject(
    "Send the monthly report to Alice (alice@example.com)",
    { category: "decision", tags: ["report", "recipient"] }
  );

  const r2 = await mgr.update(
    "Send report",
    "Send the monthly report to Bob (bob@example.com) instead of Alice",
    { author: "manager" }
  );

  const results = await mgr.search("report recipient");
  const current = results.find((r) => r.id === r1.id);

  if (!current) return { passed: false, details: "Updated memory not found in search" };

  const hasBob = current.memory.includes("Bob");
  const correctVersion = r2.previousVersion === 1 && current.metadata.version === 2;
  const hasHistory = current.metadata.versionHistory.length === 2;

  if (!hasBob) {
    return { passed: false, details: `Memory content wrong. Text: "${current.memory}"` };
  }
  if (!correctVersion || !hasHistory) {
    return { passed: false, details: `Version tracking failed. Version: ${current.metadata.version}, History: ${current.metadata.versionHistory.length}` };
  }

  return { passed: true, details: `Conflict resolved correctly. v1→v2, history preserved, content updated to "Bob"` };
}

// ---- Test 3: Efficiency Metrics ----
async function testEfficiency(): Promise<{ metrics: Record<string, unknown> }> {
  const mgr = createTestManager("bench-team", "/tmp");

  const metrics: Record<string, unknown> = {};

  // Inject 20 memories
  for (let i = 0; i < 20; i++) {
    await mgr.inject(`Test memory ${i} with some content for performance measurement`, {
      category: "perf", tags: [`test-${i}`],
    });
  }

  // Benchmark inject
  const injectTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    await mgr.inject(`Perf test memory ${i}`, { category: "perf", tags: [`bench-${i}`] });
    injectTimes.push(Date.now() - start);
  }
  metrics.injectMs = computeStats(injectTimes);

  // Benchmark search
  const searchTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    await mgr.search(`test memory ${i}`);
    searchTimes.push(Date.now() - start);
  }
  metrics.searchMs = computeStats(searchTimes);

  // Benchmark status
  const statusStart = Date.now();
  await mgr.status();
  metrics.statusAllMs = Date.now() - statusStart;

  // Benchmark update
  const updateTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await mgr.update(`Test memory ${i}`, `Updated test memory ${i} with new content`);
    updateTimes.push(Date.now() - start);
  }
  metrics.updateMs = computeStats(updateTimes);

  // Benchmark risk
  const riskStart = Date.now();
  await mgr.assessRisk();
  metrics.riskMs = Date.now() - riskStart;

  metrics.memoriesCount = 30;

  return { metrics };
}

// ---- Test 4: Risk Model Correctness ----
async function testRiskModel(): Promise<{ passed: boolean; details: string }> {
  const ledger = new MemoryLedger("risk-bench", `/tmp/risk-benchmark-${Date.now()}.json`);

  // Inject a high-risk memory (security category, low coverage, long decay)
  await ledger.injectClaim({
    entity: "生产数据库",
    attribute: "连接密码",
    value: "旧密码将于下周轮换",
    confidence: 0.9,
    source: "security_audit",
    injectedBy: "安全团队",
    category: "security",
    tags: ["prod", "critical"],
    teamId: "risk-bench",
    recallHalfLife: 1, // short half-life = fast decay
  });

  // Inject a low-risk memory
  await ledger.injectClaim({
    entity: "团队",
    attribute: "午餐偏好",
    value: "大家喜欢川菜",
    confidence: 0.5,
    source: "casual_chat",
    injectedBy: "张三",
    category: "general",
    tags: [],
    teamId: "risk-bench",
    recallHalfLife: 31, // long half-life = slow decay
  });

  const entries = await ledger.getAllEntries("risk-bench");

  const riskModel = new RiskModel({ teamSize: 5 });
  const scores = await riskModel.computeAllRisks(entries);

  const securityEntry = entries.find((e) => e.category === "security");
  const generalEntry = entries.find((e) => e.category === "general");

  const securityScore = scores.find((s) => s.memoryId === securityEntry?.id);
  const generalScore = scores.find((s) => s.memoryId === generalEntry?.id);

  if (!securityScore || !generalScore) {
    return { passed: false, details: "Risk scores not computed for all entries" };
  }

  // Security memory should have higher business impact
  if (securityScore.businessImpact <= generalScore.businessImpact) {
    return {
      passed: false,
      details: `Security business impact (${securityScore.businessImpact.toFixed(3)}) should be > general (${generalScore.businessImpact.toFixed(3)})`,
    };
  }

  // Both should be computable
  return {
    passed: true,
    details: `Risk model correct: security impact=${securityScore.businessImpact.toFixed(3)} > general impact=${generalScore.businessImpact.toFixed(3)}. Total risk: security=${securityScore.totalRisk.toFixed(3)}, general=${generalScore.totalRisk.toFixed(3)}`,
  };
}

// ---- Test 5: Ledger Conflict Detection ----
async function testLedgerConflictDetection(): Promise<{ passed: boolean; details: string }> {
  const ledger = new MemoryLedger("conflict-bench", `/tmp/conflict-benchmark-${Date.now()}.json`);

  // Inject v1
  const entry1 = await ledger.injectClaim({
    entity: "客户A",
    attribute: "交付格式",
    value: "Markdown",
    confidence: 0.5,
    source: "meeting",
    injectedBy: "张三",
    category: "decision",
    tags: ["delivery"],
    teamId: "conflict-bench",
  });

  // Inject conflicting v2 with low confidence (should create conflict-mark)
  const entry2 = await ledger.injectClaim({
    entity: "客户A",
    attribute: "交付格式",
    value: "PDF",
    confidence: 0.55, // delta < 0.15 with 0.5 → conflict-mark
    source: "meeting2",
    injectedBy: "李四",
    category: "decision",
    tags: ["delivery"],
    teamId: "conflict-bench",
  });

  // Verify version chain
  const activeClaims = entry2.claims.filter((c) => c.status === "conflicting" || c.status === "active");
  if (activeClaims.length < 2) {
    return {
      passed: false,
      details: `Expected 2 conflicting claims, got ${activeClaims.length}. Claims: ${JSON.stringify(entry2.claims.map(c => ({ v: c.version, s: c.status })))}`,
    };
  }

  return {
    passed: true,
    details: `Conflict detected correctly. Entry has ${entry2.claims.length} claims (${entry2.claims.map(c => `v${c.version}:${c.status}`).join(", ")})`,
  };
}

function computeStats(arr: number[]): Record<string, number> {
  if (arr.length === 0) return { avg: 0, p50: 0, p95: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

// ---- Run all ----
async function main() {
  console.log("=== Team Memory Engine v2 Benchmark ===\n");

  const results: Array<{ name: string; passed: boolean; details: string }> = [];

  console.log("--- Test 1: Anti-Interference ---");
  const antiInterference = await testAntiInterference();
  results.push({ name: "Anti-Interference", ...antiInterference });
  console.log(`PASSED: ${antiInterference.passed}`);
  console.log(`Details: ${antiInterference.details}\n`);

  console.log("--- Test 2: Conflict Resolution ---");
  const conflict = await testConflictResolution();
  results.push({ name: "Conflict Resolution", ...conflict });
  console.log(`PASSED: ${conflict.passed}`);
  console.log(`Details: ${conflict.details}\n`);

  console.log("--- Test 3: Efficiency Metrics ---");
  const efficiency = await testEfficiency();
  console.log(JSON.stringify(efficiency.metrics, null, 2));
  results.push({ name: "Efficiency", passed: true, details: "Completed" });

  console.log("\n--- Test 4: Risk Model ---");
  const risk = await testRiskModel();
  results.push({ name: "Risk Model", ...risk });
  console.log(`PASSED: ${risk.passed}`);
  console.log(`Details: ${risk.details}\n`);

  console.log("--- Test 5: Ledger Conflict Detection ---");
  const conflictDetection = await testLedgerConflictDetection();
  results.push({ name: "Conflict Detection", ...conflictDetection });
  console.log(`PASSED: ${conflictDetection.passed}`);
  console.log(`Details: ${conflictDetection.details}\n`);

  console.log("\n=== Benchmark Complete ===");
  const allPassed = results.every((r) => r.passed);
  const passed = results.filter((r) => r.passed).length;
  console.log(`${passed}/${results.length} tests passed`);
  if (!allPassed) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.details}`);
    }
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error("Benchmark failed:", err); process.exit(1); });
