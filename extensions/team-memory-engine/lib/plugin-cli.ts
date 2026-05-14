// CLI command registrations for the team-memory-engine plugin
// All `openclaw team-memory` subcommands.

import * as os from "os";
import * as path from "path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { TeamMemoryManager } from "./manager.js";
import type { TeamMemoryConfig } from "./plugin-config.js";
import { EventLog } from "./event-log.js";
import { formatConflictCard, sendFeishuMessage } from "./plugin-feishu.js";
import { importFeishuDoc, importFeishuBitable, importFeishuCalendar, importAllFeishuSources } from "./feishu-importer.js";
import { LedgerStorageBackend } from "./storage/ledger-storage.js";

export function registerCli(api: OpenClawPluginApi, manager: TeamMemoryManager, cfg: TeamMemoryConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.registerCli(({ program }: { program: any }) => {
    const cmd = program
      .command("team-memory")
      .description("Team memory engine commands (v2 — Memory OS)");

    // inject
    cmd.command("inject").description("Inject a new team memory").argument("<text>", "Memory content").option("-c, --category <cat>", "Category", "general").option("-t, --tags <tags>", "Comma-separated tags", "").action(async (text: string, opts: { category: string; tags: string }) => {
      try {
        const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
        const result = await manager.inject(text, { category: opts.category, tags });
        console.log(`Stored: ${result.memory} (id: ${result.id}, v${result.metadata.version})`);
        if (result.conflict) {
          console.log(`  ⚡ 冲突检测：${result.conflict.type} — 已标记 conflicting，等待人工裁决`);
          console.log(`     原因：${result.conflict.reason}`);
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

    // status
    cmd.command("status").description("Show team memory status with decay info").option("-c, --category <cat>", "Filter by category").action(async (opts: { category?: string }) => {
      try {
        const memories = await manager.status(opts.category);
        if (memories.length === 0) { console.log("No team memories stored."); return; }
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

    // list
    cmd.command("list").description("List all team memories as JSON").action(async () => {
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

    // review
    cmd.command("review").description("Mark a memory as reviewed").argument("<id>", "Memory ID").action(async (id: string) => {
      try {
        await manager.forceReview(id);
        console.log(`Memory ${id} marked as reviewed.`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // search
    cmd.command("search").description("Search team memories").argument("<query>", "Search query").action(async (query: string) => {
      try {
        const results = await manager.search(query);
        if (results.length === 0) { console.log("No matching team memories found."); return; }
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

    // risk
    cmd.command("risk").description("Assess forgetting risk for all memories").action(async () => {
      try {
        const scores = await manager.assessRisk();
        const triggered = scores.filter((s) => s.triggered);
        if (triggered.length === 0) { console.log("No memories exceed risk thresholds."); return; }
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

    // graph
    cmd.command("graph").description("Show memory graph (optionally filtered by entity)").argument("[entity]", "Entity name to filter").action(async (entity?: string) => {
      try {
        const graph = await manager.getGraph(entity);
        console.log(JSON.stringify(graph, null, 2));
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // migrate
    cmd.command("migrate").description("Run v1 → v2 data migration").action(async () => {
      try {
        const { runMigration } = await import("./migrate.js");
        const result = await runMigration();
        console.log(`Migration complete: ${result.migrated} entries migrated`);
        if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
        if (result.errors.length > 0) console.log(`Errors: ${result.errors.join(", ")}`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // rebuild-graph
    cmd.command("rebuild-graph").description("Rebuild the memory graph from current ledger state").action(async () => {
      try {
        await manager.rebuildGraph();
        const graph = await manager.getGraph();
        console.log(`Graph rebuilt: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // extract
    cmd.command("extract").description("Run LLM memory extraction on unprocessed event log entries").option("-l, --limit <n>", "Max events to process", "20").action(async (opts: { limit: string }) => {
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

    // tms
    cmd.command("tms").description("Show team capability profile").argument("[memberId]", "Filter by member").action(async (memberId?: string) => {
      try {
        if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
        const { TeamCapabilityModel } = await import("./tms.js");
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

    // simulate-departure
    cmd.command("simulate-departure").description("Simulate a member leaving — show knowledge gaps, risk changes, transfer recommendations").argument("<memberId>", "Member ID to simulate departure for").option("-j, --json", "Output as JSON").action(async (memberId: string, opts: { json?: boolean }) => {
      try {
        if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
        const result = await manager.simulateDeparture(memberId);
        if (!result) { console.log("Member not found."); return; }
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
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

    // knowledge-gaps
    cmd.command("knowledge-gaps").description("Find memories known by only one person (single points of failure)").action(async () => {
      try {
        if (!cfg.projectRoot) { console.error("projectRoot not configured"); return; }
        const gaps = await manager.getKnowledgeGaps();
        if (gaps.length === 0) { console.log("No single points of failure. Team knowledge is well distributed."); return; }
        console.log(`${gaps.length} single point(s) of failure:\n`);
        for (const gap of gaps) {
          console.log(`  [${gap.currentHolder}] ${gap.entity}.${gap.attribute} = "${gap.value.substring(0, 60)}" (risk: ${(gap.riskScore * 100).toFixed(0)}%)`);
        }
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // pipeline
    cmd.command("pipeline").description("Run the full event-log → extract → ledger → graph pipeline once").option("-b, --batch-size <n>", "Events to process per batch", "20").action(async (opts: { batchSize: string }) => {
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

    // insight
    cmd.command("insight").description("Generate team memory insight dashboard report").option("-f, --format <fmt>", "Output format: html (default) or json", "html").option("-o, --output <path>", "Output file path", "").action(async (opts: { format: string; output: string }) => {
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

    // proactive-capture
    cmd.command("proactive-capture").description("Analyze text for proactive memory capture (demo tool)").argument("<text>", "Text to analyze for memory-worthy content").action(async (text: string) => {
      try {
        const { analyzeForProactiveCapture, LLMEnhancedCapture } = await import("./proactive-capture.js");
        const capture = analyzeForProactiveCapture(text, { isOwner: true, isGroup: false });

        // LLM enhancement if configured
        const modelEndpoint = cfg.modelEndpoint ?? process.env?.TEAM_MEMORY_MODEL_ENDPOINT ?? "";
        const modelApiKey = cfg.modelApiKey ?? process.env?.TEAM_MEMORY_MODEL_API_KEY ?? "";
        const modelName = cfg.modelName ?? process.env?.TEAM_MEMORY_MODEL_NAME ?? "doubao-seed-2.0-pro";
        const modelXApiKey = cfg.modelXApiKey ?? process.env?.TEAM_MEMORY_MODEL_X_API_KEY ?? "";

        if (modelEndpoint && modelApiKey) {
          const llmCapture = new LLMEnhancedCapture({
            modelEndpoint,
            modelApiKey,
            modelName,
            xApiKey: modelXApiKey || undefined,
          });
          const llmResult = await llmCapture.analyzeHybrid(text, { isOwner: true, isGroup: false });
          if (llmResult) {
            console.log(`✅ LLM-enhanced detection [${llmResult.triggerType}] confidence=${(llmResult.confidence * 100).toFixed(0)}%`);
            console.log(`   Entity: ${llmResult.entity ?? "(LLM extracted)"}`);
            console.log(`   Attribute: ${llmResult.attribute ?? "(LLM extracted)"}`);
            console.log(`   Value: ${llmResult.value}`);
            console.log(`   Category: ${llmResult.category}`);
            return;
          }
        }

        // Fallback to regex
        if (capture.detected) {
          console.log(`✅ Regex detection [${capture.triggerType}] confidence=${(capture.confidence * 100).toFixed(0)}%`);
          console.log(`   Category: ${capture.category}`);
          console.log(`   Memory: ${capture.memoryText}`);
          if (capture.entity) console.log(`   Entity: ${capture.entity}`);
          if (capture.attribute) console.log(`   Attribute: ${capture.attribute}`);
          if (capture.value) console.log(`   Value: ${capture.value}`);
        } else {
          console.log("❌ No memory-worthy content detected");
        }
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // --- v2.2 Innovation Commands ---

    // conflict-explain — AI-powered conflict analysis
    cmd.command("conflict-explain").description("[v2.2] AI analysis of a conflicting memory").argument("<id>", "Memory ID").action(async (id: string) => {
      try {
        const explanation = await manager.explainConflictCLI(id);
        console.log(explanation);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // decay-history — adaptive decay review tracking
    cmd.command("decay-history").description("[v2.2] Show adaptive decay review history for a memory").argument("<id>", "Memory ID").action(async (id: string) => {
      try {
        const summary = await manager.getDecayHistory(id);
        const entry = await manager.getEntry(id);
        if (entry) {
          console.log(`Memory: ${entry.entity}.${entry.attribute}`);
          console.log(`Current half-life: ${entry.recall_half_life} days`);
          console.log(`Category: ${entry.category}`);
          console.log();
          console.log(summary);
        }
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // apply-decay-defaults — apply category-aware half-life defaults
    cmd.command("apply-decay-defaults").description("[v2.2] Apply category-aware default half-lives to all memories").action(async () => {
      try {
        const count = await manager.applyDecayCategoryDefaults();
        console.log(`Applied category-aware defaults to ${count} memories`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // infer-dependencies — AI-powered graph dependency inference
    cmd.command("infer-dependencies").description("[v2.2] LLM inference of cross-memory dependencies").action(async () => {
      try {
        const result = await manager.inferDependencies();
        console.log(`Inferred ${result.dependencies.length} dependencies across ${result.updatedEntries.length} entries`);
        if (result.dependencies.length > 0) {
          console.log();
          for (const dep of result.dependencies.slice(0, 20)) {
            console.log(`  ${dep.sourceId} --[${dep.relation}]--> ${dep.targetId}`);
            console.log(`    ${dep.reason}`);
            console.log();
          }
        }
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // centrality-scores — graph centrality computation
    cmd.command("centrality-scores").description("[v2.2] Show memory graph centrality scores").option("-j, --json", "Output as JSON").action(async (opts: { json?: boolean }) => {
      try {
        const centrality = await manager.getCentralityScores();
        const entries = await (manager as any).ledger.getAllEntries((manager as any).teamId);
        const scored = entries
          .map((e: any) => ({ id: e.id, entity: e.entity, attribute: e.attribute, centrality: centrality.get(e.id) ?? 0 }))
          .sort((a: any, b: any) => b.centrality - a.centrality);

        if (opts.json) {
          console.log(JSON.stringify(scored, null, 2));
          return;
        }
        console.log("Memory Centrality (higher = structurally more important):");
        console.log();
        for (const s of scored) {
          if (s.centrality > 0) {
            const bar = "█".repeat(Math.round(s.centrality * 5)) + "░".repeat(5 - Math.round(s.centrality * 5));
            console.log(`  [${bar}] ${(s.centrality * 100).toFixed(0)}% ${s.entity}.${s.attribute} (${s.id})`);
          }
        }
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // conflict-propagation — detect which memories are affected by a conflict
    cmd.command("conflict-propagation").description("[v2.2] Show which memories are affected by a conflicting memory").argument("<id>", "Memory ID").action(async (id: string) => {
      try {
        const affected = await manager.getConflictPropagation(id);
        if (affected.length === 0) {
          console.log("No dependent memories affected by this conflict.");
          return;
        }
        console.log(`${affected.length} dependent memories affected by conflict in ${id}:`);
        console.log();
        for (const entry of affected) {
          const active = entry.claims.find(c => c.status === "active");
          console.log(`  ${entry.id}: ${entry.entity}.${entry.attribute} = "${active?.value?.slice(0, 40) ?? "N/A"}"`);
        }
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    // Feishu content importer — deep integration
    cmd.command("import-doc").description("Import a Feishu doc as team memories (LLM extraction)").argument("<doc-token>", "Feishu doc token").action(async (docToken: string) => {
      try {
        const result = await importFeishuDoc(docToken, {
          modelEndpoint: cfg.modelEndpoint,
          modelApiKey: cfg.modelApiKey,
          modelName: cfg.modelName,
          xApiKey: cfg.modelXApiKey,
        }, cfg.teamId, path.join(os.homedir(), ".openclaw-memory-ledger.json"));
        console.log(`✅ Imported doc → ${result.memoriesExtracted} memories`);
        console.log(`   Content: ${result.contentLength} chars`);
        for (const id of result.memoryIds) console.log(`   ${id}`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    cmd.command("import-bitable").description("Import Feishu Bitable records as team memories").argument("<app-token>", "Bitable app token").argument("<table-id>", "Table ID").action(async (appToken: string, tableId: string) => {
      try {
        const result = await importFeishuBitable(appToken, tableId, {
          modelEndpoint: cfg.modelEndpoint,
          modelApiKey: cfg.modelApiKey,
          modelName: cfg.modelName,
          xApiKey: cfg.modelXApiKey,
        }, cfg.teamId, path.join(os.homedir(), ".openclaw-memory-ledger.json"));
        console.log(`✅ Imported bitable → ${result.memoriesExtracted} memories`);
        for (const id of result.memoryIds) console.log(`   ${id}`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    cmd.command("import-calendar").description("Import upcoming calendar events as process memories").option("-d, --days <n>", "Days ahead", "7").action(async (opts: { days: string }) => {
      try {
        const result = await importFeishuCalendar({
          modelEndpoint: cfg.modelEndpoint,
          modelApiKey: cfg.modelApiKey,
          modelName: cfg.modelName,
          xApiKey: cfg.modelXApiKey,
        }, cfg.teamId, path.join(os.homedir(), ".openclaw-memory-ledger.json"), parseInt(opts.days, 10));
        console.log(`✅ Imported calendar → ${result.memoriesExtracted} memories`);
        for (const id of result.memoryIds) console.log(`   ${id}`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

    cmd.command("import-all").description("Batch import: doc + bitable + calendar from Feishu").option("--doc <token...>", "Doc tokens to import").option("--bitable <app:table...>", "Bitables as appToken:tableId").option("--days <n>", "Calendar days ahead", "7").action(async (opts: { doc?: string[]; bitable?: string[]; days: string }) => {
      try {
        const bitables = (opts.bitable ?? []).map(s => {
          const [appToken, tableId] = s.split(":");
          return { appToken, tableId };
        });
        const ledgerPath = path.join(os.homedir(), ".openclaw-memory-ledger.json");
        const config = {
          modelEndpoint: cfg.modelEndpoint,
          modelApiKey: cfg.modelApiKey,
          modelName: cfg.modelName,
          xApiKey: cfg.modelXApiKey,
        };
        const results = await importAllFeishuSources(config, cfg.teamId, ledgerPath, {
          docTokens: opts.doc,
          bitables,
          calendarDaysAhead: parseInt(opts.days, 10),
        });
        let total = 0;
        for (const r of results) {
          console.log(`✅ ${r.sourceType} → ${r.memoriesExtracted} memories`);
          total += r.memoriesExtracted;
        }
        console.log(`\nTotal: ${total} memories imported`);
      } catch (err) {
        console.error(`Failed: ${String(err)}`);
      }
    });

  }, { commands: ["team-memory"] });
}
