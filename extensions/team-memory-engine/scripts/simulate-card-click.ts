#!/usr/bin/env npx tsx
// Simulate clicking the "已复习" (confirm) button on a memory review card.
// This calls ledger.resolveConflict(action: "confirm") directly.

import { MemoryLedger } from "../lib/ledger.js";

const memoryId = process.argv[2];
if (!memoryId) {
  console.error("Usage: tsx scripts/simulate-card-click.ts <memoryId>");
  process.exit(1);
}

const ledger = new MemoryLedger("openclaw-team", process.env.HOME + "/.openclaw-memory-ledger.json");

async function main() {
  const entry = await ledger.getEntry(memoryId);
  if (!entry) {
    console.error(`Memory not found: ${memoryId}`);
    process.exit(1);
  }

  const conflicting = entry.claims.filter((c) => c.status === "conflicting");
  if (conflicting.length === 0) {
    console.log("No conflicting claims — memory already resolved.");
    console.log(JSON.stringify(entry.claims, null, 2));
    return;
  }

  console.log("=== 点击前 ===");
  for (const c of entry.claims) {
    console.log(`  v${c.version}: ${c.value}  status=${c.status}`);
  }
  console.log();

  // Simulate "已复习" button click: callbackKey=memory_review, action=confirm
  const conflict = {
    type: "human-confirm" as const,
    existingEntry: entry,
    newClaim: entry.claims[entry.claims.length - 1],
    confidenceDelta: 0,
    reason: "Card action resolution — user clicked '已复习'",
  };

  await ledger.resolveConflict(conflict, {
    action: "confirm",
    entryId: memoryId,
    resolvedBy: "ou_23ab1a1db6759ee9ae44a8e441a52153", // demo user
  });

  console.log("=== 点击后 ===");
  const updated = await ledger.getEntry(memoryId);
  if (updated) {
    for (const c of updated.claims) {
      console.log(`  v${c.version}: ${c.value}  status=${c.status}  confirmed_by=${JSON.stringify(c.confirmed_by)}`);
    }
    console.log();
    console.log("冲突已解决 — 所有版本标记 active，加入确认者列表");
  }
}

main().catch(console.error);
