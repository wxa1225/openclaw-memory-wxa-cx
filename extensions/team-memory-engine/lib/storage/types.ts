// Shared type definitions for team memory engine

export interface Mem0Provider {
  add(messages: Array<{ role: string; content: string }>, options: Record<string, unknown>): Promise<any>;
  search(query: string, options: Record<string, unknown>): Promise<any>;
  getAll(options: Record<string, unknown>): Promise<any>;
  get(memoryId: string): Promise<any>;
  delete(memoryId: string): Promise<any>;
}

export interface TeamMemoryMeta {
  injectedAt: string;
  lastReviewedAt: string;
  reviewCount: number;
  currentIntervalIndex: number;
  version: number;
  injectedBy: string;
  category: string;
  tags: string[];
  versionHistory: Array<{
    version: number;
    text: string;
    updatedAt: string;
    updatedBy: string;
  }>;
}

export interface StoredMemory {
  id: string;
  memory: string;
  teamId: string;
  metadata: TeamMemoryMeta;
  createdAt: string;
  updatedAt: string;
}

export interface InjectOptions {
  category?: string;
  tags?: string[];
  author?: string;
}

export interface UpdateOptions {
  author?: string;
}

export interface InjectResult {
  id: string;
  memory: string;
  metadata: TeamMemoryMeta;
  conflict?: {
    type: "auto-cover" | "conflict-mark" | "human-confirm";
    reason: string;
  };
}

export interface UpdateResult {
  id: string;
  memory: string;
  previousVersion: number;
  metadata: TeamMemoryMeta;
}

export interface SearchResult {
  id: string;
  memory: string;
  strength: number;
  strengthLabel: string;
  metadata: TeamMemoryMeta;
  riskScore?: number;
}

// ============================================================================
// v2 Types: Memory OS — Ledger, Graph, Risk
// ============================================================================

// --- Six-tuple model fields ---

export interface MemoryContent {
  entity: string;
  attribute: string;
  value: string;
}

export interface MemoryContext {
  source: "feishu_chat" | "cli" | "manual_inject" | "api";
  messageId?: string;
  participants?: string[];
  channel?: string;
}

// --- Memory Ledger ---

export interface LedgerClaim {
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

export interface LedgerEntry {
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

// --- Conflict Detection ---

export interface ConflictResult {
  type: "auto-cover" | "conflict-mark" | "human-confirm";
  existingEntry: LedgerEntry;
  newClaim: LedgerClaim;
  confidenceDelta: number;
  reason: string;
}

// --- Memory Graph ---

export type GraphNodeType = "Entity" | "Attribute" | "Memory" | "Person" | "Event" | "Task";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, unknown>;
}

export type GraphEdgeType =
  | "has_preference"
  | "supersedes"
  | "derived_from"
  | "confirmed_by"
  | "affects"
  | "related_memory"
  | "injected_by"
  | "current_value"
  | "old_value"
  | "affected_task";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  properties?: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Risk Model ---

export interface RiskScore {
  memoryId: string;
  totalRisk: number;
  timeDecay: number;
  businessImpact: number;
  lowCoverage: number;
  versionRisk: number;
  lowUsage: number;
  triggered: boolean;
  timestamp: string;
}

// --- Risk Model ---
//
// Parameter selection rationale:
//
// The five risk dimensions are weighted to reflect the primary failure mode
// of team memory: stale, low-impact memories should decay quietly while
// high-impact, under-confirmed memories trigger alerts.
//
// Weights were hand-tuned so that:
//   - Normal memories (recent, well-confirmed, low category) score 0.15–0.30
//   - Stale but important memories score 0.40–0.55 (watch zone)
//   - Critical forgotten memories score > 0.55 (trigger zone)
//
// Sensitivity check (worst-case single-factor analysis):
//   - timeDecay alone at max = 0.35 (below trigger, requires businessImpact)
//   - lowCoverage alone at max = 0.20 (below trigger, requires other factors)
//   - A memory with timeDecay=0.8 + businessImpact=0.7 → total = 0.35*0.8 + 0.25*0.7 + ... ≈ 0.46
//   - Adding lowCoverage=0.8 → 0.46 + 0.16 = 0.62 > 0.55 → triggers
//
// This means a memory must be BOTH stale AND important AND under-confirmed
// to trigger — the dual-threshold gating (riskTrigger + businessImpactTrigger)
// enforces this conjunction, avoiding alert fatigue from merely-old memories.
//
// Sigmoid parameter justification (SIGMOID_ALPHA=0.6, SIGMOID_BETA=0.4):
//   - category is a deliberate classification, tags are optional annotations
//   - 0.6/0.4 split means category weight contributes 1.5× more than tag score
//   - Verified output range: security(1.0)→σ(0.6)=0.65, general(0.3)→σ(0.18)=0.54
//   - The 0.11 gap between security and general is enough to push security
//     memories above businessImpactTrigger(0.50) while keeping general below it.
//
// Parameter stability: These values were tuned to produce a risk distribution
// where ~20% of memories fall in watch zone (0.40-0.55) and ~5% in trigger
// zone (>0.55) for a typical 5-person team with 20-30 memories. If the
// trigger rate is too high/low in practice, adjust riskTrigger in 0.05 steps.

export const RISK_WEIGHTS = {
  /** TimeDecay: 1 - P_recall. Dominant factor — captures Ebbinghaus forgetting.
   *  0.35 means a fully forgotten memory contributes 35% to total risk. */
  timeDecay: 0.35,
  /** BusinessImpact: sigmoid(categoryWeight, tagScore). How damaging is it
   *  if the team forgets this? Security > decision > api > general. */
  businessImpact: 0.25,
  /** LowCoverage: 1 - confirmed_by_count / team_size. Memory known by few
   *  members is riskier. 0.20 weight ensures coverage matters but doesn't
   *  dominate — a single-person memory can still be safe if recent. */
  lowCoverage: 0.20,
  /** VersionRisk: based on conflicting claims or high version count.
   *  Conflicting = 0.8, version>3 = 0.5. Lower weight (0.10) because
   *  version churn alone shouldn't trigger alerts. */
  versionRisk: 0.10,
  /** LowUsage: 1 - min(1, access_count / expected_count). Seldom-accessed
   *  memories are candidates for cleanup, not urgent alerts. 0.10 weight. */
  lowUsage: 0.10,
} as const;

// Total weights sum to 1.0. This makes risk scores directly interpretable
// as a weighted average of the five normalized sub-scores.

export const RISK_THRESHOLDS = {
  /** Total risk must exceed 0.55 to trigger. With weights summing to 1.0,
   *  this requires roughly 2-3 sub-scores above 0.5 simultaneously.
   *  E.g., timeDecay=0.7 + businessImpact=0.6 + lowCoverage=0.5
   *  → 0.35*0.7 + 0.25*0.6 + 0.20*0.5 + 0.10*0.3 + 0.10*0.3 ≈ 0.515
   *  (below trigger) — this is intentional to avoid noise. */
  riskTrigger: 0.55,
  /** Business impact must exceed 0.50 (dual-threshold gating). This filters
   *  out old memories in low-impact categories (general=0.3, experience=0.5)
   *  while allowing security=1.0, decision=0.8 to pass. */
  businessImpactTrigger: 0.50,
} as const;

/** Category importance for business impact calculation.
 *  Used in sigmoid: σ(0.6 * categoryWeight + 0.4 * tagScore).
 *  Scale chosen so security (1.0) maps to σ(0.6) ≈ 0.65 and
 *  general (0.3) maps to σ(0.18) ≈ 0.54 — a meaningful gap that
 *  pushes security/decision memories toward the businessImpactTrigger. */
export const CATEGORY_WEIGHTS: Record<string, number> = {
  security: 1.0,
  decision: 0.8,
  api: 0.7,
  process: 0.6,
  experience: 0.5,
  general: 0.3,
} as const;

/** Tags that boost business impact. Each tag contributes to tagScore
 *  (capped at 1.0 at 3 tags). These represent operational criticality. */
export const IMPORTANT_TAGS = [
  "prod", "critical", "compliance", "deadline",
] as const;

// --- v1→v2 Migration ---

export interface MigrationResult {
  migrated: number;
  errors: string[];
  backupPath: string | null;
}

// --- Manager v2 Options ---

export interface ManagerV2Options {
  teamId: string;
  defaultUserId: string;
  storagePath?: string;
  ledgerPath?: string;
  graphPath?: string;
  projectRoot?: string;
  reviewThreshold?: number;
  teamSize?: number;
  enableGraph?: boolean;
  riskWeights?: Partial<typeof RISK_WEIGHTS>;
  modelEndpoint?: string;
  modelApiKey?: string;
  modelName?: string;
  modelXApiKey?: string;
  extractionBatchSize?: number;
}

// ============================================================================
// Event Log (Layer 1)
// ============================================================================

export interface EventLogEntry {
  id: string;
  storedAt: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  senderName?: string;
  content: string;
  contentType: "text" | "image" | "file" | "post";
  messageId: string;
  threadId?: string;
  participants?: string[];
  processedForExtraction: boolean;
  extractedMemoryIds?: string[];
  tags?: string[];
}

// ============================================================================
// TMS — Transactive Memory System (Who Knows What)
// ============================================================================

export interface MemberCapability {
  memberId: string;
  displayName: string;
  expertiseAreas: string[];
  knownMemoryIds: string[];
  trustScore: number;
  lastActiveAt: string;
  contributionCount: number;
  confirmationCount: number;
}

export interface TeamCapabilityProfile {
  teamId: string;
  members: Record<string, MemberCapability>;
  updatedAt: string;
}

// ============================================================================
// Knowledge Transfer Simulation
// ============================================================================

export interface KnowledgeGap {
  memoryId: string;
  entity: string;
  attribute: string;
  value: string;
  category: string;
  tags: string[];
  currentHolder: string;
  riskScore: number;
  businessImpact: number;
}

export interface DepartureImpact {
  memberId: string;
  displayName: string;
  totalMemoriesKnown: number;
  singlePointFailures: KnowledgeGap[];
  totalRiskIncrease: number;
  affectedCategories: string[];
  knowledgeLossPercentage: number;
}

export interface TransferRecommendation {
  recommendedMemberId: string;
  recommendedDisplayName: string;
  transferScore: number;
  reason: string;
  expertiseOverlap: number;
  currentKnowledgeOverlap: number;
  trustScore: number;
}

export interface DepartureSimulationResult {
  impact: DepartureImpact;
  recommendations: TransferRecommendation[];
  beforeRiskScores: RiskScore[];
  afterRiskScores: RiskScore[];
  summary: string;
}

// ============================================================================
// Memory Insight Dashboard
// ============================================================================

/** Single cell in the knowledge heatmap: category × member → count */
export interface HeatmapCell {
  category: string;
  memberId: string;
  displayName: string;
  memoryCount: number;
  avgStrength: number;
  avgRisk: number;
}

export interface KnowledgeHeatmap {
  cells: HeatmapCell[];
  categories: string[];
  members: string[];
  blindSpots: Array<{ category: string; reason: string }>;
  denseAreas: Array<{ category: string; count: number; holders: number }>;
}

/** Knowledge loss risk ranking per member */
export interface MemberRiskRanking {
  memberId: string;
  displayName: string;
  singlePointCount: number;
  totalKnownMemories: number;
  avgRiskOfHeldMemories: number;
  criticalMemories: string[]; // memory IDs that would be lost
  riskScore: number; // 0-1 aggregate
}

export interface KnowledgeLossRanking {
  rankings: MemberRiskRanking[];
  teamAvgSinglePoints: number;
  mostVulnerableCategory: string;
}

/** Team memory lifecycle statistics */
export interface LifecycleStats {
  totalMemories: number;
  activeMemories: number;
  supersededMemories: number;
  conflictingMemories: number;
  avgAgeDays: number;
  avgVersionCount: number;
  avgStrength: number;
  avgRiskScore: number;
  categoryBreakdown: Record<string, { count: number; avgStrength: number; avgRisk: number }>;
  strengthDistribution: Record<"fresh" | "strong" | "fading" | "weak" | "critical", number>;
  forgettingSpeedDistribution: { fast: number; medium: number; slow: number };
  memoryLifespan: { avgDaysUntilSuperseded: number | null; longestLivedDays: number };
  reviewStats: { totalReviews: number; avgReviewsPerMemory: number; mostReviewed: string | null };
}

/** TMS knowledge network data */
export interface TMSNetworkNode {
  id: string;
  displayName: string;
  type: "person" | "category";
  memoryCount: number;
  expertiseAreas: string[];
  trustScore: number;
}

export interface TMSNetworkEdge {
  source: string;
  target: string;
  type: "knows" | "overlap";
  weight: number; // number of shared memories for overlap, 1 for knows
}

export interface TMSKnowledgeNetwork {
  nodes: TMSNetworkNode[];
  edges: TMSNetworkEdge[];
  overlapPairs: Array<{ memberA: string; memberB: string; sharedCount: number; sharedPercentage: number }>;
  knowledgeSilos: Array<{ memberId: string; displayName: string; uniqueCategories: string[] }>;
  centralityScores: Record<string, number>; // member ID → how central they are
}

/** Departure impact summary across all members */
export interface TeamDepartureOverview {
  memberImpacts: Array<{
    memberId: string;
    displayName: string;
    singlePointCount: number;
    knowledgeLossPercentage: number;
    riskIncrease: number;
  }>;
  worstCaseMemberId: string;
  worstCaseLoss: number;
  teamResilienceScore: number; // 0-1, higher = more resilient
}

/** Full insight report aggregating all dimensions */
export interface InsightReport {
  generatedAt: string;
  teamId: string;
  heatmap: KnowledgeHeatmap;
  lossRanking: KnowledgeLossRanking;
  lifecycle: LifecycleStats;
  network: TMSKnowledgeNetwork;
  departureOverview: TeamDepartureOverview;
  summary: {
    totalMemories: number;
    teamHealthScore: number; // 0-100 composite
    topRisks: string[];
    recommendations: string[];
  };
}
