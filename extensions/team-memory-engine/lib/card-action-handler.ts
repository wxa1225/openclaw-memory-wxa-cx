// Card Action Handler — process memory review card button clicks from Feishu

import { MemoryLedger } from "./ledger.js";
import type { LedgerEntry, ConflictResult } from "./storage/types.js";

export interface MemoryCardActionValue {
  action: "confirm" | "update" | "dismiss";
  memory_id: string;
}

interface CardActionData {
  action?: {
    value?: MemoryCardActionValue;
  };
  operator?: {
    open_id: string;
    user_id?: string;
  };
  open_chat_id?: string;
  context?: {
    open_chat_id?: string;
  };
}

interface HandlerConfig {
  teamId: string;
  ledgerPath?: string;
}

interface CardActionResult {
  toast: { type: "success" | "warning" | "error"; content: string };
  card?: unknown;
}

const ACTION_LABELS: Record<string, string> = {
  confirm: "已确认有效",
  update: "已更新记忆",
  dismiss: "已忽略",
};

/**
 * Called from openclaw-lark's handleCardActionEvent when a memory review
 * card button is clicked. Returns undefined if not a memory action.
 */
export async function handleMemoryReviewAction(
  data: CardActionData,
  config: HandlerConfig
): Promise<CardActionResult | undefined> {
  const value = data.action?.value;
  if (!value || !value.action || !value.memory_id) return undefined;
  if (!["confirm", "update", "dismiss"].includes(value.action)) return undefined;

  const ledger = new MemoryLedger(config.teamId, config.ledgerPath);
  const entry = await ledger.getEntry(value.memory_id);
  if (!entry) {
    return { toast: { type: "error", content: "记忆不存在或已被删除" } };
  }

  const resolverId = data.operator?.open_id ?? "unknown";
  const conflictingClaims = entry.claims.filter((c) => c.status === "conflicting");

  if (conflictingClaims.length === 0) {
    // No conflict — use resolveConflict with "confirm" to persist changes
    const conflict: ConflictResult = {
      type: "human-confirm",
      existingEntry: entry,
      newClaim: entry.claims[entry.claims.length - 1],
      confidenceDelta: 0,
      reason: "Card confirm action",
    };
    await ledger.resolveConflict(conflict, {
      action: "confirm",
      entryId: value.memory_id,
      resolvedBy: resolverId,
    });
    return { toast: { type: "success", content: `已确认: ${ACTION_LABELS[value.action]}` } };
  }

  // Build a ConflictResult for resolution
  const conflict: ConflictResult = {
    type: "human-confirm",
    existingEntry: entry,
    newClaim: entry.claims[entry.claims.length - 1],
    confidenceDelta: 0,
    reason: "Card action resolution",
  };

  const resolved = await ledger.resolveConflict(conflict, {
    action: value.action,
    entryId: value.memory_id,
    resolvedBy: resolverId,
  });

  return {
    toast: {
      type: "success",
      content: `${ACTION_LABELS[value.action]} — 记忆已更新`,
    },
  };
}
