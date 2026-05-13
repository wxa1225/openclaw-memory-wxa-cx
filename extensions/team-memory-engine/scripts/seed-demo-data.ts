#!/usr/bin/env npx tsx
/**
 * Seed the ledger with 25+ realistic business-scenario memories.
 * Covers: decision, api, process, security, experience categories.
 * Includes: multi-version chains, conflicting states, varied decay levels.
 * Run: npx tsx scripts/seed-demo-data.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LEDGER_PATH = path.join(os.homedir(), ".openclaw-memory-ledger.json");
const TEAM_ID = "openclaw-team";

// Use varied timestamps to create different decay states
const NOW = Date.now();
const DAY = 86400000;

interface SeedEntry {
  id: string;
  entity: string;
  attribute: string;
  claims: Array<{
    version: number;
    value: string;
    valid_from: string;
    valid_to: string | null;
    confidence: number;
    source: string;
    injected_by: string;
    confirmed_by: string[];
    status?: "active" | "superseded" | "conflicting";
  }>;
  current_version: number;
  dependency_graph: string[];
  recall_half_life: number;
  category: string;
  tags: string[];
  access_count: number;
  createdAt: string;
  updatedAt: string;
}

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString();
}

function iso(s: string): string {
  return s;
}

const entries: SeedEntry[] = [
  // ============================================================
  // DECISION memories (6 entries) — half-life 14 days
  // ============================================================
  {
    id: "mem-dec-001",
    entity: "客户A",
    attribute: "交付格式",
    claims: [
      {
        version: 1,
        value: "交付格式改为PDF，不再使用Markdown（张三确认）",
        valid_from: iso("2026-04-20T10:00:00Z"),
        valid_to: iso("2026-05-05T14:00:00Z"),
        confidence: 0.85,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan", "ou_lisi"],
        status: "superseded",
      },
      {
        version: 2,
        value: "交付格式改回Markdown，PDF只发给外部客户",
        valid_from: iso("2026-05-05T14:00:00Z"),
        valid_to: null,
        confidence: 0.90,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan"],
        status: "active",
      },
    ],
    current_version: 2,
    dependency_graph: [],
    recall_half_life: 14,
    category: "decision",
    tags: ["客户", "交付"],
    access_count: 8,
    createdAt: iso("2026-04-20T10:00:00Z"),
    updatedAt: iso("2026-05-05T14:00:00Z"),
  },
  {
    id: "mem-dec-002",
    entity: "产品部",
    attribute: "周会时间",
    claims: [
      {
        version: 1,
        value: "产品周会从周一改到周三下午2点",
        valid_from: iso("2026-05-01T09:00:00Z"),
        valid_to: null,
        confidence: 0.80,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 14,
    category: "decision",
    tags: ["会议"],
    access_count: 3,
    createdAt: iso("2026-05-01T09:00:00Z"),
    updatedAt: iso("2026-05-01T09:00:00Z"),
  },
  {
    id: "mem-dec-003",
    entity: "客户B",
    attribute: "合同续签",
    claims: [
      {
        version: 1,
        value: "客户B合同将在6月30日到期，需要提前一个月启动续签流程",
        valid_from: iso("2026-05-10T11:00:00Z"),
        valid_to: null,
        confidence: 0.95,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan", "ou_lisi", "ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 14,
    category: "decision",
    tags: ["合同", "deadline", "客户"],
    access_count: 12,
    createdAt: iso("2026-05-10T11:00:00Z"),
    updatedAt: iso("2026-05-10T11:00:00Z"),
  },
  {
    id: "mem-dec-004",
    entity: "技术委员会",
    attribute: "技术选型",
    claims: [
      {
        version: 1,
        value: "新项目前端框架统一使用React 19，不再使用Vue",
        valid_from: iso("2026-04-15T14:00:00Z"),
        valid_to: null,
        confidence: 0.75,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 14,
    category: "decision",
    tags: ["技术选型", "前端"],
    access_count: 2,
    createdAt: iso("2026-04-15T14:00:00Z"),
    updatedAt: iso("2026-04-15T14:00:00Z"),
  },
  {
    id: "mem-dec-005",
    entity: "团队",
    attribute: "代码评审规则",
    claims: [
      {
        version: 1,
        value: "所有PR必须至少2人review才能合并",
        valid_from: iso("2026-05-08T10:00:00Z"),
        valid_to: null,
        confidence: 0.90,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan", "ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: ["mem-dec-004"],
    recall_half_life: 14,
    category: "decision",
    tags: ["流程", "代码质量"],
    access_count: 5,
    createdAt: iso("2026-05-08T10:00:00Z"),
    updatedAt: iso("2026-05-08T10:00:00Z"),
  },
  {
    id: "mem-dec-006",
    entity: "客户A",
    attribute: "需求变更",
    claims: [
      {
        version: 1,
        value: "客户A要求增加数据导出功能，优先级P1",
        valid_from: iso("2026-05-11T16:00:00Z"),
        valid_to: null,
        confidence: 0.85,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: ["mem-dec-001"],
    recall_half_life: 14,
    category: "decision",
    tags: ["客户", "需求"],
    access_count: 4,
    createdAt: iso("2026-05-11T16:00:00Z"),
    updatedAt: iso("2026-05-11T16:00:00Z"),
  },

  // ============================================================
  // API/配置 memories (5 entries) — half-life 21 days
  // ============================================================
  {
    id: "mem-api-001",
    entity: "生产环境",
    attribute: "API端点",
    claims: [
      {
        version: 1,
        value: "生产环境API端点改为v3，旧端点(/v2)本周五下线",
        valid_from: iso("2026-05-06T10:00:00Z"),
        valid_to: null,
        confidence: 0.95,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_lisi", "ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 21,
    category: "api",
    tags: ["prod", "critical"],
    access_count: 15,
    createdAt: iso("2026-05-06T10:00:00Z"),
    updatedAt: iso("2026-05-06T10:00:00Z"),
  },
  {
    id: "mem-api-002",
    entity: "数据库",
    attribute: "连接池配置",
    claims: [
      {
        version: 1,
        value: "数据库连接池最大连接数从50调到200",
        valid_from: iso("2026-04-25T08:00:00Z"),
        valid_to: null,
        confidence: 0.80,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 21,
    category: "api",
    tags: ["prod", "数据库"],
    access_count: 6,
    createdAt: iso("2026-04-25T08:00:00Z"),
    updatedAt: iso("2026-04-25T08:00:00Z"),
  },
  {
    id: "mem-api-003",
    entity: "支付系统",
    attribute: "回调URL",
    claims: [
      {
        version: 1,
        value: "微信支付回调URL: https://api.example.com/pay/wechat/callback",
        valid_from: iso("2026-05-02T12:00:00Z"),
        valid_to: null,
        confidence: 0.70,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: [],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 21,
    category: "api",
    tags: ["支付"],
    access_count: 1,
    createdAt: iso("2026-05-02T12:00:00Z"),
    updatedAt: iso("2026-05-02T12:00:00Z"),
  },
  {
    id: "mem-api-004",
    entity: "Redis",
    attribute: "缓存策略",
    claims: [
      {
        version: 1,
        value: "用户会话缓存TTL从30分钟改为2小时",
        valid_from: iso("2026-04-10T09:00:00Z"),
        valid_to: null,
        confidence: 0.65,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 21,
    category: "api",
    tags: ["缓存", "性能"],
    access_count: 3,
    createdAt: iso("2026-04-10T09:00:00Z"),
    updatedAt: iso("2026-04-10T09:00:00Z"),
  },
  {
    id: "mem-api-005",
    entity: "OSS",
    attribute: "存储桶配置",
    claims: [
      {
        version: 1,
        value: "文件存储桶迁移到阿里云oss-cn-shanghai，旧桶oss-cn-hangzhou月底关停",
        valid_from: iso("2026-05-09T15:00:00Z"),
        valid_to: null,
        confidence: 0.90,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu", "ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: ["mem-api-002"],
    recall_half_life: 21,
    category: "api",
    tags: ["迁移", "deadline"],
    access_count: 7,
    createdAt: iso("2026-05-09T15:00:00Z"),
    updatedAt: iso("2026-05-09T15:00:00Z"),
  },

  // ============================================================
  // PROCESS memories (5 entries) — half-life 10 days
  // ============================================================
  {
    id: "mem-proc-001",
    entity: "周报",
    attribute: "发送规则",
    claims: [
      {
        version: 1,
        value: "周报统一发给李四，不再抄送王五",
        valid_from: iso("2026-05-06T10:02:00Z"),
        valid_to: null,
        confidence: 0.80,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_lisi", "ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 10,
    category: "process",
    tags: ["周报"],
    access_count: 2,
    createdAt: iso("2026-05-06T10:02:00Z"),
    updatedAt: iso("2026-05-06T10:02:00Z"),
  },
  {
    id: "mem-proc-002",
    entity: "发布流程",
    attribute: "审批要求",
    claims: [
      {
        version: 1,
        value: "生产发布必须经过技术负责人+产品负责人双审批",
        valid_from: iso("2026-04-28T10:00:00Z"),
        valid_to: null,
        confidence: 0.85,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan", "ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 10,
    category: "process",
    tags: ["发布", "审批"],
    access_count: 4,
    createdAt: iso("2026-04-28T10:00:00Z"),
    updatedAt: iso("2026-04-28T10:00:00Z"),
  },
  {
    id: "mem-proc-003",
    entity: "On-call",
    attribute: "轮值表",
    claims: [
      {
        version: 1,
        value: "5月On-call轮值：第一周王五，第二周李四，第三周张三，第四周王五",
        valid_from: iso("2026-05-01T00:00:00Z"),
        valid_to: null,
        confidence: 0.75,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 7,
    category: "process",
    tags: ["on-call"],
    access_count: 9,
    createdAt: iso("2026-05-01T00:00:00Z"),
    updatedAt: iso("2026-05-01T00:00:00Z"),
  },
  {
    id: "mem-proc-004",
    entity: "Code Review",
    attribute: "命名规范",
    claims: [
      {
        version: 1,
        value: "TypeScript项目统一使用camelCase命名，禁止PascalCase变量",
        valid_from: iso("2026-05-07T11:00:00Z"),
        valid_to: null,
        confidence: 0.70,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: [],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: ["mem-dec-005"],
    recall_half_life: 10,
    category: "process",
    tags: ["规范", "前端"],
    access_count: 1,
    createdAt: iso("2026-05-07T11:00:00Z"),
    updatedAt: iso("2026-05-07T11:00:00Z"),
  },
  {
    id: "mem-proc-005",
    entity: "请假流程",
    attribute: "审批规则",
    claims: [
      {
        version: 1,
        value: "请假3天以内直属审批，超过3天需部门总监审批",
        valid_from: iso("2026-05-04T09:00:00Z"),
        valid_to: null,
        confidence: 0.80,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 10,
    category: "process",
    tags: ["HR"],
    access_count: 2,
    createdAt: iso("2026-05-04T09:00:00Z"),
    updatedAt: iso("2026-05-04T09:00:00Z"),
  },

  // ============================================================
  // SECURITY memories (4 entries) — half-life 30 days
  // ============================================================
  {
    id: "mem-sec-001",
    entity: "API密钥",
    attribute: "轮换计划",
    claims: [
      {
        version: 1,
        value: "所有生产环境API密钥必须在2026年6月1日前完成轮换",
        valid_from: iso("2026-05-01T08:00:00Z"),
        valid_to: null,
        confidence: 0.95,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan", "ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 30,
    category: "security",
    tags: ["security", "critical", "compliance", "deadline"],
    access_count: 10,
    createdAt: iso("2026-05-01T08:00:00Z"),
    updatedAt: iso("2026-05-01T08:00:00Z"),
  },
  {
    id: "mem-sec-002",
    entity: "数据库",
    attribute: "访问控制",
    claims: [
      {
        version: 1,
        value: "生产数据库禁止直连，必须通过堡垒机访问",
        valid_from: iso("2026-04-18T10:00:00Z"),
        valid_to: null,
        confidence: 0.90,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu", "ou_zhangsan"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 30,
    category: "security",
    tags: ["security", "prod", "数据库"],
    access_count: 7,
    createdAt: iso("2026-04-18T10:00:00Z"),
    updatedAt: iso("2026-04-18T10:00:00Z"),
  },
  {
    id: "mem-sec-003",
    entity: "SSL证书",
    attribute: "过期时间",
    claims: [
      {
        version: 1,
        value: "主域名example.com的SSL证书在2026年7月15日过期",
        valid_from: iso("2026-04-22T09:00:00Z"),
        valid_to: null,
        confidence: 0.85,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 30,
    category: "security",
    tags: ["security", "deadline", "prod"],
    access_count: 3,
    createdAt: iso("2026-04-22T09:00:00Z"),
    updatedAt: iso("2026-04-22T09:00:00Z"),
  },
  {
    id: "mem-sec-004",
    entity: "第三方SDK",
    attribute: "安全漏洞",
    claims: [
      {
        version: 1,
        value: "lodash 4.17.20存在原型链污染漏洞，必须升级到4.17.21+",
        valid_from: iso("2026-05-03T14:00:00Z"),
        valid_to: null,
        confidence: 0.90,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu", "ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 30,
    category: "security",
    tags: ["security", "critical", "前端"],
    access_count: 5,
    createdAt: iso("2026-05-03T14:00:00Z"),
    updatedAt: iso("2026-05-03T14:00:00Z"),
  },

  // ============================================================
  // EXPERIENCE memories (5 entries) — half-life 7 days
  // ============================================================
  {
    id: "mem-exp-001",
    entity: "部署",
    attribute: "踩坑经验",
    claims: [
      {
        version: 1,
        value: "部署前必须先清理Redis缓存，否则新用户注册会失败",
        valid_from: iso("2026-04-30T16:00:00Z"),
        valid_to: null,
        confidence: 0.85,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu", "ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 7,
    category: "experience",
    tags: ["部署", "踩坑", "Redis"],
    access_count: 6,
    createdAt: iso("2026-04-30T16:00:00Z"),
    updatedAt: iso("2026-04-30T16:00:00Z"),
  },
  {
    id: "mem-exp-002",
    entity: "客户A",
    attribute: "沟通偏好",
    claims: [
      {
        version: 1,
        value: "客户A的张总喜欢在微信沟通，不喜欢邮件，回复要简洁",
        valid_from: iso("2026-05-08T11:00:00Z"),
        valid_to: null,
        confidence: 0.80,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_zhangsan"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: ["mem-dec-001"],
    recall_half_life: 7,
    category: "experience",
    tags: ["客户", "沟通"],
    access_count: 4,
    createdAt: iso("2026-05-08T11:00:00Z"),
    updatedAt: iso("2026-05-08T11:00:00Z"),
  },
  {
    id: "mem-exp-003",
    entity: "测试",
    attribute: "性能基准",
    claims: [
      {
        version: 1,
        value: "搜索API P99延迟不能超过200ms，超过需要优化",
        valid_from: iso("2026-04-20T15:00:00Z"),
        valid_to: null,
        confidence: 0.75,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_lisi"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 7,
    category: "experience",
    tags: ["性能", "测试"],
    access_count: 2,
    createdAt: iso("2026-04-20T15:00:00Z"),
    updatedAt: iso("2026-04-20T15:00:00Z"),
  },
  {
    id: "mem-exp-004",
    entity: "CI/CD",
    attribute: "构建经验",
    claims: [
      {
        version: 1,
        value: "Docker构建时使用多阶段构建可以将镜像大小从2GB降到200MB",
        valid_from: iso("2026-05-10T14:00:00Z"),
        valid_to: null,
        confidence: 0.70,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu"],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: [],
    recall_half_life: 7,
    category: "experience",
    tags: ["CI/CD", "Docker", "优化"],
    access_count: 1,
    createdAt: iso("2026-05-10T14:00:00Z"),
    updatedAt: iso("2026-05-10T14:00:00Z"),
  },
  {
    id: "mem-exp-005",
    entity: "客户B",
    attribute: "投诉处理",
    claims: [
      {
        version: 1,
        value: "客户B投诉过一次响应慢，以后给他们做的接口都要加超时监控",
        valid_from: iso("2026-04-12T10:00:00Z"),
        valid_to: null,
        confidence: 0.60,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: [],
        status: "active",
      },
    ],
    current_version: 1,
    dependency_graph: ["mem-dec-003"],
    recall_half_life: 7,
    category: "experience",
    tags: ["客户", "监控"],
    access_count: 1,
    createdAt: iso("2026-04-12T10:00:00Z"),
    updatedAt: iso("2026-04-12T10:00:00Z"),
  },

  // ============================================================
  // CONFLICTING memory (1 entry) — shows conflict detection
  // ============================================================
  {
    id: "mem-conf-001",
    entity: "服务器",
    attribute: "域名配置",
    claims: [
      {
        version: 1,
        value: "生产服务器域名: api.example.com",
        valid_from: iso("2026-04-01T09:00:00Z"),
        valid_to: null,
        confidence: 0.75,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_wangwu"],
        status: "conflicting",
      },
      {
        version: 2,
        value: "生产服务器域名已改为 api-v2.example.com，旧域名月底停用",
        valid_from: iso("2026-05-10T10:00:00Z"),
        valid_to: null,
        confidence: 0.80,
        source: "feishu_chat",
        injected_by: "openclaw-user",
        confirmed_by: ["ou_lisi"],
        status: "conflicting",
      },
    ],
    current_version: 2,
    dependency_graph: ["mem-api-001"],
    recall_half_life: 21,
    category: "api",
    tags: ["prod", "迁移"],
    access_count: 3,
    createdAt: iso("2026-04-01T09:00:00Z"),
    updatedAt: iso("2026-05-10T10:00:00Z"),
  },
];

// ============================================================
// Write to ledger
// ============================================================

const ledger: Record<string, SeedEntry> = {};
for (const entry of entries) {
  // Add teamId to each entry so they can be filtered by team
  (entry as Record<string, unknown>).teamId = TEAM_ID;
  ledger[entry.id] = entry;
}

fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf-8");

// ============================================================
// Print summary
// ============================================================

console.log("=".repeat(60));
console.log("  Demo Data Seeded — 26 memory entries");
console.log("=".repeat(60));

const byCategory: Record<string, number> = {};
const byStatus: Record<string, number> = {};
let totalClaims = 0;
let totalVersions = 0;

for (const entry of entries) {
  byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  totalClaims += entry.claims.length;
  totalVersions = Math.max(totalVersions, entry.current_version);
  for (const c of entry.claims) {
    byStatus[c.status || "active"] = (byStatus[c.status || "active"] || 0) + 1;
  }
}

console.log("\n  分类统计:");
for (const [cat, count] of Object.entries(byCategory).sort()) {
  const icons: Record<string, string> = {
    decision: "📋", api: "🔌", process: "⚙️", security: "🔒", experience: "💡"
  };
  console.log(`    ${icons[cat] || "📝"} ${cat}: ${count} 条`);
}

console.log("\n  版本状态:");
for (const [status, count] of Object.entries(byStatus).sort()) {
  const icons: Record<string, string> = {
    active: "✅", superseded: "❌", conflicting: "⚠️"
  };
  console.log(`    ${icons[status] || "?"} ${status}: ${count} 个claim`);
}

console.log(`\n  总条目: ${entries.length} 条记忆`);
console.log(`  总claim数: ${totalClaims} 个（含版本）`);
console.log(`  依赖图: ${entries.filter(e => e.dependency_graph.length > 0).length} 条有依赖`);

// Also write event log data
const EVENT_LOG_DIR = path.join(process.env.HOME!, "workspace", "agent", "memory", "event-log");
fs.mkdirSync(EVENT_LOG_DIR, { recursive: true });

const events = [
  {
    id: "evt-001", storedAt: "2026-05-06T10:00:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_zhangsan", senderName: "张三",
    content: "客户A那边确认了，以后交付都用PDF格式，不要再发Markdown了",
    contentType: "text", messageId: "m1", processedForExtraction: false,
  },
  {
    id: "evt-002", storedAt: "2026-05-06T10:01:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_lisi", senderName: "李四",
    content: "好的，记一下。另外生产环境的API端点已经改为v3了，旧端点本周五失效",
    contentType: "text", messageId: "m2", processedForExtraction: false,
  },
  {
    id: "evt-003", storedAt: "2026-05-06T10:02:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_wangwu", senderName: "王五",
    content: "收到，周报以后统一发给李四，不要再抄送我了",
    contentType: "text", messageId: "m3", processedForExtraction: false,
  },
  {
    id: "evt-004", storedAt: "2026-05-06T10:03:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_zhangsan", senderName: "张三",
    content: "今天中午吃什么？我提议吃楼下的黄焖鸡",
    contentType: "text", messageId: "m4", processedForExtraction: false,
  },
  {
    id: "evt-005", storedAt: "2026-05-06T10:04:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_lisi", senderName: "李四",
    content: "哈哈哈好的，那我也点一份",
    contentType: "text", messageId: "m5", processedForExtraction: false,
  },
  {
    id: "evt-006", storedAt: "2026-05-08T14:00:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_zhangsan", senderName: "张三",
    content: "客户B的合同6月30号到期，提前准备续签材料",
    contentType: "text", messageId: "m6", processedForExtraction: false,
  },
  {
    id: "evt-007", storedAt: "2026-05-09T09:30:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_wangwu", senderName: "王五",
    content: "所有生产API密钥6月1号前必须轮换，安全合规要求",
    contentType: "text", messageId: "m7", processedForExtraction: false,
  },
  {
    id: "evt-008", storedAt: "2026-05-10T16:00:00Z", chatId: "oc_demo", chatType: "group",
    senderId: "ou_lisi", senderName: "李四",
    content: "客户A要求加数据导出功能，P1优先级，下周排期",
    contentType: "text", messageId: "m8", processedForExtraction: false,
  },
];

const eventFilePath = path.join(EVENT_LOG_DIR, "2026-05-06.json");
fs.writeFileSync(eventFilePath, JSON.stringify(events, null, 2), "utf-8");
console.log(`\n  Event log: ${events.length} events → ${eventFilePath}`);

console.log("\n  Ledger path:", LEDGER_PATH);
console.log("=".repeat(60));
