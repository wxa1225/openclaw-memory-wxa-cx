// RiskModel — five-dimensional forgetting risk with dual-threshold gating

import {
  calculateStrength,
  getStrengthLabel,
  FORGETTING_CURVE_INTERVALS,
} from "./decay.js";
import type {
  LedgerEntry,
  RiskScore,
  GraphNode,
  GraphData,
} from "./storage/types.js";
import {
  RISK_WEIGHTS,
  RISK_THRESHOLDS,
  CATEGORY_WEIGHTS,
  IMPORTANT_TAGS,
} from "./storage/types.js";

// Sigmoid coefficients for BusinessImpact
const SIGMOID_ALPHA = 0.6;
const SIGMOID_BETA = 0.4;

// Team size (configurable, default 5)
const DEFAULT_TEAM_SIZE = 5;

export interface RiskModelOptions {
  weights?: Partial<typeof RISK_WEIGHTS>;
  thresholds?: Partial<typeof RISK_THRESHOLDS>;
  teamSize?: number;
  expectedAccessCount?: number;
}

export class RiskModel {
  private weights: Record<string, number>;
  private thresholds: { riskTrigger: number; businessImpactTrigger: number };
  private teamSize: number;
  private expectedAccessCount: number;

  constructor(options: RiskModelOptions = {}) {
    this.weights = { ...RISK_WEIGHTS, ...options.weights };
    this.thresholds = { ...RISK_THRESHOLDS, ...options.thresholds };
    this.teamSize = options.teamSize ?? DEFAULT_TEAM_SIZE;
    this.expectedAccessCount = options.expectedAccessCount ?? 10;
  }

  /** Compute full five-dimensional risk score for a single ledger entry */
  async computeRisk(
    entry: LedgerEntry,
    now: Date = new Date()
  ): Promise<RiskScore> {
    const timeDecay = this._computeTimeDecay(entry, now);
    const businessImpact = this._computeBusinessImpact(entry);
    const lowCoverage = this._computeLowCoverage(entry);
    const versionRisk = this._computeVersionRisk(entry);
    const lowUsage = this._computeLowUsage(entry);

    const totalRisk =
      this.weights.timeDecay * timeDecay +
      this.weights.businessImpact * businessImpact +
      this.weights.lowCoverage * lowCoverage +
      this.weights.versionRisk * versionRisk +
      this.weights.lowUsage * lowUsage;

    const triggered =
      totalRisk > this.thresholds.riskTrigger &&
      businessImpact > this.thresholds.businessImpactTrigger;

    return {
      memoryId: entry.id,
      totalRisk: Math.round(totalRisk * 1000) / 1000,
      timeDecay: Math.round(timeDecay * 1000) / 1000,
      businessImpact: Math.round(businessImpact * 1000) / 1000,
      lowCoverage: Math.round(lowCoverage * 1000) / 1000,
      versionRisk: Math.round(versionRisk * 1000) / 1000,
      lowUsage: Math.round(lowUsage * 1000) / 1000,
      triggered,
      timestamp: now.toISOString(),
    };
  }

  /** Compute risks for all entries, return sorted by total risk descending */
  async computeAllRisks(entries: LedgerEntry[]): Promise<RiskScore[]> {
    const scores: RiskScore[] = [];
    for (const entry of entries) {
      const score = await this.computeRisk(entry);
      scores.push(score);
    }
    return scores.sort((a, b) => b.totalRisk - a.totalRisk);
  }

  /** Get only triggered (actionable) risk scores */
  async getTriggeredRisks(entries: LedgerEntry[]): Promise<RiskScore[]> {
    const all = await this.computeAllRisks(entries);
    return all.filter((s) => s.triggered);
  }

  /** Check if a risk score triggers an alert (dual-threshold gating) */
  isAlertTriggered(score: RiskScore): boolean {
    return (
      score.totalRisk > this.thresholds.riskTrigger &&
      score.businessImpact > this.thresholds.businessImpactTrigger
    );
  }

  // ---- Individual Risk Dimensions ----

  /** TimeDecay(m,t) = 1 - P_recall(m,t) */
  private _computeTimeDecay(entry: LedgerEntry, now: Date): number {
    const activeClaim = entry.claims.find(
      (c) => c.status === "active" || c.status === undefined
    );
    if (!activeClaim) return 1.0;

    const lastReviewed = new Date(activeClaim.valid_from).getTime();
    const elapsed = now.getTime() - lastReviewed;

    // Map recall_half_life (days) to the closest Ebbinghaus interval index
    const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
    const intervalIndex = this._closestIntervalIndex(halfLifeMs);
    const interval = FORGETTING_CURVE_INTERVALS[intervalIndex] ?? halfLifeMs;

    // P_recall = 2^(-elapsed / interval)
    const pRecall = Math.pow(2, -elapsed / interval);
    return 1 - Math.max(0, Math.min(1, pRecall));
  }

  /** BusinessImpact(m) = sigmoid(alpha * category_weight + beta * tag_score) */
  private _computeBusinessImpact(entry: LedgerEntry): number {
    const categoryWeight = CATEGORY_WEIGHTS[entry.category] ?? CATEGORY_WEIGHTS.general;

    let tagScore = 0;
    const tagCount = entry.tags.filter((t) =>
      (IMPORTANT_TAGS as readonly string[]).includes(t.toLowerCase())
    ).length;
    tagScore = Math.min(1.0, tagCount / 3);

    const linear = SIGMOID_ALPHA * categoryWeight + SIGMOID_BETA * tagScore;
    return this._sigmoid(linear);
  }

  /** LowCoverage(m) = 1 - confirmed_by_count / team_size */
  private _computeLowCoverage(entry: LedgerEntry): number {
    // Count unique confirmers across all active claims
    const confirmers = new Set<string>();
    for (const claim of entry.claims) {
      if (claim.status === "active" || claim.status === undefined) {
        for (const c of claim.confirmed_by) {
          confirmers.add(c);
        }
        // The injector also "knows" this memory
        confirmers.add(claim.injected_by);
      }
    }
    const coverage = Math.min(confirmers.size / this.teamSize, 1.0);
    return 1 - coverage;
  }

  /** VersionRisk(m) = based on conflicting claims and version count */
  private _computeVersionRisk(entry: LedgerEntry): number {
    const hasConflicting = entry.claims.some((c) => c.status === "conflicting");
    if (hasConflicting) return 0.8;

    const versionCount = entry.current_version;
    if (versionCount > 3) return 0.5;
    if (versionCount > 1) return 0.3;
    return 0.1;
  }

  /** LowUsage(m) = 1 - min(1, access_count / expected_count) */
  private _computeLowUsage(entry: LedgerEntry): number {
    const usage = Math.min(entry.access_count / this.expectedAccessCount, 1.0);
    return 1 - usage;
  }

  // ---- Helpers ----

  private _sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private _closestIntervalIndex(targetMs: number): number {
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

  // ---- Feishu Risk Card ----

  /** Format a risk score as a Feishu interactive card JSON string */
  formatRiskCard(score: RiskScore, entry: LedgerEntry): string {
    const riskPercent = Math.round(score.totalRisk * 100);

    // Determine risk sources
    const sources: string[] = [];
    if (score.timeDecay > 0.5) {
      const activeClaim = entry.claims.find(
        (c) => c.status === "active" || c.status === undefined
      );
      const daysSince = activeClaim
        ? Math.round(
            (Date.now() - new Date(activeClaim.valid_from).getTime()) /
              (24 * 60 * 60 * 1000)
          )
        : 0;
      sources.push(
        `- TimeDecay: ${daysSince} days since last update (score: ${Math.round(score.timeDecay * 100)})`
      );
    }
    if (score.lowCoverage > 0.5) {
      const confirmers = new Set<string>();
      for (const claim of entry.claims) {
        if (claim.status === "active" || claim.status === undefined) {
          for (const c of claim.confirmed_by) confirmers.add(c);
        }
      }
      sources.push(
        `- LowCoverage: only ${confirmers.size}/${this.teamSize} members aware (score: ${Math.round(score.lowCoverage * 100)})`
      );
    }
    if (score.versionRisk > 0.4) {
      sources.push(
        `- VersionRisk: ${entry.current_version} versions exist (score: ${Math.round(score.versionRisk * 100)})`
      );
    }
    if (score.lowUsage > 0.5) {
      sources.push(
        `- LowUsage: only accessed ${entry.access_count} times (score: ${Math.round(score.lowUsage * 100)})`
      );
    }

    // Get current value
    const activeClaim = entry.claims.find(
      (c) => c.status === "active" || c.status === undefined
    );
    const currentValue = activeClaim ? activeClaim.value : "N/A";
    const currentVersion = entry.current_version;

    const template = riskPercent >= 70 ? "red" : riskPercent >= 50 ? "orange" : "yellow";

    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: "plain_text" as const,
          content: `Risk Alert [${riskPercent}%] — ${entry.entity}.${entry.attribute}`,
        },
        template,
      },
      elements: [
        {
          tag: "markdown" as const,
          content: [
            `**Current value (v${currentVersion}):** ${currentValue}`,
            "",
            "**Risk sources:**",
            ...sources,
            "",
            "**Possible risk:** Team may be using outdated认知",
          ].join("\n"),
        },
        {
          tag: "action" as const,
          actions: [
            {
              tag: "button" as const,
              text: { tag: "plain_text" as const, content: "Still Valid" },
              type: "primary" as const,
              value: { action: "confirm", memory_id: entry.id },
            },
            {
              tag: "button" as const,
              text: { tag: "plain_text" as const, content: "Update" },
              type: "default" as const,
              value: { action: "update", memory_id: entry.id },
            },
            {
              tag: "button" as const,
              text: { tag: "plain_text" as const, content: "Dismiss" },
              type: "danger" as const,
              value: { action: "dismiss", memory_id: entry.id },
            },
          ],
        },
      ],
    };

    return JSON.stringify(card, null, 2);
  }

  /** Format multiple risk scores as a summary text for CLI/log output */
  formatRiskSummary(scores: RiskScore[]): string {
    const triggered = scores.filter((s) => s.triggered);
    if (triggered.length === 0) {
      return "No memories exceed risk thresholds.";
    }

    const lines = triggered.map((s, i) => {
      const riskBar = "█".repeat(Math.round(s.totalRisk * 5)) + "░".repeat(5 - Math.round(s.totalRisk * 5));
      return `${i + 1}. [${riskBar}] ${s.totalRisk.toFixed(2)} — ${s.memoryId}`;
    });

    return `${triggered.length} memory/ies exceed risk threshold:\n\n${lines.join("\n")}`;
  }
}
