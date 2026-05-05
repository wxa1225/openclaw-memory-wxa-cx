// Unit tests for extractor.ts

import { MemoryExtractor } from "../lib/extractor.js";
import type { EventLogEntry } from "../lib/storage/types.js";

function makeEvent(content: string): EventLogEntry {
  return {
    id: "evt-1", storedAt: new Date().toISOString(), chatId: "chat-1",
    chatType: "group", senderId: "alice", content, contentType: "text",
    messageId: "msg-1", processedForExtraction: false,
  };
}

describe("MemoryExtractor", () => {
  class MockExtractor extends MemoryExtractor {
    private mockResponse: string;
    constructor(mockResponse: string) {
      super({ modelEndpoint: "http://localhost/mock", modelApiKey: "test", modelName: "mock" });
      this.mockResponse = mockResponse;
    }
    protected override async callModel(): Promise<string> {
      return this.mockResponse;
    }
  }

  test("parses valid JSON array", async () => {
    const mock = JSON.stringify([{ entity: "客户A", attribute: "交付格式", value: "PDF", confidence: 0.85, category: "decision", tags: ["delivery"] }]);
    const ext = new MockExtractor(mock);
    const results = await ext.extract([makeEvent("客户A要PDF")], { existingEntries: [], teamId: "test" });
    expect(results).toHaveLength(1);
    expect(results[0].entity).toBe("客户A");
    expect(results[0].value).toBe("PDF");
    expect(results[0].category).toBe("decision");
  });

  test("extracts from code fences", async () => {
    const mock = '```json\n[{"entity":"X","attribute":"Y","value":"Z","confidence":0.9,"category":"process","tags":[]}]\n```';
    const ext = new MockExtractor(mock);
    const results = await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" });
    expect(results).toHaveLength(1);
  });

  test("empty response returns []", async () => {
    const ext = new MockExtractor("");
    expect((await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" })).length).toBe(0);
  });

  test("non-JSON returns []", async () => {
    const ext = new MockExtractor("not json");
    expect((await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" })).length).toBe(0);
  });

  test("non-array JSON returns []", async () => {
    const ext = new MockExtractor('{"msg":"none"}');
    expect((await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" })).length).toBe(0);
  });

  test("filters entries missing required fields", async () => {
    const mock = JSON.stringify([
      { entity: "A", attribute: "B", value: "C", confidence: 0.7, category: "general", tags: [] },
      { entity: "", attribute: "B", value: "C", confidence: 0.7, category: "general", tags: [] },
    ]);
    const ext = new MockExtractor(mock);
    const results = await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" });
    expect(results).toHaveLength(1);
  });

  test("clamps confidence to [0,1]", async () => {
    const mock = JSON.stringify([
      { entity: "A", attribute: "B", value: "C", confidence: 1.5, category: "general", tags: [] },
      { entity: "D", attribute: "E", value: "F", confidence: -0.3, category: "general", tags: [] },
    ]);
    const ext = new MockExtractor(mock);
    const results = await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" });
    expect(results[0].confidence).toBe(1.0);
    expect(results[1].confidence).toBe(0);
  });

  test("invalid category defaults to general", async () => {
    const mock = JSON.stringify([{ entity: "A", attribute: "B", value: "C", confidence: 0.7, category: "unknown", tags: [] }]);
    const ext = new MockExtractor(mock);
    const results = await ext.extract([makeEvent("test")], { existingEntries: [], teamId: "test" });
    expect(results[0].category).toBe("general");
  });

  test("empty event batch returns []", async () => {
    const ext = new MockExtractor("anything");
    expect((await ext.extract([], { existingEntries: [], teamId: "test" })).length).toBe(0);
  });
});
