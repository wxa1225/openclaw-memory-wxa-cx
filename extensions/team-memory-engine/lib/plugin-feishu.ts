// Feishu message helpers and Mem0 HTTP client for the team-memory-engine plugin

// ============================================================================
// Feishu message push helpers
// ============================================================================

/** Format a Feishu @mention message for conflict resolution */
export function formatConflictMention(entity: string, attribute: string, reason: string): string {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: "Memory Conflict — Human Confirmation Needed" },
      template: "orange" as const,
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
export function formatConflictCard(
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
      template: "red" as const,
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
export function formatKnowledgeTransferCard(
  simulation: NonNullable<Awaited<ReturnType<import("./manager.js").TeamMemoryManager["simulateDeparture"]>>>,
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

export async function sendFeishuMessage(
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
// Mem0 Client
// ============================================================================

export interface Mem0Provider {
  add(messages: Array<{ role: string; content: string }>, options: Record<string, unknown>): Promise<any>;
  search(query: string, options: Record<string, unknown>): Promise<any>;
  getAll(options: Record<string, unknown>): Promise<any>;
  get(memoryId: string): Promise<any>;
  delete(memoryId: string): Promise<any>;
}

export class Mem0HttpClient implements Mem0Provider {
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
