// MemoryInsightEngine — aggregates ledger, risk, TMS, and graph data
// into a structured InsightReport for the Memory Dashboard

import type {
  LedgerEntry,
  RiskScore,
  TeamCapabilityProfile,
  InsightReport,
  KnowledgeHeatmap,
  HeatmapCell,
  KnowledgeLossRanking,
  MemberRiskRanking,
  LifecycleStats,
  TMSKnowledgeNetwork,
  TMSNetworkNode,
  TMSNetworkEdge,
  TeamDepartureOverview,
  DepartureSimulationResult,
} from "./storage/types.js";
import { CATEGORY_WEIGHTS } from "./storage/types.js";
import {
  calculateStrengthFromLedger,
  getStrengthLabel,
  type StrengthLabel,
} from "./decay.js";

export interface InsightEngineOptions {
  teamId: string;
  teamSize: number;
}

export class MemoryInsightEngine {
  private teamId: string;
  private teamSize: number;

  constructor(options: InsightEngineOptions) {
    this.teamId = options.teamId;
    this.teamSize = options.teamSize;
  }

  /** Generate a complete insight report from current system state */
  async generateReport(
    entries: LedgerEntry[],
    riskScores: RiskScore[],
    tmsProfile: TeamCapabilityProfile | null,
    departureSimulations: Record<string, DepartureSimulationResult | null>,
  ): Promise<InsightReport> {
    const heatmap = this.computeKnowledgeHeatmap(entries, riskScores, tmsProfile);
    const lossRanking = this.computeKnowledgeLossRanking(entries, riskScores, tmsProfile, departureSimulations);
    const lifecycle = this.computeLifecycleStats(entries, riskScores);
    const network = this.computeTMSNetwork(tmsProfile, entries);
    const departureOverview = this.computeDepartureOverview(entries, departureSimulations, tmsProfile);

    const healthScore = this.computeTeamHealthScore(lifecycle, lossRanking, departureOverview);
    const topRisks = this.identifyTopRisks(entries, riskScores, lossRanking, departureOverview);
    const recommendations = this.generateRecommendations(lifecycle, lossRanking, heatmap, departureOverview);

    return {
      generatedAt: new Date().toISOString(),
      teamId: this.teamId,
      heatmap,
      lossRanking,
      lifecycle,
      network,
      departureOverview,
      summary: {
        totalMemories: entries.length,
        teamHealthScore: Math.round(healthScore * 10) / 10,
        topRisks,
        recommendations,
      },
    };
  }

  // ============================================================================
  // 1. Knowledge Heatmap
  // ============================================================================

  private computeKnowledgeHeatmap(
    entries: LedgerEntry[],
    riskScores: RiskScore[],
    tmsProfile: TeamCapabilityProfile | null,
  ): KnowledgeHeatmap {
    const riskMap = new Map<string, RiskScore>();
    for (const rs of riskScores) riskMap.set(rs.memoryId, rs);

    const cells: HeatmapCell[] = [];
    const categories = [...new Set(entries.map((e) => e.category))].sort();
    const members = tmsProfile ? Object.keys(tmsProfile.members).sort() : [];

    if (tmsProfile && members.length > 0) {
      for (const cat of categories) {
        for (const memberId of members) {
          const member = tmsProfile.members[memberId];
          if (!member) continue;

          const catEntries = entries.filter(
            (e) => e.category === cat && member.knownMemoryIds.includes(e.id),
          );
          if (catEntries.length === 0) continue;

          const strengths = catEntries.map((e) => calculateStrengthFromLedger(e));
          const avgStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length;

          const risks = catEntries
            .map((e) => riskMap.get(e.id)?.totalRisk ?? 0);
          const avgRisk = risks.reduce((a, b) => a + b, 0) / risks.length;

          cells.push({
            category: cat,
            memberId,
            displayName: member.displayName,
            memoryCount: catEntries.length,
            avgStrength: Math.round(avgStrength * 1000) / 1000,
            avgRisk: Math.round(avgRisk * 1000) / 1000,
          });
        }
      }
    } else {
      for (const cat of categories) {
        const catEntries = entries.filter((e) => e.category === cat);
        const strengths = catEntries.map((e) => calculateStrengthFromLedger(e));
        const avgStrength = strengths.length > 0
          ? strengths.reduce((a, b) => a + b, 0) / strengths.length
          : 0;
        const risks = catEntries.map((e) => riskMap.get(e.id)?.totalRisk ?? 0);
        const avgRisk = risks.length > 0
          ? risks.reduce((a, b) => a + b, 0) / risks.length
          : 0;

        cells.push({
          category: cat,
          memberId: "team",
          displayName: "Team (aggregate)",
          memoryCount: catEntries.length,
          avgStrength: Math.round(avgStrength * 1000) / 1000,
          avgRisk: Math.round(avgRisk * 1000) / 1000,
        });
      }
    }

    const blindSpots: Array<{ category: string; reason: string }> = [];
    for (const cat of categories) {
      const catCells = cells.filter((c) => c.category === cat);
      const totalMemories = catCells.reduce((s, c) => s + c.memoryCount, 0);
      const uniqueHolders = new Set(catCells.map((c) => c.memberId)).size;

      if (totalMemories === 0) {
        blindSpots.push({ category: cat, reason: "No memories in this category" });
      } else if (uniqueHolders <= 1) {
        blindSpots.push({
          category: cat,
          reason: `Only ${uniqueHolders} member(s) hold ${totalMemories} memory/ies`,
        });
      }
    }

    const denseAreas: Array<{ category: string; count: number; holders: number }> = [];
    for (const cat of categories) {
      const catCells = cells.filter((c) => c.category === cat);
      const totalMemories = catCells.reduce((s, c) => s + c.memoryCount, 0);
      const uniqueHolders = new Set(catCells.map((c) => c.memberId)).size;
      if (totalMemories >= 3) {
        denseAreas.push({ category: cat, count: totalMemories, holders: uniqueHolders });
      }
    }

    return { cells, categories, members, blindSpots, denseAreas };
  }

  // ============================================================================
  // 2. Knowledge Loss Ranking
  // ============================================================================

  private computeKnowledgeLossRanking(
    entries: LedgerEntry[],
    riskScores: RiskScore[],
    tmsProfile: TeamCapabilityProfile | null,
    departureSimulations: Record<string, DepartureSimulationResult | null>,
  ): KnowledgeLossRanking {
    if (!tmsProfile) {
      return { rankings: [], teamAvgSinglePoints: 0, mostVulnerableCategory: "N/A" };
    }

    const riskMap = new Map<string, RiskScore>();
    for (const rs of riskScores) riskMap.set(rs.memoryId, rs);

    const rankings: MemberRiskRanking[] = [];

    for (const [memberId, member] of Object.entries(tmsProfile.members)) {
      const sim = departureSimulations[memberId];
      if (!sim) continue;

      const spfIds = new Set(sim.impact.singlePointFailures.map((f) => f.memoryId));
      const criticalMemories: string[] = [];
      let totalRisk = 0;
      let riskCount = 0;

      for (const memId of member.knownMemoryIds) {
        const rs = riskMap.get(memId);
        if (rs) {
          totalRisk += rs.totalRisk;
          riskCount++;
        }
        if (spfIds.has(memId)) {
          criticalMemories.push(memId);
        }
      }

      const avgRisk = riskCount > 0 ? totalRisk / riskCount : 0;

      const singlePointRatio = member.knownMemoryIds.length > 0
        ? criticalMemories.length / member.knownMemoryIds.length
        : 0;
      const categoryPenalty = sim.impact.affectedCategories.reduce((sum, cat) => {
        return sum + (CATEGORY_WEIGHTS[cat] ?? 0.3);
      }, 0) / Math.max(sim.impact.affectedCategories.length, 1);

      const riskScore = Math.min(1.0,
        0.4 * singlePointRatio +
        0.3 * avgRisk +
        0.3 * categoryPenalty,
      );

      rankings.push({
        memberId,
        displayName: member.displayName,
        singlePointCount: sim.impact.singlePointFailures.length,
        totalKnownMemories: member.knownMemoryIds.length,
        avgRiskOfHeldMemories: Math.round(avgRisk * 1000) / 1000,
        criticalMemories: criticalMemories.slice(0, 10),
        riskScore: Math.round(riskScore * 1000) / 1000,
      });
    }

    rankings.sort((a, b) => b.riskScore - a.riskScore);

    const catCounts: Record<string, number> = {};
    for (const r of rankings) {
      for (const memId of r.criticalMemories) {
        const entry = entries.find((e) => e.id === memId);
        if (entry) {
          catCounts[entry.category] = (catCounts[entry.category] ?? 0) + 1;
        }
      }
    }
    const mostVulnerableCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";

    const teamAvgSinglePoints = rankings.length > 0
      ? Math.round((rankings.reduce((s, r) => s + r.singlePointCount, 0) / rankings.length) * 10) / 10
      : 0;

    return { rankings, teamAvgSinglePoints, mostVulnerableCategory };
  }

  // ============================================================================
  // 3. Lifecycle Statistics
  // ============================================================================

  private computeLifecycleStats(
    entries: LedgerEntry[],
    riskScores: RiskScore[],
  ): LifecycleStats {
    if (entries.length === 0) {
      return {
        totalMemories: 0, activeMemories: 0, supersededMemories: 0,
        conflictingMemories: 0, avgAgeDays: 0, avgVersionCount: 0,
        avgStrength: 0, avgRiskScore: 0, categoryBreakdown: {},
        strengthDistribution: { fresh: 0, strong: 0, fading: 0, weak: 0, critical: 0 },
        forgettingSpeedDistribution: { fast: 0, medium: 0, slow: 0 },
        memoryLifespan: { avgDaysUntilSuperseded: null, longestLivedDays: 0 },
        reviewStats: { totalReviews: 0, avgReviewsPerMemory: 0, mostReviewed: null },
      };
    }

    const riskMap = new Map<string, RiskScore>();
    for (const rs of riskScores) riskMap.set(rs.memoryId, rs);

    let activeCount = 0;
    let supersededCount = 0;
    let conflictingCount = 0;
    let totalAgeDays = 0;
    let totalVersions = 0;
    let totalStrength = 0;
    let totalRisk = 0;
    let totalReviews = 0;
    let maxAgeDays = 0;
    let mostReviewedId: string | null = null;
    let mostReviewedCount = 0;

    const categoryData: Record<string, { count: number; strengths: number[]; risks: number[] }> = {};
    const strengthDist: Record<StrengthLabel, number> = { fresh: 0, strong: 0, fading: 0, weak: 0, critical: 0 };
    let fastDecay = 0;
    let mediumDecay = 0;
    let slowDecay = 0;

    const now = Date.now();

    for (const entry of entries) {
      const strength = calculateStrengthFromLedger(entry);
      const label = getStrengthLabel(strength);
      strengthDist[label]++;
      totalStrength += strength;

      const rs = riskMap.get(entry.id);
      if (rs) totalRisk += rs.totalRisk;

      totalVersions += entry.current_version;
      totalReviews += entry.access_count ?? 0;

      if (entry.access_count > mostReviewedCount) {
        mostReviewedCount = entry.access_count;
        mostReviewedId = entry.id;
      }

      const activeClaims = entry.claims.filter((c) => c.status === "active" || c.status === undefined);
      const supersededClaims = entry.claims.filter((c) => c.status === "superseded");
      const conflictingClaims = entry.claims.filter((c) => c.status === "conflicting");

      if (activeClaims.length > 0) activeCount++;
      if (supersededClaims.length > 0) supersededCount++;
      if (conflictingClaims.length > 0) conflictingCount++;

      const created = new Date(entry.createdAt).getTime();
      const ageDays = (now - created) / (24 * 60 * 60 * 1000);
      totalAgeDays += ageDays;
      if (ageDays > maxAgeDays) maxAgeDays = ageDays;

      if (entry.recall_half_life <= 3) fastDecay++;
      else if (entry.recall_half_life <= 7) mediumDecay++;
      else slowDecay++;

      if (!categoryData[entry.category]) {
        categoryData[entry.category] = { count: 0, strengths: [], risks: [] };
      }
      categoryData[entry.category].count++;
      categoryData[entry.category].strengths.push(strength);
      if (rs) categoryData[entry.category].risks.push(rs.totalRisk);
    }

    const categoryBreakdown: Record<string, { count: number; avgStrength: number; avgRisk: number }> = {};
    for (const [cat, data] of Object.entries(categoryData)) {
      categoryBreakdown[cat] = {
        count: data.count,
        avgStrength: Math.round((data.strengths.reduce((a, b) => a + b, 0) / data.count) * 1000) / 1000,
        avgRisk: data.risks.length > 0
          ? Math.round((data.risks.reduce((a, b) => a + b, 0) / data.risks.length) * 1000) / 1000
          : 0,
      };
    }

    let totalSupersededDays = 0;
    let supersededCount2 = 0;
    for (const entry of entries) {
      for (const claim of entry.claims) {
        if (claim.status === "superseded" && claim.valid_from && claim.valid_to) {
          const from = new Date(claim.valid_from).getTime();
          const to = new Date(claim.valid_to).getTime();
          totalSupersededDays += (to - from) / (24 * 60 * 60 * 1000);
          supersededCount2++;
        }
      }
    }
    const avgDaysUntilSuperseded = supersededCount2 > 0
      ? Math.round((totalSupersededDays / supersededCount2) * 10) / 10
      : null;

    return {
      totalMemories: entries.length,
      activeMemories: activeCount,
      supersededMemories: supersededCount,
      conflictingMemories: conflictingCount,
      avgAgeDays: Math.round((totalAgeDays / entries.length) * 10) / 10,
      avgVersionCount: Math.round((totalVersions / entries.length) * 100) / 100,
      avgStrength: Math.round((totalStrength / entries.length) * 1000) / 1000,
      avgRiskScore: Math.round((totalRisk / entries.length) * 1000) / 1000,
      categoryBreakdown,
      strengthDistribution: strengthDist,
      forgettingSpeedDistribution: { fast: fastDecay, medium: mediumDecay, slow: slowDecay },
      memoryLifespan: { avgDaysUntilSuperseded, longestLivedDays: Math.round(maxAgeDays * 10) / 10 },
      reviewStats: {
        totalReviews,
        avgReviewsPerMemory: Math.round((totalReviews / entries.length) * 100) / 100,
        mostReviewed: mostReviewedId,
      },
    };
  }

  // ============================================================================
  // 4. TMS Knowledge Network
  // ============================================================================

  private computeTMSNetwork(
    tmsProfile: TeamCapabilityProfile | null,
    entries: LedgerEntry[],
  ): TMSKnowledgeNetwork {
    if (!tmsProfile || Object.keys(tmsProfile.members).length === 0) {
      const categories = [...new Set(entries.map((e) => e.category))];
      const nodes: TMSNetworkNode[] = categories.map((cat) => ({
        id: cat,
        displayName: cat,
        type: "category" as const,
        memoryCount: entries.filter((e) => e.category === cat).length,
        expertiseAreas: [],
        trustScore: 0,
      }));
      return { nodes, edges: [], overlapPairs: [], knowledgeSilos: [], centralityScores: {} };
    }

    const nodes: TMSNetworkNode[] = [];
    const edges: TMSNetworkEdge[] = [];
    const overlapPairs: TMSKnowledgeNetwork["overlapPairs"] = [];
    const knowledgeSilos: TMSKnowledgeNetwork["knowledgeSilos"] = [];
    const centralityScores: Record<string, number> = {};

    for (const [memberId, member] of Object.entries(tmsProfile.members)) {
      nodes.push({
        id: memberId,
        displayName: member.displayName,
        type: "person",
        memoryCount: member.knownMemoryIds.length,
        expertiseAreas: member.expertiseAreas,
        trustScore: member.trustScore,
      });
    }

    const categories = [...new Set(entries.map((e) => e.category))];
    for (const cat of categories) {
      nodes.push({
        id: `cat:${cat}`,
        displayName: cat,
        type: "category",
        memoryCount: entries.filter((e) => e.category === cat).length,
        expertiseAreas: [],
        trustScore: 0,
      });
    }

    for (const [memberId, member] of Object.entries(tmsProfile.members)) {
      const memberCatSet = new Set<string>();
      for (const memId of member.knownMemoryIds) {
        const entry = entries.find((e) => e.id === memId);
        if (entry) memberCatSet.add(entry.category);
      }
      for (const cat of memberCatSet) {
        edges.push({
          source: memberId,
          target: `cat:${cat}`,
          type: "knows",
          weight: 1,
        });
      }
    }

    const memberIds = Object.keys(tmsProfile.members);
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const mA = tmsProfile.members[memberIds[i]];
        const mB = tmsProfile.members[memberIds[j]];
        if (!mA || !mB) continue;

        const setA = new Set(mA.knownMemoryIds);
        const setB = new Set(mB.knownMemoryIds);
        let sharedCount = 0;
        for (const id of setA) {
          if (setB.has(id)) sharedCount++;
        }

        if (sharedCount > 0) {
          edges.push({
            source: memberIds[i],
            target: memberIds[j],
            type: "overlap",
            weight: sharedCount,
          });

          const totalKnown = new Set([...mA.knownMemoryIds, ...mB.knownMemoryIds]).size;
          overlapPairs.push({
            memberA: mA.displayName,
            memberB: mB.displayName,
            sharedCount,
            sharedPercentage: totalKnown > 0
              ? Math.round((sharedCount / totalKnown) * 1000) / 10
              : 0,
          });
        }
      }
    }

    for (const [memberId, member] of Object.entries(tmsProfile.members)) {
      const uniqueCats = new Set<string>();
      for (const memId of member.knownMemoryIds) {
        const entry = entries.find((e) => e.id === memId);
        if (!entry) continue;
        const otherHolders = memberIds.filter((mid) => {
          if (mid === memberId) return false;
          return tmsProfile.members[mid]?.knownMemoryIds.includes(memId);
        });
        if (otherHolders.length === 0) {
          uniqueCats.add(entry.category);
        }
      }
      if (uniqueCats.size > 0) {
        knowledgeSilos.push({
          memberId,
          displayName: member.displayName,
          uniqueCategories: [...uniqueCats],
        });
      }
    }

    for (const memberId of memberIds) {
      const degree = edges.filter(
        (e) => e.source === memberId || e.target === memberId,
      ).length;
      centralityScores[memberId] = Math.round((degree / Math.max(edges.length, 1)) * 1000) / 1000;
    }

    overlapPairs.sort((a, b) => b.sharedCount - a.sharedCount);

    return { nodes, edges, overlapPairs, knowledgeSilos, centralityScores };
  }

  // ============================================================================
  // 5. Team Departure Overview
  // ============================================================================

  private computeDepartureOverview(
    entries: LedgerEntry[],
    departureSimulations: Record<string, DepartureSimulationResult | null>,
    tmsProfile: TeamCapabilityProfile | null,
  ): TeamDepartureOverview {
    const memberImpacts: TeamDepartureOverview["memberImpacts"] = [];
    let worstCaseMemberId = "";
    let worstCaseLoss = 0;

    for (const [memberId, sim] of Object.entries(departureSimulations)) {
      if (!sim) continue;
      memberImpacts.push({
        memberId,
        displayName: sim.impact.displayName,
        singlePointCount: sim.impact.singlePointFailures.length,
        knowledgeLossPercentage: sim.impact.knowledgeLossPercentage,
        riskIncrease: sim.impact.totalRiskIncrease,
      });
      if (sim.impact.knowledgeLossPercentage > worstCaseLoss) {
        worstCaseLoss = sim.impact.knowledgeLossPercentage;
        worstCaseMemberId = memberId;
      }
    }

    memberImpacts.sort((a, b) => b.knowledgeLossPercentage - a.knowledgeLossPercentage);

    const avgSinglePoints = memberImpacts.length > 0
      ? memberImpacts.reduce((s, m) => s + m.singlePointCount, 0) / memberImpacts.length
      : 0;
    const lossFactor = 1 - (worstCaseLoss / 100);
    const spfFactor = Math.max(0, 1 - (avgSinglePoints / Math.max(entries.length, 1)));
    const teamResilienceScore = Math.round(((lossFactor * 0.6 + spfFactor * 0.4)) * 1000) / 1000;

    return {
      memberImpacts,
      worstCaseMemberId,
      worstCaseLoss: Math.round(worstCaseLoss * 10) / 10,
      teamResilienceScore,
    };
  }

  // ============================================================================
  // 6. Composite Health Score & Recommendations
  // ============================================================================

  private computeTeamHealthScore(
    lifecycle: LifecycleStats,
    lossRanking: KnowledgeLossRanking,
    departureOverview: TeamDepartureOverview,
  ): number {
    const freshnessScore = lifecycle.avgStrength;
    const distributionScore = departureOverview.teamResilienceScore;
    const riskScore = 1 - lifecycle.avgRiskScore;

    // Component 4: Conflict management (20%)
    const conflictScore = lifecycle.totalMemories > 0
      ? 1 - (lifecycle.conflictingMemories / lifecycle.totalMemories)
      : 1;

    const raw =
      0.30 * freshnessScore +
      0.25 * distributionScore +
      0.25 * riskScore +
      0.20 * conflictScore;

    // Convert to 0-100 scale (raw is already 0-1, multiply by 100)
    return Math.min(100, Math.max(0, Math.round(raw * 100)));
  }

  private identifyTopRisks(
    entries: LedgerEntry[],
    riskScores: RiskScore[],
    lossRanking: KnowledgeLossRanking,
    departureOverview: TeamDepartureOverview,
  ): string[] {
    const risks: string[] = [];

    // High-risk individual memories
    const triggered = riskScores.filter((s) => s.triggered);
    if (triggered.length > 0) {
      const top = triggered[0];
      const entry = entries.find((e) => e.id === top.memoryId);
      if (entry) {
        const value = entry.claims.find((c) => c.status === "active" || c.status === undefined)?.value ?? "";
        risks.push(`${entry.entity}.${entry.attribute}: risk ${(top.totalRisk * 100).toFixed(0)}% — "${value.substring(0, 50)}"`);
      }
    }

    // Knowledge silos from loss ranking
    for (const r of lossRanking.rankings.slice(0, 2)) {
      if (r.singlePointCount > 0) {
        risks.push(`${r.displayName} has ${r.singlePointCount} single-point knowledge(s)`);
      }
    }

    // Departure vulnerability
    if (departureOverview.worstCaseMemberId && departureOverview.worstCaseLoss > 10) {
      const member = departureOverview.memberImpacts.find(
        (m) => m.memberId === departureOverview.worstCaseMemberId,
      );
      if (member) {
        risks.push(`Worst case: ${member.displayName} departure → ${member.knowledgeLossPercentage}% knowledge loss`);
      }
    }

    // Low-strength memories
    const weakMemories = entries.filter(
      (e) => calculateStrengthFromLedger(e) < 0.3,
    );
    if (weakMemories.length > 0) {
      risks.push(`${weakMemories.length} memories in weak/critical state (decay < 30%)`);
    }

    return risks.slice(0, 5);
  }

  private generateRecommendations(
    lifecycle: LifecycleStats,
    lossRanking: KnowledgeLossRanking,
    heatmap: KnowledgeHeatmap,
    departureOverview: TeamDepartureOverview,
  ): string[] {
    const recs: string[] = [];

    if (heatmap.blindSpots.length > 0) {
      const topBlind = heatmap.blindSpots[0];
      recs.push(`Address knowledge blind spot in "${topBlind.category}": ${topBlind.reason}`);
    }

    if (lossRanking.rankings.length > 0 && lossRanking.rankings[0].singlePointCount > 2) {
      const top = lossRanking.rankings[0];
      recs.push(`Prioritize knowledge transfer from ${top.displayName} (${top.singlePointCount} single points of failure)`);
    }

    if (lifecycle.strengthDistribution.weak + lifecycle.strengthDistribution.critical > 0) {
      const count = lifecycle.strengthDistribution.weak + lifecycle.strengthDistribution.critical;
      recs.push(`Review ${count} weakening memories — schedule team review sessions to refresh decay`);
    }

    if (departureOverview.teamResilienceScore < 0.6) {
      recs.push(`Team resilience is low (${(departureOverview.teamResilienceScore * 100).toFixed(0)}%) — consider cross-training and knowledge sharing sessions`);
    }

    if (heatmap.denseAreas.length > 0) {
      const top = heatmap.denseAreas[0];
      recs.push(`"${top.category}" has dense knowledge (${top.count} memories) — ensure it's distributed across ${Math.max(top.holders, 2)}+ members`);
    }

    if (recs.length === 0) {
      recs.push("Team memory health is good — continue regular review cycles");
    }

    return recs.slice(0, 5);
  }
}
