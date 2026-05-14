/**
 * 团队记忆引擎 — 飞书交互式演示（终端控制 + 飞书卡片实时推送）
 *
 * 用法: npx tsx extensions/team-memory-engine/scripts/live-demo.ts
 *
 * 终端输入命令 → 卡片实时推送到飞书
 * 冲突裁决在终端交互选择 → 结果卡片推送到飞书
 * 所有数据从真实 ledger 读取，非硬编码
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  red: '\x1b[31m', blue: '\x1b[34m', bold: '\x1b[1m', dim: '\x1b[2m',
  brightGreen: '\x1b[92m', brightCyan: '\x1b[96m', magenta: '\x1b[35m',
};

function title(t: string) {
  console.log(`\n${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${t}${C.reset}`);
  console.log(`${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
}
function ok(m: string) { console.log(`  ${C.green}✓${C.reset} ${m}`); }
function warn(m: string) { console.log(`  ${C.yellow}⚠${C.reset} ${m}`); }
function err(m: string) { console.log(`  ${C.red}✗${C.reset} ${m}`); }

// ================== 配置 ==================
function resolveConfig() {
  let receiveId = process.env.TEAM_MEMORY_FEISHU_RECEIVE_ID;
  let receiveType = "chat_id";
  let appId = process.env.FEISHU_APP_ID;
  let appSecret = process.env.FEISHU_APP_SECRET;

  const cfgPath = path.join(process.cwd(), "openclaw.json");
  const secretsPath = process.env.TEAM_MEMORY_SECRETS_PATH
    ?? "/home/gem/workspace/.force/openclaw/miaoda-openclaw-secrets.json";

  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as any;
    if (!appId && cfg.channels?.feishu?.appId) appId = cfg.channels.feishu.appId;
    if (!appSecret && fs.existsSync(secretsPath)) {
      appSecret = JSON.parse(fs.readFileSync(secretsPath, "utf-8")).channels_feishu_app_secret;
    }
    // 优先使用 plugin config 中的 feishuChatId（群聊 ID）
    if (!receiveId) {
      const entry = cfg.plugins?.entries?.["team-memory-engine"]?.config;
      if (entry?.feishuChatId) {
        receiveId = entry.feishuChatId;
        receiveType = "chat_id";
      }
    }
    // 如果还是没有，用 owner 的 open_id 作为 fallback
    if (!receiveId && cfg.channels?.feishu?.allowFrom?.[0]) {
      receiveId = cfg.channels.feishu.allowFrom[0];
      receiveType = "open_id";
    }
  }

  if (!receiveId || !appId || !appSecret) {
    console.error(`${C.red}缺少飞书配置${C.reset}`);
    process.exit(1);
  }
  return { receiveId, appId, appSecret, receiveType };
}

// ================== Feishu API ==================
async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json() as { code: number; tenant_access_token?: string };
  if (data.code !== 0 || !data.tenant_access_token) throw new Error("获取飞书 token 失败");
  return data.tenant_access_token;
}

async function sendCard(token: string, rid: string, card: Record<string, unknown>, type = "open_id") {
  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: rid, msg_type: "interactive", content: JSON.stringify(card) }),
  });
  const data = await resp.json() as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`飞书卡片发送失败: ${JSON.stringify(data)}`);
}

async function sendText(token: string, rid: string, text: string, type = "open_id") {
  await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: rid, msg_type: "text", content: JSON.stringify({ text }) }),
  });
}

// ================== 数据加载 ==================
function loadLedger(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(process.env.HOME ?? "/tmp", ".openclaw-memory-ledger.json"), "utf-8"));
}
function loadTms(): Record<string, any> | null {
  const p = path.join(process.cwd(), "workspace", "memory", "tms", "profile.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
}

// ================== 卡片模板 ==================
function makeOverviewCard(ledger: Record<string, any>): Record<string, unknown> {
  const total = Object.keys(ledger).length;
  const active = Object.values(ledger).reduce((s, e: any) => s + e.claims.filter((c: any) => c.status === "active").length, 0);
  const conflicts = Object.values(ledger).reduce((s, e: any) => s + e.claims.filter((c: any) => c.status === "conflicting").length, 0);
  const withDeps = Object.values(ledger).filter((e: any) => e.dependency_graph?.length > 0).length;
  const catCounts: Record<string, number> = {};
  for (const [, e] of Object.entries(ledger)) catCounts[(e as any).category] = (catCounts[(e as any).category] || 0) + 1;
  const icons: Record<string, string> = { decision: "📋", api: "🔌", process: "⚙️", security: "🔒", experience: "💡" };
  const names: Record<string, string> = { decision: "决策", api: "接口", process: "流程", security: "安全", experience: "经验" };
  const catLines = Object.entries(catCounts).map(([k, v]) => `${icons[k] || "📌"} ${names[k] || k}：${v} 条`).join("\n");

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "🧠 团队记忆引擎 — 系统概览" }, template: "blue" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: "当前记忆库状态（真实数据）" } },
      { tag: "hr" },
      { tag: "column_set", flex_mode: "none", columns: [
        { tag: "column", elements: [{ tag: "markdown", content: `**记忆总数**\n${total} 条` }] },
        { tag: "column", elements: [{ tag: "markdown", content: `**活跃版本**\n${active} 个` }] },
      ]},
      { tag: "column_set", flex_mode: "none", columns: [
        { tag: "column", elements: [{ tag: "markdown", content: `**冲突版本**\n${conflicts} 个` }] },
        { tag: "column", elements: [{ tag: "markdown", content: `**依赖关系**\n${withDeps} 条` }] },
      ]},
      { tag: "hr" },
      { tag: "markdown", content: `**分类分布**\n${catLines}` },
    ],
  };
}

function makeConflictCard(ledger: Record<string, any>): Record<string, unknown> | null {
  const conflictEntry = Object.entries(ledger).find(([, e]) =>
    (e as any).claims.some((c: any) => c.status === "conflicting")
  );
  if (!conflictEntry) return null;
  const [, e] = conflictEntry;
  const v1 = e.claims[0];
  const v2 = e.claims[1];
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "⚠️ 记忆冲突 — 需要你裁决" }, template: "red" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `关于「${e.entity} - ${e.attribute}」存在矛盾` } },
      { tag: "hr" },
      { tag: "markdown", content: `**版本 1（旧）：**\n${v1.value}\n\n置信度：${Math.round((v1.confidence || 0) * 100)}%\n来源：${v1.injected_by} | 时间：${v1.valid_from}` },
      { tag: "hr" },
      { tag: "markdown", content: `**版本 2（新）：**\n${v2?.value || "无"}\n\n置信度：${Math.round((v2?.confidence || 0) * 100)}%\n来源：${v2?.injected_by || "未知"} | 时间：${v2?.valid_from || "未知"}` },
      { tag: "hr" },
      { tag: "markdown", content: "**请在终端选择：**\n输入 `1` — 保留旧版本\n输入 `2` — 采用新版本\n输入 `3` — 两个都保留" },
    ],
  };
}

function makeResultCard(action: string, ledger: Record<string, any>): Record<string, unknown> {
  const conflictEntry = Object.entries(ledger).find(([, e]) =>
    (e as any).claims.some((c: any) => c.status === "conflicting")
  );
  const v1 = conflictEntry ? (conflictEntry[1] as any).claims[0] : null;
  const v2 = conflictEntry ? (conflictEntry[1] as any).claims.find((c: any) => c.status === "conflicting") : null;

  if (action === "1") {
    if (v2) v2.status = "superseded";
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "✅ 已选择：保留旧版本" }, template: "green" },
      elements: [
        { tag: "div", text: { tag: "plain_text", content: "版本 1 保留为活跃记忆，版本 2 已标记为废弃" } },
        { tag: "hr" },
        { tag: "markdown", content: `**保留的内容：**\n${v1?.value || "无"}\n\n团队将继续记住这条决策。` },
      ],
    };
  } else if (action === "2") {
    if (v2) { v2.status = "active"; }
    if (v1) { v1.status = "superseded"; }
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "✅ 已选择：采用新版本" }, template: "green" },
      elements: [
        { tag: "div", text: { tag: "plain_text", content: "版本 2 替换为活跃记忆，旧版本已存档" } },
        { tag: "hr" },
        { tag: "markdown", content: `**新的内容：**\n${v2?.value || "无"}\n\n团队将记住这条新决策。` },
      ],
    };
  } else if (action === "3") {
    if (v2) v2.status = "active";
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "✅ 已选择：两个都保留" }, template: "blue" },
      elements: [
        { tag: "div", text: { tag: "plain_text", content: "两个版本都保留为活跃记忆，冲突已清除" } },
        { tag: "hr" },
        { tag: "markdown", content: `**版本 1：**\n${v1?.value || "无"}\n\n**版本 2：**\n${v2?.value || "无"}\n\n团队将同时记住这两条信息。` },
      ],
    };
  } else {
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "已取消选择" }, template: "grey" },
      elements: [{ tag: "div", text: { tag: "plain_text", content: "未做选择，冲突状态保持不变。" } }],
    };
  }
}

function makeRiskCard(ledger: Record<string, any>): Record<string, unknown> {
  const NOW = new Date();
  const risks: any[] = [];
  for (const m of Object.values(ledger) as any[]) {
    const elapsed = NOW.getTime() - new Date(m.createdAt).getTime();
    const halfLifeMs = m.recall_half_life * 86400000;
    const strength = Math.pow(2, -elapsed / halfLifeMs);
    const days = Math.round(elapsed / 86400000);
    risks.push({ ...m, strength, days });
  }
  risks.sort((a, b) => a.strength - b.strength);
  const critical = risks.filter(m => m.strength < 0.3);
  const warning = risks.filter(m => m.strength >= 0.3 && m.strength < 0.5);
  const healthy = risks.filter(m => m.strength >= 0.5);
  const critLines = critical.slice(0, 4).map(m => `🔴 **${m.entity}.${m.attribute}** — ${(m.strength * 100).toFixed(0)}%\n已遗忘 ${m.days} 天（半衰期 ${m.recall_half_life} 天）`).join("\n\n");
  const warnLines = warning.slice(0, 3).map(m => `🟡 **${m.entity}.${m.attribute}** — ${(m.strength * 100).toFixed(0)}%\n已遗忘 ${m.days} 天`).join("\n\n");

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "⏳ 遗忘风险 — 记忆衰减预警" }, template: critical.length > 3 ? "red" : "orange" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `检测到 ${critical.length} 条濒危记忆，${warning.length} 条需要关注，${healthy.length} 条状态良好` } },
      { tag: "hr" },
      { tag: "markdown", content: `**🔴 濒危记忆（强度 < 30%）**\n${critLines || "无"}` },
      { tag: "hr" },
      { tag: "markdown", content: `**🟡 需要关注（强度 30-50%）**\n${warnLines || "无"}` },
      { tag: "hr" },
      { tag: "markdown", content: `**🟢 状态良好（强度 ≥ 50%）**\n共 ${healthy.length} 条，无需操作` },
    ],
  };
}

function makeTmsCard(ledger: Record<string, any>, tms: Record<string, any> | null): Record<string, unknown> {
  const members = tms?.members || {};
  const memberEntries = Object.entries(members) as [string, any][];
  let singlePoints = 0;
  const spfDetails: string[] = [];
  for (const [, entry] of Object.entries(ledger)) {
    const e = entry as any;
    const holders = new Set<string>();
    for (const claim of e.claims) { holders.add(claim.injected_by); for (const c of claim.confirmed_by || []) holders.add(c); }
    const validHolders = [...holders].filter(h => members[h]);
    if (validHolders.length <= 1) {
      singlePoints++;
      if (spfDetails.length < 6) {
        const active = e.claims.find((c: any) => c.status === "active");
        spfDetails.push(`⚠️ **${e.entity}.${e.attribute}**\n唯一知情人：${validHolders[0] ? (members[validHolders[0]]?.displayName || validHolders[0]) : "未知"}`);
      }
    }
  }
  const memberLines = memberEntries.slice(0, 4).map(([id, m]) =>
    `**${m.displayName || id}**\n信任度 ${(m.trustScore || 0).toFixed(2)} | 掌握 ${m.knownMemoryIds?.length || 0} 条记忆 | 擅长：${m.expertiseAreas?.slice(0, 3).join("、") || "无"}`
  ).join("\n\n");

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "👥 团队知识分布 — TMS 分析" }, template: singlePoints > 10 ? "red" : singlePoints > 5 ? "orange" : "green" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `检测到 ${singlePoints} 个单点故障` } },
      { tag: "hr" },
      { tag: "markdown", content: `**团队成员**\n${memberLines || "暂无成员数据"}` },
      ...(spfDetails.length > 0 ? [{ tag: "hr" as const }, { tag: "markdown", content: `**单点故障**\n${spfDetails.join("\n\n")}` }] : []),
    ],
  };
}

function makeQueryCard(ledger: Record<string, any>, query: string): Record<string, unknown> {
  const terms = query.toLowerCase().split(/\s+/);
  const results = Object.entries(ledger)
    .map(([id, e]: [string, any]) => {
      const active = e.claims.filter((c: any) => c.status === "active");
      const text = `${e.entity} ${e.attribute} ${active.map((c: any) => c.value).join(' ')}`.toLowerCase();
      const matchCount = terms.filter(t => text.includes(t)).length;
      return matchCount > 0 ? { id, entry: e, relevance: matchCount / terms.length } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 5);
  const resultLines = results.map(r => {
    const active = r.entry.claims.filter((c: any) => c.status === "active");
    return `**[${r.id}]** 相关度 ${(r.relevance * 100).toFixed(0)}%\n→ ${r.entry.entity}.${r.entry.attribute}：${active[0]?.value || "无活跃值"}`;
  }).join("\n\n");

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: `🔍 记忆查询 — "${query}"` }, template: "purple" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `找到 ${results.length} 条匹配记忆` } },
      { tag: "hr" },
      { tag: "markdown", content: resultLines || "未找到匹配的记忆" },
    ],
  };
}

function makeEventLogCard(): Record<string, unknown> {
  const dir = path.join(process.cwd(), "memory", "event-log");
  if (!fs.existsSync(dir)) return { config: { wide_screen_mode: true }, header: { title: { tag: "plain_text", content: "📝 事件日志" }, template: "grey" }, elements: [{ tag: "div", text: { tag: "plain_text", content: "目录不存在" } }] };
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (files.length === 0) return { config: { wide_screen_mode: true }, header: { title: { tag: "plain_text", content: "📝 事件日志" }, template: "grey" }, elements: [{ tag: "div", text: { tag: "plain_text", content: "没有事件日志文件" } }] };
  const latest = files[files.length - 1];
  const events = JSON.parse(fs.readFileSync(path.join(dir, latest), "utf-8")) as any[];
  const lines = events.slice(0, 5).map(e => `**${e.senderName || e.senderId}** [${e.storedAt?.substring(0, 16) || "N/A"}]\n${e.content || "无内容"}`).join("\n\n");
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "📝 事件日志 — 对话捕获记录" }, template: "blue" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `文件: ${latest} | 事件数: ${events.length}` } },
      { tag: "hr" },
      { tag: "markdown", content: lines + (events.length > 5 ? `\n... 还有 ${events.length - 5} 条` : "") },
    ],
  };
}

function makeSummaryCard(ledger: Record<string, any>): Record<string, unknown> {
  const total = Object.keys(ledger).length;
  const claims = Object.values(ledger).reduce((s: number, e: any) => s + e.claims.length, 0);
  const active = Object.values(ledger).reduce((s: number, e: any) => s + e.claims.filter((c: any) => c.status === "active").length, 0);
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "✅ 演示完成" }, template: "green" },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: "团队记忆引擎交互式演示已完成！" } },
      { tag: "hr" },
      { tag: "markdown", content: [
        "**已演示功能：**",
        "1. 📊 记忆概览 — 实时统计与分类",
        "2. ⚠️ 冲突检测 — 新旧信息打架，人工裁决",
        "3. ⏳ 遗忘曲线 — Ebbinghaus 模型",
        "4. 👥 TMS 分析 — 知识分布与单点故障",
        "5. 🔍 记忆查询 — 关键词检索",
        "6. 📝 事件日志 — 对话捕获记录",
        "",
        `**数据：** ${total} 条记忆 / ${claims} 个版本 / ${active} 活跃`,
        "来源：真实 ledger 文件，非模拟数据",
      ].join("\n") },
    ],
  };
}

// ================== 主循环 ==================
type Cmd = (ledger: Record<string, any>, token: string, cfg: any, ...args: string[]) => Promise<void>;
const CMDS: Record<string, { desc: string; fn: Cmd }> = {
  status:   { desc: "推送记忆概览卡片", fn: async (l, t, c) => { await sendCard(t, c.receiveId, makeOverviewCard(l), c.receiveType); ok("概览卡片已推送"); } },
  risk:     { desc: "推送遗忘风险卡片", fn: async (l, t, c) => { await sendCard(t, c.receiveId, makeRiskCard(l), c.receiveType); ok("风险卡片已推送"); } },
  tms:      { desc: "推送团队知识分布卡片", fn: async (l, t, c) => { await sendCard(t, c.receiveId, makeTmsCard(l, loadTms()), c.receiveType); ok("TMS 卡片已推送"); } },
  query:    { desc: "推送查询结果，如 query 客户A", fn: async (l, t, c, ...a) => { const q = a.join(" ") || "客户A"; await sendCard(t, c.receiveId, makeQueryCard(l, q), c.receiveType); ok(`查询 "${q}" 已推送`); } },
  eventlog: { desc: "推送事件日志卡片", fn: async (l, t, c) => { await sendCard(t, c.receiveId, makeEventLogCard(), c.receiveType); ok("事件日志已推送"); } },
  summary:  { desc: "推送演示总结卡片", fn: async (l, t, c) => { await sendCard(t, c.receiveId, makeSummaryCard(l), c.receiveType); ok("总结卡片已推送"); } },
  conflict: { desc: "推送冲突卡片 + 终端交互裁决", fn: async (l, t, c, choice?: string) => {
    if (!Object.entries(l).some(([, e]) => (e as any).claims.some((c: any) => c.status === "conflicting"))) { warn("未找到冲突记忆"); return; }
    await sendCard(t, c.receiveId, makeConflictCard(l), c.receiveType);
    ok("冲突卡片已推送");
    if (choice) {
      await sendCard(t, c.receiveId, makeResultCard(choice, l), c.receiveType);
      ok("裁决结果已推送");
    } else {
      ok("请在终端输入: conflict 1 / conflict 2 / conflict 3");
    }
  }},
  all: { desc: "依次推送所有卡片", fn: async (l, t, c) => {
    const steps: [string, () => Promise<void>][] = [
      ["概览", async () => { await sendCard(t, c.receiveId, makeOverviewCard(l), c.receiveType); }],
      ["冲突", async () => { const x = makeConflictCard(l); if (x) await sendCard(t, c.receiveId, x, c.receiveType); }],
      ["风险", async () => { await sendCard(t, c.receiveId, makeRiskCard(l), c.receiveType); }],
      ["TMS", async () => { await sendCard(t, c.receiveId, makeTmsCard(l, loadTms()), c.receiveType); }],
      ["查询", async () => { await sendCard(t, c.receiveId, makeQueryCard(l, "客户A"), c.receiveType); }],
      ["日志", async () => { await sendCard(t, c.receiveId, makeEventLogCard(), c.receiveType); }],
      ["总结", async () => { await sendCard(t, c.receiveId, makeSummaryCard(l), c.receiveType); }],
    ];
    for (const [name, fn] of steps) { process.stdout.write(`  ${C.dim}推送 ${name}...${C.reset}`); await fn(); await new Promise(r => setTimeout(r, 1000)); ok(`${name}已推送`); }
    ok("全部推送完成");
  }},
};

async function main() {
  const cfg = resolveConfig();
  const token = await getFeishuToken(cfg.appId, cfg.appSecret);

  title("🧠 团队记忆引擎 — 飞书交互式演示");
  console.log(`${C.cyan}接收者: ${cfg.receiveId} (${cfg.receiveType})${C.reset}`);
  console.log(`${C.dim}终端输入命令 → 卡片实时推送到飞书${C.reset}`);
  console.log(`${C.dim}冲突裁决在终端交互选择 → 结果卡片推送到飞书${C.reset}\n`);

  console.log(`${C.bold}可用命令：${C.reset}`);
  for (const [cmd, info] of Object.entries(CMDS)) console.log(`  ${C.green}${cmd.padEnd(12)}${C.reset} ${info.desc}`);
  console.log(`  ${C.red}quit        ${C.reset} 退出\n`);

  const ledger = loadLedger();
  ok(`已加载 ${Object.keys(ledger).length} 条真实记忆\n`);

  let isRunning = false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("close", () => { if (!isRunning) { ok("演示结束"); process.exit(0); } });
  const ask = () => rl.question(`${C.green}demo>${C.reset} `, async (input) => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);
    if (!cmd) { ask(); return; }
    if (["quit", "exit", "q"].includes(cmd)) { ok("演示结束"); rl.close(); return; }
    if (["help", "?"].includes(cmd)) {
      console.log(`\n${C.bold}可用命令：${C.reset}`);
      for (const [c, i] of Object.entries(CMDS)) console.log(`  ${C.green}${c.padEnd(12)}${C.reset} ${i.desc}`);
      console.log(""); ask(); return;
    }
    if (CMDS[cmd]) {
      try { isRunning = true; await CMDS[cmd].fn(ledger, token, cfg, ...args); } catch (e: any) { err(e.message); }
      isRunning = false;
    } else {
      warn(`未知命令: ${cmd}`);
    }
    ask();
  });
  ask();
}

main().catch(e => { console.error(`${C.red}演示失败: ${e.message}${C.reset}`); process.exit(1); });
