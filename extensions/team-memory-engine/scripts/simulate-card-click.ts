#!/usr/bin/env npx tsx
// Simulate clicking a memory review card button.
// Usage: tsx scripts/simulate-card-click.ts <memoryId> [confirm|update|dismiss]

import { MemoryLedger } from "../lib/ledger.js";

const memoryId = process.argv[2];
if (!memoryId) {
  console.error("Usage: tsx scripts/simulate-card-click.ts <memoryId> [confirm|update|dismiss]");
  process.exit(1);
}

const action = (process.argv[3] || "confirm") as "confirm" | "update" | "dismiss";
if (!["confirm", "update", "dismiss"].includes(action)) {
  console.error("Invalid action. Use: confirm, update, or dismiss.");
  process.exit(1);
}

const ledger = new MemoryLedger("openclaw-team", process.env.HOME + "/.openclaw-memory-ledger.json");

const actionLabels: Record<string, string> = {
  confirm: "确认有效",
  update: "更新记忆",
  dismiss: "标记过期",
};

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

  const conflict = {
    type: "human-confirm" as const,
    existingEntry: entry,
    newClaim: entry.claims[entry.claims.length - 1],
    confidenceDelta: 0,
    reason: `Card action resolution — user clicked '${actionLabels[action]}'`,
  };

  await ledger.resolveConflict(conflict, {
    action,
    entryId: memoryId,
    resolvedBy: "ou_23ab1a1db6759ee9ae44a8e441a52153",
  });

  console.log("=== 点击后 ===");
  const updated = await ledger.getEntry(memoryId);
  if (updated) {
    for (const c of updated.claims) {
      console.log(`  v${c.version}: ${c.value}  status=${c.status}  confirmed_by=${JSON.stringify(c.confirmed_by)}`);
    }
    console.log();
    console.log(`冲突已解决 — 用户点击「${actionLabels[action]}」`);
  }
}

main().catch(console.error);
