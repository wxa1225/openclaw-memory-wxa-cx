/**
 * 团队记忆引擎 — 交互式演示（对话模拟版）
 *
 * 用法: npx tsx extensions/team-memory-engine/scripts/interactive-demo.ts
 *
 * 模拟真实的团队协作场景，端到端展示记忆提取、存储、查询、冲突检测、遗忘等核心功能
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// 颜色
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  brightGreen: '\x1b[92m',
  brightCyan: '\x1b[96m',
};

function title(text: string) {
  console.log(`\n${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
}

function section(text: string) {
  console.log(`${C.bold}${text}${C.reset}`);
  console.log(`${C.dim}─────────────────────────────────${C.reset}`);
}

// 演示用临时存储
const memStore: Record<string, any> = {};

// 模拟时间
let simTime = new Date('2026-05-14T09:00:00Z');
function simNow() { return simTime.toISOString(); }
function advanceMinutes(m: number) { simTime = new Date(simTime.getTime() + m * 60000); }
function advanceDays(d: number) { simTime = new Date(simTime.getTime() + d * 86400000); }

// 衰减计算（简化版 Ebbinghaus）
function calcStrength(createdAt: string, halfLife: number, now: string): number {
  const elapsed = new Date(now).getTime() - new Date(createdAt).getTime();
  const halfLifeMs = halfLife * 86400000;
  return Math.pow(2, -elapsed / halfLifeMs);
}

function strengthLabel(s: number): [string, string] {
  if (s >= 0.9) return ['fresh', C.green];
  if (s >= 0.7) return ['strong', C.brightGreen];
  if (s >= 0.5) return ['fading', C.yellow];
  if (s >= 0.3) return ['weak', C.red];
  return ['critical', C.red + C.bold];
}

// 记忆存储
function storeMemory(entity: string, attribute: string, value: string, category: string,
  source: string, injectedBy: string, halfLife: number, confirmedBy: string[] = []) {
  const id = `mem-${crypto.randomUUID().substring(0, 8)}`;
  memStore[id] = {
    id, entity, attribute,
    claims: [{
      version: 1, value, valid_from: simNow(), valid_to: null,
      confidence: 0.85, source, injected_by: injectedBy,
      confirmed_by: confirmedBy, status: 'active' as const,
    }],
    current_version: 1,
    category, tags: ['auto-extracted', source],
    recall_half_life: halfLife,
    access_count: 0,
    createdAt: simNow(),
    updatedAt: simNow(),
  };
  return id;
}

// 查询记忆
function queryMemories(query: string): Array<{ entry: any; strength: number; relevance: number }> {
  const terms = query.toLowerCase().split(/\s+/);
  const results: Array<{ entry: any; strength: number; relevance: number }> = [];

  for (const [, entry] of Object.entries(memStore)) {
    const activeClaims = entry.claims.filter((c: any) => c.status === 'active');
    if (activeClaims.length === 0) continue;

    const claim = activeClaims[0];
    const text = `${entry.entity} ${entry.attribute} ${claim.value}`.toLowerCase();
    const matches = terms.filter(t => text.includes(t));
    if (matches.length > 0) {
      const relevance = matches.length / terms.length;
      const strength = calcStrength(entry.createdAt, entry.recall_half_life, simNow());
      results.push({ entry, strength, relevance });
    }
  }

  return results.sort((a, b) => b.relevance * b.strength - a.relevance * a.strength);
}

// ====================== 演示流程 ======================

title('团队记忆引擎 — 交互式对话模拟');
console.log(`${C.dim}模拟一个真实团队的协作对话，展示记忆系统的端到端能力${C.reset}`);

// ======================== 场景 1：团队对话 → 自动提取记忆 ========================
title('场景一：团队对话 — 自动提取记忆');

const conversations = [
  { time: '09:00', sender: '张伟(架构师)', text: '各位，客户A的交付格式统一改为PDF了，Markdown不用再提供了' },
  { time: '09:02', sender: '李娜(产品)', text: '好的，我更新PRD。另外API端点也改了，新地址是 https://api.aiforce.com/v2' },
  { time: '09:05', sender: '王强(后端)', text: 'API的鉴权方式改为JWT了，旧的API key下周废弃' },
  { time: '09:08', sender: '赵敏(前端)', text: '前端需要同步改，预计明天下午完成' },
  { time: '09:10', sender: '张伟(架构师)', text: '以后所有PR都需要至少两个Reviewer批准才能合并' },
  { time: '09:15', sender: '李娜(产品)', text: '今天下午3点开评审会，讨论新版本的发布计划' },
  { time: '09:20', sender: '王强(后端)', text: '数据库迁移脚本已经写好了，需要先在staging环境验证' },
  { time: '09:25', sender: '赵敏(前端)', text: '哈哈今天天气真不错 😄' },
];

section('模拟飞书群聊对话');
for (const msg of conversations) {
  console.log(`  ${C.gray}[${msg.time}]${C.reset}  ${C.blue}${msg.sender}${C.reset}: ${msg.text}`);
  advanceMinutes(2);

  // 模拟记忆提取（规则引擎简化版）
  const extracted: string[] = [];
  if (msg.text.includes('交付格式') && msg.text.includes('PDF')) {
    storeMemory('客户A', '交付格式', '交付格式统一改为PDF，不再使用Markdown', 'decision', 'group-chat', msg.sender, 14);
    extracted.push('✓ 提取: 交付格式决策');
  }
  if (msg.text.includes('API端点')) {
    storeMemory('API服务', '端点地址', 'API端点更新为 https://api.aiforce.com/v2', 'api', 'group-chat', msg.sender, 21);
    extracted.push('✓ 提取: API端点更新');
  }
  if (msg.text.includes('JWT') && msg.text.includes('鉴权')) {
    storeMemory('API服务', '鉴权方式', 'API鉴权改为JWT，旧API key下周废弃', 'security', 'group-chat', msg.sender, 30);
    extracted.push('✓ 提取: 安全策略变更');
  }
  if (msg.text.includes('两个Reviewer')) {
    storeMemory('团队规范', 'PR审核规则', '所有PR需要至少两个Reviewer批准', 'process', 'group-chat', msg.sender, 10);
    extracted.push('✓ 提取: 团队流程规范');
  }
  if (msg.text.includes('评审会')) {
    storeMemory('版本发布', '评审会时间', '2026-05-14 15:00 新版本评审会', 'process', 'group-chat', msg.sender, 3);
    extracted.push('✓ 提取: 会议安排');
  }
  if (msg.text.includes('数据库迁移')) {
    storeMemory('数据库', '迁移状态', '迁移脚本已完成，需先在staging验证', 'experience', 'group-chat', msg.sender, 7);
    extracted.push('✓ 提取: 技术经验');
  }

  if (extracted.length > 0) {
    for (const e of extracted) {
      console.log(`    ${C.dim}→ ${C.green}${e}${C.reset}${C.dim} 存入记忆库${C.reset}`);
    }
  } else if (!msg.text.includes('天气')) {
    console.log(`    ${C.dim}→ ${C.yellow}无重要信息，未提取${C.reset}`);
  }
}

const memoryCount = Object.keys(memStore).length;
console.log(`\n  ${C.brightCyan}本轮对话共产生 ${memoryCount} 条团队记忆${C.reset}`);

// ======================== 场景 2：记忆查询 ========================
title('场景二：记忆查询 — "你还记得什么？"');

const queries = [
  { q: '客户A 交付格式', label: '查询: "客户A的交付格式是什么？"' },
  { q: 'API 端点', label: '查询: "API端点改到哪里了？"' },
  { q: 'PR 审核', label: '查询: "现在PR怎么审核？"' },
];

for (const { q, label } of queries) {
  section(label);
  const results = queryMemories(q);

  if (results.length > 0) {
    for (const r of results) {
      const claim = r.entry.claims[0];
      const [label, color] = strengthLabel(r.strength);
      console.log(`  ${C.green}✓ 匹配${C.reset} ${C.dim}(相关度: ${(r.relevance * 100).toFixed(0)}%, 强度: ${color}${label}${C.reset})`);
      console.log(`    实体: ${C.cyan}${r.entry.entity}${C.reset}`);
      console.log(`    属性: ${r.entry.attribute}`);
      console.log(`    值:   ${C.brightGreen}${claim.value}${C.reset}`);
      console.log(`    来源: ${claim.injected_by} | 类别: ${r.entry.category} | 半衰期: ${r.entry.recall_half_life}天`);
    }
  } else {
    console.log(`  ${C.yellow}✗ 未找到相关记忆${C.reset}`);
  }
  console.log('');
}

// ======================== 场景 3：冲突检测 ========================
title('场景三：冲突检测 — 新旧信息打架');

section('新消息与已有记忆冲突');
console.log(`  ${C.gray}[10:00]${C.reset}  ${C.blue}李娜(产品)${C.reset}: 客户A的交付格式改回来了，还是用Markdown，PDF不要了`);

advanceMinutes(30);

const conflictingMem = Object.values(memStore).find((e: any) => e.entity === '客户A' && e.attribute === '交付格式');
if (conflictingMem) {
  const claim = conflictingMem.claims[0];
  console.log(`  ${C.gray}[已有记忆]${C.reset}  ${C.yellow}交付格式统一改为PDF，不再使用Markdown${C.reset} ${C.dim}(置信度: ${(claim.confidence * 100).toFixed(0)}%)${C.reset}`);
  console.log(`  ${C.gray}[新消息]${C.reset}   ${C.red}交付格式改回来了，还是用Markdown，PDF不要了${C.reset}`);

  // 标记冲突
  conflictingMem.claims.push({
    version: 2,
    value: '交付格式改为Markdown，PDF不再使用',
    valid_from: simNow(),
    valid_to: null,
    confidence: 0.9,
    source: 'group-chat',
    injected_by: '李娜(产品)',
    confirmed_by: [],
    status: 'conflicting',
  });
  claim.confidence = 0.3;

  console.log(`\n  ${C.red}⚠ 检测到冲突！${C.reset}`);
  console.log(`  ${C.dim}处理方式: 飞书推送交互卡片，团队成员投票决定保留哪个版本${C.reset}`);
  console.log(`  ${C.dim}当前状态: 旧版本(信心降至30%) vs 新版本(信心90%)${C.reset}`);
}

// ======================== 场景四：遗忘曲线 ========================
title('场景四：遗忘曲线 — 时间让记忆褪色');

section('模拟 30 天后的记忆状态');
advanceDays(30);

for (const [, entry] of Object.entries(memStore)) {
  const strength = calcStrength(entry.createdAt, entry.recall_half_life, simNow());
  const [label, color] = strengthLabel(strength);
  const claim = entry.claims[0];
  const daysAgo = Math.round((new Date(simNow()).getTime() - new Date(entry.createdAt).getTime()) / 86400000);

  const barLen = Math.round(strength * 20);
  const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);

  console.log(`  ${color}[${bar}] ${(strength * 100).toFixed(0)}%${C.reset} ${C.dim}— ${label}${C.reset}`);
  console.log(`    ${C.cyan}${entry.entity}.${entry.attribute}${C.reset} → ${claim.value.substring(0, 35)}`);
  console.log(`    ${C.dim}距今 ${daysAgo} 天 | 半衰期 ${entry.recall_half_life} 天 | 类别: ${entry.category}${C.reset}`);
  console.log('');
}

// ======================== 场景五：知识盲区 ========================
title('场景五：知识盲区 — 单点故障风险');

section('TMS 分析：哪些记忆只有一人知道');

const memberMap: Record<string, string[]> = {};
for (const [, entry] of Object.entries(memStore)) {
  for (const claim of entry.claims) {
    if (!memberMap[claim.injected_by]) memberMap[claim.injected_by] = [];
    memberMap[claim.injected_by].push(entry.id);
  }
}

const singlePoints = Object.entries(memStore).filter(([, entry]: [string, any]) => {
  const holders = new Set<string>();
  for (const claim of entry.claims) {
    holders.add(claim.injected_by);
    for (const c of claim.confirmed_by || []) holders.add(c);
  }
  return holders.size <= 1;
});

console.log(`\n  ${C.red}⚠ 发现 ${singlePoints.length} 个单点故障${C.reset}\n`);
for (const [id, entry] of singlePoints) {
  const claim = entry.claims[0];
  console.log(`  ${C.red}!${C.reset} ${C.cyan}${entry.entity}.${entry.attribute}${C.reset}`);
  console.log(`    ${C.dim}唯一知情人: ${claim.injected_by}${C.reset}`);
  console.log(`    ${C.dim}风险: 如果此人离职，这条知识将丢失${C.reset}`);
  console.log('');
}

// ======================== 场景六：记忆价值 ========================
title('场景六：记忆分类统计');

section('记忆资产分布');

const catStats: Record<string, { count: number; color: string; icon: string }> = {
  decision: { count: 0, color: C.cyan, icon: '📋' },
  api: { count: 0, color: C.blue, icon: '🔌' },
  process: { count: 0, color: C.magenta, icon: '⚙️' },
  security: { count: 0, color: C.red, icon: '🔒' },
  experience: { count: 0, color: C.green, icon: '💡' },
};

for (const [, entry] of Object.entries(memStore)) {
  if (catStats[entry.category]) catStats[entry.category].count++;
}

const total = Object.keys(memStore).length;
for (const [cat, stat] of Object.entries(catStats)) {
  if (stat.count === 0) continue;
  const pct = ((stat.count / total) * 100).toFixed(0);
  const bar = '█'.repeat(stat.count * 3);
  console.log(`  ${stat.color}${stat.icon} ${cat.padEnd(12)} ${bar} ${stat.count}条 (${pct}%)${C.reset}`);
}
console.log(`\n  ${C.bold}总计: ${total} 条团队记忆${C.reset}`);

// ======================== 总结 ========================
title('演示总结');

console.log(`  ${C.green}✓${C.reset} 记忆提取: 从群聊中自动提取关键决策、API变更、流程规范`);
console.log(`  ${C.green}✓${C.reset} 记忆查询: 按语义匹配度 + 记忆强度排序返回`);
console.log(`  ${C.green}✓${C.reset} 冲突检测: 新旧信息冲突，降低旧版本置信度`);
console.log(`  ${C.green}✓${C.reset} 遗忘曲线: 基于 Ebbinghaus 模型，按类别设置不同半衰期`);
console.log(`  ${C.green}✓${C.reset} 知识盲区: 检测单点故障，识别知识流失风险`);
console.log(`  ${C.green}✓${C.reset} 分类统计: 决策/接口/流程/安全/经验 五大类资产`);

console.log(`\n  ${C.dim}这就是团队记忆引擎的核心能力 — 让团队的协作知识不再丢失。${C.reset}\n`);
