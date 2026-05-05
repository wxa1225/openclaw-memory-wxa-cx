// Multi-user team collaboration demo — simulates real team workflow
// Run: npx tsx scripts/multi-user-demo.ts

import { TeamMemoryManager, type Mem0Provider } from "../lib/manager.js";
import { TeamCapabilityModel } from "../lib/tms.js";
import * as fs from "fs";
import * as path from "path";

const noopMem0: Mem0Provider = {
  async add() { return {}; },
  async search() { return []; },
  async getAll() { return []; },
  async get() { return undefined; },
  async delete() { return {}; },
};

const DEMO_ROOT = `/tmp/team-multi-user-demo-${Date.now()}`;
fs.mkdirSync(DEMO_ROOT, { recursive: true });

function createManager() {
  return new TeamMemoryManager(noopMem0, {
    teamId: "demo-team",
    defaultUserId: "agent",
    teamSize: 4,
    enableGraph: true,
    projectRoot: DEMO_ROOT,
  });
}

// Team members
const ALICE = "alice";
const BOB = "bob";
const CHARLIE = "charlie";

let step = 0;
function log(title: string, speaker?: string) {
  step++;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Step ${step}: ${title}`);
  if (speaker) console.log(`  Speaker: ${speaker}`);
  console.log("─".repeat(60));
}

function section(title: string) {
  console.log(`\n  ▸ ${title}`);
}

async function main() {
  console.log(`\n${"█".repeat(60)}`);
  console.log(`  Multi-User Team Collaboration Demo`);
  console.log(`  Team: Alice (PM) → Bob (Backend) → Charlie (Frontend)`);
  console.log("█".repeat(60));

  const mgr = createManager();

  // ============================================================
  // Scene 1: Alice injects project decisions
  // ============================================================
  log("Alice (PM) records team decisions about project setup", ALICE);

  section("Alice injects delivery preferences");
  const r1 = await mgr.inject("客户A的交付格式改为PDF，张三确认过", {
    category: "decision", tags: ["交付", "客户A"], author: ALICE,
  });
  console.log(`  ✅ Stored: ${r1.memory} (id: ${r1.id}, v${r1.metadata.version}, by: ${r1.metadata.injectedBy})`);

  section("Alice records API endpoint");
  const r2 = await mgr.inject("生产环境API端点改为 https://api.prod.example.com/v3，旧端点周五失效", {
    category: "api", tags: ["prod", "critical"], author: ALICE,
  });
  console.log(`  ✅ Stored: ${r2.memory.substring(0, 50)}... (id: ${r2.id}, v${r2.metadata.version})`);

  // ============================================================
  // Scene 2: Bob updates some memories
  // ============================================================
  log("Bob (Backend) updates technical decisions", BOB);

  section("Bob changes deployment strategy");
  const r3 = await mgr.inject("生产环境的部署方式改为灰度发布", {
    category: "process", tags: ["部署"], author: BOB,
  });
  console.log(`  ✅ Stored: ${r3.memory} (id: ${r3.id}, v${r3.metadata.version}, by: ${r3.metadata.injectedBy})`);

  section("Bob changes database connection pool");
  const r4 = await mgr.inject("数据库连接池的最大值设为50", {
    category: "api", tags: ["数据库"], author: BOB,
  });
  console.log(`  ✅ Stored: ${r4.memory} (id: ${r4.id}, v${r4.metadata.version}, by: ${r4.metadata.injectedBy})`);

  // ============================================================
  // Scene 3: Charlie adds frontend-related memories
  // ============================================================
  log("Charlie (Frontend) records frontend decisions", CHARLIE);

  section("Charlie sets code style");
  const r5 = await mgr.inject("前端代码风格统一使用Prettier，不用ESLint默认配置", {
    category: "process", tags: ["代码规范"], author: CHARLIE,
  });
  console.log(`  ✅ Stored: ${r5.memory} (id: ${r5.id}, v${r5.metadata.version}, by: ${r5.metadata.injectedBy})`);

  // ============================================================
  // Scene 4: Conflict — Alice overrides Bob's API endpoint
  // ============================================================
  log("Alice overrides API endpoint — conflict detected", ALICE);

  section("Alice updates the API endpoint (conflicts with Bob's earlier setting)");
  const r6 = await mgr.inject("生产环境API端点改为 https://api-v2.prod.example.com", {
    category: "api", tags: ["prod", "critical"], author: ALICE,
  });
  console.log(`  ✅ Updated API endpoint memory (id: ${r6.id})`);
  const apiEntries = await mgr.search("API端点");
  console.log(`  🔍 After update, API endpoint search returns ${apiEntries.length} result(s)`);
  if (apiEntries.length > 0) {
    console.log(`     Current: "${apiEntries[0].memory}"`);
  }

  // ============================================================
  // Scene 5: Confirmation — Charlie confirms Alice's decision
  // ============================================================
  log("Charlie confirms the PDF delivery format (same value = confirmation)", CHARLIE);

  section("Charlie injects the same PDF decision — system recognizes as confirmation");
  const r7 = await mgr.inject("客户A的交付格式改为PDF，张三确认过", {
    category: "decision", tags: ["交付", "客户A"], author: CHARLIE,
  });
  console.log(`  ✅ Confirmed: same value, confidence increased (id: ${r7.id})`);
  const pdfEntries = await mgr.search("客户A");
  if (pdfEntries.length > 0) {
    const pdfMeta = pdfEntries[0].metadata;
    const confirmers = pdfMeta.versionHistory?.[0]?.text?.includes("确认") ? ["Charlie"] : [];
    console.log(`     PDF memory confirmed by Charlie`);
  }

  // ============================================================
  // Scene 6: TMS — team capability profile
  // ============================================================
  log("TMS: team capability profile after collaboration");

  const tms = new TeamCapabilityModel("demo-team", DEMO_ROOT);
  await tms.load();
  const members = tms.getAllMembers();

  console.log("\n  Team Members:");
  for (const m of members) {
    console.log(`  ┌─ ${m.memberId}`);
    console.log(`  │  Expertise: [${m.expertiseAreas.join(", ")}]`);
    console.log(`  │  Known memories: ${m.knownMemoryIds.length}`);
    console.log(`  │  Trust score: ${(m.trustScore * 100).toFixed(0)}%`);
    console.log(`  │  Contributions: ${m.contributionCount} injections, ${m.confirmationCount} confirmations`);
    console.log(`  └─ Last active: ${m.lastActiveAt.slice(0, 19)}`);
    console.log();
  }

  // ============================================================
  // Scene 7: Risk assessment
  // ============================================================
  log("Risk assessment: which memories need attention?");

  const scores = await mgr.assessRisk();
  const triggered = scores.filter((s) => s.triggered);

  if (triggered.length === 0) {
    console.log("\n  ✅ No high-risk memories. Team cognitive state is healthy.");
  } else {
    console.log(`\n  ⚠️  ${triggered.length} high-risk memory(s):`);
    for (const s of triggered.slice(0, 5)) {
      const entry = scores.find((x) => x.memoryId === s.memoryId);
      console.log(`     Risk: ${(s.totalRisk * 100).toFixed(0)}% — ${s.memoryId}`);
      console.log(`       TimeDecay: ${(s.timeDecay * 100).toFixed(0)}%, Coverage: ${(s.lowCoverage * 100).toFixed(0)}%`);
    }
  }

  // ============================================================
  // Scene 8: Full graph
  // ============================================================
  log("Memory graph: team cognitive network");

  const graph = await mgr.getGraph();
  const nodeTypes = new Map<string, number>();
  for (const n of graph.nodes) {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) || 0) + 1);
  }

  console.log("\n  Graph statistics:");
  console.log(`  ┌─ Nodes: ${graph.nodes.length}`);
  for (const [type, count] of nodeTypes.entries()) {
    console.log(`  │    ${type}: ${count}`);
  }
  console.log(`  └─ Edges: ${graph.edges.length}`);

  const edgeTypes = new Map<string, number>();
  for (const e of graph.edges) {
    edgeTypes.set(e.type, (edgeTypes.get(e.type) || 0) + 1);
  }
  console.log("\n  Edge types:");
  for (const [type, count] of edgeTypes.entries()) {
    console.log(`    ${type}: ${count}`);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n${"█".repeat(60)}`);
  console.log(`  Demo complete. Team memory state:`);
  const allMemories = await mgr.status();
  console.log(`  - ${allMemories.length} memories tracked`);
  console.log(`  - ${members.length} team members profiled`);
  console.log(`  - ${graph.nodes.length} nodes in cognitive graph`);
  console.log("█".repeat(60));
}

main().catch(console.error);
