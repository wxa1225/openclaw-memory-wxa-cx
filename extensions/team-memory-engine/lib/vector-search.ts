// Vector Semantic Search — embedding-based retrieval combined with keyword scoring
//
// Uses an OpenAI-compatible /embeddings endpoint to generate dense vectors for each
// ledger entry and the search query. At search time, combines keyword score with
// cosine similarity for hybrid retrieval.
//
// Configuration:
// - embeddingEndpoint: URL of the embedding API (e.g., "https://innerapi.../embeddings")
// - embeddingApiKey: API key for authentication
// - embeddingModel: Model name (e.g., "text-embedding-3-small")
// - keywordWeight: Weight for keyword score in hybrid search (default 0.4)
// - embeddingWeight: Weight for embedding similarity (default 0.6)

import type { LedgerEntry } from "./storage/types.js";

export interface EmbeddingConfig {
  embeddingEndpoint: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingXApiKey?: string;
  keywordWeight?: number;
  embeddingWeight?: number;
  /** Cache size for query embeddings (LRU, default 500) */
  cacheSize?: number;
}

/** Simple LRU cache for embeddings */
class EmbeddingCache {
  private cache = new Map<string, number[]>();
  private maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  get(key: string): number[] | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: number[]): void {
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Search result with both keyword and embedding scores */
export interface VectorSearchResult {
  entry: LedgerEntry;
  keywordScore: number;
  embeddingScore: number;
  combinedScore: number;
}

/**
 * Embedding-based semantic search for the Team Memory Engine.
 * Can be used standalone or combined with keyword search.
 */
export class VectorSearch {
  private config: EmbeddingConfig;
  private cache: EmbeddingCache;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.cache = new EmbeddingCache(config.cacheSize ?? 500);
  }

  /** Generate embedding for a single text */
  async embed(text: string): Promise<number[]> {
    // Check cache first
    const cached = this.cache.get(text);
    if (cached) return cached;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.embeddingApiKey}`,
    };
    if (this.config.embeddingXApiKey) {
      headers["x-api-key"] = this.config.embeddingXApiKey;
    }

    const response = await fetch(this.config.embeddingEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const embedding: number[] = data.data?.[0]?.embedding ?? data.embedding;
    if (!embedding) throw new Error("No embedding in API response");

    this.cache.set(text, embedding);
    return embedding;
  }

  /**
   * Hybrid search: combines keyword scoring with embedding similarity.
   * Returns results sorted by combined score (descending).
   *
   * @param query - Search query string
   * @param entries - All ledger entries to search through
   * @param keywordScorer - Optional function that returns keyword score for an entry
   */
  async search(
    query: string,
    entries: LedgerEntry[],
    keywordScorer?: (entry: LedgerEntry, query: string) => number
  ): Promise<VectorSearchResult[]> {
    if (entries.length === 0) return [];

    try {
      const queryEmbedding = await this.embed(query);
      const keywordWeight = this.config.keywordWeight ?? 0.4;
      const embeddingWeight = this.config.embeddingWeight ?? 0.6;

      const results: VectorSearchResult[] = [];

      for (const entry of entries) {
        // Build text representation of the entry
        const entryText = this._entryToText(entry);
        const entryEmbedding = await this.embed(entryText);

        const embeddingScore = cosineSimilarity(queryEmbedding, entryEmbedding);

        // Keyword score (from existing search or default)
        let kwScore = 0;
        if (keywordScorer) {
          kwScore = keywordScorer(entry, query);
        } else {
          kwScore = this._defaultKeywordScore(entry, query);
        }

        // Normalize keyword score to [0, 1] range (cap at 1.0)
        kwScore = Math.min(1.0, kwScore);

        const combinedScore = embeddingWeight * embeddingScore + keywordWeight * kwScore;

        results.push({
          entry,
          keywordScore: kwScore,
          embeddingScore,
          combinedScore,
        });
      }

      // Filter out zero-score results and sort by combined score
      return results
        .filter(r => r.combinedScore > 0.01)
        .sort((a, b) => b.combinedScore - a.combinedScore);
    } catch {
      // If embedding API fails, fall back to keyword-only results
      return entries
        .filter(e => this._defaultKeywordScore(e, query) > 0)
        .map(e => ({
          entry: e,
          keywordScore: this._defaultKeywordScore(e, query),
          embeddingScore: 0,
          combinedScore: this._defaultKeywordScore(e, query) * 0.4,
        }))
        .sort((a, b) => b.combinedScore - a.combinedScore);
    }
  }

  /** Generate embeddings for all entries (pre-computation for faster search) */
  async precomputeEmbeddings(entries: LedgerEntry[]): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();
    for (const entry of entries) {
      const entryText = this._entryToText(entry);
      try {
        const embedding = await this.embed(entryText);
        embeddings.set(entry.id, embedding);
      } catch {
        // Skip entries that fail to embed
      }
    }
    return embeddings;
  }

  /** Convert a ledger entry to a text string suitable for embedding */
  private _entryToText(entry: LedgerEntry): string {
    const parts: string[] = [];
    // Entity + attribute as primary identifier
    parts.push(`${entry.entity}的${entry.attribute}`);
    // All claim values (current and historical)
    for (const claim of entry.claims) {
      parts.push(claim.value);
    }
    // Category and tags as context
    if (entry.category && entry.category !== "general") {
      parts.push(entry.category);
    }
    if (entry.tags && entry.tags.length > 0) {
      parts.push(entry.tags.join(" "));
    }
    return parts.join(" ");
  }

  /** Default keyword scorer (same logic as the existing search) */
  private _defaultKeywordScore(entry: LedgerEntry, query: string): number {
    let score = 0;
    const terms = query.split(/\s+/).filter(Boolean);
    const entryText = this._entryToText(entry);
    const lowerText = entryText.toLowerCase();

    for (const term of terms) {
      if (lowerText.includes(term.toLowerCase())) {
        score += 2;
        // Exact entity/attribute match gets extra weight
        if (entry.entity.toLowerCase().includes(term.toLowerCase())) score += 3;
        if (entry.attribute.toLowerCase().includes(term.toLowerCase())) score += 2;
      }
    }

    // Check individual claim values
    for (const claim of entry.claims) {
      if (claim.value.toLowerCase().includes(query.toLowerCase())) {
        score += 5;
      }
    }

    return score;
  }
}
