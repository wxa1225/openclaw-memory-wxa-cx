/**
 * Team Memory Engine Plugin v2
 *
 * Team Cognitive Infrastructure — Memory OS with:
 * - Memory Ledger (version chains, conflict detection)
 * - Memory Graph (auto-built cognitive graph)
 * - Risk Model (5-dimensional forgetting risk)
 * - Ebbinghaus decay (spaced repetition)
 * - Vector Semantic Search (hybrid embedding + keyword)
 * - LLM Extraction with JSON Schema + retry
 *
 * Module structure:
 * - plugin-config.ts   — Config types, defaults, env parsing
 * - plugin-feishu.ts   — Feishu message helpers, Mem0 client
 * - plugin-tools.ts    — Agent tool registrations
 * - plugin-cli.ts      — CLI command registrations
 * - plugin-services.ts — Event hooks and background services
 */

import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { TeamMemoryManager } from "./lib/manager.js";
import { parseConfig, getConfigFromEnv, type TeamMemoryConfig } from "./lib/plugin-config.js";
import { Mem0HttpClient, type Mem0Provider } from "./lib/plugin-feishu.js";
import { registerTools } from "./lib/plugin-tools.js";
import { registerCli } from "./lib/plugin-cli.js";
import { setupEventHooks, registerServices } from "./lib/plugin-services.js";

// ============================================================================
// Plugin
// ============================================================================

const plugin = {
  id: "team-memory-engine" as const,
  name: "Team Memory Engine" as const,
  description: "Team Cognitive Infrastructure — Memory OS with Ledger, Graph, Risk Model, and Vector Search",
  kind: "memory" as const,
  configSchema: {
    type: "object" as const,
    properties: {
      teamId: { type: "string" as const },
      decayCheckInterval: { type: "number" as const },
      riskCheckInterval: { type: "number" as const },
      feishuChatId: { type: "string" as const },
      teamSize: { type: "number" as const },
      enableGraph: { type: "boolean" as const },
      projectRoot: { type: "string" as const },
      modelEndpoint: { type: "string" as const },
      modelApiKey: { type: "string" as const },
      modelName: { type: "string" as const },
      modelXApiKey: { type: "string" as const },
      extractionBatchSize: { type: "number" as const },
      enableProactiveCapture: { type: "boolean" as const },
      proactivePromptInterval: { type: "number" as const },
      proactiveMaxPerSession: { type: "number" as const },
      embeddingEndpoint: { type: "string" as const },
      embeddingApiKey: { type: "string" as const },
      embeddingModel: { type: "string" as const },
      embeddingXApiKey: { type: "string" as const },
    },
    parse(value: unknown): TeamMemoryConfig {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return parseConfig({});
      }
      return parseConfig({ ...(value as Record<string, unknown>) });
    },
  },

  async register(api: OpenClawPluginApi) {
    const rawConfig = api.pluginConfig && typeof api.pluginConfig === "object" && !Array.isArray(api.pluginConfig)
      ? api.pluginConfig as Record<string, unknown>
      : {};
    const envConfig = getConfigFromEnv(api);
    const cfg = parseConfig({ ...rawConfig, ...envConfig });

    const mem0ApiKey = process.env?.MEM0_API_KEY ?? api.resolveConfig?.("mem0.apiKey") ?? "";
    const mem0Host = process.env?.MEM0_HOST ?? api.resolveConfig?.("mem0.host") ?? "https://api.mem0.ai";

    // No-op provider when Mem0 is not configured
    const mem0Client: Mem0Provider = mem0ApiKey
      ? new Mem0HttpClient(mem0ApiKey, mem0Host)
      : {
          async add() { return {}; },
          async search() { return []; },
          async getAll() { return []; },
          async get() { return undefined; },
          async delete() { return {}; },
        };

    if (!mem0ApiKey) {
      api.logger.info("team-memory-engine: Mem0 not configured (MEM0_API_KEY unset), using local ledger only");
    }

    const manager = new TeamMemoryManager(mem0Client, {
      teamId: cfg.teamId,
      defaultUserId: "openclaw-user",
      teamSize: cfg.teamSize,
      enableGraph: cfg.enableGraph,
      projectRoot: cfg.projectRoot,
      modelEndpoint: cfg.modelEndpoint || undefined,
      modelApiKey: cfg.modelApiKey || undefined,
      modelName: cfg.modelName,
      modelXApiKey: cfg.modelXApiKey || undefined,
      extractionBatchSize: cfg.extractionBatchSize,
      embeddingEndpoint: cfg.embeddingEndpoint || undefined,
      embeddingApiKey: cfg.embeddingApiKey || undefined,
      embeddingModel: cfg.embeddingModel,
      embeddingXApiKey: cfg.embeddingXApiKey || undefined,
    });

    api.logger.info(
      `team-memory-engine v2: registered (team: ${cfg.teamId}, decayInterval: ${cfg.decayCheckInterval}ms, riskInterval: ${cfg.riskCheckInterval}ms, feishuChat: ${cfg.feishuChatId || "not set"}, graph: ${cfg.enableGraph}, vectorSearch: ${!!cfg.embeddingEndpoint})`
    );

    // Async init (migration) — fire-and-forget
    manager.initialize().catch((err: unknown) => {
      api.logger.warn(`team-memory-engine: initialization failed: ${String(err)}`);
    });

    // Event hooks (event log capture + proactive memory detection)
    setupEventHooks(api, manager, cfg);

    // Agent tools
    registerTools(api, manager, cfg);

    // CLI commands
    registerCli(api, manager, cfg);

    // Background services (decay check, risk check, extraction pipeline)
    registerServices(api, manager, cfg);
  },
};

export default definePluginEntry(plugin);
