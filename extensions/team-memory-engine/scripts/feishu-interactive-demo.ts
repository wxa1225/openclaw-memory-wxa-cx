/**
 * 团队记忆引擎 — 飞书交互式演示（推真实卡片到飞书群聊）
 *
 * 用法: npx tsx extensions/team-memory-engine/scripts/feishu-interactive-demo.ts
 *
 * 流程：
 * 1. 注入真实演示数据
 * 2. 推送记忆概览卡片到飞书
 * 3. 推送冲突裁决卡片，等用户在飞书点按钮
 * 4. 用户在飞书回复消息确认后继续下一步
 * 5. 推送风险评估、知识断层等卡片
 */

import * as fs from "fs";
import * as path from "path";

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  red: '\x1b[31m', blue: '\x1b[34m', bold: '\x1b[1m', dim: '\x1b[2m',
  brightGreen: '\x1b[92m', brightCyan: '\x1b[96m',
};

function title(t: string) {
  console.log(`\n${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${t}${C.reset}`);
  console.log(`${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
}

// ================== Feishu API ==================

async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json() as { code: number; tenant_access_token?: string };
  if (data.code !== 0 || !data.tenant_access_token) throw new Error("Failed to get Feishu token");
  return data.tenant_access_token;
}

async function sendFeishuCard(token: string, receiveId: string, card: Record<string, unknown>, receiveType: string = "chat_id") {
  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }),
  });
  const data = await resp.json() as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`Feishu send card failed: ${JSON.stringify(data)}`);
  return data;
}

async function sendFeishuText(token: string, receiveId: string, text: string, receiveType: string = "chat_id") {
  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
  return resp.json();
}

import { execSync } from "child_process";

// ================== 配置 ==================

function resolveConfig() {
  let receiveId = process.env.TEAM_MEMORY_FEISHU_CHAT_ID
    ?? process.env.FEISHU_DEMO_CHAT_ID
    ?? process.env.TEAM_MEMORY_FEISHU_RECEIVE_ID;
  let appId = process.env.FEISHU_APP_ID;
  let appSecret = process.env.FEISHU_APP_SECRET;
  let receiveType = process.env.TEAM_MEMORY_RECEIVE_TYPE ?? "open_id";

  // Read from openclaw.json and secrets file
  const cfgPath = path.join(process.cwd(), "openclaw.json");
  const secretsPath = process.env.TEAM_MEMORY_SECRETS_PATH
    ?? "/home/gem/workspace/.force/openclaw/miaoda-openclaw-secrets.json";

  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as any;

    // Get appId from channel config
    if (!appId && cfg.channels?.feishu?.appId) {
      appId = cfg.channels.feishu.appId;
    }

    // Get appSecret from secrets file
    if (!appSecret && fs.existsSync(secretsPath)) {
      const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
      appSecret = secrets.channels_feishu_app_secret;
    }

    // Get receiveId: prefer open_id for DM (chat_id may not work if app not in group)
    if (!receiveId) {
      // Try plugin config first
      const entry = cfg.plugins?.entries?.["team-memory-engine"]?.config;
      receiveId = entry?.feishuChatId;
    }
    // If we only have a chat_id (starts with oc_), fall back to owner's open_id
    if (receiveId && !receiveId.startsWith("ou_")) {
      const ownerOpenId = cfg.channels?.feishu?.allowFrom?.[0];
      if (ownerOpenId) {
        receiveId = ownerOpenId;
        receiveType = "open_id";
      }
    }
  }

  if (!receiveId || !appId || !appSecret) {
    console.error(`${C.red}缺少飞书配置：${C.reset}`);
    if (!appId) console.error(`  FEISHU_APP_ID — 飞书应用 ID`);
    if (!appSecret) console.error(`  FEISHU_APP_SECRET — 飞书应用 Secret（或配置到 secrets 文件）`);
    if (!receiveId) console.error(`  TEAM_MEMORY_FEISHU_RECEIVE_ID — 接收者 ID（open_id 或 chat_id）`);
    process.exit(1);
  }

  return { receiveId, appId, appSecret, receiveType };
}

// ================== 卡片模板 ==================

function makeOverviewCard(ledger: Record<string, any>): Record<string, unknown> {
  const total = Object.keys(ledger).length;
  const active = Object.values(ledger).reduce((s: number, e: any) => s + e.claims.filter((c: any) => c.status === "active").length, 0);
  const conflicts = Object.values(ledger).reduce((s: number, e: any) => s + e.claims.filter((c: any) => c.status === "conflicting").length, 0);
  const withDeps = Object.values(ledger).filter((e: any) => e.dependency_graph?.length > 0).length;

  const catCounts: Record<string, number> = {};
  for (const [, e] of Object.entries(ledger)) {
    const cat = (e as any).category;
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  const catIcons: Record<string, string> = { decision: "📋", api: "🔌", process: "⚙️", security: "🔒", experience: "💡" };
  const catNames: Record<string, string> = { decision: "决策", api: "接口", process: "流程", security: "安全", experience: "经验" };
  const catLines = Object.entries(catCounts).map(([k, v]) => `  ${catIcons[k] || "📌"} ${catNames[k] || k}：${v} 条`).join("\n");

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🧠 团队记忆引擎 — 系统概览" },
      template: "blue",
    },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `当前记忆库状态总览（实时数据）` } },
      { tag: "hr" },
      {
        tag: "column_set",
        flex_mode: "none",
        columns: [
          {
            tag: "column",
            elements: [{ tag: "markdown", content: `**记忆总数**\n${total} 条` }],
          },
          {
            tag: "column",
            elements: [{ tag: "markdown", content: `**活跃版本**\n${active} 个` }],
          },
        ],
      },
      {
        tag: "column_set",
        flex_mode: "none",
        columns: [
          {
            tag: "column",
            elements: [{ tag: "markdown", content: `**冲突版本**\n${conflicts} 个` }],
          },
          {
            tag: "column",
            elements: [{ tag: "markdown", content: `**依赖关系**\n${withDeps} 条` }],
          },
        ],
      },
      { tag: "hr" },
      { tag: "markdown", content: `**分类分布**\n${catLines}` },
      { tag: "hr" },
      { tag: "div", text: { tag: "plain_text", content: "👇 请在聊天中回复「继续」以查看冲突检测演示" } },
    ],
  };
}

function makeConflictCard(ledger: Record<string, any>): Record<string, unknown> | null {
  // Find a conflict entry
  const conflictEntry = Object.entries(ledger).find(([, e]: [string, any]) =>
    e.claims.some((c: any) => c.status === "conflicting")
  );

  if (!conflictEntry) return null;

  const [id, e] = conflictEntry;
  const conflictClaims = e.claims.filter((c: any) => c.status === "conflicting");
  const activeClaims = e.claims.filter((c: any) => c.status === "active");
  const mainClaim = activeClaims[0] || conflictClaims[0];

  const v1Text = e.claims[0]?.value?.length > 40 ? e.claims[0].value.substring(0, 40) + "…" : e.claims[0]?.value || "";
  const v2Text = e.claims[1]?.value?.length > 40 ? e.claims[1].value.substring(0, 40) + "…" : e.claims[1]?.value || "";

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "⚠️ 记忆冲突 — 需要你的裁决" },
      template: "red",
    },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `关于「${e.entity} - ${e.attribute}」存在矛盾` } },
      { tag: "hr" },
      { tag: "markdown", content: `**版本 1（旧）：**\n${v1Text}\n\n置信度：${Math.round((e.claims[0]?.confidence || 0) * 100)}%` },
      { tag: "hr" },
      { tag: "markdown", content: `**版本 2（新）：**\n${v2Text}\n\n置信度：${Math.round((e.claims[1]?.confidence || 0) * 100)}%` },
      { tag: "hr" },
      { tag: "div", text: { tag: "plain_text", content: "请在群里回复选择：\n1 — 保留旧版本\n2 — 采用新版本\n3 — 两个都保留" } },
      {
        tag: "action",
        actions: [
          { tag: "button", text: { tag: "plain_text", content: "1️⃣ 保留旧版" }, type: "default", value: { action: "keep_v1", memory_id: id } },
          { tag: "button", text: { tag: "plain_text", content: "2️⃣ 采用新版" }, type: "danger", value: { action: "keep_v2", memory_id: id } },
          { tag: "button", text: { tag: "plain_text", content: "3️⃣ 都保留" }, type: "primary", value: { action: "keep_both", memory_id: id } },
        ],
      },
    ],
  };
}

function makeRiskCard(ledger: Record<string, any>): Record<string, unknown> {
  const NOW = new Date();
  const memories = Object.values(ledger) as any[];
  const risks = memories.map(m => {
    const elapsed = NOW.getTime() - new Date(m.createdAt).getTime();
    const halfLifeMs = m.recall_half_life * 86400000;
    const strength = Math.pow(2, -elapsed / halfLifeMs);
    return { ...m, strength, days: Math.round(elapsed / 86400000) };
  }).sort((a, b) => a.strength - b.strength);

  const critical = risks.filter(m => m.strength < 0.3);
  const warning = risks.filter(m => m.strength >= 0.3 && m.strength < 0.5);

  const criticalLines = critical.slice(0, 4).map(m =>
    `🔴 **${m.entity}.${m.attribute}** — ${(m.strength * 100).toFixed(0)}%\n已遗忘 ${m.days} 天（半衰期 ${m.recall_half_life} 天）`
  ).join("\n\n");

  const warnLines = warning.slice(0, 3).map(m =>
    `🟡 **${m.entity}.${m.attribute}** — ${(m.strength * 100).toFixed(0)}%\n已遗忘 ${m.days} 天`
  ).join("\n\n");

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "⏳ 遗忘风险 — 记忆衰减预警" },
      template: critical.length > 3 ? "red" : "orange",
    },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `检测到 ${critical.length} 条濒危记忆，${warning.length} 条需要关注` } },
      { tag: "hr" },
      { tag: "markdown", content: `**🔴 濒危记忆（强度 < 30%）**\n${criticalLines || "无"}` },
      { tag: "hr" },
      { tag: "markdown", content: `**🟡 需要关注（强度 30-50%）**\n${warnLines || "无"}` },
      { tag: "hr" },
      { tag: "div", text: { tag: "plain_text", content: "👇 请在聊天中回复「继续」以查看知识断层分析" } },
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
    for (const claim of e.claims) {
      holders.add(claim.injected_by);
      for (const c of claim.confirmed_by || []) holders.add(c);
    }
    const validHolders = [...holders].filter(h => members[h]);
    if (validHolders.length <= 1) {
      singlePoints++;
      const active = e.claims.find((c: any) => c.status === "active");
      if (spfDetails.length < 5) {
        spfDetails.push(`⚠️ **${e.entity}.${e.attribute}**\n唯一知情人：${validHolders[0] ? (members[validHolders[0]]?.displayName || validHolders[0]) : "未知"}`);
      }
    }
  }

  const memberLines = memberEntries.slice(0, 4).map(([id, m]) => {
    const known = m.knownMemoryIds?.length || 0;
    const expertise = m.expertiseAreas?.slice(0, 3).join("、") || "无";
    return `**${m.displayName || id}**\n信任度 ${(m.trustScore || 0).toFixed(2)} | 掌握 ${known} 条记忆 | 擅长：${expertise}`;
  }).join("\n\n");

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "👥 团队知识分布 — TMS 分析" },
      template: singlePoints > 10 ? "red" : singlePoints > 5 ? "orange" : "green",
    },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `检测到 ${singlePoints} 个单点故障 — 以下知识仅一人知晓` } },
      { tag: "hr" },
      { tag: "markdown", content: `**团队成员**\n${memberLines || "暂无成员数据"}` },
      ...(spfDetails.length > 0 ? [
        { tag: "hr" as const },
        { tag: "markdown" as const, content: `**单点故障详情**\n${spfDetails.join("\n\n")}` },
      ] : []),
      { tag: "hr" },
      { tag: "div", text: { tag: "plain_text", content: "👇 请在聊天中回复「继续」以查看记忆查询演示" } },
    ],
  };
}

// ================== 等待用户回复 ==================

async function waitForReply(token: string, receiveId: string, receiveType: string, timeoutMs = 120000): Promise<string | null> {
  console.log(`${C.dim}  等待飞书回复（超时 ${Math.round(timeoutMs / 1000)} 秒）...${C.reset}`);

  const startTime = Date.now();
  const seenIds = new Set<string>();
  const containerType = receiveType === "open_id" ? "user" : "chat";
  const containerId = receiveId;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const resp = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=${containerType}&container_id=${containerId}&page_size=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (resp.ok) {
        const data = await resp.json() as { code: number; data?: { items?: Array<{ message_id: string; content: string }> } };
        if (data.code === 0 && data.data?.items) {
          for (const item of data.data.items.reverse()) {
            if (!seenIds.has(item.message_id)) {
              seenIds.add(item.message_id);
              try {
                const content = JSON.parse(item.content) as { text?: string };
                const text = content.text?.trim();
                if (text) return text;
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch { /* ignore */ }

    await new Promise(r => setTimeout(r, 3000));
  }

  return null;
}

// ================== 主流程 ==================

async function main() {
  const { receiveId, appId, appSecret, receiveType } = resolveConfig();

  title("🧠 团队记忆引擎 — 飞书交互式演示");
  console.log(`${C.cyan}接收者: ${receiveId} (${receiveType})${C.reset}`);
  console.log(`${C.dim}请在飞书中查看卡片并回复「继续」${C.reset}\n`);

  const token = await getFeishuToken(appId, appSecret);

  // Step 1: Seed data if needed
  title("步骤 1：注入演示数据");
  const seedScript = path.join(process.cwd(), "extensions", "team-memory-engine", "scripts", "seed-demo-data.ts");
  if (fs.existsSync(seedScript)) {
    try {
      execSync(`npx tsx ${seedScript}`, { stdio: "inherit", cwd: process.cwd() });
    } catch {
      console.log(`${C.yellow}  演示数据可能已存在，跳过注入${C.reset}`);
    }
  }

  const ledgerPath = path.join(process.env.HOME ?? "/tmp", ".openclaw-memory-ledger.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
  console.log(`\n${C.green}✓ 已加载 ${Object.keys(ledger).length} 条真实记忆${C.reset}\n`);

  // Step 2: Push overview card
  title("步骤 2：推送记忆概览卡片");
  const overviewCard = makeOverviewCard(ledger);
  await sendFeishuCard(token, receiveId, overviewCard, receiveType);
  console.log(`${C.green}✓ 概览卡片已推送到飞书${C.reset}`);
  console.log(`${C.dim}  请在飞书中查看，然后回复「继续」${C.reset}\n`);

  const reply1 = await waitForReply(token, receiveId, receiveType, 180000);
  if (!reply1) {
    console.log(`${C.yellow}⚠ 超时未回复，自动继续...${C.reset}`);
  }

  // Step 3: Push conflict resolution card
  title("步骤 3：推送冲突裁决卡片");
  const conflictCard = makeConflictCard(ledger);
  if (conflictCard) {
    await sendFeishuCard(token, receiveId, conflictCard, receiveType);
    console.log(`${C.green}✓ 冲突卡片已推送到飞书${C.reset}`);
    console.log(`${C.dim}  请在飞书中点击按钮或回复数字（1/2/3）${C.reset}\n`);

    const reply2 = await waitForReply(token, receiveId, receiveType, 180000);
    if (reply2) {
      console.log(`${C.cyan}  收到回复: ${reply2}${C.reset}`);
      if (reply2.includes("1") || reply2.includes("旧")) {
        await sendFeishuText(token, receiveId, "✅ 已选择：保留旧版本（演示模式，不实际修改数据）", receiveType);
      } else if (reply2.includes("2") || reply2.includes("新")) {
        await sendFeishuText(token, receiveId, "✅ 已选择：采用新版本（演示模式，不实际修改数据）", receiveType);
      } else if (reply2.includes("3") || reply2.includes("都")) {
        await sendFeishuText(token, receiveId, "✅ 已选择：两个都保留（演示模式）", receiveType);
      }
    } else {
      console.log(`${C.yellow}⚠ 超时未回复，自动继续...${C.reset}`);
    }
  } else {
    console.log(`${C.yellow}⚠ 未找到冲突记忆，跳过此步骤${C.reset}`);
  }

  // Step 4: Push risk assessment card
  title("步骤 4：推送遗忘风险评估卡片");
  const riskCard = makeRiskCard(ledger);
  await sendFeishuCard(token, receiveId, riskCard, receiveType);
  console.log(`${C.green}✓ 风险评估卡片已推送到飞书${C.reset}`);
  console.log(`${C.dim}  请在飞书中查看，然后回复「继续」${C.reset}\n`);

  const reply3 = await waitForReply(token, receiveId, receiveType, 180000);
  if (!reply3) {
    console.log(`${C.yellow}⚠ 超时未回复，自动继续...${C.reset}`);
  }

  // Step 5: Push TMS card
  title("步骤 5：推送团队知识分布卡片");
  const tmsPath = path.join(process.cwd(), "workspace", "memory", "tms", "profile.json");
  const tms = fs.existsSync(tmsPath) ? JSON.parse(fs.readFileSync(tmsPath, "utf-8")) : null;
  const tmsCard = makeTmsCard(ledger, tms);
  await sendFeishuCard(token, receiveId, tmsCard, receiveType);
  console.log(`${C.green}✓ TMS 卡片已推送到飞书${C.reset}`);

  // Step 6: Push final summary
  title("步骤 6：推送演示总结");
  const total = Object.keys(ledger).length;
  const summaryCard = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "✅ 演示完成" },
      template: "green",
    },
    elements: [
      { tag: "div", text: { tag: "plain_text", content: `团队记忆引擎交互式演示已完成！共展示 ${total} 条真实记忆。` } },
      { tag: "hr" },
      {
        tag: "markdown",
        content: [
          "**已演示功能：**",
          "1. 📊 记忆概览 — 实时统计与分类",
          "2. ⚠️ 冲突检测 — 新旧信息打架，需要人工裁决",
          "3. ⏳ 遗忘曲线 — 基于 Ebbinghaus 模型，按类别设置不同半衰期",
          "4. 👥 TMS 分析 — 团队知识分布与单点故障检测",
          "",
          "**数据来源：** 真实 ledger 文件，非模拟数据",
          `**记忆路径：** ${ledgerPath}`,
        ].join("\n"),
      },
    ],
  };
  await sendFeishuCard(token, receiveId, summaryCard, receiveType);
  console.log(`${C.green}✓ 总结卡片已推送到飞书${C.reset}`);

  title("🎉 演示完成");
  console.log(`${C.green}所有卡片已推送到飞书${C.reset}`);
  console.log(`${C.dim}请在飞书中查看效果${C.reset}\n`);
}

main().catch(err => {
  console.error(`${C.red}演示失败: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
