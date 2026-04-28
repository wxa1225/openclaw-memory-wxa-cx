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

  const strength = Math.pow(2, -elapsed / currentInterval);
  return Math.max(0, Math.min(1, strength));
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

  const tagStr = memory.metadata.tags.length > 0
    ? ` | Tags: ${memory.metadata.tags.join(", ")}` : "";
  const categoryStr = memory.metadata.category !== "general"
    ? ` [${memory.metadata.category}]` : "";
  const versionStr = ` v${memory.metadata.version}`;

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: `Memory Review: ${label.toUpperCase()}` },
      template: label === "critical" ? "red"
        : label === "weak" ? "orange"
        : label === "fading" ? "yellow"
        : "blue",
    },
    elements: [
      { tag: "markdown" as const, content: `**Memory:**\n${memory.memory}` },
      {
        tag: "markdown" as const,
        content: [
          `Strength: ${bars} (${Math.round(strength * 100)}%)${categoryStr}${versionStr}${tagStr}`,
          `Injected: ${new Date(memory.metadata.injectedAt).toLocaleString()}`,
          `Last reviewed: ${new Date(memory.metadata.lastReviewedAt).toLocaleString()}`,
          `Reviews: ${memory.metadata.reviewCount}`,
          `Next interval: ${formatDuration(FORGETTING_CURVE_INTERVALS[getNextIntervalIndex(memory)])}`,
        ].join("\n"),
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "Reviewed" },
            type: "primary" as const,
            value: { action: "review", memory_id: memory.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "Dismiss" },
            type: "default" as const,
            value: { action: "dismiss", memory_id: memory.id },
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
  const referenceTime = new Date(activeClaim.valid_from).getTime();
  const elapsed = now - referenceTime;

  // Map recall_half_life (days) to closest interval index
  const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
  const intervalIndex = closestIntervalIndex(halfLifeMs);
  const currentInterval =
    FORGETTING_CURVE_INTERVALS[intervalIndex] ??
    FORGETTING_CURVE_INTERVALS[FORGETTING_CURVE_INTERVALS.length - 1];

  const strength = Math.pow(2, -elapsed / currentInterval);
  return Math.max(0, Math.min(1, strength));
}

/** Get the active claim from a LedgerEntry */
export function getActiveClaim(entry: LedgerEntry): LedgerClaim | undefined {
  return entry.claims.find(
    (c) => c.status === "active" || c.status === undefined
  );
}

/** Map a half-life (ms) to the closest Ebbinghaus interval index */
function closestIntervalIndex(targetMs: number): number {
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
