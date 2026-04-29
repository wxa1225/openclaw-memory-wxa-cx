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

export const RISK_WEIGHTS = {
  timeDecay: 0.35,
  businessImpact: 0.25,
  lowCoverage: 0.20,
  versionRisk: 0.10,
  lowUsage: 0.10,
} as const;

export const RISK_THRESHOLDS = {
  riskTrigger: 0.55,
  businessImpactTrigger: 0.50,
} as const;

export const CATEGORY_WEIGHTS: Record<string, number> = {
  security: 1.0,
  decision: 0.8,
  api: 0.7,
  process: 0.6,
  experience: 0.5,
  general: 0.3,
} as const;

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
