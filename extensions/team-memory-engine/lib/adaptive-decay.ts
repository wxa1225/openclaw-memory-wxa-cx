// Adaptive Decay Learner — learns personalized half-lives from review history
//
// Each memory tracks its review outcomes. When a memory is reviewed and still valid,
// the half-life is increased (it's a stable fact). When a memory is reviewed and
// found to need updating, the half-life is decreased (it's volatile).
//
// Uses exponential moving average: new_half_life = alpha * observed_stability + (1 - alpha) * old_half_life

import type { LedgerEntry } from "./storage/types.js";

export interface ReviewOutcome {
  date: string;           // When the review happened
  stillValid: boolean;    // true = memory was still correct, false = needed update
  strengthAtReview: number; // Memory strength at review time (0-1)
}

export interface AdaptiveDecayConfig {
  /** Learning rate for EMA (0.0-1.0). Higher = faster adaptation. */
  learningRate: number;
  /** Minimum half-life in days (prevents absurdly short intervals) */
  minHalfLife: number;
  /** Maximum half-life in days (prevents "never forget" scenario) */
  maxHalfLife: number;
  /** Category-aware default half-lives */
  categoryDefaults: Record<string, number>;
}

const DEFAULT_CONFIG: AdaptiveDecayConfig = {
  learningRate: 0.3,
  minHalfLife: 2,
  maxHalfLife: 90,
  categoryDefaults: {
    decision: 21,   // Decisions tend to be stable
    api: 14,        // API configs can change
    process: 14,    // Processes evolve
    security: 7,    // Security info is volatile (keys, tokens, etc.)
    experience: 30, // Experiences/lessons are long-lasting
    general: 7,     // General info decays quickly
  },
};

/**
 * Get the category-aware default half-life for a memory.
 */
export function getCategoryDefaultHalfLife(category: string, config?: AdaptiveDecayConfig): number {
  const c = config ?? DEFAULT_CONFIG;
  return c.categoryDefaults[category] ?? c.categoryDefaults.general ?? 7;
}

/**
 * Compute an observed stability window from the review history.
 * If a memory was reviewed as "still valid" at strength S after T days,
 * the observed stability window is T / (-log2(S)).
 * This inverts S = 2^(-T/h) to get h = T / (-log2(S)).
 */
function estimateHalfLifeFromReview(
  elapsedDays: number,
  strength: number
): number {
  if (strength <= 0 || strength >= 1) return elapsedDays;
  // S = 2^(-T/h) => h = T / (-log2(S))
  const log2S = Math.log2(strength);
  if (log2S === 0) return elapsedDays;
  return elapsedDays / (-log2S);
}

/**
 * Clamp a half-life to the valid range.
 */
function clampHalfLife(value: number, config: AdaptiveDecayConfig): number {
  return Math.max(config.minHalfLife, Math.min(config.maxHalfLife, value));
}

/**
 * Adjust a memory's half-life based on review history.
 * Uses exponential moving average of observed stability windows.
 *
 * @param entry - The ledger entry to adjust (mutated in place)
 * @param config - Optional configuration overrides
 * @returns The new half-life value
 */
export function adjustHalfLifeFromReviews(
  entry: LedgerEntry,
  config?: AdaptiveDecayConfig
): number {
  const c = config ?? DEFAULT_CONFIG;

  // Get review history from metadata (stored on the entry)
  const reviews: ReviewOutcome[] = (entry as any).reviewHistory ?? [];
  if (reviews.length === 0) {
    // No reviews yet, use category default
    const defaultHL = getCategoryDefaultHalfLife(entry.category, c);
    if (!entry.recall_half_life || entry.recall_half_life === 14) {
      entry.recall_half_life = defaultHL;
    }
    return entry.recall_half_life;
  }

  // Compute observed half-life from the most recent review
  const latestReview = reviews[reviews.length - 1];
  if (!latestReview) return entry.recall_half_life;

  const elapsedMs = Date.now() - new Date(latestReview.date).getTime();
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  if (latestReview.stillValid) {
    // Memory was still valid — increase half-life (more stable than expected)
    const observedHL = estimateHalfLifeFromReview(elapsedDays, latestReview.strengthAtReview);
    const ema = c.learningRate * observedHL + (1 - c.learningRate) * entry.recall_half_life;
    entry.recall_half_life = clampHalfLife(ema, c);
  } else {
    // Memory needed update — decrease half-life (more volatile than expected)
    const reduction = c.learningRate * entry.recall_half_life * 0.5;
    entry.recall_half_life = clampHalfLife(entry.recall_half_life - reduction, c);
  }

  return entry.recall_half_life;
}

/**
 * Record a review outcome for a memory.
 * Call this when a user reviews a memory and confirms it's still valid or needs updating.
 *
 * @param entry - The ledger entry (mutated in place)
 * @param stillValid - Whether the memory is still correct after review
 * @param strength - Memory strength at review time
 */
export function recordReviewOutcome(
  entry: LedgerEntry,
  stillValid: boolean,
  strength: number
): void {
  if (!(entry as any).reviewHistory) {
    (entry as any).reviewHistory = [];
  }
  const reviews: ReviewOutcome[] = (entry as any).reviewHistory;
  reviews.push({
    date: new Date().toISOString(),
    stillValid,
    strengthAtReview: strength,
  });
  // Keep only last 20 reviews to avoid unbounded growth
  if (reviews.length > 20) {
    (entry as any).reviewHistory = reviews.slice(-20);
  }
}

/**
 * Get a summary of a memory's review history for display.
 */
export function getReviewHistorySummary(entry: LedgerEntry): string {
  const reviews: ReviewOutcome[] = (entry as any).reviewHistory ?? [];
  if (reviews.length === 0) {
    return "无复习记录（使用默认半衰期)";
  }
  const validCount = reviews.filter(r => r.stillValid).length;
  const rate = ((validCount / reviews.length) * 100).toFixed(0);
  const firstReview = new Date(reviews[0].date).toLocaleDateString("zh-CN");
  const lastReview = new Date(reviews[reviews.length - 1].date).toLocaleDateString("zh-CN");
  return `复习 ${reviews.length} 次（${firstReview} ~ ${lastReview}），${rate}% 确认有效，当前半衰期 ${entry.recall_half_life} 天`;
}

/**
 * Apply category-aware default half-lives to all entries that are still using the generic default (14).
 */
export function applyCategoryDefaults(entries: LedgerEntry[], config?: AdaptiveDecayConfig): number {
  const c = config ?? DEFAULT_CONFIG;
  let updated = 0;
  for (const entry of entries) {
    if (entry.recall_half_life === 14 || !entry.recall_half_life) {
      const defaultHL = getCategoryDefaultHalfLife(entry.category, c);
      entry.recall_half_life = defaultHL;
      updated++;
    }
  }
  return updated;
}
