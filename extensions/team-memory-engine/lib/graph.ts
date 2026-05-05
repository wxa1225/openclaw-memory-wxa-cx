// MemoryGraph — directed labeled multigraph with auto-build from ledger

import { GraphStorageBackend } from "./storage/graph-storage.js";
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  GraphNodeType,
  GraphEdgeType,
  LedgerEntry,
} from "./storage/types.js";

const DEFAULT_GRAPH_PATH = process.env.HOME
  ? `${process.env.HOME}/.openclaw-memory-graph.json`
  : "/tmp/.openclaw-memory-graph.json";

// Node/ID helpers
function nodeId(type: GraphNodeType, key: string): string {
  return `${type.toLowerCase()}:${key.replace(/[^a-zA-Z0-9一-鿿]/g, "_")}`;
}

function edgeId(source: string, target: string, type: GraphEdgeType): string {
  return `edge:${source}→${target}:${type}`;
}

export class MemoryGraph {
  private storage: GraphStorageBackend;
  private teamId: string;

  constructor(teamId: string, graphPath?: string) {
    this.teamId = teamId;
    this.storage = new GraphStorageBackend(graphPath ?? DEFAULT_GRAPH_PATH);
  }

  // ---- Build ----

  /** Rebuild entire graph from ledger entries (5-phase algorithm) */
  async rebuildFromLedger(entries: LedgerEntry[]): Promise<void> {
    const data: GraphData = { nodes: [], edges: [] };
    const nodeMap = new Map<string, GraphNode>();

    const addNode = (n: GraphNode) => {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
    };
    const addEdge = (e: GraphEdge) => {
      const existing = data.edges.find(
        (edge) => edge.source === e.source && edge.target === e.target && edge.type === e.type
      );
      if (!existing) data.edges.push(e);
    };

    for (const entry of entries) {
      const subgraph = this._buildEntrySubgraph(entry);
      for (const n of subgraph.nodes) addNode(n);
      for (const e of subgraph.edges) addEdge(e);
    }

    data.nodes = Array.from(nodeMap.values());
    await this.storage.replace(data);
  }

  /** True incremental update: remove old subgraph for entry, insert new */
  async incrementalUpdate(entry: LedgerEntry): Promise<void> {
    const data = await this.storage.load();

    const memPrefix = nodeId("Memory", `${entry.id}-`);

    // Find old entity/attribute nodes by reverse-lookup: edges pointing to memory nodes
    // that are about to be removed. This catches entity/attribute renames.
    const orphanedNodeIds = new Set<string>();
    for (const edge of data.edges) {
      if (edge.target.startsWith(memPrefix) || edge.source.startsWith(memPrefix)) {
        // This edge connects to a memory node we're about to remove.
        // If it's a has_preference/current_value/old_value/related_memory edge,
        // check whether the source/target should also be cleaned up.
        if (edge.type === "has_preference") {
          // Only orphan the entity node if ALL its has_preference edges point to old memories
          orphanedNodeIds.add(edge.source);
        }
        if (edge.type === "current_value" || edge.type === "old_value") {
          orphanedNodeIds.add(edge.source); // attribute node
        }
        if (edge.type === "related_memory") {
          orphanedNodeIds.add(edge.source); // entity node
        }
      }
    }

    // Verify orphaned nodes are truly orphaned (no other edges reference them)
    const nodesToRemove = new Set<string>();
    for (const nodeIdStr of orphanedNodeIds) {
      const otherEdges = data.edges.filter(
        (e) => (e.source === nodeIdStr || e.target === nodeIdStr) &&
          !e.source.startsWith(memPrefix) && !e.target.startsWith(memPrefix)
      );
      // If only edges to old memory nodes exist, this node is truly orphaned
      if (otherEdges.length === 0) {
        nodesToRemove.add(nodeIdStr);
      }
    }

    // Remove old nodes/edges for this entry's memory nodes
    data.nodes = data.nodes.filter((n) => !n.id.startsWith(memPrefix));
    data.edges = data.edges.filter(
      (e) => !e.source.startsWith(memPrefix) && !e.target.startsWith(memPrefix)
    );

    // Also remove stale entity/attribute edges that pointed to old memory nodes
    data.edges = data.edges.filter((e) => {
      if (e.type === "related_memory" || e.type === "current_value" || e.type === "old_value") {
        if (e.target.startsWith(memPrefix)) return false;
      }
      return true;
    });

    // Remove truly orphaned nodes and their edges
    for (const orphanId of nodesToRemove) {
      data.nodes = data.nodes.filter((n) => n.id !== orphanId);
      data.edges = data.edges.filter((e) => e.source !== orphanId && e.target !== orphanId);
    }

    // Build and add new subgraph
    const subgraph = this._buildEntrySubgraph(entry);

    // Add nodes (deduplicate against existing)
    for (const n of subgraph.nodes) {
      if (!data.nodes.find((existing) => existing.id === n.id)) {
        data.nodes.push(n);
      }
    }

    // Add edges (deduplicate)
    for (const e of subgraph.edges) {
      if (!data.edges.find((existing) => existing.id === e.id)) {
        data.edges.push(e);
      }
    }

    await this.storage.replace(data);
  }

  /** Build graph subgraph for a single ledger entry */
  private _buildEntrySubgraph(entry: LedgerEntry): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const addNode = (n: GraphNode) => {
      if (!nodes.find((existing) => existing.id === n.id)) nodes.push(n);
    };
    const addEdge = (e: GraphEdge) => {
      if (!edges.find((existing) => existing.id === e.id)) edges.push(e);
    };

    // Phase 1: Entity & Attribute
    const entityNode: GraphNode = {
      id: nodeId("Entity", entry.entity),
      type: "Entity",
      label: entry.entity,
      properties: { category: entry.category, tags: entry.tags },
    };
    addNode(entityNode);

    const attrNode: GraphNode = {
      id: nodeId("Attribute", `${entry.entity}.${entry.attribute}`),
      type: "Attribute",
      label: entry.attribute,
      properties: { entity: entry.entity },
    };
    addNode(attrNode);

    addEdge({
      id: edgeId(entityNode.id, attrNode.id, "has_preference"),
      source: entityNode.id,
      target: attrNode.id,
      type: "has_preference",
    });

    // Phase 2: Version chain linking
    for (let i = 0; i < entry.claims.length; i++) {
      const claim = entry.claims[i];
      const memNode: GraphNode = {
        id: nodeId("Memory", `${entry.id}-v${claim.version}`),
        type: "Memory",
        label: `v${claim.version}: ${claim.value.substring(0, 40)}`,
        properties: {
          version: claim.version,
          confidence: claim.confidence,
          status: claim.status,
          valid_from: claim.valid_from,
          valid_to: claim.valid_to,
        },
      };
      addNode(memNode);

      // Link entity → memory
      addEdge({
        id: edgeId(entityNode.id, memNode.id, "related_memory"),
        source: entityNode.id,
        target: memNode.id,
        type: "related_memory",
      });

      // Link attribute → memory (current vs old value)
      if (claim.status === "active" || claim.status === undefined) {
        addEdge({
          id: edgeId(attrNode.id, memNode.id, "current_value"),
          source: attrNode.id,
          target: memNode.id,
          type: "current_value",
        });
      } else if (claim.status === "superseded") {
        addEdge({
          id: edgeId(attrNode.id, memNode.id, "old_value"),
          source: attrNode.id,
          target: memNode.id,
          type: "old_value",
        });
      }

      // Supersedes edge
      if (i > 0) {
        const prevClaim = entry.claims[i - 1];
        addEdge({
          id: edgeId(
            nodeId("Memory", `${entry.id}-v${claim.version}`),
            nodeId("Memory", `${entry.id}-v${prevClaim.version}`),
            "supersedes"
          ),
          source: nodeId("Memory", `${entry.id}-v${claim.version}`),
          target: nodeId("Memory", `${entry.id}-v${prevClaim.version}`),
          type: "supersedes",
        });
      }
    }

    // Phase 3: Provenance linking
    for (const claim of entry.claims) {
      if (claim.source) {
        const eventNode: GraphNode = {
          id: nodeId("Event", claim.source),
          type: "Event",
          label: claim.source,
          properties: { source: claim.source },
        };
        addNode(eventNode);

        const memNodeId = nodeId("Memory", `${entry.id}-v${claim.version}`);
        addEdge({
          id: edgeId(memNodeId, eventNode.id, "derived_from"),
          source: memNodeId,
          target: eventNode.id,
          type: "derived_from",
        });
      }
    }

    // Phase 4: Social linking
    for (const claim of entry.claims) {
      const injectorNode: GraphNode = {
        id: nodeId("Person", claim.injected_by),
        type: "Person",
        label: claim.injected_by,
        properties: { role: "injector" },
      };
      addNode(injectorNode);

      const memNodeId = nodeId("Memory", `${entry.id}-v${claim.version}`);
      addEdge({
        id: edgeId(memNodeId, injectorNode.id, "injected_by"),
        source: memNodeId,
        target: injectorNode.id,
        type: "injected_by",
      });

      for (const confirmer of claim.confirmed_by) {
        const confirmerNode: GraphNode = {
          id: nodeId("Person", confirmer),
          type: "Person",
          label: confirmer,
          properties: { role: "confirmer" },
        };
        addNode(confirmerNode);

        addEdge({
          id: edgeId(memNodeId, confirmerNode.id, "confirmed_by"),
          source: memNodeId,
          target: confirmerNode.id,
          type: "confirmed_by",
        });
      }
    }

    // Phase 5: Impact propagation
    for (const depId of entry.dependency_graph) {
      const taskNode: GraphNode = {
        id: nodeId("Task", depId),
        type: "Task",
        label: depId,
        properties: { type: "dependency" },
      };
      addNode(taskNode);

      const activeClaim = entry.claims.find(
        (c) => c.status === "active" || c.status === undefined
      );
      if (activeClaim) {
        const memNodeId = nodeId("Memory", `${entry.id}-v${activeClaim.version}`);
        addEdge({
          id: edgeId(memNodeId, taskNode.id, "affects"),
          source: memNodeId,
          target: taskNode.id,
          type: "affects",
        });
      }
    }

    return { nodes, edges };
  }

  // ---- Node/Edge CRUD ----

  async addNode(node: GraphNode): Promise<void> {
    await this.storage.addNode(node);
  }

  async addEdge(edge: GraphEdge): Promise<void> {
    await this.storage.addEdge(edge);
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.storage.deleteNode(nodeId);
  }

  // ---- Queries ----

  async getEntityPreferences(entity: string): Promise<GraphEdge[]> {
    const entityNode = nodeId("Entity", entity);
    return this.storage.getEdges(entityNode, undefined, "has_preference");
  }

  async getMemoryProvenance(memoryId: string): Promise<GraphNode[]> {
    const memNode = nodeId("Memory", memoryId);
    return this.storage.getNeighbors(memNode, "derived_from");
  }

  async getAffectedTasks(memoryId: string): Promise<GraphNode[]> {
    const memNode = nodeId("Memory", memoryId);
    return this.storage.getNeighbors(memNode, "affects");
  }

  async getNeighbors(nodeIdStr: string, edgeType?: GraphEdgeType): Promise<GraphNode[]> {
    return this.storage.getNeighbors(nodeIdStr, edgeType);
  }

  async getAll(): Promise<GraphData> {
    return this.storage.getAll();
  }

  /** Query: trace the full history of an entity's attribute */
  async traceAttributeHistory(entity: string, attribute: string): Promise<{
    values: Array<{ version: number; value: string; valid_from: string; valid_to: string | null; confidence: number }>;
    people: string[];
  }> {
    const data = await this.getAll();
    const attrNodeId = nodeId("Attribute", `${entity}.${attribute}`);

    const valueNodes = data.edges
      .filter((e) => e.source === attrNodeId && (e.type === "current_value" || e.type === "old_value"))
      .map((e) => data.nodes.find((n) => n.id === e.target))
      .filter(Boolean) as GraphNode[];

    const values = valueNodes.map((n) => ({
      version: n.properties.version as number,
      value: n.label,
      valid_from: n.properties.valid_from as string,
      valid_to: n.properties.valid_to as string | null,
      confidence: n.properties.confidence as number,
    }));

    const people = new Set<string>();
    for (const vn of valueNodes) {
      const neighbors = await this.storage.getNeighbors(vn.id, "confirmed_by");
      for (const n of neighbors) people.add(n.label);
      const injectors = await this.storage.getNeighbors(vn.id, "injected_by");
      for (const n of injectors) people.add(n.label);
    }

    return { values, people: Array.from(people) };
  }
}
