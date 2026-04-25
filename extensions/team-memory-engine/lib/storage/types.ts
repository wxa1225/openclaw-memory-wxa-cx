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
}
