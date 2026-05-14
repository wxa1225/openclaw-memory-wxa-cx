/**
 * 团队记忆引擎 — 真实数据端到端演示
 *
 * 用法: npx tsx extensions/team-memory-engine/scripts/real-demo.ts
 *
 * 所有数据从真实 ledger.json 读取，所有计算使用真实算法
 */

import * as fs from "fs";
import * as path from "path";

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  red: '\x1b[31m', blue: '\x1b[34m', magenta: '\x1b[35m', white: '\x1b[37m',
  bold: '\x1b[1m', dim: '\x1b[2m', gray: '\x1b[90m',
  brightGreen: '\x1b[92m', brightCyan: '\x1b[96m', brightRed: '\x1b[91m',
};

function hr() { console.log(`${C.cyan}${C.bold}══════════════════════════════════════════════════════════${C.reset}`); }
function title(t: string) { hr(); console.log(`${C.cyan}${C.bold}  ${t}${C.reset}`); hr(); console.log(''); }
function section(t: string) { console.log(`${C.bold}▎${t}${C.reset}\n`); }

// ================== 加载真实数据 ==================
const LEDGER_PATH = path.join(process.env.HOME ?? '/tmp', '.openclaw-memory-ledger.json');
const GRAPH_PATH = path.join(process.env.HOME ?? '/tmp', '.openclaw-memory-graph.json');
const TMS_PATH = path.join(process.cwd(), 'workspace', 'memory', 'tms', 'profile.json');

const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'));
const entryCount = Object.keys(ledger).length;
console.log(`${C.dim}✓ 已加载真实记忆库: ${C.brightCyan}${entryCount} 条记录${C.dim}${C.reset}`);
console.log(`${C.dim}  路径: ${LEDGER_PATH}${C.reset}\n`);

// ================== 衰减算法 ==================
const NOW = new Date();
let spCount = 0;

function calcStrength(createdAt: string, halfLife: number): number {
  const elapsed = NOW.getTime() - new Date(createdAt).getTime();
  const halfLifeMs = halfLife * 86400000;
  return Math.pow(2, -elapsed / halfLifeMs);
}

function strengthLabel(s: number): [string, string, string] {
  if (s >= 0.9) return ['fresh', C.green, '新鲜'];
  if (s >= 0.7) return ['strong', C.brightGreen, '牢固'];
  if (s >= 0.5) return ['fading', C.yellow, '衰减中'];
  if (s >= 0.3) return ['weak', C.red, '脆弱'];
  return ['critical', C.red + C.bold, '濒危'];
}

function daysAgo(createdAt: string): number {
  return Math.round((NOW.getTime() - new Date(createdAt).getTime()) / 86400000);
}

// ================== 场景 1：记忆总览 ==================
title('场景一：记忆总览 — 所有记忆的健康状态');

const catIcons: Record<string, string> = { decision: '📋', api: '🔌', process: '⚙️', security: '🔒', experience: '💡' };
const catNames: Record<string, string> = { decision: '决策', api: '接口', process: '流程', security: '安全', experience: '经验' };

for (const [id, entry] of Object.entries(ledger)) {
  const e = entry as any;
  const activeClaims = e.claims.filter((c: any) => c.status === 'active');
  const conflictClaims = e.claims.filter((c: any) => c.status === 'conflicting');
  const supClaims = e.claims.filter((c: any) => c.status === 'superseded');
  const claim = activeClaims[0] || conflictClaims[0];
  if (!claim) continue;

  const strength = calcStrength(e.createdAt, e.recall_half_life);
  const [eng, color, cn] = strengthLabel(strength);
  const days = daysAgo(e.createdAt);
  const barLen = Math.round(strength * 20);
  const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);

  const icon = catIcons[e.category] || '📌';
  const catName = catNames[e.category] || e.category;

  console.log(`${color}[${bar}]${C.reset} ${cn} (${(strength * 100).toFixed(1)}%)`);
  console.log(`  ${icon} ${C.cyan}${e.entity}.${e.attribute}${C.reset}`);
  console.log(`  ${C.dim}→ ${claim.value.substring(0, 60)}${claim.value.length > 60 ? '...' : ''}${C.reset}`);
  console.log(`  ${C.dim}创建: ${e.createdAt} (${days}天前) | 半衰期: ${e.recall_half_life}天 | 类别: ${catName}${C.reset}`);
  if (e.dependency_graph && e.dependency_graph.length > 0) {
    console.log(`  ${C.dim}依赖: ${e.dependency_graph.join(' → ')}${C.reset}`);
  }

  if (conflictClaims.length > 0) {
    console.log(`  ${C.brightRed}⚠ 存在 ${conflictClaims.length} 个冲突版本:${C.reset}`);
    for (const cc of conflictClaims) {
      console.log(`    ${C.red}v${cc.version}: ${cc.value.substring(0, 50)} (置信度: ${(cc.confidence * 100).toFixed(0)}%)${C.reset}`);
    }
  }

  console.log('');
}

// ================== 场景 2：冲突详情 ==================
title('场景二：冲突检测 — 新旧记忆打架的处理');

const conflicts = Object.entries(ledger).filter(([, entry]: [string, any]) =>
  entry.claims.some((c: any) => c.status === 'conflicting')
);

if (conflicts.length > 0) {
  for (const [id, entry] of conflicts) {
    const e = entry as any;
    section(`冲突 #${id}`);
    console.log(`  实体: ${C.cyan}${e.entity}.${e.attribute}${C.reset}\n`);

    for (const claim of e.claims) {
      const statusColor = claim.status === 'conflicting' ? C.yellow :
        claim.status === 'superseded' ? C.gray : C.green;
      const statusText = claim.status === 'conflicting' ? '⚠ 冲突中' :
        claim.status === 'superseded' ? '✗ 已废弃' : '✓ 活跃';

      console.log(`  ${statusColor}[v${claim.version}] ${statusText} | 置信度: ${(claim.confidence * 100).toFixed(0)}% | 来源: ${claim.injected_by}${C.reset}`);
      console.log(`  ${C.dim}   "${claim.value}"${C.reset}`);
      console.log(`  ${C.dim}   时间: ${claim.valid_from}${C.reset}`);
      console.log('');
    }

    // 模拟飞书交互卡片
    console.log(`  ${C.bold}📱 飞书推送卡片交互模拟：${C.reset}\n`);
    console.log(`  ${C.cyan}┌─────────────────────────────────────────────────┐${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}  ${C.bold}⚠️ 记忆冲突提醒${C.reset}                              ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}                                                 ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}  ${C.dim}关于「${e.entity} - ${e.attribute}」存在冲突${C.reset}         ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}                                                 ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}  ${C.yellow}旧(v1): ${e.claims.find((c: any) => c.version === 1)?.value?.substring(0, 35)}...${C.reset}${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}  ${C.green}新(v2): ${e.claims.find((c: any) => c.version === 2)?.value?.substring(0, 35)}...${C.reset}${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}                                                 ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset}  ${C.green}[ ✓ 仍有效 ]${C.reset}  ${C.red}[ ✗ 更新 ]${C.reset}  ${C.gray}[ 忽略 ]${C.reset}        ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}└─────────────────────────────────────────────────┘${C.reset}`);
    console.log('');
  }
}

// ================== 场景 3：遗忘风险分析 ==================
title('场景三：遗忘风险 — 哪些记忆即将丢失？');

const memories = Object.values(ledger) as any[];
const sorted = memories
  .map(m => ({
    ...m,
    strength: calcStrength(m.createdAt, m.recall_half_life),
    days: daysAgo(m.createdAt),
  }))
  .sort((a, b) => a.strength - b.strength);

const critical = sorted.filter(m => m.strength < 0.3);
const warning = sorted.filter(m => m.strength >= 0.3 && m.strength < 0.5);

section('🔴 濒危记忆（强度 < 30%）— 建议立即复习');
for (const m of critical) {
  const [,, cn] = strengthLabel(m.strength);
  console.log(`  ${C.red + C.bold}${(m.strength * 100).toFixed(1)}%${C.reset}  ${C.cyan}${m.entity}.${m.attribute}${C.reset}`);
  console.log(`    ${C.dim}已遗忘 ${m.days} 天 | 半衰期 ${m.recall_half_life} 天 | 需要复习${C.reset}`);
}

if (warning.length > 0) {
  console.log('');
  section('🟡 警告记忆（强度 30%-50%）— 近期需要关注');
  for (const m of warning) {
    console.log(`  ${C.yellow}${(m.strength * 100).toFixed(1)}%${C.reset}  ${C.cyan}${m.entity}.${m.attribute}${C.reset}`);
    console.log(`    ${C.dim}已遗忘 ${m.days} 天 | 半衰期 ${m.recall_half_life} 天${C.reset}`);
  }
}

console.log('');
section('记忆衰减统计');
const fresh = sorted.filter(m => m.strength >= 0.7).length;
const fading = sorted.filter(m => m.strength >= 0.5 && m.strength < 0.7).length;
const weak = sorted.filter(m => m.strength >= 0.3 && m.strength < 0.5).length;
const crit = sorted.filter(m => m.strength < 0.3).length;
console.log(`  ${C.green}新鲜 (≥70%): ${fresh} 条${C.reset}`);
console.log(`  ${C.yellow}衰减 (50-70%): ${fading} 条${C.reset}`);
console.log(`  ${C.red}脆弱 (30-50%): ${weak} 条${C.reset}`);
console.log(`  ${C.red + C.bold}濒危 (<30%): ${crit} 条${C.reset}`);

// ================== 场景 4：知识图谱 ==================
title('场景四：知识图谱 — 记忆之间的关联');

if (fs.existsSync(GRAPH_PATH)) {
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
  console.log(`  节点数: ${C.cyan}${graph.nodes?.length || 0}${C.reset}`);
  console.log(`  边数: ${C.cyan}${graph.edges?.length || 0}${C.reset}`);
  console.log('');

  // 显示实体间的依赖关系
  section('依赖关系图');
  for (const [id, entry] of Object.entries(ledger)) {
    const e = entry as any;
    if (e.dependency_graph && e.dependency_graph.length > 0) {
      const active = e.claims.find((c: any) => c.status === 'active');
      console.log(`  ${C.cyan}${id}${C.reset} → ${e.dependency_graph.map((d: string) => C.yellow + d + C.reset).join(', ')}`);
      console.log(`    ${C.dim}→ ${active?.value?.substring(0, 50)}${C.reset}`);
    }
  }
} else {
  console.log(`  ${C.yellow}图谱文件不存在，正在构建...${C.reset}`);
  // 直接显示依赖
  section('记忆依赖关系');
  for (const [id, entry] of Object.entries(ledger)) {
    const e = entry as any;
    if (e.dependency_graph && e.dependency_graph.length > 0) {
      const active = e.claims.find((c: any) => c.status === 'active');
      console.log(`  ${C.cyan}${id}${C.reset} → ${e.dependency_graph.map((d: string) => C.yellow + d + C.reset).join(', ')}`);
      console.log(`    ${C.dim}→ ${active?.value?.substring(0, 50)}${C.reset}`);
    }
  }
}

// ================== 场景 5：TMS 知识分布 ==================
title('场景五：TMS — 谁知道什么？');

if (fs.existsSync(TMS_PATH)) {
  const tms = JSON.parse(fs.readFileSync(TMS_PATH, 'utf-8'));
  const members = tms.members || {};

  section('团队成员能力分布');
  for (const [id, member] of Object.entries(members)) {
    const m = member as any;
    const expertise = m.expertiseAreas?.join(', ') || '无';
    console.log(`  ${C.cyan}${m.displayName || id}${C.reset}`);
    console.log(`    专业领域: ${C.dim}${expertise}${C.reset}`);
    console.log(`    信任度: ${C.green}${(m.trustScore || 0).toFixed(2)}${C.reset} | 贡献: ${m.contributionCount || 0} | 确认: ${m.confirmationCount || 0}`);
    console.log(`    掌握记忆: ${m.knownMemoryIds?.length || 0} 条`);
    console.log('');
  }

  // 单点故障
  section('知识盲区 — 单点故障');
  spCount = 0;
  for (const [id, entry] of Object.entries(ledger)) {
    const e = entry as any;
    const holders = new Set<string>();
    for (const claim of e.claims) {
      holders.add(claim.injected_by);
      for (const c of claim.confirmed_by || []) holders.add(c);
    }
    const validHolders = [...holders].filter(h => members[h]);
    if (validHolders.length <= 1) {
      spCount++;
      const active = e.claims.find((c: any) => c.status === 'active');
      console.log(`  ${C.red}!${C.reset} ${C.cyan}${e.entity}.${e.attribute}${C.reset}`);
      console.log(`    ${C.dim}唯一知情人: ${validHolders[0] || '未知'} | 如果此人离职将丢失${C.reset}`);
    }
  }
  console.log(`\n  共发现 ${C.red}${spCount}${C.reset} 个单点故障`);
} else {
  console.log(`  ${C.yellow}TMS 文件不存在: ${TMS_PATH}${C.reset}`);
}

// ================== 场景 6：向量搜索 ==================
title('场景六：查询演示 — 从真实记忆中检索');

const queries = [
  { q: '客户A', label: '查询: "客户A的相关信息"' },
  { q: 'API', label: '查询: "API配置相关"' },
  { q: '安全', label: '查询: "安全相关内容"' },
  { q: '部署', label: '查询: "部署踩坑经验"' },
];

for (const { q, label } of queries) {
  section(label);
  const results = Object.entries(ledger)
    .map(([id, entry]: [string, any]) => {
      const active = entry.claims.filter((c: any) => c.status === 'active');
      const text = `${entry.entity} ${entry.attribute} ${active.map((c: any) => c.value).join(' ')}`.toLowerCase();
      const qLower = q.toLowerCase();
      const terms = qLower.split(/\s+/);
      const matchCount = terms.filter(t => text.includes(t)).length;
      return matchCount > 0 ? { id, entry, matchCount, relevance: matchCount / terms.length } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 3);

  if (results.length > 0) {
    for (const r of results) {
      const active = r.entry.claims.filter((c: any) => c.status === 'active');
      console.log(`  ${C.green}✓ [${r.id}]${C.reset} 相关度: ${(r.relevance * 100).toFixed(0)}%`);
      console.log(`    ${C.cyan}${r.entry.entity}.${r.entry.attribute}${C.reset}`);
      if (active.length > 0) {
        console.log(`    ${C.dim}→ ${active[0].value.substring(0, 60)}${C.reset}`);
      }
    }
  } else {
    console.log(`  ${C.yellow}未找到匹配记忆${C.reset}`);
  }
  console.log('');
}

// ================== 场景 7：事件日志 ==================
title('场景七：事件日志 — 对话捕获记录');

const eventLogDir = path.join(process.cwd(), 'memory', 'event-log');
if (fs.existsSync(eventLogDir)) {
  const logFiles = fs.readdirSync(eventLogDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (logFiles.length > 0) {
    const latest = logFiles[logFiles.length - 1];
    const logData = JSON.parse(fs.readFileSync(path.join(eventLogDir, latest), 'utf-8'));
    const events = Array.isArray(logData) ? logData : [];

    console.log(`  文件: ${latest} | 事件数: ${events.length}\n`);
    for (const ev of events.slice(0, 5)) {
      const e = ev as any;
      console.log(`  ${C.gray}[${e.storedAt?.substring(0, 16) || 'N/A'}]${C.reset} ${C.blue}${e.senderName || e.senderId || 'unknown'}${C.reset}: ${e.content?.substring(0, 80)}${(e.content?.length || 0) > 80 ? '...' : ''}`);
      console.log(`    ${C.dim}类型: ${e.contentType} | 聊天: ${e.chatId} | ${e.processedForExtraction ? '✓ 已提取' : '未提取'}${C.reset}`);
    }
    if (events.length > 5) {
      console.log(`  ${C.dim}... 还有 ${events.length - 5} 条事件${C.reset}`);
    }
  } else {
    console.log(`  ${C.yellow}没有事件日志文件${C.reset}`);
  }
} else {
  console.log(`  ${C.yellow}事件日志目录不存在: ${eventLogDir}${C.reset}`);
}

// ================== 总结 ==================
title('演示完成 — 系统总览');

const totalClaims = Object.values(ledger).reduce((sum: number, e: any) => sum + e.claims.length, 0);
const activeCount = Object.values(ledger).reduce((sum: number, e: any) => sum + e.claims.filter((c: any) => c.status === 'active').length, 0);
const conflictCount = Object.values(ledger).reduce((sum: number, e: any) => sum + e.claims.filter((c: any) => c.status === 'conflicting').length, 0);
const withDeps = Object.values(ledger).filter((e: any) => e.dependency_graph?.length > 0).length;
const avgStrength = (sorted.reduce((sum: number, m: any) => sum + m.strength, 0) / sorted.length * 100).toFixed(1);

console.log(`  ${C.green}✓${C.reset} 记忆总数: ${C.bold}${entryCount} 条${C.reset} / ${totalClaims} 个版本`);
console.log(`  ${C.green}✓${C.reset} 活跃版本: ${C.brightGreen}${activeCount}${C.reset} | 冲突版本: ${C.red}${conflictCount}${C.reset} | 依赖关系: ${C.yellow}${withDeps}${C.reset}`);
console.log(`  ${C.green}✓${C.reset} 平均记忆强度: ${C.cyan}${avgStrength}%${C.reset}`);
console.log(`  ${C.green}✓${C.reset} 濒危记忆: ${C.red}${critical.length} 条${C.reset} | 单点故障: ${C.red}${spCount || 0} 个${C.reset}`);
console.log(`  ${C.green}✓${C.reset} 分类分布: ${catIcons.decision}决策 ${catIcons.api}接口 ${catIcons.process}流程 ${catIcons.security}安全 ${catIcons.experience}经验`);
console.log('');
console.log(`  ${C.dim}以上所有数据均来自真实 ledger 文件，非模拟数据${C.reset}`);
console.log(`  ${C.dim}路径: ${LEDGER_PATH}${C.reset}`);
console.log('');
