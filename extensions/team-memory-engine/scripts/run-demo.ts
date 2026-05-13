/**
 * Team Memory Engine — One-Click Demo & Evaluation Script
 *
 * Usage: npx tsx extensions/team-memory-engine/scripts/run-demo.ts
 *
 * This script:
 * 1. Seeds demo data (if not already seeded)
 * 2. Loads and displays all team memories with decay status
 * 3. Runs risk assessment and shows triggered alerts
 * 4. Builds and displays the knowledge graph summary
 * 5. Runs TMS knowledge gap analysis
 * 6. Runs departure simulation
 * 7. Generates the HTML insight report
 * 8. Prints a complete dashboard to the terminal
 *
 * No LLM API calls required — all computations use local data.
 */

import * as fs from "fs";
import * as path from "path";

const LEDGER_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-ledger.json"
);

const TMS_PATH = path.join(
  process.cwd(),
  "workspace",
  "memory",
  "tms",
  "profile.json"
);

const GRAPH_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-graph.json"
);

// ===========================================================================
// Types (mirroring storage/types.ts)
// ===========================================================================

interface LedgerClaim {
  version: number;
  value: string;
  valid_from: string;
  valid_to: string | null;
  confidence: number;
  source?: string;
  injected_by: string;
  confirmed_by: string[];
  status?: "active" | "superseded" | "conflicting";
}

interface LedgerEntry {
  id: string;
  entity: string;
  attribute: string;
  claims: LedgerClaim[];
  current_version: number;
  dependency_graph: string[];
  recall_half_life: number;
  category: string;
  tags: string[];
  teamId: string;
  access_count: number;
  createdAt: string;
  updatedAt: string;
}

interface MemberCapability {
  memberId: string;
  displayName: string;
  expertiseAreas: string[];
  knownMemoryIds: string[];
  trustScore: number;
  contributionCount: number;
  confirmationCount: number;
}

interface TeamCapabilityProfile {
  teamId: string;
  members: Record<string, MemberCapability>;
  updatedAt: string;
}

// ===========================================================================
// Core Algorithms (extracted from decay.ts, risk.ts for self-contained demo)
// ===========================================================================

const FORGETTING_CURVE_INTERVALS: number[] = [
  1 * 60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
  9 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  2 * 24 * 60 * 60 * 1000,
  6 * 24 * 60 * 60 * 1000,
  15 * 24 * 60 * 60 * 1000,
  31 * 24 * 60 * 60 * 1000,
];

const RISK_WEIGHTS = {
  timeDecay: 0.35,
  businessImpact: 0.25,
  lowCoverage: 0.20,
  versionRisk: 0.10,
  lowUsage: 0.10,
} as const;

const RISK_THRESHOLDS = {
  riskTrigger: 0.55,
  businessImpactTrigger: 0.50,
} as const;

const CATEGORY_WEIGHTS: Record<string, number> = {
  security: 1.0,
  decision: 0.8,
  api: 0.7,
  process: 0.6,
  experience: 0.5,
  general: 0.3,
} as const;

function computeDecayStrength(elapsed: number, currentInterval: number): number {
  if (currentInterval <= 0) return 1.0;
  return Math.max(0, Math.min(1, Math.pow(2, -elapsed / currentInterval)));
}

function closestIntervalIndex(targetMs: number): number {
  let bestIndex = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < FORGETTING_CURVE_INTERVALS.length; i++) {
    const diff = Math.abs(FORGETTING_CURVE_INTERVALS[i] - targetMs);
    if (diff < bestDiff) { bestDiff = diff; bestIndex = i; }
  }
  return bestIndex;
}

function calculateStrength(entry: LedgerEntry): number {
  const activeClaim = entry.claims.find(c => c.status === "active" || c.status === undefined);
  if (!activeClaim) return 0;
  const elapsed = Date.now() - new Date(activeClaim.valid_from).getTime();
  const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
  const interval = FORGETTING_CURVE_INTERVALS[closestIntervalIndex(halfLifeMs)];
  return computeDecayStrength(elapsed, interval);
}

function getStrengthLabel(strength: number): string {
  if (strength >= 0.8) return "fresh";
  if (strength >= 0.5) return "strong";
  if (strength >= 0.3) return "fading";
  if (strength >= 0.1) return "weak";
  return "critical";
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function computeBusinessImpact(entry: LedgerEntry): number {
  const categoryWeight = CATEGORY_WEIGHTS[entry.category] ?? CATEGORY_WEIGHTS.general;
  const importantTags = ["prod", "critical", "compliance", "deadline"];
  const tagCount = entry.tags.filter(t => importantTags.includes(t.toLowerCase())).length;
  const tagScore = Math.min(1.0, tagCount / 3);
  return sigmoid(0.6 * categoryWeight + 0.4 * tagScore);
}

function computeRiskScore(entry: LedgerEntry, teamSize: number): {
  totalRisk: number; timeDecay: number; businessImpact: number;
  lowCoverage: number; versionRisk: number; lowUsage: number; triggered: boolean;
} {
  const now = Date.now();
  const activeClaim = entry.claims.find(c => c.status === "active" || c.status === undefined);
  const elapsed = activeClaim ? now - new Date(activeClaim.valid_from).getTime() : 0;
  const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
  const interval = FORGETTING_CURVE_INTERVALS[closestIntervalIndex(halfLifeMs)];
  const pRecall = computeDecayStrength(elapsed, interval);
  const timeDecay = 1 - pRecall;
  const businessImpact = computeBusinessImpact(entry);

  // LowCoverage
  const confirmers = new Set<string>();
  for (const claim of entry.claims) {
    if (claim.status === "active" || claim.status === undefined) {
      for (const c of claim.confirmed_by) confirmers.add(c);
      confirmers.add(claim.injected_by);
    }
  }
  const coverage = Math.min(confirmers.size / teamSize, 1.0);
  const lowCoverage = 1 - coverage;

  // VersionRisk
  const hasConflicting = entry.claims.some(c => c.status === "conflicting");
  const versionRisk = hasConflicting ? 0.6 : entry.current_version > 2 ? 0.3 : 0.1;

  // LowUsage
  const expectedAccess = 10;
  const lowUsage = 1 - Math.min(entry.access_count / expectedAccess, 1.0);

  const totalRisk =
    RISK_WEIGHTS.timeDecay * timeDecay +
    RISK_WEIGHTS.businessImpact * businessImpact +
    RISK_WEIGHTS.lowCoverage * lowCoverage +
    RISK_WEIGHTS.versionRisk * versionRisk +
    RISK_WEIGHTS.lowUsage * lowUsage;

  const triggered = totalRisk > RISK_THRESHOLDS.riskTrigger && businessImpact > RISK_THRESHOLDS.businessImpactTrigger;

  return {
    totalRisk: Math.round(totalRisk * 1000) / 1000,
    timeDecay: Math.round(timeDecay * 1000) / 1000,
    businessImpact: Math.round(businessImpact * 1000) / 1000,
    lowCoverage: Math.round(lowCoverage * 1000) / 1000,
    versionRisk: Math.round(versionRisk * 1000) / 1000,
    lowUsage: Math.round(lowUsage * 1000) / 1000,
    triggered,
  };
}

// ===========================================================================
// Terminal UI Helpers
// ===========================================================================

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
};

function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function bold(text: string): string { return colorize(text, "bold"); }
function green(text: string): string { return colorize(text, "green"); }
function red(text: string): string { return colorize(text, "red"); }
function yellow(text: string): string { return colorize(text, "yellow"); }
function blue(text: string): string { return colorize(text, "blue"); }
function cyan(text: string): string { return colorize(text, "cyan"); }
function magenta(text: string): string { return colorize(text, "magenta"); }
function dim(text: string): string { return colorize(text, "dim"); }

function progressBar(value: number, width: number = 20): string {
  const filled = Math.round(value * width);
  const empty = width - filled;
  const color = value >= 0.7 ? green : value >= 0.4 ? yellow : red;
  return `${color("█".repeat(filled))}${dim("░".repeat(empty))}`;
}

function section(title: string): void {
  console.log("");
  console.log(`${bold("═".repeat(70))}`);
  console.log(`  ${colorize(title, "cyan")}`);
  console.log(`${bold("═".repeat(70))}`);
}

function subsection(title: string): void {
  console.log(`\n${bold("─".repeat(50))}`);
  console.log(`  ${colorize(title, "blue")}`);
  console.log(`${bold("─".repeat(50))}`);
}

// ===========================================================================
// Demo Sections
// ===========================================================================

function loadLedger(): LedgerEntry[] {
  const raw = fs.readFileSync(LEDGER_PATH, "utf-8");
  const data: Record<string, LedgerEntry> = JSON.parse(raw);
  return Object.values(data);
}

function loadTms(): TeamCapabilityProfile | null {
  try {
    const raw = fs.readFileSync(TMS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 1. System Overview
function showOverview(entries: LedgerEntry[], tms: TeamCapabilityProfile | null) {
  section("TEAM MEMORY ENGINE — System Overview");
  console.log(`  ${bold("Architecture:")}  Memory OS with Ledger + Graph + Risk + Decay + TMS`);
  console.log(`  ${bold("Total Memories:")}  ${green(entries.length.toString())}`);
  console.log(`  ${bold("Categories:")}  ${[...new Set(entries.map(e => e.category))].join(", ")}`);
  console.log(`  ${bold("Team Members:")}  ${tms ? Object.keys(tms.members).length : 0}`);
  console.log(`  ${bold("Team ID:")}  ${dim("openclaw-team")}`);
  console.log(`  ${bold("Storage:")}  ${dim(LEDGER_PATH)}`);
}

// 2. Memory Catalog
function showMemoryCatalog(entries: LedgerEntry[]) {
  section("MEMORY CATALOG — All Team Memories with Decay Status");

  const categories = ["security", "decision", "api", "process", "experience", "general"];
  const categoryIcons: Record<string, string> = {
    security: "🔒", decision: "📋", api: "🔌",
    process: "⚙️", experience: "💡", general: "📝",
  };

  for (const cat of categories) {
    const catEntries = entries.filter(e => e.category === cat);
    if (catEntries.length === 0) continue;

    const icon = categoryIcons[cat] ?? "📝";
    subsection(`${icon} ${cat.toUpperCase()} (${catEntries.length} memories)`);

    for (const entry of catEntries) {
      const strength = calculateStrength(entry);
      const label = getStrengthLabel(strength);
      const activeClaim = entry.claims.find(c => c.status === "active" || c.status === undefined);
      const value = activeClaim?.value ?? "(no active value)";
      const displayValue = value.length > 80 ? value.slice(0, 80) + "..." : value;

      const statusIcon = label === "fresh" ? green("●") : label === "strong" ? blue("●") :
        label === "fading" ? yellow("●") : label === "weak" ? colorize("●", "yellow") : red("●");
      const conflictBadge = entry.claims.some(c => c.status === "conflicting") ? red(" ⚠ CONFLICT") : "";

      const confirmers = new Set<string>();
      for (const claim of entry.claims) {
        if (claim.status === "active" || claim.status === undefined) {
          for (const c of claim.confirmed_by) confirmers.add(c);
          confirmers.add(claim.injected_by);
        }
      }

      console.log(`  ${statusIcon} ${bold(entry.id)} [v${entry.current_version}]`);
      console.log(`    ${bold(`${entry.entity}.${entry.attribute}`)}${conflictBadge}`);
      console.log(`    ${dim(displayValue)}`);
      console.log(`    Strength: ${progressBar(strength, 15)} ${(strength * 100).toFixed(0)}% (${label}) | Confirmed by: ${confirmers.size} | Accesses: ${entry.access_count}`);
      console.log("");
    }
  }
}

// 3. Risk Assessment
function showRiskAssessment(entries: LedgerEntry[]) {
  section("RISK ASSESSMENT — 5-Dimensional Forgetting Risk (Dual-Threshold)");

  const scores = entries.map(entry => ({
    entry,
    score: computeRiskScore(entry, 5),
  })).filter(s => s.score.triggered)
    .sort((a, b) => b.score.totalRisk - a.score.totalRisk);

  if (scores.length === 0) {
    console.log(`\n  ${green("✓ No triggered risk alerts. Team cognitive state is healthy.")}`);
    return;
  }

  console.log(`\n  ${bold(`${scores.length} triggered risk alert(s):`)}\n`);

  for (const { entry, score } of scores) {
    const riskColor = score.totalRisk >= 0.7 ? red : score.totalRisk >= 0.55 ? yellow : cyan;
    const activeClaim = entry.claims.find(c => c.status === "active");
    const value = activeClaim?.value?.slice(0, 60) ?? "...";

    console.log(`  ${riskColor(`▓ ${(score.totalRisk * 100).toFixed(0)}%`)} ${bold(`${entry.entity}.${entry.attribute}`)}`);
    console.log(`    Value: ${dim(value)}`);
    console.log(`    TimeDecay: ${progressBar(score.timeDecay, 10)} ${(score.timeDecay * 100).toFixed(0)}%`);
    console.log(`    BusinessImpact: ${progressBar(score.businessImpact, 10)} ${(score.businessImpact * 100).toFixed(0)}%`);
    console.log(`    LowCoverage: ${progressBar(score.lowCoverage, 10)} ${(score.lowCoverage * 100).toFixed(0)}%`);
    console.log(`    VersionRisk: ${progressBar(score.versionRisk, 10)} ${(score.versionRisk * 100).toFixed(0)}%`);
    console.log(`    LowUsage: ${progressBar(score.lowUsage, 10)} ${(score.lowUsage * 100).toFixed(0)}%`);
    console.log("");
  }
}

// 4. Decay Distribution
function showDecayDistribution(entries: LedgerEntry[]) {
  section("DECAY DISTRIBUTION — Ebbinghaus Forgetting Curve");

  let fresh = 0, strong = 0, fading = 0, weak = 0, critical = 0;
  for (const entry of entries) {
    const s = calculateStrength(entry);
    if (s >= 0.8) fresh++;
    else if (s >= 0.5) strong++;
    else if (s >= 0.3) fading++;
    else if (s >= 0.1) weak++;
    else critical++;
  }

  const total = entries.length;
  const bars: Array<{ label: string; count: number; color: string; icon: string }> = [
    { label: "Fresh (≥80%)", count: fresh, color: "green", icon: "🟢" },
    { label: "Strong (50-80%)", count: strong, color: "blue", icon: "🔵" },
    { label: "Fading (30-50%)", count: fading, color: "yellow", icon: "🟡" },
    { label: "Weak (10-30%)", count: weak, color: "yellow", icon: "🟠" },
    { label: "Critical (<10%)", count: critical, color: "red", icon: "🔴" },
  ];

  for (const bar of bars) {
    const pct = bar.count / total;
    console.log(`  ${bar.icon} ${bold(bar.label.padEnd(22))} ${colorize(bar.count.toString(), bar.color as keyof typeof COLORS).padStart(3)}  ${progressBar(pct)}`);
  }
}

// 5. Conflict Detection
function showConflicts(entries: LedgerEntry[]) {
  section("CONFLICT DETECTION — Version Chain with Conflicting Claims");

  const conflictEntries = entries.filter(e => e.claims.some(c => c.status === "conflicting"));

  if (conflictEntries.length === 0) {
    console.log(`\n  ${green("✓ No conflicts detected.")}`);
    return;
  }

  for (const entry of conflictEntries) {
    console.log(`\n  ${red("⚠ CONFLICT")} ${bold(`${entry.entity}.${entry.attribute}`)} (${entry.id})`);
    for (const claim of entry.claims) {
      if (claim.status === "active" || claim.status === "conflicting") {
        const statusColor = claim.status === "conflicting" ? red : green;
        const statusLabel = claim.status === "conflicting" ? "CONFLICTING" : "active";
        console.log(`    ${statusColor(`v${claim.version}`)} [${statusLabel}] ${dim(claim.value.slice(0, 70))}`);
        console.log(`      Confidence: ${(claim.confidence * 100).toFixed(0)}% | By: ${claim.injected_by.slice(0, 8)} | ${claim.valid_from.slice(0, 10)}`);
      }
    }
    console.log(`  ${dim("Resolution: Click Still Valid / Update / Dismiss on the Feishu card")}`);
  }
}

// 6. TMS Analysis
function showTMS(tms: TeamCapabilityProfile | null, entries: LedgerEntry[]) {
  if (!tms) return;

  section("TRANSACTIVE MEMORY SYSTEM — Who Knows What");

  const members = Object.values(tms.members);

  subsection("Team Members & Expertise");
  for (const m of members) {
    console.log(`  ${bold(m.displayName.padEnd(12))} Trust: ${progressBar(m.trustScore, 10)} ${(m.trustScore * 100).toFixed(0)}%`);
    console.log(`  ${dim("             ")}Expertise: ${m.expertiseAreas.join(", ")}`);
    console.log(`  ${dim("             ")}Known memories: ${m.knownMemoryIds.length} | Contributions: ${m.contributionCount} | Confirmations: ${m.confirmationCount}`);
    console.log("");
  }

  // Single points of failure
  subsection("Knowledge Gaps — Single Points of Failure");
  const gaps: Array<{ entry: LedgerEntry; holder: string }> = [];
  for (const entry of entries) {
    const holders = new Set<string>();
    for (const claim of entry.claims) {
      holders.add(claim.injected_by);
      for (const c of claim.confirmed_by) holders.add(c);
    }
    // Filter to holders in TMS
    const validHolders = [...holders].filter(h => tms.members[h]);
    if (validHolders.length === 1) {
      gaps.push({ entry, holder: validHolders[0] });
    }
  }

  if (gaps.length === 0) {
    console.log(`  ${green("✓ No single points of failure.")}`);
  } else {
    const topGaps = gaps.slice(0, 8);
    for (const { entry, holder } of topGaps) {
      const memberName = tms.members[holder]?.displayName ?? holder.slice(0, 8);
      const strength = calculateStrength(entry);
      console.log(`  ${yellow("⚠")} ${bold(`${entry.entity}.${entry.attribute}`)}`);
      console.log(`    Only known by: ${red(memberName)} | Risk: ${strength < 0.5 ? red("HIGH") : yellow("MEDIUM")} | Decay: ${(strength * 100).toFixed(0)}%`);
    }
    if (gaps.length > 8) {
      console.log(`  ${dim(`... and ${gaps.length - 8} more`)} `);
    }
  }
}

// 7. Departure Simulation
function showDepartureSimulation(tms: TeamCapabilityProfile | null, entries: LedgerEntry[]) {
  if (!tms) return;

  section("DEPARTURE SIMULATION — Knowledge Loss Risk Analysis");

  const members = Object.values(tms.members);

  // Find worst case
  let worstMember: { name: string; loss: number; singlePoints: number } | null = null;

  for (const member of members) {
    let singlePoints = 0;
    for (const entry of entries) {
      const holders = new Set<string>();
      for (const claim of entry.claims) {
        holders.add(claim.injected_by);
        for (const c of claim.confirmed_by) holders.add(c);
      }
      const validHolders = [...holders].filter(h => tms.members[h]);
      if (validHolders.length === 1 && validHolders[0] === member.memberId) {
        singlePoints++;
      }
    }
    const lossPct = member.knownMemoryIds.length > 0
      ? Math.round((singlePoints / entries.length) * 1000) / 10
      : 0;

    if (!worstMember || lossPct > worstMember.loss) {
      worstMember = { name: member.displayName, loss: lossPct, singlePoints };
    }
  }

  if (worstMember) {
    console.log(`\n  ${red("⚠ Worst Case:")} If ${bold(red(worstMember.name))} leaves the team:`);
    console.log(`    - ${bold(worstMember.singlePoints.toString())} knowledge(s) would be lost (only they knew)`);
    console.log(`    - ${bold(`${worstMember.loss}%`)} of total knowledge base at risk`);
    console.log(`\n  ${cyan("Recommendation:")} Prioritize knowledge sharing sessions for ${worstMember.name}`);
  }

  // All members comparison
  subsection("Departure Impact Comparison");
  console.log(`  ${bold("Member".padEnd(12))} ${"Known".padStart(8)} ${"Single Points".padStart(12)} ${"Risk Level".padStart(12)}`);
  console.log(`  ${"─".repeat(48)}`);
  for (const member of members) {
    let singlePoints = 0;
    for (const entry of entries) {
      const holders = new Set<string>();
      for (const claim of entry.claims) {
        holders.add(claim.injected_by);
        for (const c of claim.confirmed_by) holders.add(c);
      }
      const validHolders = [...holders].filter(h => tms.members[h]);
      if (validHolders.length === 1 && validHolders[0] === member.memberId) {
        singlePoints++;
      }
    }
    const riskLevel = singlePoints >= 3 ? red("Critical") : singlePoints >= 1 ? yellow("Warning") : green("Safe");
    console.log(`  ${member.displayName.padEnd(12)} ${member.knownMemoryIds.toString().length > 0 ? String(member.knownMemoryIds.length).padStart(8) : "0".padStart(8)} ${String(singlePoints).padStart(12)} ${riskLevel.padStart(12)}`);
  }
}

// 8. Graph Summary
function showGraphSummary(entries: LedgerEntry[]) {
  section("MEMORY GRAPH — Cognitive Relationship Network");

  // Count relationships
  const entitySet = new Set<string>();
  const depCount = entries.reduce((sum, e) => sum + (e.dependency_graph?.length ?? 0), 0);

  for (const entry of entries) {
    entitySet.add(entry.entity);
  }

  console.log(`  ${bold("Entity Nodes:")}  ${entitySet.size}`);
  console.log(`  ${bold("Attribute Nodes:")}  ${entries.length}`);
  console.log(`  ${bold("Dependency Edges:")}  ${depCount}`);

  if (depCount > 0) {
    subsection("Dependency Relationships");
    for (const entry of entries) {
      if (entry.dependency_graph && entry.dependency_graph.length > 0) {
        for (const targetId of entry.dependency_graph) {
          const target = entries.find(e => e.id === targetId);
          if (target) {
            console.log(`  ${dim("→")} ${bold(`${entry.entity}.${entry.attribute}`)} ${blue("depends on")} ${bold(`${target.entity}.${target.attribute}`)}`);
          }
        }
      }
    }
  }
}

// 9. Generate HTML report
async function generateHtmlReport(entries: LedgerEntry[], tms: TeamCapabilityProfile | null) {
  section("GENERATING HTML INSIGHT REPORT");

  const reportPath = path.join(process.cwd(), "team-memory-report.html");

  // Build a minimal report using the html-report.ts renderer
  // For the demo, we'll generate a self-contained HTML file

  const categoryColors: Record<string, string> = {
    security: "#ef4444", decision: "#f59e0b", api: "#3b82f6",
    process: "#10b981", experience: "#8b5cf6", general: "#6b7280",
  };

  // Compute stats
  const totalMemories = entries.length;
  const strengths = entries.map(e => calculateStrength(e));
  const avgStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length;

  let fresh = 0, strong = 0, fading = 0, weak = 0, critical = 0;
  for (const s of strengths) {
    if (s >= 0.8) fresh++;
    else if (s >= 0.5) strong++;
    else if (s >= 0.3) fading++;
    else if (s >= 0.1) weak++;
    else critical++;
  }

  const risks = entries.map(e => computeRiskScore(e, 5));
  const triggered = risks.filter(r => r.triggered);
  const avgRisk = risks.reduce((a, b) => a + b.totalRisk, 0) / risks.length;

  const memberCount = tms ? Object.keys(tms.members).length : 0;
  const conflictCount = entries.filter(e => e.claims.some(c => c.status === "conflicting")).length;

  const healthScore = Math.round(
    (0.30 * avgStrength + 0.25 * 0.7 + 0.25 * (1 - avgRisk) + 0.20 * (1 - conflictCount / totalMemories)) * 100
  );

  const today = new Date().toISOString();
  const memberRows = tms ? Object.values(tms.members).map(m => {
    let singlePoints = 0;
    for (const entry of entries) {
      const holders = new Set<string>();
      for (const claim of entry.claims) {
        holders.add(claim.injected_by);
        for (const c of claim.confirmed_by) holders.add(c);
      }
      const validHolders = [...holders].filter(h => tms.members[h]);
      if (validHolders.length === 1 && validHolders[0] === m.memberId) singlePoints++;
    }
    return `<tr><td style="font-weight:600">${m.displayName}</td><td>${m.knownMemoryIds.length}</td><td style="color:${singlePoints > 2 ? '#ef4444' : singlePoints > 0 ? '#f59e0b' : '#10b981'}; font-weight:600">${singlePoints}</td><td>${(m.trustScore * 100).toFixed(0)}%</td></tr>`;
  }).join("\n") : "";

  const categoryRows = [...new Set(entries.map(e => e.category))].map(cat => {
    const catEntries = entries.filter(e => e.category === cat);
    const catStrengths = catEntries.map(e => calculateStrength(e));
    const avgS = catStrengths.reduce((a, b) => a + b, 0) / catStrengths.length;
    const catRisks = catEntries.map(e => computeRiskScore(e, 5));
    const avgR = catRisks.reduce((a, b) => a + b.totalRisk, 0) / catRisks.length;
    const color = categoryColors[cat] ?? "#6b7280";
    return `<tr><td><span style="color:${color}">●</span> ${cat}</td><td style="font-weight:600">${catEntries.length}</td><td>${(avgS * 100).toFixed(0)}%</td><td style="color:${avgR > 0.5 ? '#ef4444' : '#10b981'}; font-weight:600">${(avgR * 100).toFixed(0)}%</td></tr>`;
  }).join("\n");

  const memoryRows = entries.map(entry => {
    const strength = calculateStrength(entry);
    const label = getStrengthLabel(strength);
    const activeClaim = entry.claims.find(c => c.status === "active" || c.status === undefined);
    const risk = computeRiskScore(entry, 5);
    const strengthColor2 = strength >= 0.8 ? "#10b981" : strength >= 0.5 ? "#3b82f6" : strength >= 0.3 ? "#f59e0b" : strength >= 0.1 ? "#f97316" : "#ef4444";
    const riskColor2 = risk.totalRisk > 0.55 ? "#ef4444" : risk.totalRisk > 0.3 ? "#f59e0b" : "#10b981";
    const value = activeClaim?.value?.slice(0, 80) ?? "...";
    const catColor = categoryColors[entry.category] ?? "#6b7280";
    return `<tr><td style="font-family:monospace;font-size:0.85rem">${entry.id}</td><td style="font-weight:600">${entry.entity}.${entry.attribute}</td><td style="font-size:0.85rem;color:#94a3b8">${value}</td><td><span style="color:${catColor}">●</span> ${entry.category}</td><td>v${entry.current_version}</td><td style="color:${strengthColor2}; font-weight:600">${(strength * 100).toFixed(0)}%</td><td style="color:${riskColor2}; font-weight:600">${(risk.totalRisk * 100).toFixed(0)}%</td></tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Team Memory Insight Report</title>
<style>
:root { --bg:#0f172a; --surface:#1e293b; --surface2:#334155; --text:#f1f5f9; --text-dim:#94a3b8; --border:#475569; --accent:#3b82f6; --green:#10b981; --amber:#f59e0b; --red:#ef4444; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:2rem; }
.container { max-width:1400px; margin:0 auto; }
h1 { font-size:2rem; margin-bottom:0.5rem; }
h2 { font-size:1.4rem; margin:2rem 0 1rem; color:var(--accent); border-bottom:1px solid var(--border); padding-bottom:0.5rem; }
h3 { font-size:1.1rem; margin-bottom:0.5rem; color:var(--text-dim); }
.subtitle { color:var(--text-dim); margin-bottom:2rem; }
.grid { display:grid; gap:1.5rem; }
.grid-4 { grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); }
.grid-2 { grid-template-columns:repeat(auto-fit,minmax(500px,1fr)); }
.card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:1.5rem; }
.card-accent { border-left:4px solid var(--accent); }
.card-green { border-left:4px solid var(--green); }
.card-amber { border-left:4px solid var(--amber); }
.card-red { border-left:4px solid var(--red); }
.stat-value { font-size:2.5rem; font-weight:700; }
.stat-label { color:var(--text-dim); font-size:0.85rem; }
table { width:100%; border-collapse:collapse; margin-top:0.5rem; }
th, td { padding:0.5rem 0.8rem; text-align:left; border-bottom:1px solid var(--border); font-size:0.85rem; }
th { color:var(--text-dim); font-weight:500; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; }
tr:hover { background:var(--surface2); }
.badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600; }
.badge-green { background:rgba(16,185,129,0.15); color:var(--green); }
.badge-amber { background:rgba(245,158,11,0.15); color:var(--amber); }
.badge-red { background:rgba(239,68,68,0.15); color:var(--red); }
</style>
</head>
<body>
<div class="container">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem">
    <div>
      <h1 style="background:linear-gradient(135deg,var(--accent),#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Team Memory Insight Report</h1>
      <p class="subtitle">Generated: ${new Date().toLocaleString('zh-CN')} | Team: openclaw-team</p>
    </div>
    <div style="text-align:right">
      <div class="stat-value" style="color:${healthScore >= 70 ? 'var(--green)' : healthScore >= 50 ? 'var(--amber)' : 'var(--red)'}">${healthScore}</div>
      <div class="stat-label">Team Health Score / 100</div>
    </div>
  </div>

  <div class="grid grid-4" style="margin-bottom:2rem">
    <div class="card card-accent"><div class="stat-value">${totalMemories}</div><div class="stat-label">Total Memories</div></div>
    <div class="card ${avgStrength >= 0.5 ? 'card-green' : avgStrength >= 0.3 ? 'card-amber' : 'card-red'}"><div class="stat-value">${(avgStrength * 100).toFixed(0)}%</div><div class="stat-label">Avg Memory Strength</div></div>
    <div class="card ${avgRisk <= 0.3 ? 'card-green' : avgRisk <= 0.5 ? 'card-amber' : 'card-red'}"><div class="stat-value">${(avgRisk * 100).toFixed(0)}%</div><div class="stat-label">Avg Risk Score</div></div>
    <div class="card card-accent"><div class="stat-value">${memberCount}</div><div class="stat-label">Team Members</div></div>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <h3>Strength Distribution</h3>
      <p><span class="badge badge-green">Fresh: ${fresh}</span> <span class="badge badge-green">Strong: ${strong}</span> <span class="badge badge-amber">Fading: ${fading}</span> <span class="badge badge-amber">Weak: ${weak}</span> <span class="badge badge-red">Critical: ${critical}</span></p>
    </div>
    <div class="card">
      <h3>System Stats</h3>
      <p>Conflicts: ${conflictCount > 0 ? `<span class="badge badge-red">${conflictCount}</span>` : '<span class="badge badge-green">0</span>'}</p>
      <p>Risk Alerts: ${triggered.length > 0 ? `<span class="badge badge-red">${triggered.length}</span>` : '<span class="badge badge-green">0</span>'}</p>
      <p>Categories: ${[...new Set(entries.map(e => e.category))].length}</p>
    </div>
  </div>

  <h2>🔒 Risk Alerts</h2>
  <div class="card">
    ${triggered.length > 0
      ? `<table><tr><th>Memory</th><th>Entity.Attribute</th><th>Total Risk</th><th>TimeDecay</th><th>BusinessImpact</th><th>LowCoverage</th></tr>` +
        triggered.slice(0, 10).map((r, i) => {
          const entry = entries.find(e => e.id === r.memoryId);
          if (!entry) return "";
          return `<tr><td>${entry.id}</td><td style="font-weight:600">${entry.entity}.${entry.attribute}</td><td style="color:#ef4444;font-weight:600">${(r.totalRisk * 100).toFixed(0)}%</td><td>${(r.timeDecay * 100).toFixed(0)}%</td><td>${(r.businessImpact * 100).toFixed(0)}%</td><td>${(r.lowCoverage * 100).toFixed(0)}%</td></tr>`;
        }).filter(Boolean).join("") + `</table>`
      : '<p style="color:var(--green)">✓ No critical risk alerts.</p>'
    }
  </div>

  <h2>📊 Category Breakdown</h2>
  <div class="card">
    <table><tr><th>Category</th><th>Count</th><th>Avg Strength</th><th>Avg Risk</th></tr>${categoryRows}</table>
  </div>

  <h2>👥 Team Members — Knowledge Distribution</h2>
  <div class="card">
    <table><tr><th>Member</th><th>Known Memories</th><th>Single Points</th><th>Trust Score</th></tr>${memberRows}</table>
  </div>

  <h2>📋 Complete Memory Inventory</h2>
  <div class="card" style="overflow-x:auto">
    <table><tr><th>ID</th><th>Entity.Attribute</th><th>Value</th><th>Category</th><th>Version</th><th>Strength</th><th>Risk</th></tr>${memoryRows}</table>
  </div>

</div>
</body>
</html>`;

  await fs.promises.writeFile(reportPath, html, "utf-8");
  console.log(`\n  ✅ HTML report generated: ${reportPath}`);
  console.log(`  ${dim("Open this file in a browser to view the full dashboard.")}`);
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  console.log("\n");
  console.log(`${colorize("██╗    ██╗███████╗██████╗ ███████╗███████╗ ██████╗ ███╗   ██╗", "cyan")}`);
  console.log(`${colorize("██║    ██║██╔════╝██╔══██╗██╔════╝██╔════╝██╔═══██╗████╗  ██║", "cyan")}`);
  console.log(`${colorize("██║ █╗ ██║█████╗  ██████╔╝███████╗█████╗  ██║   ██║██╔██╗ ██║", "cyan")}`);
  console.log(`${colorize("██║███╗██║██╔══╝  ██╔══██╗╚════██║██╔══╝  ██║   ██║██║╚██╗██║", "cyan")}`);
  console.log(`${colorize("╚███╔███╔╝███████╗██████╔╝███████║███████╗╚██████╔╝██║ ╚████║", "cyan")}`);
  console.log(`${colorize(" ╚══╝╚══╝ ╚══════╝╚═════╝ ╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝", "cyan")}`);
  console.log(`${colorize("                          MEMORY ENGINE DEMO", "bold")}`);
  console.log(`${dim("                " + "═".repeat(50))}\n`);

  // Check if data exists
  let entries: LedgerEntry[];
  try {
    entries = loadLedger();
  } catch {
    console.log(`${yellow("⚠ No data found. Running seeder first...")}\n`);
    // Run seeder
    const { execSync } = await import("child_process");
    execSync("npx tsx extensions/team-memory-engine/scripts/seed-demo-data.ts", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    entries = loadLedger();
  }

  const tms = loadTms();

  showOverview(entries, tms);
  showDecayDistribution(entries);
  showMemoryCatalog(entries);
  showRiskAssessment(entries);
  showConflicts(entries);
  showTMS(tms, entries);
  showDepartureSimulation(tms, entries);
  showGraphSummary(entries);

  await generateHtmlReport(entries, tms);

  section("DEMO COMPLETE");
  console.log(`\n  ${green("✓ All systems operational")}`);
  console.log(`  ${dim("Next steps:")}`);
  console.log(`  1. Open the HTML report in a browser`);
  console.log(`  2. Run CLI commands: openclaw team-memory status/risk/graph`);
  console.log(`  3. Send a message to the Feishu bot to test proactive capture`);
  console.log(`\n${dim("─".repeat(70))}\n`);
}

main().catch(err => {
  console.error(`\n${red("✗ Error:")} ${err}`);
  process.exit(1);
});
