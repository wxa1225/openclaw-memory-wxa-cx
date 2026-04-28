/**
 * Team Memory Engine Plugin v2
 *
 * Team Cognitive Infrastructure — Memory OS with:
 * - Memory Ledger (version chains, conflict detection)
 * - Memory Graph (auto-built cognitive graph)
 * - Risk Model (5-dimensional forgetting risk)
 * - Ebbinghaus decay (spaced repetition)
 *
 * Configuration (in openclaw.json):
 *   plugins.entries["team-memory-engine"].config: {
 *     "teamId": "openclaw-team",
 *     "decayCheckInterval": 1800000,
 *     "riskCheckInterval": 3600000,
 *     "feishuChatId": "oc_xxx",
 *     "teamSize": 5,
 *     "enableGraph": true
 *   }
 *
 * Also supports env vars:
 *   TEAM_MEMORY_TEAM_ID
 *   TEAM_MEMORY_DECAY_INTERVAL
 *   TEAM_MEMORY_FEISHU_CHAT_ID
 *   TEAM_MEMORY_TEAM_SIZE
 */

import { Type } from "@sinclair/typebox";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { TeamMemoryManager, type Mem0Provider } from "./lib/manager.js";

// ============================================================================
// Feishu message push helper
// ============================================================================

async function sendFeishuMessage(
  appId: string,
  appSecret: string,
  chatId: string,
  content: string,
  msgType: string = "text"
): Promise<boolean> {
  try {
    const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!tokenResp.ok) return false;
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) return false;
    const token = tokenData.tenant_access_token;

    const msgResp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: msgType,
        content: msgType === "interactive" ? content : JSON.stringify({ text: content }),
      }),
    });
    if (!msgResp.ok) return false;
    const msgData = await msgResp.json();
    return msgData.code === 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Config
// ============================================================================

interface TeamMemoryConfig {
  teamId: string;
  decayCheckInterval: number;
  riskCheckInterval: number;
  feishuChatId: string;
  teamSize: number;
  enableGraph: boolean;
}

const ALLOWED_CONFIG_KEYS = [
  "teamId", "decayCheckInterval", "riskCheckInterval",
  "feishuChatId", "teamSize", "enableGraph",
];

function parseConfig(value: Record<string, unknown>): TeamMemoryConfig {
  return {
    teamId: typeof value.teamId === "string" && value.teamId ? value.teamId : "openclaw-team",
    decayCheckInterval: typeof value.decayCheckInterval === "number" ? value.decayCheckInterval : 30 * 60 * 1000,
    riskCheckInterval: typeof value.riskCheckInterval === "number" ? value.riskCheckInterval : 60 * 60 * 1000,
    feishuChatId: typeof value.feishuChatId === "string" && value.feishuChatId ? value.feishuChatId : "",
    teamSize: typeof value.teamSize === "number" && value.teamSize > 0 ? value.teamSize : 5,
    enableGraph: typeof value.enableGraph === "boolean" ? value.enableGraph : true,
  };
}

function getConfigFromEnv(api: OpenClawPluginApi): Record<string, unknown> {
  const env = (api.config as Record<string, unknown> | undefined)?.env;
  const vars = env && typeof env === "object" && "vars" in env ? (env as Record<string, unknown>).vars : {};
  const get = (key: string): string | undefined => {
    if (typeof process !== "undefined" && process.env && typeof (process.env as Record<string, string>)[key] === "string") {
      return (process.env as Record<string, string>)[key];
    }
    if (typeof vars === "object" && vars && key in vars) {
      return (vars as Record<string, string>)[key];
    }
    return undefined;
  };

  const cfg: Record<string, unknown> = {};
  const teamId = get("TEAM_MEMORY_TEAM_ID");
  const decayInterval = get("TEAM_MEMORY_DECAY_INTERVAL");
  const riskInterval = get("TEAM_MEMORY_RISK_INTERVAL");
  const chatId = get("TEAM_MEMORY_FEISHU_CHAT_ID");
  const teamSize = get("TEAM_MEMORY_TEAM_SIZE");
  if (teamId) cfg.teamId = teamId;
  if (decayInterval) cfg.decayCheckInterval = parseInt(decayInterval, 10);
  if (riskInterval) cfg.riskCheckInterval = parseInt(riskInterval, 10);
  if (chatId) cfg.feishuChatId = chatId;
  if (teamSize) cfg.teamSize = parseInt(teamSize, 10);
  return cfg;
}

// ============================================================================
// Mem0 Client
// ============================================================================

class Mem0HttpClient implements Mem0Provider {
  private apiKey: string;
  private host: string;
  private headers: Record<string, string>;

  constructor(apiKey: string, host: string = "https://api.mem0.ai") {
    this.apiKey = apiKey;
    this.host = host;
    this.headers = {
      Authorization: `Token ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.host}${path}`;
    const opts: RequestInit = { method, headers: this.headers };
    if (body) opts.body = JSON.stringify(body);

    const response = await fetch(url, opts);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Mem0 API error ${response.status}: ${text}`);
    }
    const text = await response.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  async add(messages: Array<{ role: string; content: string }>, options: Record<string, unknown>) {
    return this.request("POST", "/v1/memories/", { messages, ...options });
  }

  async search(query: string, options: Record<string, unknown>) {
    return this.request("POST", "/v1/memories/search/", { query, ...options });
  }

  async getAll(options: Record<string, unknown>) {
    const params = new URLSearchParams(
      Object.entries(options).filter(([_, v]) => v != null).map(([k, v]) => [k, String(v)])
    );
    return this.request("GET", `/v1/memories/?${params}`);
  }

  async get(memoryId: string) {
    return this.request("GET", `/v1/memories/${memoryId}/`);
  }

  async delete(memoryId: string) {
    return this.request("DELETE", `/v1/memories/${memoryId}/`);
  }
}

// ============================================================================
// Plugin
// ============================================================================

const plugin = {
  id: "team-memory-engine",
  name: "Team Memory Engine",
  description: "Team Cognitive Infrastructure — Memory OS with Ledger, Graph, and Risk Model",
  kind: "memory" as const,
  configSchema: {
    parse(value: unknown): TeamMemoryConfig {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
          teamId: "openclaw-team",
          decayCheckInterval: 30 * 60 * 1000,
          riskCheckInterval: 60 * 60 * 1000,
          feishuChatId: "",
          teamSize: 5,
          enableGraph: true,
        };
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

    if (!mem0ApiKey) {
      api.logger.warn("team-memory-engine: MEM0_API_KEY not set, memory operations will use local ledger only");
    }

    const mem0Client = new Mem0HttpClient(mem0ApiKey, mem0Host);
    const manager = new TeamMemoryManager(mem0Client, {
      teamId: cfg.teamId,
      defaultUserId: "openclaw-user",
      teamSize: cfg.teamSize,
      enableGraph: cfg.enableGraph,
    });

    // Initialize: check for v1 migration
    try {
      await manager.initialize();
    } catch (err) {
      api.logger.warn(`team-memory-engine: initialization failed: ${String(err)}`);
    }

    api.logger.info(
      `team-memory-engine v2: registered (team: ${cfg.teamId}, decayInterval: ${cfg.decayCheckInterval}ms, riskInterval: ${cfg.riskCheckInterval}ms, feishuChat: ${cfg.feishuChatId || "not set"}, graph: ${cfg.enableGraph})`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "team_memory_inject",
        label: "Team Memory Inject",
        description: "Inject a new team memory with decay tracking and version management. Use when team makes a decision, records a fact, or notes an important item.",
        parameters: Type.Object({
          text: Type.String({ description: "The memory content to store" }),
          category: Type.Optional(Type.String({ description: "Category: security, decision, api, process, experience, general" })),
          tags: Type.Optional(Type.Array(Type.String(), { description: "Additional tags for searchability" })),
        }),
        async execute(_toolCallId, params) {
          try {
            const { text, category, tags } = params as { text: string; category?: string; tags?: string[] };
            const result = await manager.inject(text, { category, tags, author: "agent" });
            return {
              content: [{ type: "text", text: `Team memory stored: "${result.memory}" (id: ${result.id}, v${result.metadata.version})` }],
              details: { action: "injected", id: result.id },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to inject memory: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "team_memory_inject" },
    );

    api.registerTool(
      {
        name: "team_memory_update",
        label: "Team Memory Update",
        description: "Update an existing team memory. Searches by query, adds a new version. Preserves full version history chain.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query to find the memory to update" }),
          newText: Type.String({ description: "The new content" }),
        }),
        async execute(_toolCallId, params) {
          try {
            const { query, newText } = params as { query: string; newText: string };
            const result = await manager.update(query, newText, { author: "agent" });
            return {
              content: [{ type: "text", text: `Memory updated (v${result.previousVersion} → v${result.previousVersion + 1}): "${result.memory}"` }],
              details: { action: "updated", id: result.id, previousVersion: result.previousVersion },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to update memory: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "team_memory_update" },
    );

    api.registerTool(
      {
        name: "team_memory_status",
        label: "Team Memory Status",
        description: "List all team memories with their current decay status, strength, and version info.",
        parameters: Type.Object({
          category: Type.Optional(Type.String({ description: "Filter by category" })),
        }),
        async execute(_toolCallId, params) {
          try {
            const { category } = params as { category?: string };
            const memories = await manager.status(category);

            if (memories.length === 0) {
              return {
                content: [{ type: "text", text: "No team memories stored yet." }],
                details: { count: 0 },
              };
            }

            const lines = memories.map((m, i) => {
              const bars = "●".repeat(Math.round(m.strength * 5)) + "○".repeat(5 - Math.round(m.strength * 5));
              const categoryStr = m.metadata.category ? ` [${m.metadata.category}]` : "";
              const versionStr = m.metadata.version ? ` v${m.metadata.version}` : "";
              return `${i + 1}. ${m.memory.substring(0, 60)}${m.memory.length > 60 ? "..." : ""}${categoryStr}${versionStr}\n   Strength: ${bars} (${Math.round(m.strength * 100)}%)`;
            }).join("\n");

            return {
              content: [{ type: "text", text: `${memories.length} team memories:\n\n${lines}` }],
              details: { count: memories.length },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get memory status: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "team_memory_status" },
    );

    api.registerTool(
      {
        name: "team_memory_review",
        label: "Team Memory Review",
        description: "Mark a team memory as reviewed. Resets the decay curve to the next interval.",
        parameters: Type.Object({
          memoryId: Type.String({ description: "The memory ID to mark as reviewed" }),
        }),
        async execute(_toolCallId, params) {
          try {
            const { memoryId } = params as { memoryId: string };
            await manager.forceReview(memoryId);
            return {
              content: [{ type: "text", text: `Memory ${memoryId} marked as reviewed.` }],
              details: { action: "reviewed", id: memoryId },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to review memory: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "team_memory_review" },
    );

    // NEW: Risk assessment tool
    api.registerTool(
      {
        name: "team_memory_risk",
        label: "Team Memory Risk Assessment",
        description: "Assess forgetting risk scores for all team memories. Returns memories that exceed the dual-threshold (risk + business impact).",
        parameters: Type.Object({
          threshold: Type.Optional(Type.Number({ description: "Override risk threshold (default: 0.55)" })),
        }),
        async execute(_toolCallId, params) {
          try {
            const scores = await manager.assessRisk();
            const triggered = scores.filter((s) => s.triggered);

            if (triggered.length === 0) {
              return {
                content: [{ type: "text", text: "No memories exceed risk thresholds. Team cognitive state is healthy." }],
                details: { totalChecked: scores.length, triggered: 0 },
              };
            }

            const lines = triggered.map((s, i) => {
              const riskBar = "█".repeat(Math.round(s.totalRisk * 5)) + "░".repeat(5 - Math.round(s.totalRisk * 5));
              return `${i + 1}. [Risk ${riskBar}] ${(s.totalRisk * 100).toFixed(0)}% — ${s.memoryId} (decay:${(s.timeDecay * 100).toFixed(0)}%, impact:${(s.businessImpact * 100).toFixed(0)}%, coverage:${(s.lowCoverage * 100).toFixed(0)}%)`;
            }).join("\n");

            return {
              content: [{ type: "text", text: `${triggered.length} of ${scores.length} memories exceed risk threshold:\n\n${lines}` }],
              details: { totalChecked: scores.length, triggered: triggered.length, scores: triggered.map((s) => ({ id: s.memoryId, risk: s.totalRisk })) },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to assess risk: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "team_memory_risk" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const cmd = program
          .command("team-memory")
          .description("Team memory engine commands (v2 — Memory OS)");

        cmd
          .command("inject")
          .description("Inject a new team memory")
          .argument("<text>", "Memory content")
          .option("-c, --category <cat>", "Category", "general")
          .option("-t, --tags <tags>", "Comma-separated tags", "")
          .action(async (text: string, opts: { category: string; tags: string }) => {
            try {
              const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
              const result = await manager.inject(text, { category: opts.category, tags });
              console.log(`Stored: ${result.memory} (id: ${result.id}, v${result.metadata.version})`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        cmd
          .command("status")
          .description("Show team memory status with decay info")
          .option("-c, --category <cat>", "Filter by category")
          .action(async (opts: { category?: string }) => {
            try {
              const memories = await manager.status(opts.category);
              if (memories.length === 0) {
                console.log("No team memories stored.");
                return;
              }
              for (const m of memories) {
                const bars = "●".repeat(Math.round(m.strength * 5)) + "○".repeat(5 - Math.round(m.strength * 5));
                const cat = m.metadata.category ? ` [${m.metadata.category}]` : "";
                const ver = m.metadata.version ? ` v${m.metadata.version}` : "";
                console.log(`[${m.strengthLabel.toUpperCase()}] ${bars} ${Math.round(m.strength * 100)}%${cat}${ver}`);
                console.log(`  ${m.memory}`);
                console.log();
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        cmd
          .command("list")
          .description("List all team memories as JSON")
          .action(async () => {
            try {
              const memories = await manager.status();
              console.log(JSON.stringify(
                memories.map((m) => ({
                  id: m.id,
                  memory: m.memory,
                  category: m.metadata.category,
                  version: m.metadata.version,
                  strength: Math.round(m.strength * 100),
                  label: m.strengthLabel,
                })),
                null, 2
              ));
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        cmd
          .command("review")
          .description("Mark a memory as reviewed")
          .argument("<id>", "Memory ID")
          .action(async (id: string) => {
            try {
              await manager.forceReview(id);
              console.log(`Memory ${id} marked as reviewed.`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        cmd
          .command("search")
          .description("Search team memories")
          .argument("<query>", "Search query")
          .action(async (query: string) => {
            try {
              const results = await manager.search(query);
              if (results.length === 0) {
                console.log("No matching team memories found.");
                return;
              }
              for (const m of results) {
                const bars = "●".repeat(Math.round(m.strength * 5)) + "○".repeat(5 - Math.round(m.strength * 5));
                console.log(`[${m.strengthLabel.toUpperCase()}] ${bars} ${Math.round(m.strength * 100)}%`);
                console.log(`  ${m.memory}`);
                console.log();
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: risk command
        cmd
          .command("risk")
          .description("Assess forgetting risk for all memories")
          .action(async () => {
            try {
              const scores = await manager.assessRisk();
              const triggered = scores.filter((s) => s.triggered);

              if (triggered.length === 0) {
                console.log("No memories exceed risk thresholds.");
                return;
              }

              console.log(`${triggered.length} of ${scores.length} memories exceed risk threshold:\n`);
              for (const s of triggered) {
                const riskBar = "█".repeat(Math.round(s.totalRisk * 5)) + "░".repeat(5 - Math.round(s.totalRisk * 5));
                console.log(`  [${riskBar}] ${(s.totalRisk * 100).toFixed(0)}% ${s.memoryId}`);
                console.log(`    TimeDecay: ${(s.timeDecay * 100).toFixed(0)}% | BusinessImpact: ${(s.businessImpact * 100).toFixed(0)}% | LowCoverage: ${(s.lowCoverage * 100).toFixed(0)}%`);
                console.log(`    VersionRisk: ${(s.versionRisk * 100).toFixed(0)}% | LowUsage: ${(s.lowUsage * 100).toFixed(0)}%`);
                console.log();
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: graph command
        cmd
          .command("graph")
          .description("Show memory graph (optionally filtered by entity)")
          .argument("[entity]", "Entity name to filter")
          .action(async (entity?: string) => {
            try {
              const graph = await manager.getGraph(entity);
              console.log(JSON.stringify(graph, null, 2));
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: migrate command
        cmd
          .command("migrate")
          .description("Run v1 → v2 data migration")
          .action(async () => {
            try {
              const { runMigration } = await import("./lib/migrate.js");
              const result = await runMigration();
              console.log(`Migration complete: ${result.migrated} entries migrated`);
              if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
              if (result.errors.length > 0) {
                console.log(`Errors: ${result.errors.join(", ")}`);
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: rebuild-graph command
        cmd
          .command("rebuild-graph")
          .description("Rebuild the memory graph from current ledger state")
          .action(async () => {
            try {
              await manager.rebuildGraph();
              const graph = await manager.getGraph();
              console.log(`Graph rebuilt: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });
      },
      { commands: ["team-memory"] },
    );

    // ========================================================================
    // Services (decay check + risk check loops)
    // ========================================================================

    let decayTimer: ReturnType<typeof setInterval> | null = null;
    let riskTimer: ReturnType<typeof setInterval> | null = null;

    api.registerService({
      id: "team-memory-engine",
      async start() {
        api.logger.info(`team-memory-engine v2: starting services (decay: ${cfg.decayCheckInterval}ms, risk: ${cfg.riskCheckInterval}ms)`);

        // Decay check service
        decayTimer = setInterval(async () => {
          try {
            const reminder = await manager.checkAndFormatReminders();
            if (reminder) {
              api.logger.info(`team-memory-engine: reminders due:\n${reminder.content}`);

              // Push to Feishu if configured
              if (cfg.feishuChatId) {
                for (const card of reminder.cards) {
                  await sendFeishuMessage(
                    process.env?.FEISHU_APP_ID ?? "",
                    process.env?.FEISHU_APP_SECRET ?? "",
                    cfg.feishuChatId,
                    card,
                    "interactive"
                  );
                }
              }
            }
          } catch (err) {
            api.logger.warn(`team-memory-engine: decay check failed: ${String(err)}`);
          }
        }, cfg.decayCheckInterval);

        // Risk check service (separate interval)
        if (cfg.riskCheckInterval > 0) {
          riskTimer = setInterval(async () => {
            try {
              const scores = await manager.assessRisk();
              const triggered = scores.filter((s) => s.triggered);
              if (triggered.length > 0) {
                const summary = triggered.map((s) => `  ${s.memoryId}: ${(s.totalRisk * 100).toFixed(0)}%`).join("\n");
                api.logger.info(`team-memory-engine: risk alerts:\n${summary}`);
              }
            } catch (err) {
              api.logger.warn(`team-memory-engine: risk check failed: ${String(err)}`);
            }
          }, cfg.riskCheckInterval);
        }
      },
      stop() {
        if (decayTimer) { clearInterval(decayTimer); decayTimer = null; }
        if (riskTimer) { clearInterval(riskTimer); riskTimer = null; }
        api.logger.info("team-memory-engine: stopped");
      },
    });
  },
};

export default definePluginEntry(plugin);
