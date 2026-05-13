/**
 * Demo Data Seeder — injects 30 realistic team memory entries for competition demo.
 *
 * Usage: npx tsx extensions/team-memory-engine/scripts/seed-demo-data.ts
 *
 * Creates a realistic snapshot with:
 * - 30 memories across 6 categories (decision, api, process, security, experience, general)
 * - Multiple members (5-person team)
 * - Version histories, conflicting claims, varying decay states
 * - Realistic business scenario (team building an OpenClaw memory system)
 */

import * as fs from "fs";
import * as path from "path";

const LEDGER_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".openclaw-memory-ledger.json"
);

const TEAM_ID = "openclaw-team";

// Team members with display names
const MEMBERS = [
  { id: "ou_23ab1a1db6759ee9ae44a8e441a52153", name: "赵晨旭" },
  { id: "ou_d38d8ebf8d6a2e1ffb35317a0a8188df", name: "王小明" },
  { id: "ou_mock_member_003", name: "李婷婷" },
  { id: "ou_mock_member_004", name: "张伟" },
  { id: "ou_mock_member_005", name: "陈芳" },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

type EntryDef = {
  id: string;
  entity: string;
  attribute: string;
  category: string;
  recall_half_life: number;
  tags: string[];
  claims: Array<{
    version: number;
    value: string;
    valid_from: string;
    valid_to: string | null;
    confidence: number;
    source: string;
    injected_by: string;
    confirmed_by: string[];
    status: "active" | "superseded" | "conflicting";
  }>;
  dependency_graph: string[];
  access_count: number;
  createdAt: string;
  updatedAt: string;
};

function makeEntry(def: EntryDef): EntryDef {
  return {
    ...def,
    teamId: TEAM_ID,
  };
}

// ===========================================================================
// 30 realistic memory entries
// ===========================================================================

const ENTRIES: EntryDef[] = [
  // ---- DECISION (6 entries) ----

  // 1. Primary database choice — high confidence, well confirmed
  makeEntry({
    id: "mem-dec001",
    entity: "项目架构",
    attribute: "数据库选型",
    category: "decision",
    recall_half_life: 30,
    tags: ["架构", "基础设施", "critical"],
    claims: [
      {
        version: 1, value: "使用 SQLite 作为本地存储，支持团队规模（<10人）的日常操作",
        valid_from: daysAgo(25), valid_to: daysAgo(10),
        confidence: 0.85, source: "group_discussion",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[2].id, MEMBERS[3].id],
        status: "superseded",
      },
      {
        version: 2, value: "升级为 PostgreSQL，支持多用户并发访问和复杂查询需求",
        valid_from: daysAgo(10), valid_to: null,
        confidence: 0.92, source: "group_discussion",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[2].id, MEMBERS[3].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: ["mem-api001"],
    access_count: 18,
    createdAt: daysAgo(25), updatedAt: daysAgo(10),
  }),

  // 2. UI framework decision
  makeEntry({
    id: "mem-dec002",
    entity: "前端团队",
    attribute: "UI框架",
    category: "decision",
    recall_half_life: 21,
    tags: ["前端", "技术栈"],
    claims: [
      {
        version: 1, value: "使用 Tailwind CSS + React 作为前端技术栈，支持暗色模式",
        valid_from: daysAgo(20), valid_to: null,
        confidence: 0.78, source: "meeting",
        injected_by: MEMBERS[1].id, confirmed_by: [MEMBERS[0].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 12,
    createdAt: daysAgo(20), updatedAt: daysAgo(20),
  }),

  // 3. API Gateway decision
  makeEntry({
    id: "mem-dec003",
    entity: "项目架构",
    attribute: "API网关",
    category: "decision",
    recall_half_life: 21,
    tags: ["架构", "API"],
    claims: [
      {
        version: 1, value: "使用 Nginx 反向代理作为 API 网关，负责路由、限流和 SSL 终止",
        valid_from: daysAgo(15), valid_to: null,
        confidence: 0.82, source: "group_discussion",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id, MEMBERS[1].id],
        status: "active",
      },
    ],
    dependency_graph: ["mem-api001", "mem-sec001"],
    access_count: 8,
    createdAt: daysAgo(15), updatedAt: daysAgo(15),
  }),

  // 4. Deployment platform — has a conflicting claim
  makeEntry({
    id: "mem-dec004",
    entity: "运维团队",
    attribute: "部署平台",
    category: "decision",
    recall_half_life: 14,
    tags: ["运维", "CI/CD"],
    claims: [
      {
        version: 1, value: "使用 Docker + Kubernetes 部署到阿里云 ACK 集群",
        valid_from: daysAgo(12), valid_to: null,
        confidence: 0.70, source: "meeting",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[2].id],
        status: "conflicting",
      },
      {
        version: 2, value: "改用 Vercel Serverless 部署，降低运维成本和复杂度",
        valid_from: daysAgo(5), valid_to: null,
        confidence: 0.68, source: "group_discussion",
        injected_by: MEMBERS[1].id, confirmed_by: [MEMBERS[4].id],
        status: "conflicting",
      },
    ],
    dependency_graph: [],
    access_count: 15,
    createdAt: daysAgo(12), updatedAt: daysAgo(5),
  }),

  // 5. Sprint length decision
  makeEntry({
    id: "mem-dec005",
    entity: "开发团队",
    attribute: "迭代周期",
    category: "decision",
    recall_half_life: 14,
    tags: ["敏捷", "流程"],
    claims: [
      {
        version: 1, value: "采用两周一个 Sprint 的节奏，每周五下午进行回顾和计划",
        valid_from: daysAgo(30), valid_to: null,
        confidence: 0.90, source: "meeting",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[2].id, MEMBERS[3].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 22,
    createdAt: daysAgo(30), updatedAt: daysAgo(30),
  }),

  // 6. Payment provider — fading decay
  makeEntry({
    id: "mem-dec006",
    entity: "商务团队",
    attribute: "支付渠道",
    category: "decision",
    recall_half_life: 7,
    tags: ["商务", "支付"],
    claims: [
      {
        version: 1, value: "选择支付宝作为主要支付渠道，微信支付作为备选",
        valid_from: daysAgo(8), valid_to: null,
        confidence: 0.75, source: "meeting",
        injected_by: MEMBERS[2].id, confirmed_by: [MEMBERS[0].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 3,
    createdAt: daysAgo(8), updatedAt: daysAgo(8),
  }),

  // ---- API / CONFIG (5 entries) ----

  // 7. Production API endpoint
  makeEntry({
    id: "mem-api001",
    entity: "API网关",
    attribute: "生产环境端点",
    category: "api",
    recall_half_life: 30,
    tags: ["生产", "critical"],
    claims: [
      {
        version: 1, value: "https://api.openclaw.internal:8443/v1 — 内部负载均衡器地址",
        valid_from: daysAgo(20), valid_to: null,
        confidence: 0.95, source: "manual_inject",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id, MEMBERS[1].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 35,
    createdAt: daysAgo(20), updatedAt: daysAgo(20),
  }),

  // 8. Staging environment
  makeEntry({
    id: "mem-api002",
    entity: "API网关",
    attribute: "预发布环境端点",
    category: "api",
    recall_half_life: 14,
    tags: ["预发布"],
    claims: [
      {
        version: 1, value: "https://staging.openclaw.internal:8443/v1",
        valid_from: daysAgo(18), valid_to: null,
        confidence: 0.88, source: "manual_inject",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 10,
    createdAt: daysAgo(18), updatedAt: daysAgo(18),
  }),

  // 9. Webhook callback URL
  makeEntry({
    id: "mem-api003",
    entity: "飞书集成",
    attribute: "Webhook回调地址",
    category: "api",
    recall_half_life: 21,
    tags: ["飞书", "Webhook"],
    claims: [
      {
        version: 1, value: "https://api.openclaw.internal:8443/webhook/feishu",
        valid_from: daysAgo(14), valid_to: null,
        confidence: 0.80, source: "manual_inject",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 6,
    createdAt: daysAgo(14), updatedAt: daysAgo(14),
  }),

  // 10. Database connection string
  makeEntry({
    id: "mem-api004",
    entity: "PostgreSQL",
    attribute: "连接字符串格式",
    category: "api",
    recall_half_life: 30,
    tags: ["数据库", "critical"],
    claims: [
      {
        version: 1, value: "postgresql://app_user:<password>@pg-master.internal:5432/openclaw_db?sslmode=require&pool_size=10",
        valid_from: daysAgo(10), valid_to: null,
        confidence: 0.92, source: "manual_inject",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id, MEMBERS[1].id],
        status: "active",
      },
    ],
    dependency_graph: ["mem-sec001"],
    access_count: 20,
    createdAt: daysAgo(10), updatedAt: daysAgo(10),
  }),

  // 11. Redis cache — fading, needs review
  makeEntry({
    id: "mem-api005",
    entity: "Redis",
    attribute: "缓存策略",
    category: "api",
    recall_half_life: 7,
    tags: ["缓存", "性能"],
    claims: [
      {
        version: 1, value: "使用 Redis 缓存热点数据，TTL 设置为 5 分钟，最大内存 512MB",
        valid_from: daysAgo(9), valid_to: null,
        confidence: 0.70, source: "group_discussion",
        injected_by: MEMBERS[1].id, confirmed_by: [],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 2,
    createdAt: daysAgo(9), updatedAt: daysAgo(9),
  }),

  // ---- PROCESS (6 entries) ----

  // 12. Code review policy
  makeEntry({
    id: "mem-proc001",
    entity: "开发团队",
    attribute: "代码审查规范",
    category: "process",
    recall_half_life: 21,
    tags: ["代码质量", "流程"],
    claims: [
      {
        version: 1, value: "所有 PR 需要至少 2 个 Reviewer 批准，其中至少 1 个必须是资深工程师",
        valid_from: daysAgo(22), valid_to: null,
        confidence: 0.88, source: "meeting",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[2].id, MEMBERS[3].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 28,
    createdAt: daysAgo(22), updatedAt: daysAgo(22),
  }),

  // 13. Release process
  makeEntry({
    id: "mem-proc002",
    entity: "运维团队",
    attribute: "发布流程",
    category: "process",
    recall_half_life: 14,
    tags: ["发布", "CI/CD", "critical"],
    claims: [
      {
        version: 1, value: "预发布验证通过后，由值班工程师在飞书群中发起发布审批，通过后执行蓝绿部署",
        valid_from: daysAgo(16), valid_to: null,
        confidence: 0.85, source: "meeting",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id, MEMBERS[2].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 14,
    createdAt: daysAgo(16), updatedAt: daysAgo(16),
  }),

  // 14. On-call rotation — fading
  makeEntry({
    id: "mem-proc003",
    entity: "运维团队",
    attribute: "值班轮换规则",
    category: "process",
    recall_half_life: 7,
    tags: ["运维", "值班"],
    claims: [
      {
        version: 1, value: "每周一轮换，值班人负责当周的线上问题和监控告警",
        valid_from: daysAgo(11), valid_to: null,
        confidence: 0.65, source: "group_discussion",
        injected_by: MEMBERS[2].id, confirmed_by: [MEMBERS[3].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 4,
    createdAt: daysAgo(11), updatedAt: daysAgo(11),
  }),

  // 15. Git branching strategy
  makeEntry({
    id: "mem-proc004",
    entity: "开发团队",
    attribute: "分支策略",
    category: "process",
    recall_half_life: 14,
    tags: ["Git", "流程"],
    claims: [
      {
        version: 1, value: "采用 GitFlow：main 保护分支，feature/* 开发，release/* 预发布，hotfix/* 紧急修复",
        valid_from: daysAgo(20), valid_to: null,
        confidence: 0.82, source: "meeting",
        injected_by: MEMBERS[1].id, confirmed_by: [MEMBERS[0].id, MEMBERS[2].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 16,
    createdAt: daysAgo(20), updatedAt: daysAgo(20),
  }),

  // 16. Bug triage process
  makeEntry({
    id: "mem-proc005",
    entity: "质量团队",
    attribute: "Bug分级流程",
    category: "process",
    recall_half_life: 14,
    tags: ["质量", "Bug"],
    claims: [
      {
        version: 1, value: "P0: 当天修复; P1: 本周修复; P2: 下个 Sprint; P3: 排入 Backlog",
        valid_from: daysAgo(18), valid_to: null,
        confidence: 0.90, source: "meeting",
        injected_by: MEMBERS[2].id, confirmed_by: [MEMBERS[0].id, MEMBERS[1].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 19,
    createdAt: daysAgo(18), updatedAt: daysAgo(18),
  }),

  // 17. Documentation convention — weak decay
  makeEntry({
    id: "mem-proc006",
    entity: "开发团队",
    attribute: "文档规范",
    category: "process",
    recall_half_life: 14,
    tags: ["文档"],
    claims: [
      {
        version: 1, value: "每个功能模块必须有 README.md，API 变更需更新 OpenAPI spec",
        valid_from: daysAgo(28), valid_to: null,
        confidence: 0.55, source: "meeting",
        injected_by: MEMBERS[4].id, confirmed_by: [MEMBERS[0].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 3,
    createdAt: daysAgo(28), updatedAt: daysAgo(28),
  }),

  // ---- SECURITY (4 entries) ----

  // 18. Auth method
  makeEntry({
    id: "mem-sec001",
    entity: "安全团队",
    attribute: "认证方式",
    category: "security",
    recall_half_life: 30,
    tags: ["认证", "critical", "prod"],
    claims: [
      {
        version: 1, value: "使用 JWT + Refresh Token 双 Token 机制，Access Token 有效期 15 分钟，Refresh Token 7 天",
        valid_from: daysAgo(14), valid_to: null,
        confidence: 0.95, source: "security_review",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id, MEMBERS[1].id, MEMBERS[2].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 25,
    createdAt: daysAgo(14), updatedAt: daysAgo(14),
  }),

  // 19. Rate limiting
  makeEntry({
    id: "mem-sec002",
    entity: "API网关",
    attribute: "限流策略",
    category: "security",
    recall_half_life: 14,
    tags: ["安全", "API"],
    claims: [
      {
        version: 1, value: "生产环境限流：未认证用户 10 次/分钟，认证用户 100 次/分钟，白名单 IP 不限",
        valid_from: daysAgo(10), valid_to: null,
        confidence: 0.85, source: "security_review",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id],
        status: "active",
      },
    ],
    dependency_graph: ["mem-api001"],
    access_count: 11,
    createdAt: daysAgo(10), updatedAt: daysAgo(10),
  }),

  // 20. Backup policy — fading, single person knows
  makeEntry({
    id: "mem-sec003",
    entity: "运维团队",
    attribute: "备份策略",
    category: "security",
    recall_half_life: 7,
    tags: ["备份", "数据安全"],
    claims: [
      {
        version: 1, value: "每日凌晨 2:00 全量备份，保留 7 天，异地存储到 OSS 冷归档",
        valid_from: daysAgo(12), valid_to: null,
        confidence: 0.72, source: "meeting",
        injected_by: MEMBERS[3].id, confirmed_by: [],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 1,
    createdAt: daysAgo(12), updatedAt: daysAgo(12),
  }),

  // 21. Incident response — recent, well confirmed
  makeEntry({
    id: "mem-sec004",
    entity: "安全团队",
    attribute: "应急响应流程",
    category: "security",
    recall_half_life: 30,
    tags: ["安全", "应急响应", "critical"],
    claims: [
      {
        version: 1, value: "安全事件分级响应：L1(信息泄露) → 立即封禁 + 通知安全组; L2(服务中断) → 切换备用 + 30分钟内通报; L3(数据损坏) → 恢复备份 + 全面审计",
        valid_from: daysAgo(3), valid_to: null,
        confidence: 0.93, source: "security_review",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[2].id, MEMBERS[3].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: ["mem-sec003"],
    access_count: 9,
    createdAt: daysAgo(3), updatedAt: daysAgo(3),
  }),

  // ---- EXPERIENCE (5 entries) ----

  // 22. Performance optimization lesson
  makeEntry({
    id: "mem-exp001",
    entity: "前端团队",
    attribute: "性能优化经验",
    category: "experience",
    recall_half_life: 14,
    tags: ["性能", "前端"],
    claims: [
      {
        version: 1, value: "首屏加载超过 3 秒时，优先检查图片压缩和 Webpack bundle 分析，常见原因是未使用 Tree Shaking",
        valid_from: daysAgo(12), valid_to: null,
        confidence: 0.80, source: "post_mortem",
        injected_by: MEMBERS[1].id, confirmed_by: [MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 7,
    createdAt: daysAgo(12), updatedAt: daysAgo(12),
  }),

  // 23. Database migration lesson — has conflict
  makeEntry({
    id: "mem-exp002",
    entity: "数据库团队",
    attribute: "迁移经验",
    category: "experience",
    recall_half_life: 21,
    tags: ["数据库", "迁移"],
    claims: [
      {
        version: 1, value: "数据库迁移必须在低峰期执行，先在小数据量上验证，迁移前做好完整备份",
        valid_from: daysAgo(18), valid_to: null,
        confidence: 0.78, source: "post_mortem",
        injected_by: MEMBERS[3].id, confirmed_by: [MEMBERS[0].id, MEMBERS[2].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 13,
    createdAt: daysAgo(18), updatedAt: daysAgo(18),
  }),

  // 24. API design lesson
  makeEntry({
    id: "mem-exp003",
    entity: "后端团队",
    attribute: "API设计经验",
    category: "experience",
    recall_half_life: 14,
    tags: ["API", "设计"],
    claims: [
      {
        version: 1, value: "API 分页统一使用 cursor-based 而非 offset-based，避免深翻页性能问题",
        valid_from: daysAgo(8), valid_to: null,
        confidence: 0.85, source: "code_review",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[3].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 15,
    createdAt: daysAgo(8), updatedAt: daysAgo(8),
  }),

  // 25. Monitoring lesson — weak
  makeEntry({
    id: "mem-exp004",
    entity: "运维团队",
    attribute: "监控告警经验",
    category: "experience",
    recall_half_life: 7,
    tags: ["监控", "告警"],
    claims: [
      {
        version: 1, value: "告警阈值设置：CPU > 80% 持续 5 分钟，内存 > 90%，磁盘 > 85%，P99 延迟 > 2s",
        valid_from: daysAgo(15), valid_to: null,
        confidence: 0.60, source: "post_mortem",
        injected_by: MEMBERS[2].id, confirmed_by: [],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 2,
    createdAt: daysAgo(15), updatedAt: daysAgo(15),
  }),

  // 26. Testing lesson
  makeEntry({
    id: "mem-exp005",
    entity: "质量团队",
    attribute: "测试策略经验",
    category: "experience",
    recall_half_life: 14,
    tags: ["测试", "质量"],
    claims: [
      {
        version: 1, value: "核心业务逻辑必须有单元测试覆盖率 > 80%，集成测试覆盖主要用户路径",
        valid_from: daysAgo(6), valid_to: null,
        confidence: 0.82, source: "retrospective",
        injected_by: MEMBERS[4].id, confirmed_by: [MEMBERS[0].id, MEMBERS[1].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 8,
    createdAt: daysAgo(6), updatedAt: daysAgo(6),
  }),

  // ---- GENERAL (4 entries) ----

  // 27. Team meeting schedule
  makeEntry({
    id: "mem-gen001",
    entity: "开发团队",
    attribute: "例会安排",
    category: "general",
    recall_half_life: 7,
    tags: ["会议"],
    claims: [
      {
        version: 1, value: "每周一 10:00 站会（15分钟），周四 14:00 技术分享（30分钟）",
        valid_from: daysAgo(25), valid_to: null,
        confidence: 0.88, source: "meeting",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[2].id, MEMBERS[3].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 20,
    createdAt: daysAgo(25), updatedAt: daysAgo(25),
  }),

  // 28. Office hours — fading
  makeEntry({
    id: "mem-gen002",
    entity: "人事团队",
    attribute: "工作时间",
    category: "general",
    recall_half_life: 3,
    tags: ["人事"],
    claims: [
      {
        version: 1, value: "弹性工作制：核心工作时间 10:00-16:00，其余时间自行安排，每周 40 小时",
        valid_from: daysAgo(5), valid_to: null,
        confidence: 0.75, source: "meeting",
        injected_by: MEMBERS[2].id, confirmed_by: [MEMBERS[0].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 5,
    createdAt: daysAgo(5), updatedAt: daysAgo(5),
  }),

  // 29. Tool preference
  makeEntry({
    id: "mem-gen003",
    entity: "开发团队",
    attribute: "协作工具",
    category: "general",
    recall_half_life: 14,
    tags: ["工具"],
    claims: [
      {
        version: 1, value: "飞书用于日常沟通和文档，GitHub 用于代码管理，Figma 用于设计协作",
        valid_from: daysAgo(20), valid_to: null,
        confidence: 0.85, source: "meeting",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[3].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 14,
    createdAt: daysAgo(20), updatedAt: daysAgo(20),
  }),

  // 30. Project deadline — critical, recent
  makeEntry({
    id: "mem-gen004",
    entity: "项目架构",
    attribute: "里程碑 deadline",
    category: "general",
    recall_half_life: 3,
    tags: ["deadline", "critical", "比赛"],
    claims: [
      {
        version: 1, value: "OpenClaw Memory 系统比赛 Demo 提交截止日：2026-05-20，路演日：2026-05-25",
        valid_from: hoursAgo(2), valid_to: null,
        confidence: 0.98, source: "manual_inject",
        injected_by: MEMBERS[0].id, confirmed_by: [MEMBERS[1].id, MEMBERS[2].id, MEMBERS[3].id, MEMBERS[4].id],
        status: "active",
      },
    ],
    dependency_graph: [],
    access_count: 12,
    createdAt: hoursAgo(2), updatedAt: hoursAgo(2),
  }),
];

// ===========================================================================
// TMS Profile
// ===========================================================================

const TMS_PATH = path.join(
  process.cwd(),
  "workspace",
  "memory",
  "tms",
  "profile.json"
);

function buildTmsProfile() {
  return {
    teamId: TEAM_ID,
    members: Object.fromEntries(
      MEMBERS.map((m) => [
        m.id,
        {
          memberId: m.id,
          displayName: m.name,
          expertiseAreas: getExpertiseFor(m.id),
          knownMemoryIds: getKnownMemoryIds(m.id),
          trustScore: getTrustScore(m.id),
          lastActiveAt: daysAgo(Math.floor(Math.random() * 3)),
          contributionCount: getContributionCount(m.id),
          confirmationCount: getConfirmationCount(m.id),
        },
      ])
    ),
    updatedAt: new Date().toISOString(),
  };
}

function getExpertiseFor(memberId: string): string[] {
  const map: Record<string, string[]> = {
    [MEMBERS[0].id]: ["decision", "security", "process", "架构", "安全", "流程"],
    [MEMBERS[1].id]: ["decision", "api", "experience", "前端", "API", "性能"],
    [MEMBERS[2].id]: ["process", "security", "general", "运维", "质量", "Bug"],
    [MEMBERS[3].id]: ["api", "security", "decision", "数据库", "认证", "基础设施"],
    [MEMBERS[4].id]: ["experience", "general", "测试", "文档", "质量"],
  };
  return map[memberId] ?? [];
}

function getKnownMemoryIds(memberId: string): string[] {
  // Simulate different knowledge patterns
  const allIds = ENTRIES.map((e) => e.id);
  switch (memberId) {
    case MEMBERS[0].id: // 赵晨旭 — knows almost everything (owner)
      return allIds.filter((id) => id !== "mem-api005");
    case MEMBERS[1].id: // 王小明 — frontend/API focused
      return ["mem-dec002", "mem-dec004", "mem-api001", "mem-api002", "mem-api005", "mem-exp001", "mem-exp003", "mem-proc001", "mem-proc004", "mem-sec001", "mem-sec002", "mem-gen001", "mem-gen003", "mem-gen004"];
    case MEMBERS[2].id: // 李婷婷 — process/ops focused
      return ["mem-dec004", "mem-dec005", "mem-proc001", "mem-proc003", "mem-proc005", "mem-sec001", "mem-sec003", "mem-exp002", "mem-gen001", "mem-gen002", "mem-gen004"];
    case MEMBERS[3].id: // 张伟 — infrastructure/security focused
      return ["mem-dec001", "mem-dec003", "mem-api001", "mem-api002", "mem-api004", "mem-sec001", "mem-sec002", "mem-sec003", "mem-sec004", "mem-exp002", "mem-exp003", "mem-proc002", "mem-gen001", "mem-gen003", "mem-gen004"];
    case MEMBERS[4].id: // 陈芳 — QA/experience focused
      return ["mem-dec002", "mem-dec005", "mem-proc005", "mem-proc006", "mem-exp001", "mem-exp005", "mem-sec004", "mem-gen003", "mem-gen004"];
    default:
      return [];
  }
}

function getTrustScore(memberId: string): number {
  const map: Record<string, number> = {
    [MEMBERS[0].id]: 0.95,
    [MEMBERS[1].id]: 0.82,
    [MEMBERS[2].id]: 0.75,
    [MEMBERS[3].id]: 0.90,
    [MEMBERS[4].id]: 0.68,
  };
  return map[memberId] ?? 0.5;
}

function getContributionCount(memberId: string): number {
  const map: Record<string, number> = {
    [MEMBERS[0].id]: 18, [MEMBERS[1].id]: 12,
    [MEMBERS[2].id]: 8, [MEMBERS[3].id]: 15, [MEMBERS[4].id]: 6,
  };
  return map[memberId] ?? 3;
}

function getConfirmationCount(memberId: string): number {
  const map: Record<string, number> = {
    [MEMBERS[0].id]: 25, [MEMBERS[1].id]: 15,
    [MEMBERS[2].id]: 12, [MEMBERS[3].id]: 20, [MEMBERS[4].id]: 8,
  };
  return map[memberId] ?? 2;
}

// ===========================================================================
// Event Log (simulate some recent events)
// ===========================================================================

const EVENT_LOG_DIR = path.join(
  process.cwd(),
  "workspace",
  "memory",
  "event-log"
);

function buildEventLog() {
  const today = new Date().toISOString().split("T")[0];
  return [
    {
      id: "evt-001",
      storedAt: hoursAgo(5).toString(),
      chatId: "oc_83d25a1a702dd5e85aa4666b1d07554a",
      chatType: "group" as const,
      senderId: MEMBERS[0].id,
      senderName: MEMBERS[0].name,
      content: "大家注意，我们决定以后所有 PR 都需要两个 Reviewer 批准",
      contentType: "text" as const,
      messageId: "msg-001",
      participants: MEMBERS.map((m) => m.id),
      processedForExtraction: true,
      extractedMemoryIds: ["mem-proc001"],
    },
    {
      id: "evt-002",
      storedAt: hoursAgo(3).toString(),
      chatId: "oc_83d25a1a702dd5e85aa4666b1d07554a",
      chatType: "group" as const,
      senderId: MEMBERS[3].id,
      senderName: MEMBERS[3].name,
      content: "生产环境 API 端点更新为 https://api.openclaw.internal:8443/v1",
      contentType: "text" as const,
      messageId: "msg-002",
      participants: MEMBERS.map((m) => m.id),
      processedForExtraction: true,
      extractedMemoryIds: ["mem-api001"],
    },
    {
      id: "evt-003",
      storedAt: hoursAgo(2).toString(),
      chatId: "oc_83d25a1a702dd5e85aa4666b1d07554a",
      chatType: "group" as const,
      senderId: MEMBERS[0].id,
      senderName: MEMBERS[0].name,
      content: "比赛 Demo 提交截止日是 5 月 20 日，大家要加油！",
      contentType: "text" as const,
      messageId: "msg-003",
      participants: MEMBERS.map((m) => m.id),
      processedForExtraction: false,
    },
  ];
}

// ===========================================================================
// Memory/learnings files
// ===========================================================================

const MEMORY_DIR = path.join(process.cwd(), "workspace", "memory");
const LEARNINGS_DIR = path.join(MEMORY_DIR, "learnings");

function buildLearningsFiles() {
  const today = new Date().toISOString().split("T")[0];

  return [
    {
      path: path.join(MEMORY_DIR, `${today}.md`),
      content: `# ${today} 每日日志\n\n## 事件\n\n- 团队记忆系统完成 30 条基础数据初始化\n- 覆盖决策、API、流程、安全、经验、通用 6 大类别\n- 模拟 5 人团队成员的知识分布\n\n## 决策\n\n- 确定使用 PostgreSQL 替代 SQLite 作为生产数据库\n- 部署方案存在争议：K8s vs Vercel（待确认）\n\n## 备注\n\n- 比赛 Demo 准备中，截止日 2026-05-20\n`,
    },
    {
      path: path.join(LEARNINGS_DIR, "LEARNINGS.md"),
      content: `# Learnings — 教训和发现\n\n---\n\n## LRN-20260501-001 | correction\n**背景：** 代码审查时发现，直接使用 JSON 文件存储存在并发风险\n**教训：** 生产环境需要引入文件锁或改用数据库\n**状态：** promoted\n**提升到：** TOOLS.md\n\n---\n\n## LRN-20260503-002 | best_practice\n**背景：** 团队记忆系统中，安全类记忆的半衰期应该设长一些\n**发现：** security 类别默认半衰期 30 天，general 只有 7 天\n**教训：** 关键信息的遗忘曲线应该更平缓\n\n---\n\n## LRN-20260505-003 | knowledge_gap\n**背景：** Vector Search 功能配置了但 embedding API 未接入\n**发现：** 搜索功能降级为 keyword-only\n**教训：** 需要配置 text-embedding 端点以启用混合检索\n`,
    },
    {
      path: path.join(LEARNINGS_DIR, "ERRORS.md"),
      content: `# Errors — 操作失败和异常记录\n\n---\n\n## ERR-20260502-001\n**时间：** 2026-05-02 14:30\n**错误：** Event Log 写入并发冲突导致数据丢失\n**原因：** 两个 before_agent_start hook 同时写入同一天的 JSON 文件\n**修复：** 引入 writeLock 队列机制（参见 ledger-storage.ts）\n**状态：** fixed\n`,
    },
    {
      path: path.join(LEARNINGS_DIR, "FEATURE_REQUESTS.md"),
      content: `# Feature Requests — 用户请求的缺失能力\n\n---\n\n## FEAT-20260504-001\n**请求：** 支持飞书文档内容自动导入为团队记忆\n**场景：** 会议纪要中的决策应自动提取，不需要手动 inject\n**优先级：** 高\n\n## FEAT-20260506-002\n**请求：** 支持语音消息的记忆提取\n**场景：** 语音会议中的关键决策也能被记录\n**优先级：** 中\n`,
    },
  ];
}

// ===========================================================================
// Graph Builder — 5-phase algorithm (mirrors MemoryGraph._buildEntrySubgraph)
// ===========================================================================

interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

function nodeId(type: string, key: string): string {
  return `${type.toLowerCase()}:${key.replace(/[^a-zA-Z0-9一-鿿]/g, "_")}`;
}

function edgeId(source: string, target: string, type: string): string {
  return `edge:${source}→${target}:${type}`;
}

function buildGraphFromEntries(entries: EntryDef[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (!nodeIds.has(n.id)) { nodeIds.add(n.id); nodes.push(n); }
  };
  const addEdge = (e: GraphEdge) => {
    if (!edgeIds.has(e.id)) { edgeIds.add(e.id); edges.push(e); }
  };

  for (const entry of entries) {
    // Phase 1: Entity & Attribute nodes
    const entityNode: GraphNode = {
      id: nodeId("Entity", entry.entity),
      type: "Entity",
      label: entry.entity,
      properties: { category: entry.category, tags: entry.tags },
    };
    addNode(entityNode);

    const attrNode: GraphNode = {
      id: nodeId("Attribute", `${entry.entity}.${entry.attribute}`),
      type: "Attribute",
      label: entry.attribute,
      properties: { entity: entry.entity },
    };
    addNode(attrNode);

    addEdge({
      id: edgeId(entityNode.id, attrNode.id, "has_preference"),
      source: entityNode.id,
      target: attrNode.id,
      type: "has_preference",
    });

    // Phase 2: Version chain + Memory nodes
    for (let i = 0; i < entry.claims.length; i++) {
      const claim = entry.claims[i];
      const memNode: GraphNode = {
        id: nodeId("Memory", `${entry.id}-v${claim.version}`),
        type: "Memory",
        label: `v${claim.version}: ${claim.value.substring(0, 40)}`,
        properties: {
          version: claim.version,
          confidence: claim.confidence,
          status: claim.status,
          valid_from: claim.valid_from,
          valid_to: claim.valid_to,
        },
      };
      addNode(memNode);

      // Entity → Memory
      addEdge({
        id: edgeId(entityNode.id, memNode.id, "related_memory"),
        source: entityNode.id,
        target: memNode.id,
        type: "related_memory",
      });

      // Attribute → Memory (current vs old value)
      if (claim.status === "active" || claim.status === undefined) {
        addEdge({
          id: edgeId(attrNode.id, memNode.id, "current_value"),
          source: attrNode.id,
          target: memNode.id,
          type: "current_value",
        });
      } else if (claim.status === "superseded") {
        addEdge({
          id: edgeId(attrNode.id, memNode.id, "old_value"),
          source: attrNode.id,
          target: memNode.id,
          type: "old_value",
        });
      }

      // Supersedes edge (version chain)
      if (i > 0) {
        const prevClaim = entry.claims[i - 1];
        addEdge({
          id: edgeId(
            nodeId("Memory", `${entry.id}-v${claim.version}`),
            nodeId("Memory", `${entry.id}-v${prevClaim.version}`),
            "supersedes"
          ),
          source: nodeId("Memory", `${entry.id}-v${claim.version}`),
          target: nodeId("Memory", `${entry.id}-v${prevClaim.version}`),
          type: "supersedes",
        });
      }
    }

    // Phase 3: Provenance (source events)
    for (const claim of entry.claims) {
      if (claim.source) {
        const eventNode: GraphNode = {
          id: nodeId("Event", claim.source),
          type: "Event",
          label: claim.source,
          properties: { source: claim.source },
        };
        addNode(eventNode);
        const memNodeId = nodeId("Memory", `${entry.id}-v${claim.version}`);
        addEdge({
          id: edgeId(memNodeId, eventNode.id, "derived_from"),
          source: memNodeId,
          target: eventNode.id,
          type: "derived_from",
        });
      }
    }

    // Phase 4: Social linking (injector + confirmers)
    for (const claim of entry.claims) {
      const injectorNode: GraphNode = {
        id: nodeId("Person", claim.injected_by),
        type: "Person",
        label: claim.injected_by,
        properties: { role: "injector" },
      };
      addNode(injectorNode);
      const memNodeId = nodeId("Memory", `${entry.id}-v${claim.version}`);
      addEdge({
        id: edgeId(memNodeId, injectorNode.id, "injected_by"),
        source: memNodeId,
        target: injectorNode.id,
        type: "injected_by",
      });
      for (const confirmer of claim.confirmed_by) {
        const confirmerNode: GraphNode = {
          id: nodeId("Person", confirmer),
          type: "Person",
          label: confirmer,
          properties: { role: "confirmer" },
        };
        addNode(confirmerNode);
        addEdge({
          id: edgeId(memNodeId, confirmerNode.id, "confirmed_by"),
          source: memNodeId,
          target: confirmerNode.id,
          type: "confirmed_by",
        });
      }
    }

    // Phase 5: Dependency graph edges
    for (const depId of entry.dependency_graph) {
      const targetEntry = entries.find(e => e.id === depId);
      if (targetEntry) {
        const activeClaim = entry.claims.find(c => c.status === "active");
        const targetActiveClaim = targetEntry.claims.find(c => c.status === "active");
        if (activeClaim && targetActiveClaim) {
          const memNodeId = nodeId("Memory", `${entry.id}-v${activeClaim.version}`);
          const targetMemNodeId = nodeId("Memory", `${depId}-v${targetActiveClaim.version}`);
          addEdge({
            id: edgeId(memNodeId, targetMemNodeId, "affects"),
            source: memNodeId,
            target: targetMemNodeId,
            type: "affects",
          });
        }
      }
    }
  }

  return { nodes, edges };
}

// ===========================================================================
// Main: write all files
// ===========================================================================

async function main() {
  console.log("🚀 Seeding demo data for Team Memory Engine...\n");

  // 1. Write Ledger
  const ledgerData: Record<string, EntryDef> = {};
  for (const entry of ENTRIES) {
    ledgerData[entry.id] = makeEntry(entry);
  }
  await fs.promises.writeFile(LEDGER_PATH, JSON.stringify(ledgerData, null, 2), "utf-8");
  console.log(`✅ Ledger: ${ENTRIES.length} entries → ${LEDGER_PATH}`);

  // 3. Build Memory Graph from ledger entries (5-phase algorithm)
  const GRAPH_PATH = path.join(
    process.env.HOME ?? "/tmp",
    ".openclaw-memory-graph.json"
  );
  const graph = buildGraphFromEntries(ENTRIES);
  await fs.promises.writeFile(GRAPH_PATH, JSON.stringify(graph, null, 2), "utf-8");
  console.log(`✅ Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges → ${GRAPH_PATH}`);

  // 4. Write TMS Profile
  await fs.promises.mkdir(path.dirname(TMS_PATH), { recursive: true });
  const tms = buildTmsProfile();
  await fs.promises.writeFile(TMS_PATH, JSON.stringify(tms, null, 2), "utf-8");
  console.log(`✅ TMS Profile: ${MEMBERS.length} members → ${TMS_PATH}`);

  // 5. Write Event Log
  await fs.promises.mkdir(EVENT_LOG_DIR, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const events = buildEventLog();
  await fs.promises.writeFile(
    path.join(EVENT_LOG_DIR, `${today}.json`),
    JSON.stringify(events, null, 2),
    "utf-8"
  );
  console.log(`✅ Event Log: ${events.length} events → ${EVENT_LOG_DIR}/${today}.json`);

  // 6. Write Memory logs and learnings
  await fs.promises.mkdir(MEMORY_DIR, { recursive: true });
  await fs.promises.mkdir(LEARNINGS_DIR, { recursive: true });

  for (const file of buildLearningsFiles()) {
    await fs.promises.writeFile(file.path, file.content, "utf-8");
    console.log(`✅ Memory: ${path.basename(file.path)} → ${file.path}`);
  }

  // 7. Print summary
  console.log("\n📊 Data Summary:");
  console.log(`   Total memories: ${ENTRIES.length}`);
  console.log(`   Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  console.log(`   Categories: ${[...new Set(ENTRIES.map(e => e.category))].join(", ")}`);
  console.log(`   Team members: ${MEMBERS.length}`);
  console.log(`   Conflicting entries: ${ENTRIES.filter(e => e.claims.some(c => c.status === "conflicting")).length}`);
  console.log(`   Multi-version entries: ${ENTRIES.filter(e => e.claims.length > 1).length}`);

  // Show decay state distribution
  const now = Date.now();
  let fresh = 0, strong = 0, fading = 0, weak = 0, critical = 0;
  for (const entry of ENTRIES) {
    const activeClaim = entry.claims.find(c => c.status === "active");
    if (!activeClaim) { critical++; continue; }
    const elapsed = now - new Date(activeClaim.valid_from).getTime();
    const halfLifeMs = entry.recall_half_life * 24 * 60 * 60 * 1000;
    const strength = Math.pow(2, -elapsed / halfLifeMs);
    if (strength >= 0.8) fresh++;
    else if (strength >= 0.5) strong++;
    else if (strength >= 0.3) fading++;
    else if (strength >= 0.1) weak++;
    else critical++;
  }
  console.log(`\n   Decay distribution:`);
  console.log(`   🟢 Fresh (≥80%):   ${fresh}`);
  console.log(`   🔵 Strong (50-80%): ${strong}`);
  console.log(`   🟡 Fading (30-50%): ${fading}`);
  console.log(`   🟠 Weak (10-30%):   ${weak}`);
  console.log(`   🔴 Critical (<10%): ${critical}`);
}

main().catch(console.error);
