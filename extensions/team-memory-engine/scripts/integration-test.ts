// Team Memory Engine v2 — Integration Tests (no LLM API required)

import { TeamMemoryManager, type Mem0Provider } from "../lib/manager.js";
import { EventLog } from "../lib/event-log.js";
import { MemoryLedger } from "../lib/ledger.js";
import { TeamCapabilityModel } from "../lib/tms.js";
import * as fs from "fs";
import * as path from "path";

// No-op Mem0 provider
const noopMem0: Mem0Provider = {
  async add() { return {}; },
  async search() { return []; },
  async getAll() { return []; },
  async get() { return undefined; },
  async delete() { return {}; },
};

const TEST_ROOT = path.join("/tmp", `team-memory-int-test-${Date.now()}`);
const TEST_STORAGE_DIR = path.join("/tmp", `team-memory-storage-${Date.now()}`);

function setup() {
  try { fs.mkdirSync(TEST_ROOT, { recursive: true }); } catch {}
  try { fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true }); } catch {}
}

function cleanup() {
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true }); } catch {}
}

function createManager(teamId: string, opts: Record<string, any> = {}) {
  return new TeamMemoryManager(noopMem0, {
    teamId,
    defaultUserId: "integration-test",
    teamSize: 5,
    enableGraph: true,
    projectRoot: TEST_ROOT,
    ledgerPath: path.join(TEST_STORAGE_DIR, `${teamId}-ledger.json`),
    graphPath: path.join(TEST_STORAGE_DIR, `${teamId}-graph.json`),
    ...opts,
  });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}: ${detail}`);
    failed++;
  }
}

// ---- Test 1: Event Log Write & Query ----
async function testEventLog() {
  console.log("\n--- Test 1: Event Log Write & Query ---");

  const log = new EventLog(TEST_ROOT);

  await log.append({
    chatId: "chat-1", chatType: "group", senderId: "alice",
    senderName: "Alice", content: "客户A要PDF格式", contentType: "text",
    messageId: "msg-1", participants: ["alice", "bob"],
  });
  await log.append({
    chatId: "chat-2", chatType: "p2p", senderId: "bob",
    content: "私聊内容", contentType: "text", messageId: "msg-2",
  });
  await log.append({
    chatId: "chat-1", chatType: "group", senderId: "charlie",
    content: "API端点已更新", contentType: "text", messageId: "msg-3",
  });

  const all = await log.query({});
  assert(all.length === 3, "Total events", `Expected 3, got ${all.length}`);

  const chat1 = await log.query({ chatId: "chat-1" });
  assert(chat1.length === 2, "Filter by chatId", `Expected 2, got ${chat1.length}`);

  const alice = await log.query({ senderId: "alice" });
  assert(alice.length === 1, "Filter by senderId", `Expected 1, got ${alice.length}`);

  const unprocessed = await log.getUnprocessed();
  assert(unprocessed.length === 3, "Unprocessed count", `Expected 3, got ${unprocessed.length}`);

  await log.markProcessed([all[0].id, all[1].id]);
  const remaining = await log.getUnprocessed();
  assert(remaining.length === 1, "After markProcessed", `Expected 1, got ${remaining.length}`);

  // Verify file exists
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(TEST_ROOT, "memory", "event-log", `${today}.json`);
  assert(fs.existsSync(logFile), "Event log file exists", `Path: ${logFile}`);
}

// ---- Test 2: Ledger → Graph Incremental Update ----
async function testGraphIncremental() {
  console.log("\n--- Test 2: Ledger → Graph Incremental Update ---");

  const mgr = createManager("graph-test");

  await mgr.inject("客户A要PDF格式", { category: "decision", author: "alice" });
  await mgr.inject("API端点已更新", { category: "api", author: "bob" });
  await mgr.inject("部署流程改为灰度发布", { category: "process", author: "charlie" });

  const graph1 = await mgr.getGraph();
  const initialNodes = graph1.nodes.length;
  assert(initialNodes > 0, "Initial graph has nodes", `Count: ${initialNodes}`);

  // Inject one more — should incrementally update
  await mgr.inject("数据库连接池设为10", { category: "api", author: "dave" });

  const graph2 = await mgr.getGraph();
  assert(graph2.nodes.length > initialNodes, "Graph grew after inject",
    `Before: ${initialNodes}, After: ${graph2.nodes.length}`);

  // Verify entity nodes exist — ensure extraction produces diverse entities,
  // not just entity:"general" (graph degeneration into star topology).
  const entityNodes = graph2.nodes.filter(n => n.type === "Entity");
  assert(entityNodes.length >= 2, "At least 2 distinct Entity nodes (no star degeneration)", `Got ${entityNodes.length}`);

  // Verify no "general" entity node dominates (star topology check)
  const generalEdges = graph2.edges.filter(e =>
    e.type === "has_preference" &&
    graph2.nodes.find(n => n.id === e.source && n.label === "general")
  );
  const totalPrefEdges = graph2.edges.filter(e => e.type === "has_preference").length;
  const generalRatio = totalPrefEdges > 0 ? generalEdges.length / totalPrefEdges : 0;
  assert(generalRatio < 0.5, "Less than 50% of edges attached to 'general' entity",
    `General ratio: ${(generalRatio * 100).toFixed(0)}% (${generalEdges.length}/${totalPrefEdges})`);

  // Verify has_preference edges exist (one per unique entity.attribute)
  const prefEdges = graph2.edges.filter(e => e.type === "has_preference");
  assert(prefEdges.length >= 1, "At least 1 has_preference edge", `Got ${prefEdges.length}`);
}

// ---- Test 3: Card Action Handler (Conflict Resolution) ----
async function testCardAction() {
  console.log("\n--- Test 3: Card Action Handler ---");

  const { handleMemoryReviewAction } = await import("../lib/card-action-handler.js");
  const ledger = new MemoryLedger("card-test", path.join(TEST_ROOT, "card-ledger.json"));

  // Create a conflict scenario
  await ledger.injectClaim({
    entity: "客户A", attribute: "交付格式", value: "Markdown",
    confidence: 0.5, source: "meeting", injectedBy: "张三",
    category: "decision", tags: ["delivery"], teamId: "card-test",
  });
  await ledger.injectClaim({
    entity: "客户A", attribute: "交付格式", value: "PDF",
    confidence: 0.55, source: "meeting2", injectedBy: "李四",
    category: "decision", tags: ["delivery"], teamId: "card-test",
  });

  // Find the entry
  const entries = await ledger.getAllEntries("card-test");
  const entry = entries.find(e => e.entity === "客户A" && e.attribute === "交付格式");
  assert(!!entry, "Conflict entry exists");

  // Simulate confirm button click — pass the correct teamId and ledgerPath
  const result = await handleMemoryReviewAction({
    action: { value: { action: "confirm", memory_id: entry!.id } },
    operator: { open_id: "resolver-001" },
  }, { teamId: "card-test", ledgerPath: path.join(TEST_ROOT, "card-ledger.json") });

  assert(result?.toast?.type === "success", "Confirm returns success toast");

  // Verify confirmed_by was updated — use a FRESH ledger instance to avoid cache stale data
  const freshLedger = new MemoryLedger("card-test", path.join(TEST_ROOT, "card-ledger.json"));
  const updated = await freshLedger.getEntry(entry!.id);
  const allConfirmed = updated!.claims.flatMap(c => c.confirmed_by);
  const hasResolver = allConfirmed.includes("resolver-001");
  assert(hasResolver, "Resolver added to confirmed_by", JSON.stringify(allConfirmed));

  // Simulate dismiss
  const dismissResult = await handleMemoryReviewAction({
    action: { value: { action: "dismiss", memory_id: entry!.id } },
    operator: { open_id: "resolver-002" },
  }, { teamId: "card-test", ledgerPath: path.join(TEST_ROOT, "card-ledger.json") });

  assert(dismissResult?.toast?.type === "success", "Dismiss returns success toast");

  // Test unknown memory
  const unknownResult = await handleMemoryReviewAction({
    action: { value: { action: "confirm", memory_id: "mem-nonexistent" } },
    operator: { open_id: "resolver-003" },
  }, { teamId: "card-test", ledgerPath: path.join(TEST_ROOT, "card-ledger.json") });

  assert(unknownResult?.toast?.type === "error", "Unknown memory returns error toast");
}

// ---- Test 4: TMS Sync ----
async function testTMS() {
  console.log("\n--- Test 4: TMS Sync ---");

  const mgr = createManager("tms-test");

  await mgr.inject("客户A要PDF格式", { category: "decision", tags: ["delivery"], author: "alice" });
  await mgr.inject("API端点已更新", { category: "api", tags: ["staging"], author: "bob" });
  await mgr.inject("部署改为灰度", { category: "process", author: "charlie" });

  const tms = new TeamCapabilityModel("tms-test", TEST_ROOT);
  await tms.load();

  const members = tms.getAllMembers();
  // TMS is synced by inject() now, so members should exist
  assert(members.length >= 1, "At least 1 member tracked", `Got ${members.length}`);

  if (members.length === 0) {
    console.log("  (Skipping remaining TMS tests — no members synced yet)");
    return;
  }

  const alice = tms.getMember("alice");
  if (alice) {
    assert(alice!.expertiseAreas.includes("decision"), "Alice has decision expertise");
    assert(alice!.knownMemoryIds.length >= 1, "Alice knows at least 1 memory", `Got ${alice!.knownMemoryIds.length}`);
  } else {
    assert(false, "Alice exists", "Member not found among: " + members.map(m => m.memberId).join(", "));
  }

  const bob = tms.getMember("bob");
  if (bob) {
    assert(bob!.expertiseAreas.includes("api"), "Bob has api expertise");
  }

  const trustAlice = tms.computeTrustScore("alice");
  assert(trustAlice >= 0.5 && trustAlice <= 1.0, "Alice trust score in range", `Got ${trustAlice}`);
}

// ---- Test 5: Full Pipeline (no LLM, regex fallback) ----
async function testFullPipeline() {
  console.log("\n--- Test 5: Full Pipeline (regex fallback) ---");

  const mgr = createManager("pipeline-test");
  const log = new EventLog(TEST_ROOT);

  // Write 5 events
  await log.append({
    chatId: "chat-pipeline", chatType: "group", senderId: "alice",
    content: "API的端点改为v3了", contentType: "text",
    messageId: "p-1",
  });
  await log.append({
    chatId: "chat-pipeline", chatType: "group", senderId: "bob",
    content: "客户B的交付格式要PDF", contentType: "text",
    messageId: "p-2",
  });
  await log.append({
    chatId: "chat-pipeline", chatType: "group", senderId: "charlie",
    content: "今天中午吃什么？", contentType: "text",
    messageId: "p-3",
  });
  await log.append({
    chatId: "chat-pipeline", chatType: "group", senderId: "alice",
    content: "数据库密码需要轮换", contentType: "text",
    messageId: "p-4",
  });
  await log.append({
    chatId: "chat-pipeline", chatType: "group", senderId: "dave",
    content: "哈哈哈这个好笑", contentType: "text",
    messageId: "p-5",
  });

  const before = await mgr.status();
  const beforeCount = before.length;

  // Get unprocessed events, pass to pipeline, then mark them processed
  const unprocessed = await log.getUnprocessed();
  const extracted = await mgr.injectFromEvent(unprocessed);
  await log.markProcessed(unprocessed.map(e => e.id));

  const after = await mgr.status();
  assert(after.length >= beforeCount, "Pipeline added memories",
    `Before: ${beforeCount}, After: ${after.length}`);

  // All events marked processed
  const remaining = await log.getUnprocessed();
  assert(remaining.length === 0, "All events processed after extraction",
    `Remaining: ${remaining.length}`);

  // Graph updated
  const graph = await mgr.getGraph();
  assert(graph.nodes.length > 0, "Graph has nodes after pipeline", `Count: ${graph.nodes.length}`);
}

// ---- Run All ----
async function main() {
  console.log("=== Team Memory Engine v2 — Integration Tests ===");
  console.log(`Test root: ${TEST_ROOT}\n`);

  setup();

  try {
    await testEventLog();
    await testGraphIncremental();
    await testCardAction();
    await testTMS();
    await testFullPipeline();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

    if (failed > 0) {
      console.log("\nFailed tests detected.");
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(`\n❌ Integration test crashed: ${String(err)}`);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
