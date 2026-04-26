/**
 * Team Memory Engine Plugin
 *
 * Team knowledge memory with Ebbinghaus forgetting curve and version management.
 * Built on top of Mem0 for storage, adding:
 * - Team-scoped memory injection
 * - Spaced repetition decay model
 * - Version management (update preserves history chain)
 * - Scheduled review reminders
 *
 * Configuration (in openclaw.json):
 *   plugins.entries["team-memory-engine"].config: {
 *     "teamId": "openclaw-team",
 *     "decayCheckInterval": 1800000,
 *     "feishuChatId": "oc_xxx"
 *   }
 *
 * Also supports env vars:
 *   TEAM_MEMORY_TEAM_ID
 *   TEAM_MEMORY_DECAY_INTERVAL
 *   TEAM_MEMORY_FEISHU_CHAT_ID
 */

import { Type } from "@sinclair/typebox";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { TeamMemoryManager, type Mem0Provider } from "./lib/manager.js";
import { formatReviewCard, type TeamMemoryMeta } from "./lib/decay.js";

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
    // Step 1: Get tenant_access_token
    const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!tokenResp.ok) return false;
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) return false;
    const token = tokenData.tenant_access_token;

    // Step 2: Send message to chat
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

/** Format reminder text as a Feishu interactive card JSON */
async function formatReviewCardsForChat(reminder: string): Promise<string> {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: "🔔 Team Memory Review Reminder" },
      template: "orange" as const,
    },
    elements: [
      { tag: "markdown" as const, content: `**Memories needing review:**\n\n${reminder}` },
      { tag: "note" as const, elements: [{ tag: "plain_text" as const, content: "Team Memory Engine — Ebbinghaus Spaced Repetition" }] },
    ],
  };
  return JSON.stringify(card);
}

// ============================================================================
// Config
// ============================================================================

interface TeamMemoryConfig {
  teamId: string;
  decayCheckInterval: number;
  feishuChatId: string;
}

const ALLOWED_CONFIG_KEYS = ["teamId", "decayCheckInterval", "feishuChatId"];

function parseConfig(value: Record<string, unknown>): TeamMemoryConfig {
  const unknown = Object.keys(value).filter((k) => !ALLOWED_CONFIG_KEYS.includes(k));
  if (unknown.length > 0) {
    throw new Error(`team-memory-engine config has unknown keys: ${unknown.join(", ")}`);
  }

  return {
    teamId: typeof value.teamId === "string" && value.teamId ? value.teamId : "openclaw-team",
    decayCheckInterval: typeof value.decayCheckInterval === "number" ? value.decayCheckInterval : 30 * 60 * 1000,
    feishuChatId: typeof value.feishuChatId === "string" && value.feishuChatId ? value.feishuChatId : "",
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
  const interval = get("TEAM_MEMORY_DECAY_INTERVAL");
  const chatId = get("TEAM_MEMORY_FEISHU_CHAT_ID");
  if (teamId) cfg.teamId = teamId;
  if (interval) cfg.decayCheckInterval = parseInt(interval, 10);
  if (chatId) cfg.feishuChatId = chatId;
  return cfg;
}

// ============================================================================
// Mem0 Client (reusing from mem0-plugin lib)
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
    const opts: RequestInit = {
      method,
      headers: this.headers,
    };
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
    const payload = { messages, ...options };
    return this.request("POST", "/v1/memories/", payload);
  }

  async search(query: string, options: Record<string, unknown>) {
    const payload = { query, ...options };
    return this.request("POST", "/v1/memories/search/", payload);
  }

  async getAll(options: Record<string, unknown>) {
    const params = new URLSearchParams(
      Object.entries(options)
        .filter(([_, v]) => v != null)
        .map(([k, v]) => [k, String(v)])
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
  description: "Team knowledge memory with Ebbinghaus decay curve, version management, and review reminders",
  kind: "memory" as const,
  configSchema: {
    parse(value: unknown): TeamMemoryConfig {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { teamId: "openclaw-team", decayCheckInterval: 30 * 60 * 1000, feishuChatId: "" };
      }
      const envOverrides = {}; // would need to be called separately
      const merged = { ...(value as Record<string, unknown>) };
      return parseConfig(merged);
    },
  },

  register(api: OpenClawPluginApi) {
    const rawConfig = api.pluginConfig && typeof api.pluginConfig === "object" && !Array.isArray(api.pluginConfig)
      ? api.pluginConfig as Record<string, unknown>
      : {};
    const envConfig = getConfigFromEnv(api);
    const cfg = parseConfig({ ...rawConfig, ...envConfig });

    // Resolve Mem0 credentials from secrets or env
    const mem0ApiKey = process.env?.MEM0_API_KEY ?? api.resolveConfig?.("mem0.apiKey") ?? "";
    const mem0Host = process.env?.MEM0_HOST ?? api.resolveConfig?.("mem0.host") ?? "https://api.mem0.ai";

    if (!mem0ApiKey) {
      api.logger.warn("team-memory-engine: MEM0_API_KEY not set, memory operations will fail");
    }

    const mem0Client = new Mem0HttpClient(mem0ApiKey, mem0Host);
    const manager = new TeamMemoryManager(mem0Client, {
      teamId: cfg.teamId,
      defaultUserId: "openclaw-user",
    });

    api.logger.info(
      `team-memory-engine: registered (team: ${cfg.teamId}, decayInterval: ${cfg.decayCheckInterval}ms, feishuChat: ${cfg.feishuChatId || "not set"})`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "team_memory_inject",
        label: "Team Memory Inject",
        description: "Inject a new team memory with decay tracking. Use when team makes a decision, records a fact, or notes an important item to remember long-term.",
        parameters: Type.Object({
          text: Type.String({ description: "The memory content to store" }),
          category: Type.Optional(Type.String({ description: "Category tag (e.g., security, decision, api, process)" })),
          tags: Type.Optional(Type.Array(Type.String(), { description: "Additional tags for searchability" })),
        }),
        async execute(_toolCallId, params) {
          try {
            const { text, category, tags } = params as { text: string; category?: string; tags?: string[] };
            const result = await manager.inject(text, { category, tags, author: "agent" });
            return {
              content: [{ type: "text", text: `Team memory stored: "${result.memory}" (id: ${result.id})` }],
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
        description: "Update an existing team memory. Searches by query, then replaces with new content. Preserves version history.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query to find the memory to update" }),
          newText: Type.String({ description: "The new content to replace with" }),
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
              const injectedBy = m.metadata.injected_by ? ` @${m.metadata.injected_by}` : "";
              return `${i + 1}. ${m.memory.substring(0, 60)}${m.memory.length > 60 ? "..." : ""}${categoryStr}${versionStr}\n   Strength: ${bars} (${Math.round(m.strength * 100)}%)${injectedBy}`;
            }).join("\n");

            return {
              content: [{ type: "text", text: `${memories.length} team memories:\n\n${lines}` }],
              details: { count: memories.length, memories: memories.map((m) => ({ id: m.id, memory: m.memory.substring(0, 100), strength: m.strength, strengthLabel: m.strengthLabel })) },
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
              content: [{ type: "text", text: `Memory ${memoryId} marked as reviewed. Decay curve reset to next interval.` }],
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

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const cmd = program
          .command("team-memory")
          .description("Team memory engine commands");

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
              console.log(`Stored: ${result.memory} (id: ${result.id})`);
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
                console.log(`  by: ${m.metadata.injected_by ?? "unknown"} at: ${m.metadata.injected_at ?? "unknown"}`);
                console.log();
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        cmd
          .command("list")
          .description("List all team memories (alias for status)")
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
      },
      { commands: ["team-memory"] },
    );

    // ========================================================================
    // Service (decay check loop)
    // ========================================================================

    let decayTimer: ReturnType<typeof setInterval> | null = null;

    api.registerService({
      id: "team-memory-engine",
      async start() {
        api.logger.info(`team-memory-engine: starting decay check service (interval: ${cfg.decayCheckInterval}ms)`);

        decayTimer = setInterval(async () => {
          try {
            const reminder = await manager.checkAndFormatReminders();
            if (reminder && cfg.feishuChatId) {
              // Try to send to Feishu group chat
              const appId = (process.env as Record<string, string>)?.FEISHU_APP_ID ??
                (api.config as any)?.channels?.feishu?.appId ?? "";
              const appSecret = (process.env as Record<string, string>)?.FEISHU_APP_SECRET ??
                (api.config as any)?.channels?.feishu?.appSecret ?? "";

              if (appId && appSecret) {
                const cardJson = await formatReviewCardsForChat(reminder);
                const sent = await sendFeishuMessage(appId, appSecret, cfg.feishuChatId, cardJson, "interactive");
                if (sent) {
                  api.logger.info("team-memory-engine: review reminder pushed to Feishu successfully");
                } else {
                  api.logger.warn("team-memory-engine: failed to push reminder to Feishu, falling back to log");
                  api.logger.info(`team-memory-engine: decay reminders due:\n${reminder}`);
                }
              } else {
                api.logger.info(`team-memory-engine: decay reminders due (no Feishu credentials):\n${reminder}`);
              }
            } else if (reminder) {
              api.logger.info(`team-memory-engine: decay reminders due:\n${reminder}`);
            }
          } catch (err) {
            api.logger.warn(`team-memory-engine: decay check failed: ${String(err)}`);
          }
        }, cfg.decayCheckInterval);
      },
      stop() {
        if (decayTimer) {
          clearInterval(decayTimer);
          decayTimer = null;
        }
        api.logger.info("team-memory-engine: stopped");
      },
    });
  },
};

export default definePluginEntry(plugin);
