// Tool registrations for the team-memory-engine plugin
// Each registerTool call creates one agent-callable tool.

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { TeamMemoryManager } from "./manager.js";
import type { TeamMemoryConfig } from "./plugin-config.js";
import { EventLog } from "./event-log.js";
import { formatConflictMention, sendFeishuMessage } from "./plugin-feishu.js";

export function registerTools(api: OpenClawPluginApi, manager: TeamMemoryManager, cfg: TeamMemoryConfig) {
  // team_memory_inject
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

  // team_memory_update
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

  // team_memory_status
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
            return { content: [{ type: "text", text: "No team memories stored yet." }], details: { count: 0 } };
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

  // team_memory_review
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
          return { content: [{ type: "text", text: `Memory ${memoryId} marked as reviewed.` }], details: { action: "reviewed", id: memoryId } };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed to review memory: ${String(err)}` }], details: { error: String(err) } };
        }
      },
    },
    { name: "team_memory_review" },
  );

  // team_memory_risk
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
            return { content: [{ type: "text", text: "No memories exceed risk thresholds. Team cognitive state is healthy." }], details: { totalChecked: scores.length, triggered: 0 } };
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
          return { content: [{ type: "text", text: `Failed to assess risk: ${String(err)}` }], details: { error: String(err) } };
        }
      },
    },
    { name: "team_memory_risk" },
  );

  // team_memory_extract
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

  // team_memory_tms
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
          const { TeamCapabilityModel } = await import("./tms.js");
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

  // team_memory_simulate
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
          return { content: [{ type: "text", text: lines.join("\n") }], details: { simulation: result } };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${String(err)}` }], details: { error: String(err) } };
        }
      },
    },
    { name: "team_memory_simulate" },
  );

  // team_memory_gaps
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
          const lines = [`${gaps.length} single point(s) of failure:`, ``];
          for (const gap of gaps.slice(0, 15)) {
            lines.push(`  - ${gap.currentHolder} knows: ${gap.entity}.${gap.attribute} = "${gap.value.substring(0, 50)}" (risk: ${(gap.riskScore * 100).toFixed(0)}%)`);
          }
          if (gaps.length > 15) {
            lines.push(`  ... and ${gaps.length - 15} more`);
          }
          return { content: [{ type: "text", text: lines.join("\n") }], details: { gaps } };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${String(err)}` }], details: { error: String(err) } };
        }
      },
    },
    { name: "team_memory_gaps" },
  );

  // team_memory_insight
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

  // team_memory_proactive
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
}
