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
import { EventLog } from "./lib/event-log.js";
import { analyzeForProactiveCapture, PromptRateLimiter } from "./lib/proactive-capture.js";
import { formatProactiveConfirmCard } from "./lib/proactive-card.js";

// ============================================================================
// Feishu message push helper
// ============================================================================

/** Format a Feishu @mention message for conflict resolution */
function formatConflictMention(entity: string, attribute: string, reason: string): string {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: "Memory Conflict — Human Confirmation Needed" },
      template: "orange",
    },
    elements: [
      {
        tag: "markdown" as const,
        content: [
          `**Conflict detected:** ${reason}`,
          "",
          "Please review the conflicting values and confirm which one is correct.",
          "Use `team_memory_review` or `team_memory_resolve` to resolve.",
        ].join("\n"),
      },
    ],
  };
  return JSON.stringify(card, null, 2);
}

/** Format a Feishu interactive conflict card with action buttons (used by CLI inject) */
function formatConflictCard(
  memoryId: string,
  category: string,
  claims: Array<{ version: number; value: string; confidence: number }>,
): string {
  const claimsText = claims.map((c) =>
    `**v${c.version}** [⚠️ 冲突] ${c.value} — 置信度 ${Math.round(c.confidence * 100)}%`
  ).join("\n\n");

  const v1Value = claims[0]?.value.substring(0, 8) ?? "";
  const v2Value = claims[1]?.value.substring(0, 8) ?? "";

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: "🧠 记忆冲突 — 需要裁决" },
      template: "red",
    },
    elements: [
      { tag: "div" as const, text: { tag: "plain_text" as const, content: "发现矛盾更新，请选择保留哪个版本" } },
      {
        tag: "markdown" as const,
        content: `${claimsText}\n\n💡 选错可随时点击其他按钮切换`,
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: `保留 v1 (${v1Value})` },
            type: "default" as const,
            value: { memory_id: memoryId, action: "dismiss" },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: `保留 v2 (${v2Value})` },
            type: "danger" as const,
            value: { memory_id: memoryId, action: "update" },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "两个都保留" },
            type: "primary" as const,
            value: { memory_id: memoryId, action: "confirm" },
          },
        ],
      },
    ],
  };
  return JSON.stringify(card);
}

/** Format a knowledge transfer simulation result as a Feishu interactive card */
function formatKnowledgeTransferCard(
  simulation: NonNullable<Awaited<ReturnType<import("./lib/manager.js").TeamMemoryManager["simulateDeparture"]>>>,
): string {
  const spfCount = simulation.impact.singlePointFailures.length;
  const spfLines = simulation.impact.singlePointFailures.slice(0, 5).map((spf) =>
    `**[风险 ${(spf.riskScore * 100).toFixed(0)}%]** ${spf.entity}.${spf.attribute}: ${spf.value.substring(0, 50)}`
  ).join("\n");
  const moreText = spfCount > 5 ? `\n... 还有 ${spfCount - 5} 条断层` : "";

  let recText = "无合适传承对象";
  if (simulation.recommendations.length > 0) {
    const top = simulation.recommendations[0];
    recText = `**推荐：${top.recommendedDisplayName}**（匹配度 ${(top.transferScore * 100).toFixed(0)}%）\n专业重叠 ${(top.expertiseOverlap * 100).toFixed(0)}% | 已有知识 ${(top.currentKnowledgeOverlap * 100).toFixed(0)}%`;
  }

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: "⚠️ 知识断层预警 — 传承模拟报告" },
      template: (spfCount > 3 ? "red" : spfCount > 0 ? "orange" : "green") as "red" | "orange" | "green",
    },
    elements: [
      { tag: "div" as const, text: { tag: "plain_text" as const, content: `如果 ${simulation.impact.displayName} 离开团队：` } },
      {
        tag: "markdown" as const,
        content: [
          `**核心指标**`,
          `• 知道记忆：${simulation.impact.totalMemoriesKnown} 条`,
          `• 知识断层：${spfCount} 条（仅 TA 知道）`,
          `• 风险增加：${Math.round(simulation.impact.totalRiskIncrease * 100)}%`,
          `• 知识损失率：${simulation.impact.knowledgeLossPercentage}%`,
          `• 受影响类别：${simulation.impact.affectedCategories.join(", ") || "无"}`,
          "",
          spfCount > 0 ? `**知识断层详情**\n${spfLines}${moreText}` : "**无知识断层** — 团队知识分布良好",
          "",
          `**推荐传承对象**\n${recText}`,
        ].join("\n"),
      },
    ],
  };
  return JSON.stringify(card);
}

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
  projectRoot: string;
  modelEndpoint: string;
  modelApiKey: string;
  modelName: string;
  modelXApiKey: string;
  extractionBatchSize: number;
  // Proactive Memory Capture
  enableProactiveCapture: boolean;
  proactivePromptInterval: number;
  proactiveMaxPerSession: number;
}

const ALLOWED_CONFIG_KEYS = [
  "teamId", "decayCheckInterval", "riskCheckInterval",
  "feishuChatId", "teamSize", "enableGraph",
  "projectRoot", "modelEndpoint", "modelApiKey", "modelName", "modelXApiKey", "extractionBatchSize",
  "enableProactiveCapture", "proactivePromptInterval", "proactiveMaxPerSession",
];

function parseConfig(value: Record<string, unknown>): TeamMemoryConfig {
  return {
    teamId: typeof value.teamId === "string" && value.teamId ? value.teamId : "openclaw-team",
    decayCheckInterval: typeof value.decayCheckInterval === "number" ? value.decayCheckInterval : 30 * 60 * 1000,
    riskCheckInterval: typeof value.riskCheckInterval === "number" ? value.riskCheckInterval : 60 * 60 * 1000,
    feishuChatId: typeof value.feishuChatId === "string" && value.feishuChatId ? value.feishuChatId : "",
    teamSize: typeof value.teamSize === "number" && value.teamSize > 0 ? value.teamSize : 5,
    enableGraph: typeof value.enableGraph === "boolean" ? value.enableGraph : true,
    projectRoot: typeof value.projectRoot === "string" && value.projectRoot ? value.projectRoot : "",
    modelEndpoint: typeof value.modelEndpoint === "string" ? value.modelEndpoint : "",
    modelApiKey: typeof value.modelApiKey === "string" ? value.modelApiKey : "",
    modelName: typeof value.modelName === "string" && value.modelName ? value.modelName : "qwen-plus",
    modelXApiKey: typeof value.modelXApiKey === "string" ? value.modelXApiKey : "",
    extractionBatchSize: typeof value.extractionBatchSize === "number" && value.extractionBatchSize > 0 ? value.extractionBatchSize : 20,
    // Proactive capture defaults: enabled, 2min interval, 10 max per session
    enableProactiveCapture: typeof value.enableProactiveCapture === "boolean" ? value.enableProactiveCapture : true,
    proactivePromptInterval: typeof value.proactivePromptInterval === "number" ? value.proactivePromptInterval : 2 * 60 * 1000,
    proactiveMaxPerSession: typeof value.proactiveMaxPerSession === "number" ? value.proactiveMaxPerSession : 10,
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
          projectRoot: "",
          modelEndpoint: "",
          modelApiKey: "",
          modelName: "qwen-plus",
          modelXApiKey: "",
          extractionBatchSize: 20,
          enableProactiveCapture: true,
          proactivePromptInterval: 2 * 60 * 1000,
          proactiveMaxPerSession: 10,
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

    // Use a no-op provider when Mem0 is not configured — avoids unnecessary
    // HTTP client creation and failed network requests.
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
    });

    api.logger.info(
      `team-memory-engine v2: registered (team: ${cfg.teamId}, decayInterval: ${cfg.decayCheckInterval}ms, riskInterval: ${cfg.riskCheckInterval}ms, feishuChat: ${cfg.feishuChatId || "not set"}, graph: ${cfg.enableGraph})`,
    );

    // Async init (migration) — fire-and-forget so it doesn't block tool registration
    manager.initialize().catch((err: unknown) => {
      api.logger.warn(`team-memory-engine: initialization failed: ${String(err)}`);
    });

    // ========================================================================
    // Event Log Hooks — capture conversation flow into Event Log
    // ========================================================================

    // Proactive capture rate limiter (per-plugin-instance, resets on restart)
    const rateLimiter = new PromptRateLimiter({
      minIntervalMs: cfg.proactivePromptInterval,
      maxPerSession: cfg.proactiveMaxPerSession,
    });

    // Owner user ID for confidence adjustment (from OpenClaw config if available)
    const ownerUserId = api.resolveConfig?.("feishu.ownerId") ?? "";

    // Only enable event logging if projectRoot is configured
    if (cfg.projectRoot) {
      const eventLog = new EventLog(cfg.projectRoot);

      // Capture user messages before agent processes them
      api.on("before_agent_start", async (event: unknown, ctx: unknown) => {
        const evt = event as { prompt?: string };
        if (!evt.prompt || !evt.prompt.trim()) return;

        const prompt = evt.prompt.trim();
        // Skip very short messages (likely noise or commands)
        if (prompt.length < 3) return;

        // Skip internal system/tool messages to avoid feedback loops
        const skipPrefixes = ["<system", "<tool", "Team memory stored:", "Memory updated"];
        if (skipPrefixes.some((p) => prompt.startsWith(p))) return;

        // ============================================================
        // Proactive Memory Capture — real-time decision detection
        // ============================================================
        if (cfg.enableProactiveCapture && cfg.feishuChatId) {
          try {
            const capture = analyzeForProactiveCapture(prompt, {
              isOwner: true, // Running in owner context
              isGroup: false, // DM session
            });

            if (capture.detected && rateLimiter.canPrompt()) {
              rateLimiter.recordPrompt();
              api.logger.info(
                `team-memory-engine: proactive capture detected [${capture.triggerType}] confidence=${(capture.confidence * 100).toFixed(0)}% — "${capture.memoryText.substring(0, 60)}"`
              );

              // Send Feishu interactive confirmation card
              const card = formatProactiveConfirmCard(capture);
              await sendFeishuMessage(
                process.env?.FEISHU_APP_ID ?? "",
                process.env?.FEISHU_APP_SECRET ?? "",
                cfg.feishuChatId,
                card,
                "interactive"
              );
            }
          } catch (err) {
            // Proactive capture failure — non-critical, don't block agent
            api.logger.warn(`team-memory-engine: proactive capture error: ${String(err)}`);
          }
        }

        const sessionKey = (ctx as Record<string, unknown>)?.sessionKey as string | undefined;
        const agentId = (ctx as Record<string, unknown>)?.agentId as string | undefined;

        try {
          await eventLog.append({
            chatId: sessionKey ?? "unknown-session",
            chatType: "p2p",
            senderId: "user",
            senderName: undefined,
            content: prompt,
            contentType: "text",
            messageId: `msg-${Date.now()}`,
            threadId: undefined,
            participants: agentId ? [agentId, "user"] : undefined,
          });
        } catch (err) {
          api.logger.warn(`team-memory-engine: event log append failed: ${String(err)}`);
        }
      });

      // Capture agent responses after they complete
      api.on("agent_end", async (event: unknown, ctx: unknown) => {
        const evt = event as { success?: boolean; messages?: unknown[] };
        if (!evt.success || !evt.messages || evt.messages.length === 0) return;

        const sessionKey = (ctx as Record<string, unknown>)?.sessionKey as string | undefined;

        try {
          const messages = evt.messages as Array<{ role?: string; content?: string | Array<{ type: string; text: string }> }>;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg?.role === "assistant") {
              const content = msg.content;
              let textContent = "";
              if (typeof content === "string") {
                textContent = content;
              } else if (Array.isArray(content)) {
                for (const block of content) {
                  if (
                    block && typeof block === "object" &&
                    (block as Record<string, unknown>).type === "text" &&
                    typeof (block as Record<string, unknown>).text === "string"
                  ) {
                    textContent += (textContent ? "\n" : "") + (block as Record<string, unknown>).text;
                  }
                }
              }
              if (textContent.trim()) {
                await eventLog.append({
                  chatId: sessionKey ?? "unknown-session",
                  chatType: "p2p",
                  senderId: "agent",
                  senderName: "AI",
                  content: textContent.trim(),
                  contentType: "text",
                  messageId: `msg-${Date.now()}-agent`,
                });
              }
              break;
            }
          }
        } catch (err) {
          api.logger.warn(`team-memory-engine: agent_end event log failed: ${String(err)}`);
        }
      });
    } else {
      api.logger.info("team-memory-engine: event logging disabled (projectRoot not configured)");
    }

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
        async execute(_toolCallId: unknown, params: unknown) {
          try {
            const { text, category, tags } = params as { text: string; category?: string; tags?: string[] };
            const result = await manager.inject(text, { category, tags, author: "agent" });
            const conflictMsg = result.conflict
              ? `\nConflict detected (${result.conflict.type}): ${result.conflict.reason}`
              : "";

            // Send Feishu @mention for human-confirm conflicts
            if (result.conflict?.type === "human-confirm" && cfg.feishuChatId) {
              const card = formatConflictMention(
                result.metadata.injectedBy,
                result.metadata.category,
                result.conflict.reason
              );
              await sendFeishuMessage(
                process.env?.FEISHU_APP_ID ?? "",
                process.env?.FEISHU_APP_SECRET ?? "",
                cfg.feishuChatId,
                card,
                "interactive"
              );
            }

            return {
              content: [{ type: "text", text: `Team memory stored: "${result.memory}" (id: ${result.id}, v${result.metadata.version})${conflictMsg}` }],
              details: { action: "injected", id: result.id, conflict: result.conflict },
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
        async execute(_toolCallId: unknown, params: unknown) {
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
        async execute(_toolCallId: unknown, params: unknown) {
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
        async execute(_toolCallId: unknown, params: unknown) {
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
        async execute(_toolCallId: unknown, params: unknown) {
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

    // NEW: Memory extraction tool
    api.registerTool(
      {
        name: "team_memory_extract",
        label: "Team Memory Extract",
        description: "Run LLM-based memory extraction on unprocessed event log entries. Use after group discussions to automatically capture team decisions and facts.",
        parameters: Type.Object({
          limit: Type.Optional(Type.Number({ description: "Max events to process (default: 20)" })),
        }),
        async execute(_toolCallId: unknown, params: unknown) {
          try {
            const limit = (params as any)?.limit ?? cfg.extractionBatchSize;
            if (!cfg.projectRoot) {
              return { content: [{ type: "text", text: "Event log not configured. Set projectRoot in config." }] };
            }
            const eventLog = new EventLog(cfg.projectRoot);
            const unprocessed = await eventLog.getUnprocessed();
            const batch = unprocessed.slice(0, limit);
            if (batch.length === 0) {
              return { content: [{ type: "text", text: "No unprocessed events found." }] };
            }
            const extracted = await manager.injectFromEvent(batch);
            await eventLog.markProcessed(batch.map((e) => e.id));
            return {
              content: [{ type: "text", text: `Extracted ${extracted.length} memories from ${batch.length} events.` }],
              details: { extracted: extracted.length, processed: batch.length },
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Failed to extract: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "team_memory_extract" },
    );

    // NEW: TMS tool
    api.registerTool(
      {
        name: "team_memory_tms",
        label: "Team Capability Profile",
        description: "Query which team members know which memories. Returns member expertise areas, known memories, and trust scores.",
        parameters: Type.Object({
          memberId: Type.Optional(Type.String({ description: "Filter by member ID" })),
        }),
        async execute(_toolCallId: unknown, params: unknown) {
          try {
            if (!cfg.projectRoot) {
              return { content: [{ type: "text", text: "TMS not configured. Set projectRoot in config." }] };
            }
            const { TeamCapabilityModel } = await import("./lib/tms.js");
            const tms = new TeamCapabilityModel(cfg.teamId, cfg.projectRoot);
            await tms.load();
            const memberId = (params as any)?.memberId;
            if (memberId) {
              const member = tms.getMember(memberId);
              if (!member) return { content: [{ type: "text", text: `Member not found: ${memberId}` }] };
              return { content: [{ type: "text", text: `${member.memberId} (${member.displayName})\nExpertise: ${member.expertiseAreas.join(", ") || "none"}\nKnown memories: ${member.knownMemoryIds.length}\nTrust: ${(member.trustScore * 100).toFixed(0)}%` }] };
            }
            const members = tms.getAllMembers();
            if (members.length === 0) return { content: [{ type: "text", text: "No team members tracked yet." }] };
            const lines = members.map((m) => `${m.memberId}: expertise=[${m.expertiseAreas.join(", ")}], memories=${m.knownMemoryIds.length}, trust=${(m.trustScore * 100).toFixed(0)}%`);
            return { content: [{ type: "text", text: `${members.length} team members:\n\n${lines.join("\n")}` }] };
          } catch (err) {
            return { content: [{ type: "text", text: `Failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "team_memory_tms" },
    );

    // NEW: Knowledge transfer simulation tool
    api.registerTool(
      {
        name: "team_memory_simulate",
        label: "Team Memory Knowledge Transfer Simulation",
        description: "Simulate a team member leaving and analyze knowledge gaps, risk changes, and transfer recommendations. Use for team planning and knowledge management.",
        parameters: Type.Object({
          memberId: Type.String({ description: "The member ID to simulate departure for" }),
        }),
        async execute(_toolCallId: unknown, params: unknown) {
          try {
            const { memberId } = params as { memberId: string };
            if (!cfg.projectRoot) {
              return { content: [{ type: "text", text: "Simulation requires TMS. Set projectRoot in config." }] };
            }
            const result = await manager.simulateDeparture(memberId);
            if (!result) {
              return { content: [{ type: "text", text: `Member not found: ${memberId}` }] };
            }
            const lines = [
              `Knowledge transfer simulation for ${result.impact.displayName}:`,
              ``,
              `  Memories known: ${result.impact.totalMemoriesKnown}`,
              `  Single points of failure: ${result.impact.singlePointFailures.length}`,
              `  Team risk increase: ${Math.round(result.impact.totalRiskIncrease * 100)}%`,
              `  Knowledge loss: ${result.impact.knowledgeLossPercentage}%`,
              `  Affected categories: ${result.impact.affectedCategories.join(", ") || "none"}`,
              ``,
              `Single points of failure:`,
            ];
            for (const spf of result.impact.singlePointFailures.slice(0, 10)) {
              lines.push(`  - ${spf.entity}.${spf.attribute}: "${spf.value.substring(0, 50)}" (risk: ${(spf.riskScore * 100).toFixed(0)}%)`);
            }
            if (result.impact.singlePointFailures.length > 10) {
              lines.push(`  ... and ${result.impact.singlePointFailures.length - 10} more`);
            }
            if (result.recommendations.length > 0) {
              lines.push(``, `Recommended transfer target:`);
              const rec = result.recommendations[0];
              lines.push(`  ${rec.recommendedDisplayName} (match: ${(rec.transferScore * 100).toFixed(0)}%)`);
              lines.push(`  ${rec.reason}`);
            }
            lines.push(``, result.summary);
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { simulation: result },
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "team_memory_simulate" },
    );

    // NEW: Knowledge gaps tool
    api.registerTool(
      {
        name: "team_memory_gaps",
        label: "Team Knowledge Gaps Analysis",
        description: "Find all memories known by only one person (single points of failure). Use to identify team knowledge risks.",
        parameters: Type.Object({}),
        async execute(_toolCallId: unknown, _params: unknown) {
          try {
            if (!cfg.projectRoot) {
              return { content: [{ type: "text", text: "Knowledge gaps analysis requires TMS. Set projectRoot in config." }] };
            }
            const gaps = await manager.getKnowledgeGaps();
            if (gaps.length === 0) {
              return { content: [{ type: "text", text: "No single points of failure found. Team knowledge is well distributed." }] };
            }
            const lines = [
              `${gaps.length} single point(s) of failure found:`,
              ``,
            ];
            for (const gap of gaps.slice(0, 15)) {
              lines.push(`  - ${gap.currentHolder} knows: ${gap.entity}.${gap.attribute} = "${gap.value.substring(0, 50)}" (risk: ${(gap.riskScore * 100).toFixed(0)}%)`);
            }
            if (gaps.length > 15) {
              lines.push(`  ... and ${gaps.length - 15} more`);
            }
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { gaps },
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "team_memory_gaps" },
    );

    // NEW: Memory Insight Dashboard tool
    api.registerTool(
      {
        name: "team_memory_insight",
        label: "Team Memory Insight Report",
        description: "Generate a comprehensive team memory insight dashboard report. Shows knowledge heatmap, loss risk ranking, lifecycle stats, and TMS network. Use for team reviews, planning, and identifying knowledge risks.",
        parameters: Type.Object({
          format: Type.Optional(Type.String({ description: "Output format: html (default) or json" })),
          outputPath: Type.Optional(Type.String({ description: "File path to save the report (default: team-memory-report.html)" })),
        }),
        async execute(_toolCallId: unknown, params: unknown) {
          try {
            const format = ((params as any)?.format as "html" | "json") ?? "html";
            const outputPath = ((params as any)?.outputPath as string) ?? (format === "html" ? "team-memory-report.html" : "team-memory-report.json");
            const { report, format: actualFormat } = await manager.generateInsightReport(format);

            // Write to file
            const fs = await import("fs");
            await fs.promises.writeFile(outputPath, report, "utf-8");

            return {
              content: [{ type: "text", text: `Memory insight report generated: ${outputPath} (${actualFormat}, ${(Buffer.byteLength(report, "utf-8") / 1024).toFixed(1)} KB)` }],
              details: { outputPath, format: actualFormat, sizeBytes: Buffer.byteLength(report, "utf-8") },
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Failed to generate insight report: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "team_memory_insight" },
    );

    // NEW: Proactive memory capture tool — agent can use this to save a detected decision
    api.registerTool(
      {
        name: "team_memory_proactive",
        label: "Team Memory Proactive Save",
        description: "Save a memory detected from conversation. Use when you notice the team making a decision, stating a fact, or setting a rule that should be remembered long-term.",
        parameters: Type.Object({
          text: Type.String({ description: "The memory content detected from conversation" }),
          triggerType: Type.Optional(Type.String({ description: "What triggered this detection: decision_made, future_commitment, policy_change, explicit_save, etc." })),
          category: Type.Optional(Type.String({ description: "Category: decision, process, api, security, experience, general" })),
          tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to attach" })),
        }),
        async execute(_toolCallId: unknown, params: unknown) {
          try {
            const { text, triggerType, category, tags } = params as { text: string; triggerType?: string; category?: string; tags?: string[] };
            const allTags = [...(tags ?? []), "proactive", triggerType ?? "manual"];
            const result = await manager.inject(text, { category: category ?? "decision", tags: allTags, author: "agent" });
            return {
              content: [{ type: "text", text: `Proactive memory stored: "${result.memory}" (id: ${result.id}, v${result.metadata.version}, triggered by: ${triggerType ?? "manual"})` }],
              details: { action: "proactive_injected", id: result.id, triggerType },
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Failed to save proactive memory: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "team_memory_proactive" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ program }: { program: any }) => {
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
              if (result.conflict) {
                console.log(`  ⚡ 冲突检测：${result.conflict.type} — 已标记 conflicting，等待人工裁决`);
                console.log(`     原因：${result.conflict.reason}`);
                // Push Feishu interactive card with action buttons
                if (result.conflict.type !== "auto-cover" && cfg.feishuChatId) {
                  const entry = await manager.getEntry(result.id);
                  if (entry) {
                    const conflictingClaims = entry.claims.filter((c) => c.status === "conflicting");
                    const claimsForCard = conflictingClaims.length > 0
                      ? conflictingClaims.map((c) => ({ version: c.version, value: c.value, confidence: c.confidence }))
                      : entry.claims.slice(-2).map((c) => ({ version: c.version, value: c.value, confidence: c.confidence }));
                    const card = formatConflictCard(result.id, entry.category, claimsForCard);
                    await sendFeishuMessage(
                      process.env?.FEISHU_APP_ID ?? "",
                      process.env?.FEISHU_APP_SECRET ?? "",
                      cfg.feishuChatId,
                      card,
                      "interactive"
                    );
                    console.log(`  📤 飞书冲突卡片已推送到群聊`);
                  }
                }
              }
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

        // NEW: extract command
        cmd
          .command("extract")
          .description("Run LLM memory extraction on unprocessed event log entries")
          .option("-l, --limit <n>", "Max events to process", "20")
          .action(async (opts: { limit: string }) => {
            try {
              if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
              const eventLog = new EventLog(cfg.projectRoot);
              const unprocessed = await eventLog.getUnprocessed();
              const limit = parseInt(opts.limit, 10);
              const batch = unprocessed.slice(0, limit);
              if (batch.length === 0) { console.log("No unprocessed events."); return; }
              const extracted = await manager.injectFromEvent(batch);
              await eventLog.markProcessed(batch.map((e) => e.id));
              console.log(`Extracted ${extracted.length} memories from ${batch.length} events`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: tms command
        cmd
          .command("tms")
          .description("Show team capability profile")
          .argument("[memberId]", "Filter by member")
          .action(async (memberId?: string) => {
            try {
              if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
              const { TeamCapabilityModel } = await import("./lib/tms.js");
              const tms = new TeamCapabilityModel(cfg.teamId, cfg.projectRoot);
              await tms.load();
              if (memberId) {
                const m = tms.getMember(memberId);
                if (!m) { console.log("Member not found"); return; }
                console.log(`${m.memberId} (${m.displayName})`);
                console.log(`  Expertise: ${m.expertiseAreas.join(", ") || "none"}`);
                console.log(`  Known memories: ${m.knownMemoryIds.length}`);
                console.log(`  Trust: ${(m.trustScore * 100).toFixed(0)}%`);
                return;
              }
              const members = tms.getAllMembers();
              if (members.length === 0) { console.log("No members tracked."); return; }
              for (const m of members) {
                console.log(`${m.memberId}: expertise=[${m.expertiseAreas.join(", ")}], memories=${m.knownMemoryIds.length}, trust=${(m.trustScore * 100).toFixed(0)}%`);
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: simulate-departure command
        cmd
          .command("simulate-departure")
          .description("Simulate a member leaving — show knowledge gaps, risk changes, transfer recommendations")
          .argument("<memberId>", "Member ID to simulate departure for")
          .option("-j, --json", "Output as JSON")
          .action(async (memberId: string, opts: { json?: boolean }) => {
            try {
              if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
              const result = await manager.simulateDeparture(memberId);
              if (!result) { console.log("Member not found."); return; }
              if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
              }
              console.log(`\n=== 知识传承模拟：${result.impact.displayName} 离开团队 ===\n`);
              console.log(`总记忆数: ${result.impact.totalMemoriesKnown}`);
              console.log(`知识断层: ${result.impact.singlePointFailures.length} 条（仅 TA 知道）`);
              console.log(`团队风险增加: ${Math.round(result.impact.totalRiskIncrease * 100)}%`);
              console.log(`知识损失率: ${result.impact.knowledgeLossPercentage}%`);
              console.log(`受影响类别: ${result.impact.affectedCategories.join(", ") || "无"}\n`);

              if (result.impact.singlePointFailures.length > 0) {
                console.log("--- 知识断层详情 ---\n");
                for (const spf of result.impact.singlePointFailures) {
                  console.log(`  [风险 ${(spf.riskScore * 100).toFixed(0)}%] ${spf.entity}.${spf.attribute}`);
                  console.log(`    内容: "${spf.value}"`);
                  console.log(`    类别: ${spf.category}\n`);
                }
              }

              if (result.recommendations.length > 0) {
                console.log("--- 推荐传承对象 ---\n");
                for (const rec of result.recommendations.slice(0, 3)) {
                  console.log(`  ${rec.recommendedDisplayName} (匹配度 ${(rec.transferScore * 100).toFixed(0)}%)`);
                  console.log(`    专业重叠: ${(rec.expertiseOverlap * 100).toFixed(0)}%`);
                  console.log(`    已有知识: ${(rec.currentKnowledgeOverlap * 100).toFixed(0)}%`);
                  console.log(`    信任度: ${(rec.trustScore * 100).toFixed(0)}%`);
                  console.log(`    ${rec.reason}\n`);
                }
              }

              console.log(result.summary);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: knowledge-gaps command
        cmd
          .command("knowledge-gaps")
          .description("Find memories known by only one person (single points of failure)")
          .action(async () => {
            try {
              if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
              const gaps = await manager.getKnowledgeGaps();
              if (gaps.length === 0) {
                console.log("No single points of failure. Team knowledge is well distributed.");
                return;
              }
              console.log(`${gaps.length} single point(s) of failure:\n`);
              for (const gap of gaps) {
                console.log(`  [${gap.currentHolder}] ${gap.entity}.${gap.attribute} = "${gap.value.substring(0, 60)}" (risk: ${(gap.riskScore * 100).toFixed(0)}%)`);
              }
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: pipeline command
        cmd
          .command("pipeline")
          .description("Run the full event-log → extract → ledger → graph pipeline once")
          .option("-b, --batch-size <n>", "Events to process per batch", "20")
          .action(async (opts: { batchSize: string }) => {
            try {
              if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
              const eventLog = new EventLog(cfg.projectRoot);
              const unprocessed = await eventLog.getUnprocessed();
              const batchSize = parseInt(opts.batchSize, 10);
              const batch = unprocessed.slice(0, batchSize);
              if (batch.length === 0) { console.log("No unprocessed events."); return; }
              const extracted = await manager.injectFromEvent(batch);
              await eventLog.markProcessed(batch.map((e) => e.id));
              console.log(`Pipeline: extracted ${extracted.length} memories from ${batch.length} events`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: insight command
        cmd
          .command("insight")
          .description("Generate team memory insight dashboard report")
          .option("-f, --format <fmt>", "Output format: html (default) or json", "html")
          .option("-o, --output <path>", "Output file path", "")
          .action(async (opts: { format: string; output: string }) => {
            try {
              const format = opts.format as "html" | "json";
              const outputPath = opts.output || (format === "html" ? "team-memory-report.html" : "team-memory-report.json");
              const { report, format: actualFormat } = await manager.generateInsightReport(format);
              const fs = await import("fs");
              await fs.promises.writeFile(outputPath, report, "utf-8");
              const sizeKB = (Buffer.byteLength(report, "utf-8") / 1024).toFixed(1);
              console.log(`Insight report generated: ${outputPath} (${actualFormat}, ${sizeKB} KB)`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        // NEW: proactive-capture command (demo / testing)
        cmd
          .command("proactive-capture")
          .description("Analyze text for proactive memory capture (demo tool)")
          .argument("<text>", "Text to analyze for memory-worthy content")
          .action(async (text: string) => {
            try {
              const capture = analyzeForProactiveCapture(text, { isOwner: true, isGroup: false });
              if (capture.detected) {
                console.log(`✅ Detected [${capture.triggerType}] confidence=${(capture.confidence * 100).toFixed(0)}%`);
                console.log(`   Category: ${capture.category}`);
                console.log(`   Memory: ${capture.memoryText}`);
                if (capture.entity) console.log(`   Entity: ${capture.entity}`);
                if (capture.attribute) console.log(`   Attribute: ${capture.attribute}`);
                if (capture.value) console.log(`   Value: ${capture.value}`);
                console.log(`   Prompt: ${capture.confirmationPrompt}`);
              } else {
                console.log("❌ No memory-worthy content detected");
              }
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

    // ========================================================================
    // Pipeline service (event-log → extract → ledger → graph → TMS)
    // ========================================================================

    let pipelineTimer: ReturnType<typeof setInterval> | null = null;

    api.registerService({
      id: "team-memory-pipeline",
      async start() {
        if (!cfg.projectRoot) return; // Event log not configured

        api.logger.info(`team-memory-pipeline: starting (5min interval, batchSize: ${cfg.extractionBatchSize})`);

        pipelineTimer = setInterval(async () => {
          try {
            const eventLog = new EventLog(cfg.projectRoot);
            const unprocessed = await eventLog.getUnprocessed();
            if (unprocessed.length === 0) return;

            const batch = unprocessed.slice(0, cfg.extractionBatchSize);
            const extracted = await manager.injectFromEvent(batch);
            if (extracted.length === 0) return;

            await eventLog.markProcessed(batch.map((e) => e.id));
            api.logger.info(`team-memory-pipeline: extracted ${extracted.length} memories from ${batch.length} events`);
          } catch (err) {
            api.logger.warn(`team-memory-pipeline: failed: ${String(err)}`);
          }
        }, 5 * 60 * 1000);
      },
      stop() {
        if (pipelineTimer) { clearInterval(pipelineTimer); pipelineTimer = null; }
        api.logger.info("team-memory-pipeline: stopped");
      },
    });
  },
};

export default definePluginEntry(plugin);
