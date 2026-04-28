// GraphStorageBackend — persisted memory graph

import * as fs from "fs";
import * as path from "path";
import type { GraphNode, GraphEdge, GraphData, GraphNodeType, GraphEdgeType } from "./types.js";

const DEFAULT_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-graph.json"
);

export class GraphStorageBackend {
  private filePath: string;
  private cache: GraphData | null = null;

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath;
  }

  async load(): Promise<GraphData> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      this.cache = JSON.parse(raw);
    } catch {
      this.cache = { nodes: [], edges: [] };
    }
    return this.cache;
  }

  async save(): Promise<void> {
    if (!this.cache) return;
    const tmpPath = this.filePath + ".tmp";
    await fs.promises.writeFile(tmpPath, JSON.stringify(this.cache, null, 2), "utf-8");
    await fs.promises.rename(tmpPath, this.filePath);
  }

  // --- Node operations ---

  async addNode(node: GraphNode): Promise<void> {
    const data = await this.load();
    const existing = data.nodes.findIndex((n) => n.id === node.id);
    if (existing >= 0) {
      data.nodes[existing] = node;
    } else {
      data.nodes.push(node);
    }
    await this.save();
  }

  async getNode(id: string): Promise<GraphNode | undefined> {
    const data = await this.load();
    return data.nodes.find((n) => n.id === id);
  }

  async deleteNode(id: string): Promise<void> {
    const data = await this.load();
    data.nodes = data.nodes.filter((n) => n.id !== id);
    data.edges = data.edges.filter((e) => e.source !== id && e.target !== id);
    await this.save();
  }

  async getAllNodes(type?: GraphNodeType): Promise<GraphNode[]> {
    const data = await this.load();
    if (type) return data.nodes.filter((n) => n.type === type);
    return data.nodes;
  }

  // --- Edge operations ---

  async addEdge(edge: GraphEdge): Promise<void> {
    const data = await this.load();
    const existing = data.edges.findIndex((e) => e.id === edge.id);
    if (existing >= 0) {
      data.edges[existing] = edge;
    } else {
      data.edges.push(edge);
    }
    await this.save();
  }

  async getEdges(source?: string, target?: string, type?: GraphEdgeType): Promise<GraphEdge[]> {
    const data = await this.load();
    return data.edges.filter((e) => {
      if (source && e.source !== source) return false;
      if (target && e.target !== target) return false;
      if (type && e.type !== type) return false;
      return true;
    });
  }

  async deleteEdge(id: string): Promise<void> {
    const data = await this.load();
    data.edges = data.edges.filter((e) => e.id !== id);
    await this.save();
  }

  // --- Graph queries ---

  async getNeighbors(nodeId: string, edgeType?: GraphEdgeType): Promise<GraphNode[]> {
    const data = await this.load();
    const neighborIds = new Set<string>();
    for (const edge of data.edges) {
      if (edgeType && edge.type !== edgeType) continue;
      if (edge.source === nodeId) neighborIds.add(edge.target);
      if (edge.target === nodeId) neighborIds.add(edge.source);
    }
    return data.nodes.filter((n) => neighborIds.has(n.id));
  }

  async getAll(): Promise<GraphData> {
    return this.load();
  }

  /** Replace entire graph (used by rebuildFromLedger) */
  async replace(data: GraphData): Promise<void> {
    this.cache = data;
    await this.save();
  }
}
