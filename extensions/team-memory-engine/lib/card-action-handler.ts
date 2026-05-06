// Card Action Handler — process memory review card button clicks from Feishu

import { MemoryLedger } from "./ledger.js";
import type { LedgerEntry, ConflictResult } from "./storage/types.js";

export interface MemoryCardActionValue {
  action: "confirm" | "update" | "dismiss" | "review" | "dismiss_warning";
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
  open_message_id?: string;
  context?: {
    open_chat_id?: string;
    open_message_id?: string;
  };
}

interface HandlerConfig {
  teamId: string;
  ledgerPath?: string;
  openMessageId?: string;
  accountId?: string;
  cfg?: unknown;
}

interface CardActionResult {
  toast: { type: "success" | "warning" | "error"; content: string };
  card?: {
    type: "raw";
    data: unknown;
  };
}

const ACTION_LABELS: Record<string, string> = {
  confirm: "已确认有效",
  update: "已更新记忆",
  dismiss: "已忽略",
};

const ACTION_ICONS: Record<string, string> = {
  confirm: "✓ 确认有效",
  update: "✓ 更新记忆",
  dismiss: "✓ 标记过期",
};

/** Build an updated card showing which action was selected, keeping all buttons clickable */
function buildUpdatedCard(
  entry: LedgerEntry,
  selectedAction: string
): { type: "raw"; data: unknown } {
  const claimsCount = entry.claims.length;

  // Build version list with status indicators
  const versionLines = entry.claims.map((c) => {
    const statusTag = c.status === "active" ? "✅ 活跃" : c.status === "superseded" ? "❌ 已废弃" : `⚠️ ${c.status}`;
    return `**v${c.version}** [${statusTag}] ${c.value} — 置信度 ${(c.confidence * 100).toFixed(0)}%`;
  });
  const claimsMd = versionLines.join("\n\n");

  const buttonLabels: Record<string, string> = {
    confirm: selectedAction === "confirm" ? ACTION_ICONS.confirm : "确认有效",
    update: selectedAction === "update" ? ACTION_ICONS.update : "更新记忆",
    dismiss: selectedAction === "dismiss" ? ACTION_ICONS.dismiss : "标记过期",
  };

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🧠 记忆冲突 — 已处理" },
      template: selectedAction === "dismiss" ? "orange" as const : "green" as const,
    },
    elements: [
      { tag: "div" as const, text: { tag: "plain_text" as const, content: `当前操作：${ACTION_LABELS[selectedAction]}（共 ${claimsCount} 个版本）` } },
      {
        tag: "markdown" as const,
        content: `**记忆内容：**\n\n${claimsMd}\n\n💡 如选错，可点击其他按钮切换`,
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: buttonLabels.confirm },
            type: selectedAction === "confirm" ? ("primary" as const) : ("default" as const),
            value: { action: "confirm", memory_id: entry.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: buttonLabels.update },
            type: selectedAction === "update" ? ("danger" as const) : ("default" as const),
            value: { action: "update", memory_id: entry.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: buttonLabels.dismiss },
            type: "default" as const,
            value: { action: "dismiss", memory_id: entry.id },
          },
        ],
      },
    ],
  };

  return { type: "raw", data: card };
}

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
  if (!["confirm", "update", "dismiss", "review", "dismiss_warning"].includes(value.action)) return undefined;

  // Extract open_message_id from data for card update
  const openMessageId = data.open_message_id ?? data.context?.open_message_id ?? config.openMessageId;
  const enrichedConfig = { ...config, openMessageId };

  const ledger = new MemoryLedger(enrichedConfig.teamId, enrichedConfig.ledgerPath);
  const entry = await ledger.getEntry(value.memory_id);
  if (!entry) {
    return { toast: { type: "error", content: "记忆不存在或已被删除" } };
  }

  const resolverId = data.operator?.open_id ?? "unknown";

  // "review" — boost confidence and recency (Ebbinghaus reset)
  if (value.action === "review") {
    const conflict: ConflictResult = {
      type: "human-confirm",
      existingEntry: entry,
      newClaim: entry.claims[entry.claims.length - 1],
      confidenceDelta: 0.15,
      reason: "User reviewed memory via Feishu card",
    };
    await ledger.resolveConflict(conflict, {
      action: "confirm",
      entryId: value.memory_id,
      resolvedBy: resolverId,
    });

    const updated = await ledger.getEntry(value.memory_id);
    const val = updated?.claims[updated.claims.length - 1]?.value ?? '';
    const cat = updated?.category ?? '';
    return {
      toast: { type: "success", content: "✅ 已复习 — 记忆强度重置为 100%" },
      card: {
        type: "raw",
        data: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: "🧠 记忆已复习" },
            template: "green" as const,
          },
          elements: [
            { tag: "div" as const, text: { tag: "plain_text" as const, content: "✅ 已复习 — 记忆强度已重置" } },
            {
              tag: "markdown" as const,
              content: `**内容：** ${val}\n**类别：** ${cat}\n\n强度已重置为 100%，下次提醒时间已推迟`,
            },
          ],
        },
      },
    };
  }

  // "dismiss_warning" — acknowledge without boosting
  if (value.action === "dismiss_warning") {
    return {
      toast: { type: "warning", content: "已忽略，下次巡检再提醒" },
      card: {
        type: "raw",
        data: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: "🧠 已忽略" },
            template: "grey" as const,
          },
          elements: [
            { tag: "div" as const, text: { tag: "plain_text" as const, content: "已忽略，下次巡检再提醒" } },
          ],
        },
      },
    };
  }

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
    return {
      toast: { type: "success", content: ACTION_LABELS[value.action] },
      card: buildUpdatedCard(entry, value.action),
    };
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

  // Get updated entry to show in card
  const updated = await ledger.getEntry(value.memory_id);

  return {
    toast: {
      type: "success",
      content: `${ACTION_LABELS[value.action]} — 记忆已更新`,
    },
    card: updated ? buildUpdatedCard(updated, value.action) : undefined,
  };
}
