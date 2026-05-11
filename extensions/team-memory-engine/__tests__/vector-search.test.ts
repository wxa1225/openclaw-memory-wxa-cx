// Tests for Vector Search — cosine similarity and hybrid scoring

import { cosineSimilarity, VectorSearch } from "../lib/vector-search.js";
import type { LedgerEntry } from "../lib/storage/types.js";

describe("Vector Search", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = [1, 0, 0, 1];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    });

    it("returns 0 for zero vectors", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it("returns -1 for opposite vectors", () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    });

    it("returns 0.5 for partially similar vectors", () => {
      // cos(60°) = 0.5
      const a = [1, 0];
      const b = [1, Math.sqrt(3)];
      const result = cosineSimilarity(a, b);
      expect(result).toBeCloseTo(0.5, 4);
    });

    it("handles empty arrays", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe("VectorSearch fallback", () => {
    it("search returns keyword-only results when embedding API fails", async () => {
      // Create with invalid endpoint to trigger fallback
      const vs = new VectorSearch({
        embeddingEndpoint: "http://invalid-host:9999/embeddings",
        embeddingApiKey: "test",
        embeddingModel: "test",
      });

      const entries: LedgerEntry[] = [
        {
          id: "mem-1",
          entity: "客户A",
          attribute: "交付格式",
          claims: [{
            version: 1, value: "PDF", valid_from: new Date().toISOString(),
            valid_to: null, confidence: 0.8, injected_by: "test", confirmed_by: [], status: "active",
          }],
          current_version: 1,
          dependency_graph: [],
          recall_half_life: 14,
          category: "decision",
          tags: ["交付"],
          teamId: "test",
          access_count: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      // Should fallback to keyword search since API is unreachable
      const results = await vs.search("PDF", entries);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.id).toBe("mem-1");
      expect(results[0].embeddingScore).toBe(0); // Fallback has no embedding
    });
  });
});
