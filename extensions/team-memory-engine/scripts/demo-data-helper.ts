#!/usr/bin/env npx tsx
/**
 * Demo data helper — replaces Python scripts in demo-final.sh.
 * Run: npx tsx scripts/demo-data-helper.ts <command>
 *
 * Commands:
 *   write-events          Write 5 demo events to event log
 *   list-events           List events with formatted output
 *   show-ledger           Show ledger entries
 *   show-conflict         Show conflict detection result
 *   show-version-chain    Show version chain for a memory
 *   simulate-decay        Simulate time passage for decay demo
 *   simulate-review       Simulate memory review (reset valid_from)
 *   simulate-conflict     Simulate conflict injection
 *   simulate-resolve      Simulate conflict resolution (update/supersede)
 *   simulate-risk         Simulate 5-dimension risk calculation
 *   show-graph            Show graph statistics
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LEDGER_PATH = path.join(os.homedir(), ".openclaw-memory-ledger.json");
const EVENT_LOG_DIR = process.env.PROJECT_ROOT
  ? path.join(process.env.PROJECT_ROOT, "memory/event-log")
  : path.join(process.cwd(), "memory/event-log");

// ============================================================
// write-events
// ============================================================

function writeEvents() {
  const events = [
    {
      id: "evt-001",
      storedAt: "2026-05-06T10:00:00Z",
      chatId: "oc_demo",
      chatType: "group",
      senderId: "u1",
      senderName: "张三",
      content: "客户A那边确认了，以后交付都用PDF格式，不要再发Markdown了",
      contentType: "text",
      messageId: "m1",
      processedForExtraction: false,
    },
    {
      id: "evt-002",
      storedAt: "2026-05-06T10:01:00Z",
      chatId: "oc_demo",
      chatType: "group",
      senderId: "u2",
      senderName: "李四",
      content: "好的，记一下。另外生产环境的API端点已经改为v3了，旧端点本周五失效",
      contentType: "text",
      messageId: "m2",
      processedForExtraction: false,
    },
    {
      id: "evt-003",
      storedAt: "2026-05-06T10:02:00Z",
      chatId: "oc_demo",
      chatType: "group",
      senderId: "u3",
      senderName: "王五",
      content: "收到，周报以后统一发给李四，不要再抄送我了",
      contentType: "text",
      messageId: "m3",
      processedForExtraction: false,
    },
    {
      id: "evt-004",
      storedAt: "2026-05-06T10:03:00Z",
      chatId: "oc_demo",
      chatType: "group",
      senderId: "u1",
      senderName: "张三",
      content: "今天中午吃什么？我提议吃楼下的黄焖鸡",
      contentType: "text",
      messageId: "m4",
      processedForExtraction: false,
    },
    {
      id: "evt-005",
      storedAt: "2026-05-06T10:04:00Z",
      chatId: "oc_demo",
      chatType: "group",
      senderId: "u2",
      senderName: "李四",
      content: "哈哈哈好的，那我也点一份",
      contentType: "text",
      messageId: "m5",
      processedForExtraction: false,
    },
  ];

  fs.mkdirSync(EVENT_LOG_DIR, { recursive: true });
  const filePath = path.join(EVENT_LOG_DIR, "2026-05-06.json");
  fs.writeFileSync(filePath, JSON.stringify(events, null, 2), "utf-8");
  console.log("Done: 5 events written to", filePath);
}

// ============================================================
// list-events
// ============================================================

function listEvents() {
  const filePath = path.join(EVENT_LOG_DIR, "2026-05-06.json");
  const events: Array<{ senderName: string; content: string }> = JSON.parse(
    fs.readFileSync(filePath, "utf-8")
  );
  for (const e of events) {
    let tag = "  普通";
    if (e.content.includes("PDF") || e.content.includes("交付格式")) tag = "📌 决策";
    else if (e.content.includes("API")) tag = "📌 配置";
    else if (e.content.includes("周报")) tag = "📌 流程";
    console.log(`  ${tag}  [${e.senderName}] ${e.content}`);
  }
}

// ============================================================
// show-ledger
// ============================================================

function showLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.log("  (ledger empty)");
    return;
  }
  const data: Record<string, any> = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
  let count = 0;
  for (const mid of Object.keys(data)) {
    const entry = data[mid];
    const claims = entry.claims || [];
    if (claims.length > 0) {
      const latest = claims[claims.length - 1];
      const cat = entry.category || "general";
      const val = (latest.value || "").slice(0, 60);
      console.log(`  [${cat}] ${val}`);
      console.log(`        id=${mid}  confidence=${latest.confidence?.toFixed(2)}`);
      count++;
    }
  }
  console.log(`\n共 ${count} 条记忆`);
}

// ============================================================
// show-conflict
// ============================================================

function showConflict() {
  if (!fs.existsSync(LEDGER_PATH)) return;
  const data: Record<string, any> = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
  for (const [mid, entry] of Object.entries(data)) {
    const claims = (entry as any).claims || [];
    if (claims.length >= 2 && claims.some((c: any) => c.status === "conflicting")) {
      console.log(`  🔍 检测到矛盾更新：${mid}`);
      for (const c of claims) {
        const icon = c.status === "conflicting" ? "⚠️" : "✅";
        console.log(`    ${icon} v${c.version}: ${(c.value || "").slice(0, 50)}`);
        console.log(`        status=${c.status}  confidence=${c.confidence?.toFixed(2)}`);
      }
      console.log(`\n  ⚡ 冲突已标记，两个版本均未丢失，等待人工裁决`);
      return;
    }
  }
  console.log("  (no conflicts found)");
}

// ============================================================
// show-version-chain
// ============================================================

function showVersionChain() {
  if (!fs.existsSync(LEDGER_PATH)) return;
  const data: Record<string, any> = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
  for (const [mid, entry] of Object.entries(data)) {
    const claims = (entry as any).claims || [];
    if (claims.length >= 2) {
      console.log(`  📋 ${mid}: ${claims.length} 个版本\n`);
      for (const c of claims) {
        const val = (c.value || "").slice(0, 50);
        let icon = "✅";
        let desc = "活跃";
        if (c.status === "conflicting") { icon = "⚠️"; desc = "冲突 — 等待裁决"; }
        else if (c.status === "superseded") { icon = "❌"; desc = "已废弃"; }
        console.log(`    ${icon} v${c.version}: ${val}`);
        console.log(`        status=${c.status}  confidence=${c.confidence?.toFixed(2)}  ${desc}`);
      }
      console.log();
      console.log("  ✅ v1 未被覆盖，标记为 conflicting，历史完整保留");
      console.log("  ⚠️  v2 同样 conflicting，等待人工裁决");
      console.log("  → 人工可通过飞书卡片点击按钮裁决，或 CLI 命令 resolve");
      return;
    }
  }
  console.log("  (no multi-version entries)");
}

// ============================================================
// simulate-decay
// ============================================================

function simulateDecay() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.log("  (ledger empty, skip decay demo)");
    return;
  }
  const data: Record<string, any> = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));

  // Find decision/api memory
  let targetId: string | null = null;
  let targetEntry: any = null;
  for (const [mid, entry] of Object.entries(data)) {
    const cat = (entry as any).category || "";
    if (cat === "api" || cat === "decision") {
      targetId = mid;
      targetEntry = entry;
      break;
    }
  }

  if (!targetId || !targetEntry) {
    console.log("  (no decision/api memory, skip decay demo)");
    return;
  }

  const claims = targetEntry.claims || [];
  const latest = claims[claims.length - 1] || {};
  const cat = targetEntry.category || "";
  const val = (latest.value || "").slice(0, 50);
  const halfLife = 14; // decision/api
  const daysAgo = 10;
  const strength = Math.pow(2, -daysAgo / halfLife) * 100;

  // Backdate valid_from
  const oldTime = new Date(Date.now() - daysAgo * 86400000);
  claims[claims.length - 1].valid_from = oldTime.toISOString();
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), "utf-8");

  console.log("  [模拟时间流逝] 将 decision 类记忆的创建时间回拨 10 天...");
  console.log(`  记忆类别: ${cat}`);
  console.log(`  创建时间: 10 天前（模拟）`);
  console.log(`  半衰期: ${halfLife}天（decision/api 类）`);
  console.log(`  记忆强度: ${strength.toFixed(0)}% = 2^(-10/${halfLife})`);
  console.log(`  紧急程度: WARNING`);
  console.log();
  console.log("  → 系统检测到记忆强度降至遗忘临界点，推送复习提醒");
  console.log();

  const bars = (pct: number) => {
    const filled = Math.round(pct / 20);
    return "●".repeat(filled) + "○".repeat(5 - filled);
  };

  console.log(`  [复习前]  [${cat}] ${val}`);
  console.log(`    强度: ${bars(strength)} (${strength.toFixed(0)}%) | 距今: 10天`);
  console.log();

  // Review: reset valid_from, boost confidence
  console.log("  [执行复习] → 重置衰减时钟，置信度 +15%");
  const now = new Date().toISOString();
  claims[claims.length - 1].valid_from = now;
  claims[claims.length - 1].confidence = Math.min(1.0, (claims[claims.length - 1].confidence || 0.8) + 0.15);
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), "utf-8");

  console.log();
  console.log(`  [复习后]  [${cat}] ${val}`);
  console.log(`    强度: ${bars(100)} (100%) | 距今: 0天`);
  console.log(`    → 记忆强度回到 100%，下次提醒时间已推迟`);
}

// ============================================================
// simulate-conflict-inject
// ============================================================

function simulateConflictInject() {
  // This just prints the message; actual inject is done by CLI
  console.log("  [冲突解决] 同时演示 Step 8 检测到的 PDF vs Markdown 冲突裁决");
  console.log();
}

// ============================================================
// simulate-resolve
// ============================================================

function simulateResolve() {
  if (!fs.existsSync(LEDGER_PATH)) return;
  const data: Record<string, any> = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));

  let conflictId: string | null = null;
  for (const [mid, entry] of Object.entries(data)) {
    const claims = (entry as any).claims || [];
    if (claims.length >= 2 && claims.some((c: any) => c.status === "conflicting")) {
      conflictId = mid;
      break;
    }
  }

  if (!conflictId) {
    console.log("  (no conflicts to resolve)");
    return;
  }

  const claims = (data[conflictId] as any).claims || [];
  const maxVersion = Math.max(...claims.map((c: any) => c.version));

  console.log("  [冲突前]");
  for (const c of claims) {
    if (c.status === "conflicting") {
      console.log(`    v${c.version}: ${(c.value || "").slice(0, 40)}  status=${c.status}`);
    }
  }
  console.log();

  console.log("  [执行裁决] → 选择 'update'（保留新版本 Markdown）");

  const now = new Date().toISOString();
  for (const c of claims) {
    if (c.status === "conflicting") {
      if (c.version < maxVersion) {
        c.status = "superseded";
        c.valid_to = now;
      } else {
        c.status = "active";
      }
    }
  }
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), "utf-8");

  console.log();
  console.log("  [裁决后]");
  for (const c of claims) {
    let icon = "⚠️";
    if (c.status === "active") icon = "✅";
    else if (c.status === "superseded") icon = "❌";
    console.log(`    ${icon} v${c.version}: ${(c.value || "").slice(0, 40)}  status=${c.status}`);
  }
  console.log();
  console.log("  → v1 (PDF) 被标记为 superseded，但历史完整保留");
  console.log("  → v2 (Markdown) 成为活跃版本");
  console.log("  → 如需回溯，可随时恢复 v1");
}

// ============================================================
// simulate-risk
// ============================================================

function simulateRisk() {
  if (!fs.existsSync(LEDGER_PATH)) return;
  const data: Record<string, any> = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));

  // Find decision memory and backdate 20 days
  for (const [mid, entry] of Object.entries(data)) {
    const cat = (entry as any).category || "";
    if (cat === "decision") {
      const claims = (entry as any).claims || [];
      if (claims.length > 0) {
        claims[claims.length - 1].status = "active";
        const oldTime = new Date(Date.now() - 20 * 86400000).toISOString();
        claims[claims.length - 1].valid_from = oldTime;
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), "utf-8");
        console.log(`  [模拟] 将 ${mid}（decision 类）回拨 20 天，模拟长期未复习`);
        console.log(`  → 记忆强度: 2^(-20/14) = ${(Math.pow(2, -20 / 14) * 100).toFixed(0)}%`);
      }
      break;
    }
  }

  const halfLife = 14;
  const elapsed = 20;
  const strength = Math.pow(2, -elapsed / halfLife);
  const timeDecay = 1 - strength;

  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const categoryWeight = 0.8; // decision
  const businessImpact = sigmoid(0.6 * categoryWeight);

  const scores = {
    timeDecay: parseFloat(timeDecay.toFixed(3)),
    businessImpact: parseFloat(businessImpact.toFixed(3)),
    lowCoverage: parseFloat((1.0 - 1 / 5).toFixed(3)),
    versionRisk: 0.3,
    lowUsage: parseFloat((1.0 - 0 / 10).toFixed(3)),
  };

  const weights = { timeDecay: 0.30, businessImpact: 0.25, lowCoverage: 0.15, versionRisk: 0.15, lowUsage: 0.15 };
  const total = Object.keys(scores).reduce((sum, k) => sum + weights[k as keyof typeof weights] * scores[k as keyof typeof scores], 0);

  const riskBar = (val: number) => {
    const filled = Math.round(val * 5);
    return "█".repeat(filled) + "░".repeat(5 - filled);
  };

  console.log();
  console.log(`  ⚠️  触发风险预警！`);
  console.log();
  console.log(`  五维评分:`);
  for (const [dim, val] of Object.entries(scores)) {
    const bar = riskBar(val);
    const flag = val > 0.5 ? " ← 高风险" : "";
    console.log(`    [${dim.padEnd(15)}] ${bar} ${val.toFixed(3)}${flag}`);
  }
  console.log();
  console.log(`  综合风险: ${riskBar(total)} ${total.toFixed(3)}`);
  console.log(`  触发条件: 综合风险 ${total.toFixed(3)} > 阈值 0.55 ✓  且 业务影响 ${scores.businessImpact.toFixed(3)} > 阈值 0.55 ✓`);
  console.log();
  console.log(`  → 系统建议：推送复习提醒到飞书群聊`);
  console.log(`  → 用户点击'已复习'后，风险将重置为 0`);
}

// ============================================================
// Main
// ============================================================

const command = process.argv[2];

switch (command) {
  case "write-events":
    writeEvents();
    break;
  case "list-events":
    listEvents();
    break;
  case "show-ledger":
    showLedger();
    break;
  case "show-conflict":
    showConflict();
    break;
  case "show-version-chain":
    showVersionChain();
    break;
  case "simulate-decay":
    simulateDecay();
    break;
  case "simulate-conflict":
    simulateConflictInject();
    break;
  case "simulate-resolve":
    simulateResolve();
    break;
  case "simulate-risk":
    simulateRisk();
    break;
  default:
    console.log("Usage: npx tsx scripts/demo-data-helper.ts <command>");
    console.log("Commands: write-events, list-events, show-ledger, show-conflict,");
    console.log("  show-version-chain, simulate-decay, simulate-conflict,");
    console.log("  simulate-resolve, simulate-risk");
    process.exit(1);
}
