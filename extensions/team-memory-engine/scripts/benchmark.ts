// Team Memory Engine Benchmark Script
// Tests: anti-interference, conflict update, efficiency metrics

import { TeamMemoryManager, type Mem0Provider } from "../lib/manager.js";
import { LocalStorageBackend } from "../lib/storage/local.js";

// No-op Mem0 provider for benchmark (no API key needed)
const noopMem0: Mem0Provider = {
  async add() { return {}; },
  async search() { return []; },
  async getAll() { return []; },
  async get() { return undefined; },
  async delete() { return {}; },
};

function createTestManager(teamId: string, storagePath: string): TeamMemoryManager {
  return new TeamMemoryManager(noopMem0, {
    teamId,
    defaultUserId: "benchmark",
    storagePath,
  });
}

// ---- Test 1: Anti-Interference ----
async function testAntiInterference(): Promise<{ passed: boolean; details: string }> {
  const path = `/tmp/tm-benchmark-anti-interference-${Date.now()}.json`;
  const mgr = createTestManager("bench-team", path);

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

// ---- Test 2: Conflict Update ----
async function testConflictUpdate(): Promise<{ passed: boolean; details: string }> {
  const path = `/tmp/tm-benchmark-conflict-${Date.now()}.json`;
  const mgr = createTestManager("bench-team", path);

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
  const path = `/tmp/tm-benchmark-efficiency-${Date.now()}.json`;
  const mgr = createTestManager("bench-team", path);

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

  // File size
  const fs = await import("fs");
  const stats = fs.statSync(path);
  metrics.storageSizeBytes = stats.size;
  metrics.memoriesCount = 30;

  return { metrics };
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
  console.log("=== Team Memory Engine Benchmark ===\n");

  console.log("--- Test 1: Anti-Interference ---");
  const antiInterference = await testAntiInterference();
  console.log(`PASSED: ${antiInterference.passed}`);
  console.log(`Details: ${antiInterference.details}\n`);

  console.log("--- Test 2: Conflict Update ---");
  const conflict = await testConflictUpdate();
  console.log(`PASSED: ${conflict.passed}`);
  console.log(`Details: ${conflict.details}\n`);

  console.log("--- Test 3: Efficiency Metrics ---");
  const efficiency = await testEfficiency();
  console.log(JSON.stringify(efficiency.metrics, null, 2));

  console.log("\n=== Benchmark Complete ===");
  const allPassed = antiInterference.passed && conflict.passed;
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error("Benchmark failed:", err); process.exit(1); });
