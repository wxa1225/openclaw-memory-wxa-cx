// TMS Knowledge Analyzer — knowledge gap detection, departure simulation, transfer recommendation

import type {
  LedgerEntry,
  MemberCapability,
  TeamCapabilityProfile,
  KnowledgeGap,
  DepartureImpact,
  TransferRecommendation,
  DepartureSimulationResult,
  RiskScore,
} from "./storage/types.js";
import { CATEGORY_WEIGHTS } from "./storage/types.js";

export class TMSKnowledgeAnalyzer {
  private teamId: string;
  private profile: TeamCapabilityProfile;

  constructor(teamId: string, profile: TeamCapabilityProfile) {
    this.teamId = teamId;
    this.profile = profile;
  }

  // ---- Knowledge Gap Analysis ----

  /** Find all memories known by exactly one person (single points of failure) */
  findSinglePointsOfFailure(entries: LedgerEntry[]): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];

    for (const entry of entries) {
      const holders = this._getMemoryHolders(entry);
      if (holders.length === 1) {
        const activeClaim = entry.claims.find(
          (c) => c.status === "active" || c.status === undefined
        );
        if (activeClaim) {
          gaps.push({
            memoryId: entry.id,
            entity: entry.entity,
            attribute: entry.attribute,
            value: activeClaim.value,
            category: entry.category,
            tags: entry.tags,
            currentHolder: holders[0],
            riskScore: this._computeSinglePointRisk(entry),
            businessImpact: this._computeBusinessImpact(entry),
          });
        }
      }
    }

    return gaps.sort((a, b) => b.riskScore - a.riskScore);
  }

  /** Simulate a member leaving the team */
  simulateDeparture(
    memberId: string,
    entries: LedgerEntry[]
  ): DepartureSimulationResult | null {
    const member = this.profile.members[memberId];
    if (!member) return null;

    const teamSize = Object.keys(this.profile.members).length;
    if (teamSize <= 1) return null; // Can't simulate departure from 1-person team

    // Find all memories this member knows
    const memberMemories = entries.filter((e) =>
      this._getMemoryHolders(e).includes(memberId)
    );

    // Single points of failure (memories only this member knows)
    const singlePointFailures: KnowledgeGap[] = [];
    for (const entry of memberMemories) {
      const holders = this._getMemoryHolders(entry);
      if (holders.length === 1 && holders[0] === memberId) {
        const activeClaim = entry.claims.find(
          (c) => c.status === "active" || c.status === undefined
        );
        if (activeClaim) {
          singlePointFailures.push({
            memoryId: entry.id,
            entity: entry.entity,
            attribute: entry.attribute,
            value: activeClaim.value,
            category: entry.category,
            tags: entry.tags,
            currentHolder: memberId,
            riskScore: this._computeSinglePointRisk(entry),
            businessImpact: this._computeBusinessImpact(entry),
          });
        }
      }
    }

    // Compute risk before and after departure
    const beforeScores = this._computeAllRisks(entries, teamSize);
    const afterScores = this._computeAllRisksAfterDeparture(entries, memberId, teamSize - 1);

    // Total risk increase
    const beforeTotal = beforeScores.reduce((sum, s) => sum + s.totalRisk, 0);
    const afterTotal = afterScores.reduce((sum, s) => sum + s.totalRisk, 0);
    const totalRiskIncrease = Math.round((afterTotal - beforeTotal) * 1000) / 1000;

    // Affected categories
    const affectedCategories = [...new Set(singlePointFailures.map((g) => g.category))];

    // Knowledge loss percentage
    const totalUniqueMemories = new Set(entries.map((e) => e.id)).size;
    const knowledgeLossPercentage = totalUniqueMemories > 0
      ? Math.round((singlePointFailures.length / totalUniqueMemories) * 10000) / 100
      : 0;

    // Generate transfer recommendations
    const recommendations = this._generateTransferRecommendations(
      singlePointFailures,
      memberId,
      entries
    );

    // Build summary
    const summary = this._buildSummary(member, singlePointFailures, totalRiskIncrease, recommendations);

    return {
      impact: {
        memberId,
        displayName: member.displayName,
        totalMemoriesKnown: memberMemories.length,
        singlePointFailures: singlePointFailures.sort((a, b) => b.riskScore - a.riskScore),
        totalRiskIncrease,
        affectedCategories,
        knowledgeLossPercentage,
      },
      recommendations,
      beforeRiskScores: beforeScores,
      afterRiskScores: afterScores,
      summary,
    };
  }

  /** Get team-wide knowledge distribution heatmap */
  getKnowledgeDistribution(entries: LedgerEntry[]): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const entry of entries) {
      const holders = this._getMemoryHolders(entry);
      const category = entry.category;
      if (!distribution[category]) distribution[category] = 0;
      distribution[category] += holders.length;
    }

    return distribution;
  }

  /** Get memories that overlap between two members (shared knowledge) */
  getSharedKnowledge(memberA: string, memberB: string): string[] {
    const memberAData = this.profile.members[memberA];
    const memberBData = this.profile.members[memberB];
    if (!memberAData || !memberBData) return [];

    const setA = new Set(memberAData.knownMemoryIds);
    const setB = new Set(memberBData.knownMemoryIds);
    const shared: string[] = [];

    for (const id of setA) {
      if (setB.has(id)) shared.push(id);
    }

    return shared;
  }

  // ---- Internal Helpers ----

  /** Get all members who know a specific memory */
  private _getMemoryHolders(entry: LedgerEntry): string[] {
    const holders = new Set<string>();
    for (const claim of entry.claims) {
      holders.add(claim.injected_by);
      for (const confirmer of claim.confirmed_by) {
        holders.add(confirmer);
      }
    }
    // Only return holders that are in the TMS profile
    return [...holders].filter((h) => this.profile.members[h]);
  }

  /** Compute risk score for a single-point-of-failure memory */
  private _computeSinglePointRisk(entry: LedgerEntry): number {
    // Base: knowledge coverage (0.5 if only 1 person knows, scales up with importance)
    const coverageRisk = 0.8; // Single holder = 80% coverage risk
    const businessImpact = this._computeBusinessImpact(entry);

    // Weighted: 60% coverage risk + 40% business impact
    return Math.min(1.0, Math.round((0.6 * coverageRisk + 0.4 * businessImpact) * 1000) / 1000);
  }

  /** Compute business impact for a memory */
  private _computeBusinessImpact(entry: LedgerEntry): number {
    const categoryWeight = CATEGORY_WEIGHTS[entry.category] ?? CATEGORY_WEIGHTS.general;
    const importantTags = ["prod", "critical", "compliance", "deadline"];
    const tagCount = entry.tags.filter((t) =>
      importantTags.includes(t.toLowerCase())
    ).length;
    const tagScore = Math.min(1.0, tagCount / 3);

    // Sigmoid (same as risk.ts)
    const alpha = 0.6;
    const beta = 0.4;
    const linear = alpha * categoryWeight + beta * tagScore;
    return 1 / (1 + Math.exp(-linear));
  }

  /** Compute risk scores for all entries with given team size */
  private _computeAllRisks(entries: LedgerEntry[], teamSize: number): RiskScore[] {
    return entries.map((entry) => this._computeRiskForEntry(entry, teamSize));
  }

  /** Compute risk scores after a member leaves (team size reduced, coverage reduced) */
  private _computeAllRisksAfterDeparture(
    entries: LedgerEntry[],
    departedMemberId: string,
    newTeamSize: number
  ): RiskScore[] {
    return entries.map((entry) => {
      // Adjust confirmed_by to remove departed member
      const adjustedEntry = this._adjustEntryForDeparture(entry, departedMemberId);
      return this._computeRiskForEntry(adjustedEntry, newTeamSize);
    });
  }

  /** Remove departed member from entry's confirmed_by lists */
  private _adjustEntryForDeparture(entry: LedgerEntry, departedMemberId: string): LedgerEntry {
    const adjusted = {
      ...entry,
      claims: entry.claims.map((claim) => ({
        ...claim,
        confirmed_by: claim.confirmed_by.filter((c) => c !== departedMemberId),
      })),
    };
    return adjusted;
  }

  /** Compute a simplified risk score for a single entry */
  private _computeRiskForEntry(entry: LedgerEntry, teamSize: number): RiskScore {
    const now = new Date();

    // TimeDecay (simplified: same as RiskModel)
    const activeClaim = entry.claims.find(
      (c) => c.status === "active" || c.status === undefined
    );
    let timeDecay = 0.5;
    if (activeClaim) {
      const elapsed = now.getTime() - new Date(activeClaim.valid_from).getTime();
      const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
      const pRecall = Math.pow(2, -elapsed / halfLifeMs);
      timeDecay = 1 - pRecall;
    }

    // BusinessImpact
    const businessImpact = this._computeBusinessImpact(entry);

    // LowCoverage (adjusted for team size)
    const confirmers = new Set<string>();
    for (const claim of entry.claims) {
      for (const c of claim.confirmed_by) confirmers.add(c);
      confirmers.add(claim.injected_by);
    }
    const coverage = Math.min(confirmers.size / Math.max(teamSize, 1), 1.0);
    const lowCoverage = 1 - coverage;

    // VersionRisk
    const versionRisk = entry.current_version > 3 ? 0.3 : 0.1;

    // LowUsage
    const lowUsage = Math.max(0, 1 - (entry.access_count ?? 0) / 10);

    // Weighted total (same weights as RISK_WEIGHTS)
    const totalRisk =
      0.35 * timeDecay +
      0.25 * businessImpact +
      0.20 * lowCoverage +
      0.10 * versionRisk +
      0.10 * lowUsage;

    const triggered =
      totalRisk > 0.55 && businessImpact > 0.50;

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

  /** Generate transfer recommendations for single-point-of-failure memories */
  private _generateTransferRecommendations(
    singlePointFailures: KnowledgeGap[],
    departedMemberId: string,
    entries: LedgerEntry[]
  ): TransferRecommendation[] {
    const members = Object.values(this.profile.members).filter(
      (m) => m.memberId !== departedMemberId
    );

    if (members.length === 0) return [];

    return members
      .map((member) => this._scoreTransferCandidate(member, singlePointFailures, entries))
      .filter((r) => r.transferScore > 0)
      .sort((a, b) => b.transferScore - a.transferScore);
  }

  /** Score a potential transfer candidate */
  private _scoreTransferCandidate(
    candidate: MemberCapability,
    singlePointFailures: KnowledgeGap[],
    entries: LedgerEntry[]
  ): TransferRecommendation {
    // 1. Expertise overlap: how much of the departing member's expertise does this candidate share?
    const departedMember = this.profile.members[Object.keys(this.profile.members).find(
      (id) => id !== candidate.memberId
    )!];
    const departedExpertise = departedMember
      ? new Set(departedMember.expertiseAreas)
      : new Set<string>();
    const candidateExpertise = new Set(candidate.expertiseAreas);

    let expertiseOverlap = 0;
    if (departedExpertise.size > 0) {
      let overlapCount = 0;
      for (const area of departedExpertise) {
        if (candidateExpertise.has(area)) overlapCount++;
      }
      expertiseOverlap = overlapCount / departedExpertise.size;
    }

    // 2. Current knowledge overlap: how many of the single-point memories does this candidate already know?
    // (If they already know some, they're a better candidate)
    const candidateKnownMemories = new Set(candidate.knownMemoryIds);
    let knownOverlap = 0;
    for (const spf of singlePointFailures) {
      if (candidateKnownMemories.has(spf.memoryId)) knownOverlap++;
    }
    const currentKnowledgeOverlap = singlePointFailures.length > 0
      ? knownOverlap / singlePointFailures.length
      : 0;

    // 3. Trust score: higher trust = better candidate
    const trustScore = candidate.trustScore;

    // Weighted transfer score
    // 40% expertise overlap + 30% knowledge overlap + 30% trust
    const transferScore = Math.round(
      (0.4 * expertiseOverlap + 0.3 * currentKnowledgeOverlap + 0.3 * trustScore) * 1000
    ) / 1000;

    // Build reason string
    const reason = this._buildTransferReason(
      candidate,
      expertiseOverlap,
      currentKnowledgeOverlap,
      trustScore
    );

    return {
      recommendedMemberId: candidate.memberId,
      recommendedDisplayName: candidate.displayName,
      transferScore,
      reason,
      expertiseOverlap: Math.round(expertiseOverlap * 1000) / 1000,
      currentKnowledgeOverlap: Math.round(currentKnowledgeOverlap * 1000) / 1000,
      trustScore: Math.round(trustScore * 1000) / 1000,
    };
  }

  /** Build a human-readable reason for why this candidate is recommended */
  private _buildTransferReason(
    candidate: MemberCapability,
    expertiseOverlap: number,
    currentKnowledgeOverlap: number,
    trustScore: number
  ): string {
    const parts: string[] = [];

    if (expertiseOverlap > 0.5) {
      parts.push(` expertise overlap ${(expertiseOverlap * 100).toFixed(0)}%`);
    }
    if (currentKnowledgeOverlap > 0) {
      parts.push(` already knows ${(currentKnowledgeOverlap * 100).toFixed(0)}% of at-risk memories`);
    }
    if (trustScore > 0.7) {
      parts.push(` high trust score (${(trustScore * 100).toFixed(0)}%)`);
    }
    if (parts.length === 0) {
      parts.push(` available team member`);
    }

    return `Recommended because:${parts.join(",")}`;
  }

  /** Build a summary text for the departure simulation */
  private _buildSummary(
    member: MemberCapability,
    singlePointFailures: KnowledgeGap[],
    totalRiskIncrease: number,
    recommendations: TransferRecommendation[]
  ): string {
    let summary = `如果 ${member.displayName} 离开团队：\n\n`;

    summary += `  - 总共知道 ${member.knownMemoryIds.length} 条记忆\n`;
    summary += `  - 其中 ${singlePointFailures.length} 条只有 TA 知道（知识断层）\n`;
    summary += `  - 团队整体风险增加 ${Math.round(totalRiskIncrease * 100)}%\n`;
    summary += `  - 受影响类别：${[...new Set(singlePointFailures.map((g) => g.category))].join(", ") || "无"}\n`;

    if (recommendations.length > 0) {
      const best = recommendations[0];
      summary += `\n推荐传承对象：${best.recommendedDisplayName}（匹配度 ${(best.transferScore * 100).toFixed(0)}%）`;
    }

    return summary;
  }
}
