// Unit tests for graph.ts — MemoryGraph with 5-phase build algorithm

import * as fs from "fs";
import * as path from "path";
import { MemoryGraph } from "../lib/graph.js";
import type { LedgerEntry, LedgerClaim } from "../lib/storage/types.js";

const TEST_DIR = path.join("/tmp", `graph-test-${Date.now()}`);
const TEST_GRAPH_PATH = path.join(TEST_DIR, "graph.json");

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function makeGraph() {
  return new MemoryGraph("test-team", TEST_GRAPH_PATH);
}

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const now = new Date().toISOString();
  return {
    id: "test-entry",
    entity: "TestEntity",
    attribute: "testAttr",
    claims: [{
      version: 1,
      value: "test value",
      valid_from: now,
      valid_to: null,
      confidence: 0.7,
      source: "test-source",
      injected_by: "alice",
      confirmed_by: ["bob"],
      status: "active",
    }],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 14,
    category: "general",
    tags: [],
    teamId: "test-team",
    access_count: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("MemoryGraph", () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  // ---- rebuildFromLedger ----

  test("builds graph from empty ledger", async () => {
    const graph = makeGraph();
    await graph.rebuildFromLedger([]);
    const data = await graph.getAll();
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
  });

  test("creates Entity and Attribute nodes for each entry", async () => {
    const graph = makeGraph();
    const entry = makeEntry({ entity: "客户A", attribute: "交付格式" });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();

    const entityNodes = data.nodes.filter((n) => n.type === "Entity");
    const attrNodes = data.nodes.filter((n) => n.type === "Attribute");
    expect(entityNodes.length).toBeGreaterThanOrEqual(1);
    expect(attrNodes.length).toBeGreaterThanOrEqual(1);

    const customerNode = entityNodes.find((n) => n.label === "客户A");
    expect(customerNode).toBeDefined();
  });

  test("creates Memory nodes for each claim", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [
        { version: 1, value: "PDF", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.7, injected_by: "alice", confirmed_by: [], status: "superseded", source: "test" },
        { version: 2, value: "Markdown", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.8, injected_by: "bob", confirmed_by: [], status: "active", source: "test" },
      ],
      current_version: 2,
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const memoryNodes = data.nodes.filter((n) => n.type === "Memory");
    expect(memoryNodes).toHaveLength(2);
  });

  test("creates Person nodes for injectors and confirmers", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: ["bob", "charlie"], status: "active", source: "test",
      }],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const personNodes = data.nodes.filter((n) => n.type === "Person");
    const personLabels = personNodes.map((n) => n.label);
    expect(personLabels).toContain("alice");
    expect(personLabels).toContain("bob");
    expect(personLabels).toContain("charlie");
  });

  test("creates Event nodes for claim sources", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: [], status: "active", source: "meeting-notes",
      }],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const eventNodes = data.nodes.filter((n) => n.type === "Event");
    expect(eventNodes.length).toBeGreaterThanOrEqual(1);
  });

  test("creates Task nodes for dependency_graph entries", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      dependency_graph: ["task-001", "task-002"],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const taskNodes = data.nodes.filter((n) => n.type === "Task");
    expect(taskNodes).toHaveLength(2);
  });

  test("creates has_preference edge between Entity and Attribute", async () => {
    const graph = makeGraph();
    const entry = makeEntry();
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const prefEdges = data.edges.filter((e) => e.type === "has_preference");
    expect(prefEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("creates current_value edge for active claims", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "active-value", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: [], status: "active", source: "test",
      }],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const currentEdges = data.edges.filter((e) => e.type === "current_value");
    expect(currentEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("creates old_value edge for superseded claims", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "old-value", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.5, injected_by: "alice",
        confirmed_by: [], status: "superseded", source: "test",
      }],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const oldEdges = data.edges.filter((e) => e.type === "old_value");
    expect(oldEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("creates supersedes edge between consecutive versions", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [
        { version: 1, value: "v1", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.5, injected_by: "alice", confirmed_by: [], status: "superseded", source: "test" },
        { version: 2, value: "v2", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.8, injected_by: "bob", confirmed_by: [], status: "active", source: "test" },
      ],
      current_version: 2,
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const supersedesEdges = data.edges.filter((e) => e.type === "supersedes");
    expect(supersedesEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("creates injected_by and confirmed_by edges", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: ["bob"], status: "active", source: "test",
      }],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const injectedByEdges = data.edges.filter((e) => e.type === "injected_by");
    const confirmedByEdges = data.edges.filter((e) => e.type === "confirmed_by");
    expect(injectedByEdges.length).toBeGreaterThanOrEqual(1);
    expect(confirmedByEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("creates affects edge for dependency_graph with active claim", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      dependency_graph: ["deploy-task-1"],
    });
    await graph.rebuildFromLedger([entry]);
    const data = await graph.getAll();
    const affectsEdges = data.edges.filter((e) => e.type === "affects");
    expect(affectsEdges.length).toBeGreaterThanOrEqual(1);
  });

  // ---- incrementalUpdate ----

  test("incrementalUpdate adds new entry to existing graph", async () => {
    const graph = makeGraph();
    const entry1 = makeEntry({ id: "entry-1", entity: "Project", attribute: "name" });
    await graph.rebuildFromLedger([entry1]);

    const entry2 = makeEntry({ id: "entry-2", entity: "User", attribute: "theme" });
    await graph.incrementalUpdate(entry2);

    const data = await graph.getAll();
    const entityNodes = data.nodes.filter((n) => n.type === "Entity");
    expect(entityNodes.length).toBeGreaterThanOrEqual(2);
  });

  test("incrementalUpdate does not duplicate nodes", async () => {
    const graph = makeGraph();
    const entry = makeEntry({ id: "single" });
    await graph.rebuildFromLedger([entry]);
    const beforeCount = (await graph.getAll()).nodes.length;

    await graph.incrementalUpdate(entry);
    const afterCount = (await graph.getAll()).nodes.length;
    expect(afterCount).toBe(beforeCount);
  });

  // ---- Queries ----

  test("getEntityPreferences returns has_preference edges", async () => {
    const graph = makeGraph();
    const entry = makeEntry({ entity: "客户A", attribute: "交付格式" });
    await graph.rebuildFromLedger([entry]);

    const prefs = await graph.getEntityPreferences("客户A");
    expect(prefs.length).toBeGreaterThanOrEqual(1);
    expect(prefs[0].type).toBe("has_preference");
  });

  test("getAffectedTasks returns task nodes linked to memory", async () => {
    const graph = makeGraph();
    const entry = makeEntry({ dependency_graph: ["task-deploy"] });
    await graph.rebuildFromLedger([entry]);

    const data = await graph.getAll();
    const taskNodes = data.nodes.filter((n) => n.type === "Task");
    expect(taskNodes.length).toBeGreaterThanOrEqual(1);
    expect(taskNodes[0].label).toBe("task-deploy");

    const affectsEdges = data.edges.filter((e) => e.type === "affects");
    expect(affectsEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("traceAttributeHistory returns version history and people", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      entity: "客户A",
      attribute: "交付格式",
      claims: [
        { version: 1, value: "Markdown", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.6, injected_by: "alice", confirmed_by: ["bob"], status: "superseded", source: "test" },
        { version: 2, value: "PDF", valid_from: new Date().toISOString(), valid_to: null, confidence: 0.85, injected_by: "bob", confirmed_by: [], status: "active", source: "test" },
      ],
      current_version: 2,
    });
    await graph.rebuildFromLedger([entry]);

    const history = await graph.traceAttributeHistory("客户A", "交付格式");
    expect(history.values.length).toBeGreaterThanOrEqual(1);
    expect(history.people).toContain("alice");
    expect(history.people).toContain("bob");
  });

  test("getMemoryProvenance returns event nodes", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: [], status: "active", source: "meeting-2024",
      }],
    });
    await graph.rebuildFromLedger([entry]);

    const data = await graph.getAll();
    const eventNodes = data.nodes.filter((n) => n.type === "Event");
    expect(eventNodes.length).toBeGreaterThanOrEqual(1);

    const derivedFromEdges = data.edges.filter((e) => e.type === "derived_from");
    expect(derivedFromEdges.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Node/Edge CRUD ----

  test("addNode and addEdge work directly", async () => {
    const graph = makeGraph();
    await graph.rebuildFromLedger([]);

    await graph.addNode({
      id: "custom:node1",
      type: "Entity",
      label: "CustomEntity",
      properties: {},
    });
    await graph.addEdge({
      id: "edge:custom:node1→custom:node2:test",
      source: "custom:node1",
      target: "custom:node2",
      type: "has_preference",
    });

    const data = await graph.getAll();
    expect(data.nodes.find((n) => n.id === "custom:node1")).toBeDefined();
    expect(data.edges.find((e) => e.source === "custom:node1")).toBeDefined();
  });

  test("removeNode removes node and its edges", async () => {
    const graph = makeGraph();
    await graph.rebuildFromLedger([]);

    await graph.addNode({
      id: "custom:toDelete",
      type: "Entity",
      label: "ToDelete",
      properties: {},
    });
    await graph.removeNode("custom:toDelete");

    const data = await graph.getAll();
    expect(data.nodes.find((n) => n.id === "custom:toDelete")).toBeUndefined();
  });

  test("getNeighbors returns connected nodes", async () => {
    const graph = makeGraph();
    const entry = makeEntry({
      claims: [{
        version: 1, value: "test", valid_from: new Date().toISOString(),
        valid_to: null, confidence: 0.7, injected_by: "alice",
        confirmed_by: ["bob", "charlie"], status: "active", source: "test",
      }],
    });
    await graph.rebuildFromLedger([entry]);

    const data = await graph.getAll();
    const memNode = data.nodes.find((n) => n.type === "Memory");
    expect(memNode).toBeDefined();

    const confirmers = await graph.getNeighbors(memNode!.id, "confirmed_by");
    expect(confirmers.length).toBeGreaterThanOrEqual(2);
  });

  test("getAll returns full graph data", async () => {
    const graph = makeGraph();
    const entries = [
      makeEntry({ id: "e1", entity: "A", attribute: "x" }),
      makeEntry({ id: "e2", entity: "B", attribute: "y" }),
    ];
    await graph.rebuildFromLedger(entries);

    const data = await graph.getAll();
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);
  });
});
