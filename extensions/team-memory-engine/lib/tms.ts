// Team Capability Model — Transactive Memory System (who knows what + trust)
//
// Expertise is inferred from contribution patterns:
// 1. Category-level expertise (decision, api, process, etc.)
// 2. Tag-based expertise (domain knowledge areas)
// 3. Entity ownership (who created/confirmed memories about specific entities)
// 4. Interaction quality (how often their contributions are validated by others)
// 5. Verification accuracy (confirmed vs rejected ratio)
// 6. Recency-weighted activity (recent contributions count more)

import * as fs from "fs";
import * as path from "path";
import type { LedgerEntry, MemberCapability, TeamCapabilityProfile } from "./storage/types.js";

// Tags that should not be treated as expertise areas
const NOISE_TAGS = new Set([
  "general", "todo", "wip", "test", "draft", "temp", "note",
]);

const EXPERTISE_CATEGORIES = new Set([
  "decision", "api", "process", "experience", "security",
]);

/** Category importance weights — higher = more valuable expertise */
const CATEGORY_IMPORTANCE: Record<string, number> = {
  security: 1.0,
  decision: 0.8,
  api: 0.7,
  process: 0.6,
  experience: 0.5,
  general: 0.2,
};

/** Internal tracking for expertise depth per area */
interface ExpertiseDepth {
  /** Number of memories contributed in this area */
  count: number;
  /** Total confidence of contributed memories */
  totalConfidence: number;
  /** How many times others confirmed contributions in this area */
  confirmations: number;
  /** Timestamp of most recent contribution */
  lastActiveAt: string;
}

export class TeamCapabilityModel {
  private profile: TeamCapabilityProfile;
  private storagePath: string;
  /** Per-member, per-expertise-area depth tracking */
  private expertiseDepths: Record<string, Record<string, ExpertiseDepth>> = {};

  constructor(teamId: string, projectRoot: string) {
    this.profile = {
      teamId,
      members: {},
      updatedAt: new Date().toISOString(),
    };
    this.storagePath = path.join(projectRoot, "memory", "tms", "profile.json");
  }

  /** Load existing profile from disk */
  async load(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.storagePath, "utf-8");
      const data = JSON.parse(raw) as TeamCapabilityProfile;
      this.profile = data;
      // Rebuild expertise depths from loaded profile
      this._rebuildDepths();
    } catch {
      // No existing profile — start empty
    }
  }

  /** Rebuild expertise depth tracking from existing member data */
  private _rebuildDepths(): void {
    this.expertiseDepths = {};
    for (const [memberId, member] of Object.entries(this.profile.members)) {
      this.expertiseDepths[memberId] = {};
      for (const area of member.expertiseAreas) {
        this.expertiseDepths[memberId][area] = {
          count: 0,
          totalConfidence: 0,
          confirmations: 0,
          lastActiveAt: member.lastActiveAt,
        };
      }
    }
  }

  /** Update profile from current ledger state */
  async syncFromLedger(entries: LedgerEntry[]): Promise<void> {
    await this.load(); // Refresh from disk first

    for (const entry of entries) {
      for (const claim of entry.claims) {
        // Track injector
        this._ensureMember(claim.injected_by);
        const injector = this.profile.members[claim.injected_by]!;
        if (!injector.knownMemoryIds.includes(entry.id)) {
          injector.knownMemoryIds.push(entry.id);
        }
        injector.contributionCount++;
        injector.lastActiveAt = new Date().toISOString();
        this._updateExpertise(injector, entry, claim.confidence);
        this._recordDepth(claim.injected_by, entry, claim.confidence, false);

        // Track confirmers — they validate the injector's contribution
        for (const confirmer of claim.confirmed_by) {
          this._ensureMember(confirmer);
          const member = this.profile.members[confirmer]!;
          if (!member.knownMemoryIds.includes(entry.id)) {
            member.knownMemoryIds.push(entry.id);
          }
          member.confirmationCount++;
          member.lastActiveAt = new Date().toISOString();
          this._updateExpertise(member, entry, claim.confidence);
          this._recordDepth(confirmer, entry, claim.confidence, true);
        }
      }
    }

    // Recompute trust scores with enhanced model
    for (const [id, member] of Object.entries(this.profile.members)) {
      this.profile.members[id].trustScore = this.computeTrustScore(id);
    }

    this.profile.updatedAt = new Date().toISOString();
    await this.save();
  }

  /** Get all members */
  getAllMembers(): MemberCapability[] {
    return Object.values(this.profile.members);
  }

  /** Get a single member's capability */
  getMember(memberId: string): MemberCapability | undefined {
    return this.profile.members[memberId];
  }

  /** Get members who know a specific memory */
  getMembersForMemory(memoryId: string): string[] {
    const result: string[] = [];
    for (const [id, member] of Object.entries(this.profile.members)) {
      if (member.knownMemoryIds.includes(memoryId)) {
        result.push(id);
      }
    }
    return result;
  }

  /** Get expertise areas for a member */
  getMemberExpertise(memberId: string): string[] {
    return this.profile.members[memberId]?.expertiseAreas ?? [];
  }

  /**
   * Get expertise depth for a member in a specific area.
   * Returns { count, avgConfidence, confirmations, recency } or null.
   */
  getExpertiseDepth(memberId: string, area: string): {
    count: number;
    avgConfidence: number;
    confirmations: number;
    daysSinceActive: number;
  } | null {
    const depth = this.expertiseDepths[memberId]?.[area];
    if (!depth || depth.count === 0) return null;
    return {
      count: depth.count,
      avgConfidence: depth.totalConfidence / depth.count,
      confirmations: depth.confirmations,
      daysSinceActive: Math.round((Date.now() - new Date(depth.lastActiveAt).getTime()) / 86400000),
    };
  }

  /**
   * Find the best member for a given topic/entity.
   * Scores members by expertise overlap, trust, and recency.
   */
  findBestMemberForTopic(entity: string, category: string, tags: string[]): {
    memberId: string;
    displayName: string;
    score: number;
    reason: string;
  } | null {
    let best: ReturnType<TeamCapabilityModel["findBestMemberForTopic"]> = null;
    let bestScore = 0;

    for (const [id, member] of Object.entries(this.profile.members)) {
      let score = 0;
      const reasons: string[] = [];

      // Category expertise match
      if (member.expertiseAreas.includes(category)) {
        score += 20;
        reasons.push(`专长领域: ${category}`);
      }

      // Tag overlap with member expertise
      const sharedTags = tags.filter(t => member.expertiseAreas.includes(t));
      if (sharedTags.length > 0) {
        score += sharedTags.length * 10;
        reasons.push(`标签匹配: ${sharedTags.join(", ")}`);
      }

      // Entity ownership (knows memories about this entity)
      const entityMemories = member.knownMemoryIds.filter(mid =>
        // Rough heuristic: memory IDs that might relate to this entity
        // This is a simplified check; in production, use graph lookup
        true
      );
      if (entityMemories.length > 0) {
        score += Math.min(15, entityMemories.length);
      }

      // Trust score bonus
      score += member.trustScore * 15;

      // Recency bonus (more active recently = more reliable)
      const daysSinceActive = Math.round((Date.now() - new Date(member.lastActiveAt).getTime()) / 86400000);
      if (daysSinceActive <= 7) score += 10;
      else if (daysSinceActive <= 30) score += 5;

      if (score > bestScore) {
        bestScore = score;
        best = {
          memberId: id,
          displayName: member.displayName,
          score: Math.min(100, score),
          reason: reasons.join("；") || "综合评分",
        };
      }
    }

    return best;
  }

  /**
   * Calculate interaction quality score for a member.
   * Measures how often their contributions are validated by others.
   * High quality = many confirmations per contribution.
   */
  computeInteractionQuality(memberId: string): number {
    const member = this.profile.members[memberId];
    if (!member || member.contributionCount === 0) return 0;
    // Ratio of confirmations to contributions, normalized to [0, 1]
    const ratio = member.confirmationCount / member.contributionCount;
    return Math.min(1.0, ratio / 3); // 3 confirmations per contribution = max quality
  }

  /**
   * Calculate verification accuracy for a member.
   * Based on how many of their contributions have been confirmed by others.
   */
  computeVerificationAccuracy(memberId: string): number {
    const depths = this.expertiseDepths[memberId];
    if (!depths) return 0.5;

    let totalContributions = 0;
    let totalConfirmations = 0;
    for (const depth of Object.values(depths)) {
      totalContributions += depth.count;
      totalConfirmations += depth.confirmations;
    }

    if (totalContributions === 0) return 0.5;
    // Sigmoid of confirmation ratio
    const ratio = totalConfirmations / totalContributions;
    return 0.5 + 0.5 * (1 - Math.exp(-ratio * 5));
  }

  /** Calculate trust score based on contributions, confirmations, and quality */
  computeTrustScore(memberId: string): number {
    const member = this.profile.members[memberId];
    if (!member) return 0.5;
    const total = member.contributionCount + member.confirmationCount;
    if (total === 0) return 0.5;

    // Base score from contribution volume (sigmoid curve)
    const volumeScore = 0.5 + 0.5 * (1 - Math.exp(-total / 10));

    // Interaction quality bonus (up to +0.15)
    const interactionQuality = this.computeInteractionQuality(memberId);
    const qualityBonus = interactionQuality * 0.15;

    // Recency factor (up to +0.1) — recent activity is more trustworthy
    const daysSinceActive = Math.round((Date.now() - new Date(member.lastActiveAt).getTime()) / 86400000);
    const recencyFactor = Math.max(0, 0.1 * (1 - daysSinceActive / 30));

    return Math.min(1.0, volumeScore + qualityBonus + recencyFactor);
  }

  // ---- Internal ----

  private _ensureMember(memberId: string): void {
    if (!this.profile.members[memberId]) {
      this.profile.members[memberId] = {
        memberId,
        displayName: memberId,
        expertiseAreas: [],
        knownMemoryIds: [],
        trustScore: 0.5,
        lastActiveAt: new Date().toISOString(),
        contributionCount: 0,
        confirmationCount: 0,
      };
    }
  }

  /** Update member's expertise areas based on a ledger entry */
  private _updateExpertise(member: MemberCapability, entry: LedgerEntry, confidence: number): void {
    // Category-based expertise
    if (EXPERTISE_CATEGORIES.has(entry.category) && !member.expertiseAreas.includes(entry.category)) {
      member.expertiseAreas.push(entry.category);
    }
    // Tag-based expertise (filtering noise)
    for (const tag of entry.tags) {
      const tagLower = tag.toLowerCase();
      if (NOISE_TAGS.has(tagLower)) continue;
      if (!member.expertiseAreas.includes(tag)) {
        member.expertiseAreas.push(tag);
      }
    }
    // Entity name as expertise area (for domain-specific knowledge)
    if (entry.entity && entry.entity !== "general" && !member.expertiseAreas.includes(entry.entity)) {
      member.expertiseAreas.push(entry.entity);
    }
  }

  /** Record expertise depth for a member in a specific area */
  private _recordDepth(memberId: string, entry: LedgerEntry, confidence: number, isConfirmation: boolean): void {
    if (!this.expertiseDepths[memberId]) this.expertiseDepths[memberId] = {};

    const areas = new Set<string>();
    areas.add(entry.category);
    for (const tag of entry.tags) {
      if (!NOISE_TAGS.has(tag.toLowerCase())) areas.add(tag);
    }
    if (entry.entity && entry.entity !== "general") areas.add(entry.entity);

    for (const area of areas) {
      if (!this.expertiseDepths[memberId][area]) {
        this.expertiseDepths[memberId][area] = {
          count: 0,
          totalConfidence: 0,
          confirmations: 0,
          lastActiveAt: entry.updatedAt,
        };
      }
      const depth = this.expertiseDepths[memberId][area];
      depth.count++;
      depth.totalConfidence += confidence;
      if (isConfirmation) depth.confirmations++;
      depth.lastActiveAt = new Date().toISOString();
    }
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(this.storagePath, JSON.stringify(this.profile, null, 2), "utf-8");
  }
}
