// Storage Performance Benchmark — tests scalability with thousands of memories
// Run: npx tsx scripts/storage-perf-bench.ts

import { TeamMemoryManager, type Mem0Provider } from "../lib/manager.js";
import * as fs from "fs";
import * as path from "path";

const noopMem0: Mem0Provider = {
  async add() { return {}; },
  async search() { return []; },
  async getAll() { return []; },
  async get() { return undefined; },
  async delete() { return {}; },
};

const BENCH_ROOT = `/tmp/team-mem-perf-bench-${Date.now()}`;
fs.mkdirSync(BENCH_ROOT, { recursive: true });

const STORAGE_DIR = path.join(BENCH_ROOT, "storage");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

interface PerfMetric {
  operation: string;
  count: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function measure(label: string, timings: number[]): PerfMetric {
  const sorted = [...timings].sort((a, b) => a - b);
  return {
    operation: label,
    count: timings.length,
    totalMs: parseFloat(timings.reduce((a, b) => a + b, 0).toFixed(2)),
    avgMs: parseFloat((timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(3)),
    p50Ms: parseFloat(sorted[Math.floor(sorted.length * 0.5)].toFixed(3)),
    p95Ms: parseFloat(sorted[Math.floor(sorted.length * 0.95)].toFixed(3)),
    p99Ms: parseFloat(sorted[Math.floor(sorted.length * 0.99)].toFixed(3)),
    maxMs: parseFloat(sorted[sorted.length - 1].toFixed(3)),
  };
}

async function bench(label: string, iterations: number, fn: () => Promise<void>): Promise<number[]> {
  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const elapsed = performance.now() - start;
    timings.push(elapsed);
  }
  return timings;
}

// Memory content templates for realistic variety
const entities = [
  "客户A", "客户B", "客户C", "Alpha项目", "Beta项目", "API网关",
  "数据库", "生产环境", "测试环境", "CI流水线", "代码审查流程", "发布规范",
  "微服务架构", "前端团队", "后端团队", "运维团队", "安全团队", "产品组",
];
const attributes = [
  "交付格式", "部署方式", "API端点", "数据库版本", "连接池大小", "代码风格",
  "会议时间", "截止日期", "负责人", "审批流程", "密钥轮换周期", "监控阈值",
  "日志级别", "备份策略", "回滚方案", "灰度比例", "超时设置", "缓存策略",
];
const values = [
  "PDF", "Markdown", "灰度发布", "全量上线", "v3", "v4",
  "50", "100", "每周五", "每月1号", "Prettier", "ESLint",
  "周三下午3点", "6月15号", "李四", "王五", "24小时", "1小时",
  "JSON", "XML", "gRPC", "REST", "PostgreSQL", "MySQL",
];
const categories = ["decision", "api", "process", "experience", "security", "general"] as const;
const tagPool = ["prod", "critical", "compliance", "deadline", "交付", "客户A", "部署", "数据库", "代码规范", "安全"];
const authors = ["alice", "bob", "charlie", "dave", "eve", "frank", "grace", "hank"];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTags(): string[] {
  const count = Math.floor(Math.random() * 3);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) tags.push(randomFrom(tagPool));
  return [...new Set(tags)];
}

async function main() {
  console.log("\n" + "█".repeat(60));
  console.log("  Storage Performance Benchmark — Scalability Test");
  console.log("  Tests: 100, 500, 1000, 2000, 5000 memories");
  console.log("█".repeat(60));

  const scales = [100, 500, 1000, 2000, 5000];
  const allResults: Record<number, { inject: PerfMetric; search: PerfMetric; status: PerfMetric; fileSizeKB: number }> = {};

  for (const scale of scales) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  Testing scale: ${scale} memories`);
    console.log("─".repeat(60));

    const scaleDir = path.join(STORAGE_DIR, `scale-${scale}`);
    fs.mkdirSync(scaleDir, { recursive: true });

    const mgr = new TeamMemoryManager(noopMem0, {
      teamId: "perf-team",
      defaultUserId: "agent",
      teamSize: 8,
      enableGraph: false, // disable graph to isolate storage perf
      projectRoot: scaleDir,
      ledgerPath: path.join(scaleDir, "ledger.json"),
      graphPath: path.join(scaleDir, "graph.json"),
    });

    // --- Inject memories ---
    console.log(`\n  Injecting ${scale} memories...`);
    const injectTimings: number[] = [];
    for (let i = 0; i < scale; i++) {
      const entity = randomFrom(entities);
      const attr = randomFrom(attributes);
      const val = randomFrom(values);
      const category = randomFrom(categories);
      const text = `${entity}的${attr}改为${val}`;
      const start = performance.now();
      await mgr.inject(text, {
        category,
        tags: randomTags(),
        author: randomFrom(authors),
      });
      const elapsed = performance.now() - start;
      injectTimings.push(elapsed);

      if ((i + 1) % 500 === 0) {
        process.stdout.write(`  Progress: ${i + 1}/${scale} (${((i + 1) / scale * 100).toFixed(0)}%)\n`);
      }
    }

    const injectMetric = measure("inject", injectTimings);
    console.log(`  Inject: avg=${injectMetric.avgMs.toFixed(2)}ms, p50=${injectMetric.p50Ms.toFixed(2)}ms, p95=${injectMetric.p95Ms.toFixed(2)}ms, p99=${injectMetric.p99Ms.toFixed(2)}ms, max=${injectMetric.maxMs.toFixed(2)}ms`);

    // --- Search ---
    const searchQueries = ["API端点", "客户A", "部署方式", "v3", "prod", "PDF", "灰度发布", "数据库", "6月15号", "代码风格"];
    const searchTimings: number[] = [];
    for (let i = 0; i < 50; i++) {
      const query = searchQueries[i % searchQueries.length];
      const start = performance.now();
      await mgr.search(query);
      searchTimings.push(performance.now() - start);
    }
    const searchMetric = measure("search", searchTimings);
    console.log(`  Search: avg=${searchMetric.avgMs.toFixed(2)}ms, p50=${searchMetric.p50Ms.toFixed(2)}ms, p95=${searchMetric.p95Ms.toFixed(2)}ms, p99=${searchMetric.p99Ms.toFixed(2)}ms`);

    // --- Status (full read) ---
    const statusTimings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await mgr.status();
      statusTimings.push(performance.now() - start);
    }
    const statusMetric = measure("status", statusTimings);
    console.log(`  Status: avg=${statusMetric.avgMs.toFixed(2)}ms, p50=${statusMetric.p50Ms.toFixed(2)}ms`);

    // --- File size ---
    const ledgerPath = path.join(scaleDir, "ledger.json");
    const fileSizeKB = Math.round(fs.statSync(ledgerPath).size / 1024);
    console.log(`  Ledger file size: ${fileSizeKB} KB`);

    allResults[scale] = {
      inject: injectMetric,
      search: searchMetric,
      status: statusMetric,
      fileSizeKB,
    };
  }

  // --- Summary table ---
  console.log(`\n\n${"█".repeat(60)}`);
  console.log("  Performance Summary");
  console.log("█".repeat(60));

  console.log("\n  ┌─ Inject Performance ─────────────────────────────────────────────────┐");
  console.log("  │ Scale   │  avg(ms)  │  p50(ms)  │  p95(ms)  │  p99(ms)  │  max(ms)  │");
  console.log("  │" + "─".repeat(66) + "│");
  for (const scale of scales) {
    const m = allResults[scale].inject;
    console.log(`  │ ${String(scale).padStart(5)}   │ ${String(m.avgMs.toFixed(2)).padStart(9)} │ ${String(m.p50Ms.toFixed(2)).padStart(9)} │ ${String(m.p95Ms.toFixed(2)).padStart(9)} │ ${String(m.p99Ms.toFixed(2)).padStart(9)} │ ${String(m.maxMs.toFixed(2)).padStart(9)} │`);
  }
  console.log("  └────────────────────────────────────────────────────────────────────────┘");

  console.log("\n  ┌─ Search Performance (50 queries avg) ──────────────────────────────────┐");
  console.log("  │ Scale   │  avg(ms)  │  p50(ms)  │  p95(ms)  │  p99(ms)  │  max(ms)  │");
  console.log("  │" + "─".repeat(66) + "│");
  for (const scale of scales) {
    const m = allResults[scale].search;
    console.log(`  │ ${String(scale).padStart(5)}   │ ${String(m.avgMs.toFixed(2)).padStart(9)} │ ${String(m.p50Ms.toFixed(2)).padStart(9)} │ ${String(m.p95Ms.toFixed(2)).padStart(9)} │ ${String(m.p99Ms.toFixed(2)).padStart(9)} │ ${String(m.maxMs.toFixed(2)).padStart(9)} │`);
  }
  console.log("  └────────────────────────────────────────────────────────────────────────┘");

  console.log("\n  ┌─ Storage Size ─────────────────────────────────────────────────────────┐");
  console.log("  │ Scale   │  File Size (KB)  │  Bytes/Memory  │  Total Records  │");
  console.log("  │" + "─".repeat(66) + "│");
  for (const scale of scales) {
    const sizeKB = allResults[scale].fileSizeKB;
    const bytesPer = Math.round((sizeKB * 1024) / scale);
    console.log(`  │ ${String(scale).padStart(5)}   │ ${String(sizeKB).padStart(14)} │ ${String(bytesPer).padStart(12)} │ ${String(scale).padStart(14)} │`);
  }
  console.log("  └────────────────────────────────────────────────────────────────────────┘");

  // --- Scaling analysis ---
  console.log("\n  ┌─ Scaling Analysis ─────────────────────────────────────────────────────┐");
  const baseInject = allResults[100].inject.avgMs;
  const baseSearch = allResults[100].search.avgMs;
  for (const scale of scales.filter(s => s > 100)) {
    const injectSlowdown = allResults[scale].inject.avgMs / baseInject;
    const searchSlowdown = allResults[scale].search.avgMs / baseSearch;
    console.log(`  │ Scale ${scale}: inject ${injectSlowdown.toFixed(1)}x slower, search ${searchSlowdown.toFixed(1)}x slower vs base (100) │`);
  }
  console.log("  └────────────────────────────────────────────────────────────────────────┘");

  console.log("\n  Conclusion:");
  const maxSearch = allResults[5000].search.avgMs;
  const maxInject = allResults[5000].inject.avgMs;
  if (maxSearch < 50) {
    console.log(`  ✅ Search latency at 5000 memories: ${maxSearch.toFixed(2)}ms — acceptable for interactive use`);
  } else {
    console.log(`  ⚠️  Search latency at 5000 memories: ${maxSearch.toFixed(2)}ms — consider adding indexes`);
  }
  if (maxInject < 100) {
    console.log(`  ✅ Inject latency at 5000 memories: ${maxInject.toFixed(2)}ms — acceptable for background processing`);
  } else {
    console.log(`  ⚠️  Inject latency at 5000 memories: ${maxInject.toFixed(2)}ms — consider batching writes`);
  }
  console.log("█".repeat(60) + "\n");
}

main().catch(console.error);
