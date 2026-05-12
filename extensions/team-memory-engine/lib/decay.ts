// Ebbinghaus forgetting curve model and review card formatting

import type { StoredMemory, TeamMemoryMeta, LedgerEntry, LedgerClaim } from "./storage/types.js";

// Ebbinghaus spaced repetition intervals (milliseconds)
export const FORGETTING_CURVE_INTERVALS: number[] = [
  1 * 60 * 1000,             // 1 minute
  10 * 60 * 1000,            // 10 minutes
  60 * 60 * 1000,            // 1 hour
  9 * 60 * 60 * 1000,        // 9 hours
  24 * 60 * 60 * 1000,       // 1 day
  2 * 24 * 60 * 60 * 1000,   // 2 days
  6 * 24 * 60 * 60 * 1000,   // 6 days
  15 * 24 * 60 * 60 * 1000,  // 15 days
  31 * 24 * 60 * 60 * 1000,  // 31 days
];

export type StrengthLabel = "fresh" | "strong" | "fading" | "weak" | "critical";

/**
 * Core decay formula: S = 2^(-elapsed / currentInterval)
 * This is the single source of truth for the Ebbinghaus forgetting curve computation.
 * Both StoredMemory and LedgerEntry strength calculations delegate to this function.
 */
export function computeDecayStrength(elapsed: number, currentInterval: number): number {
  if (currentInterval <= 0) return 1.0;
  const strength = Math.pow(2, -elapsed / currentInterval);
  return Math.max(0, Math.min(1, strength));
}

/**
 * Exponential decay: S = 2^(-elapsed / current_interval)
 * At the interval boundary, strength = 0.5
 */
export function calculateStrength(memory: StoredMemory): number {
  const now = Date.now();
  const referenceTime = memory.metadata.lastReviewedAt
    ? new Date(memory.metadata.lastReviewedAt).getTime()
    : new Date(memory.metadata.injectedAt).getTime();

  const elapsed = now - referenceTime;
  const intervalIndex = memory.metadata.currentIntervalIndex;
  const currentInterval =
    FORGETTING_CURVE_INTERVALS[intervalIndex] ??
    FORGETTING_CURVE_INTERVALS[FORGETTING_CURVE_INTERVALS.length - 1];

  return computeDecayStrength(elapsed, currentInterval);
}

export function getStrengthLabel(strength: number): StrengthLabel {
  if (strength >= 0.8) return "fresh";
  if (strength >= 0.5) return "strong";
  if (strength >= 0.3) return "fading";
  if (strength >= 0.1) return "weak";
  return "critical";
}

export function isDueForReview(memory: StoredMemory, threshold = 0.4): boolean {
  return calculateStrength(memory) < threshold;
}

export function getNextIntervalIndex(memory: StoredMemory): number {
  return Math.min(
    memory.metadata.currentIntervalIndex + 1,
    FORGETTING_CURVE_INTERVALS.length - 1
  );
}

function formatDuration(ms: number): string {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  return `${Math.round(ms / (24 * 60 * 60 * 1000))}d`;
}

/** Format a review reminder as a Feishu interactive card JSON string */
export function formatReviewCard(memory: StoredMemory): string {
  const strength = calculateStrength(memory);
  const label = getStrengthLabel(strength);
  const bars = "●".repeat(Math.round(strength * 5)) +
    "○".repeat(5 - Math.round(strength * 5));

  const categoryLabels: Record<string, string> = {
    decision: "📋 决策",
    process: "⚙️ 流程",
    api: "🔌 API/配置",
    security: "🔒 安全",
    experience: "💡 经验",
    general: "📝 通用",
  };
  const categoryStr = memory.metadata.category !== "general"
    ? categoryLabels[memory.metadata.category] ?? "" : "📝 通用";
  const versionStr = ` v${memory.metadata.version}`;

  const labelMap: Record<string, { text: string; template: "red" | "orange" | "yellow" | "blue" }> = {
    critical: { text: "严重遗忘", template: "red" },
    weak: { text: "即将遗忘", template: "orange" },
    fading: { text: "记忆衰减", template: "yellow" },
    strong: { text: "需要复习", template: "blue" },
    fresh: { text: "复习提醒", template: "blue" },
  };
  const labelInfo = labelMap[label] ?? labelMap.fresh;

  const tagStr = memory.metadata.tags.length > 0
    ? ` | 标签: ${memory.metadata.tags.join(", ")}` : "";

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: `🧠 记忆复习提醒 — ${labelInfo.text}` },
      template: labelInfo.template,
    },
    elements: [
      {
        tag: "markdown" as const,
        content: [
          `**记忆内容：** ${memory.memory}`,
          `**类别：** ${categoryStr}${versionStr}`,
          `**强度：** ${bars} (${Math.round(strength * 100)}%)${tagStr}`,
          `**创建时间：** ${new Date(memory.metadata.injectedAt).toLocaleDateString()}`,
          `**上次复习：** ${memory.metadata.lastReviewedAt ? new Date(memory.metadata.lastReviewedAt).toLocaleDateString() : "从未复习"}`,
          `**复习次数：** ${memory.metadata.reviewCount}`,
        ].join("\n"),
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "✓ 已复习" },
            type: "primary" as const,
            value: { action: "review", memory_id: memory.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "暂时忽略" },
            type: "default" as const,
            value: { action: "dismiss_warning", memory_id: memory.id },
          },
        ],
      },
    ],
  };

  return JSON.stringify(card, null, 2);
}

// Re-export for index.ts compatibility
export type { TeamMemoryMeta } from "./storage/types.js";

// ============================================================================
// LedgerEntry-compatible decay functions (v2)
// ============================================================================

/**
 * Calculate strength for a LedgerEntry.
 * Uses the active claim's valid_from as reference time,
 * and recall_half_life (days) mapped to Ebbinghaus interval.
 */
export function calculateStrengthFromLedger(entry: LedgerEntry): number {
  const activeClaim = entry.claims.find(
    (c) => c.status === "active" || c.status === undefined
  );
  if (!activeClaim) return 0;

  const now = Date.now();
  const elapsed = now - new Date(activeClaim.valid_from).getTime();

  // Map recall_half_life (days) to closest Ebbinghaus interval
  const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
  const intervalIndex = closestIntervalIndex(halfLifeMs);
  const currentInterval =
    FORGETTING_CURVE_INTERVALS[intervalIndex] ??
    FORGETTING_CURVE_INTERVALS[FORGETTING_CURVE_INTERVALS.length - 1];

  return computeDecayStrength(elapsed, currentInterval);
}

/** Get the active claim from a LedgerEntry */
export function getActiveClaim(entry: LedgerEntry): LedgerClaim | undefined {
  return entry.claims.find(
    (c) => c.status === "active" || c.status === undefined
  );
}

/** Map a half-life (ms) to the closest Ebbinghaus interval index */
export function closestIntervalIndex(targetMs: number): number {
  let bestIndex = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < FORGETTING_CURVE_INTERVALS.length; i++) {
    const diff = Math.abs(FORGETTING_CURVE_INTERVALS[i] - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// ============================================================================
// Feishu Card Formatting for LedgerEntry (v2)
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  decision: "📋 决策",
  process: "⚙️ 流程",
  api: "🔌 API/配置",
  security: "🔒 安全",
  experience: "💡 经验",
  general: "📝 通用",
};

/** Format a decay reminder as a Feishu interactive card JSON string for LedgerEntry */
export function formatDecayCard(entry: LedgerEntry): string {
  const strength = calculateStrengthFromLedger(entry);
  const label = getStrengthLabel(strength);
  const bars = "●".repeat(Math.round(strength * 5)) +
    "○".repeat(5 - Math.round(strength * 5));

  const categoryLabel = CATEGORY_LABELS[entry.category] ?? "📝 通用";
  const activeClaim = getActiveClaim(entry);
  const value = activeClaim?.value ?? entry.id;
  const version = entry.current_version;

  const labelMap: Record<string, { text: string; template: "red" | "orange" | "yellow" | "blue" }> = {
    critical: { text: "严重遗忘", template: "red" },
    weak: { text: "即将遗忘", template: "orange" },
    fading: { text: "记忆衰减", template: "yellow" },
    strong: { text: "需要复习", template: "blue" },
    fresh: { text: "复习提醒", template: "blue" },
  };
  const labelInfo = labelMap[label] ?? labelMap.fresh;

  const tagsStr = entry.tags && entry.tags.length > 0
    ? ` | 标签: ${entry.tags.join(", ")}` : "";
  const daysSince = activeClaim?.valid_from
    ? Math.round((Date.now() - new Date(activeClaim.valid_from).getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: `🧠 记忆复习提醒 — ${labelInfo.text}` },
      template: labelInfo.template,
    },
    elements: [
      {
        tag: "markdown" as const,
        content: [
          `**记忆内容：** ${value}`,
          `**类别：** ${categoryLabel} v${version}`,
          `**强度：** ${bars} (${Math.round(strength * 100)}%)${tagsStr}`,
          `**距今：** ${daysSince} 天`,
          `**半衰期：** ${entry.recall_half_life ?? 14} 天`,
        ].join("\n"),
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "✓ 已复习" },
            type: "primary" as const,
            value: { action: "review", memory_id: entry.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "暂时忽略" },
            type: "default" as const,
            value: { action: "dismiss_warning", memory_id: entry.id },
          },
        ],
      },
    ],
  };

  return JSON.stringify(card, null, 2);
}
