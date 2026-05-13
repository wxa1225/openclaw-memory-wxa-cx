// Event hooks and background services for the team-memory-engine plugin
// - Event log capture (before_agent_start, agent_end)
// - Proactive memory capture
// - Decay check + risk check services
// - Event-log → extract pipeline service

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { TeamMemoryManager } from "./manager.js";
import type { TeamMemoryConfig } from "./plugin-config.js";
import { EventLog } from "./event-log.js";
import { analyzeForProactiveCapture, PromptRateLimiter, LLMEnhancedCapture } from "./proactive-capture.js";
import { formatProactiveConfirmCard } from "./proactive-card.js";
import { sendFeishuMessage } from "./plugin-feishu.js";

export function setupEventHooks(api: OpenClawPluginApi, manager: TeamMemoryManager, cfg: TeamMemoryConfig) {
  // Proactive capture rate limiter
  const rateLimiter = new PromptRateLimiter({
    minIntervalMs: cfg.proactivePromptInterval,
    maxPerSession: cfg.proactiveMaxPerSession,
  });

  // LLM-enhanced capture (only if model endpoint configured)
  const llmCapture = (cfg.modelEndpoint && cfg.modelApiKey)
    ? new LLMEnhancedCapture({
        modelEndpoint: cfg.modelEndpoint,
        modelApiKey: cfg.modelApiKey,
        modelName: cfg.modelName ?? "doubao-seed-2.0-pro",
        xApiKey: cfg.modelXApiKey || undefined,
      })
    : null;

  if (llmCapture) {
    api.logger.info("team-memory-engine: LLM-enhanced proactive capture enabled");
  }

  if (!cfg.projectRoot) {
    api.logger.info("team-memory-engine: event logging disabled (projectRoot not configured)");
    return;
  }

  const eventLog = new EventLog(cfg.projectRoot);

  // Capture user messages before agent processes them
  api.on("before_agent_start", async (event: unknown, ctx: unknown) => {
    const evt = event as { prompt?: string };
    if (!evt.prompt || !evt.prompt.trim()) return;

    const prompt = evt.prompt.trim();
    if (prompt.length < 3) return;

    const skipPrefixes = ["<system", "<tool", "Team memory stored:", "Memory updated"];
    if (skipPrefixes.some((p) => prompt.startsWith(p))) return;

    // Proactive Memory Capture — real-time decision detection
    if (cfg.enableProactiveCapture && cfg.feishuChatId) {
      try {
        // Hybrid approach: regex first (fast), then LLM enhancement (async)
        let capture = analyzeForProactiveCapture(prompt, { isOwner: true, isGroup: false });
        if (!capture.detected) return;

        // LLM enhancement: if available, enrich with structured extraction
        if (llmCapture && rateLimiter.canPrompt()) {
          try {
            const llmResult = await llmCapture.analyze(prompt);
            if (llmResult) {
              capture = { ...capture, ...llmResult };
              api.logger.info(
                `team-memory-engine: LLM-enhanced capture [${capture.triggerType}] entity=${capture.entity ?? "?"} attribute=${capture.attribute ?? "?"} confidence=${(capture.confidence * 100).toFixed(0)}% — "${capture.memoryText.substring(0, 60)}"`
              );
            }
          } catch {
            // LLM enhancement failed, continue with regex result
          }
        }

        if (rateLimiter.canPrompt()) {
          rateLimiter.recordPrompt();
          api.logger.info(
            `team-memory-engine: proactive capture detected [${capture.triggerType}] confidence=${(capture.confidence * 100).toFixed(0)}% — "${capture.memoryText.substring(0, 60)}"`
          );
          const card = formatProactiveConfirmCard(capture);
          await sendFeishuMessage(
            process.env?.FEISHU_APP_ID ?? "",
            process.env?.FEISHU_APP_SECRET ?? "",
            cfg.feishuChatId,
            card,
            "interactive"
          );
        }
      } catch (err) {
        api.logger.warn(`team-memory-engine: proactive capture error: ${String(err)}`);
      }
    }

    const sessionKey = (ctx as Record<string, unknown>)?.sessionKey as string | undefined;
    const agentId = (ctx as Record<string, unknown>)?.agentId as string | undefined;

    try {
      await eventLog.append({
        chatId: sessionKey ?? "unknown-session",
        chatType: "p2p",
        senderId: "user",
        senderName: undefined,
        content: prompt,
        contentType: "text",
        messageId: `msg-${Date.now()}`,
        threadId: undefined,
        participants: agentId ? [agentId, "user"] : undefined,
      });
    } catch (err) {
      api.logger.warn(`team-memory-engine: event log append failed: ${String(err)}`);
    }
  });

  // Capture agent responses after they complete
  api.on("agent_end", async (event: unknown, ctx: unknown) => {
    const evt = event as { success?: boolean; messages?: unknown[] };
    if (!evt.success || !evt.messages || evt.messages.length === 0) return;

    const sessionKey = (ctx as Record<string, unknown>)?.sessionKey as string | undefined;

    try {
      const messages = evt.messages as Array<{ role?: string; content?: string | Array<{ type: string; text: string }> }>;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg?.role === "assistant") {
          const content = msg.content;
          let textContent = "";
          if (typeof content === "string") {
            textContent = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block && typeof block === "object" &&
                (block as Record<string, unknown>).type === "text" &&
                typeof (block as Record<string, unknown>).text === "string"
              ) {
                textContent += (textContent ? "\n" : "") + (block as Record<string, unknown>).text;
              }
            }
          }
          if (textContent.trim()) {
            await eventLog.append({
              chatId: sessionKey ?? "unknown-session",
              chatType: "p2p",
              senderId: "agent",
              senderName: "AI",
              content: textContent.trim(),
              contentType: "text",
              messageId: `msg-${Date.now()}-agent`,
            });
          }
          break;
        }
      }
    } catch (err) {
      api.logger.warn(`team-memory-engine: agent_end event log failed: ${String(err)}`);
    }
  });
}

export function registerServices(api: OpenClawPluginApi, manager: TeamMemoryManager, cfg: TeamMemoryConfig) {
  let decayTimer: ReturnType<typeof setInterval> | null = null;
  let riskTimer: ReturnType<typeof setInterval> | null = null;

  // Decay check + risk check services
  api.registerService({
    id: "team-memory-engine",
    async start() {
      api.logger.info(`team-memory-engine v2: starting services (decay: ${cfg.decayCheckInterval}ms, risk: ${cfg.riskCheckInterval}ms)`);

      decayTimer = setInterval(async () => {
        try {
          const reminder = await manager.checkAndFormatReminders();
          if (reminder) {
            api.logger.info(`team-memory-engine: reminders due:\n${reminder.content}`);
            if (cfg.feishuChatId) {
              for (const card of reminder.cards) {
                await sendFeishuMessage(
                  process.env?.FEISHU_APP_ID ?? "",
                  process.env?.FEISHU_APP_SECRET ?? "",
                  cfg.feishuChatId,
                  card,
                  "interactive"
                );
              }
            }
          }
        } catch (err) {
          api.logger.warn(`team-memory-engine: decay check failed: ${String(err)}`);
        }
      }, cfg.decayCheckInterval);

      if (cfg.riskCheckInterval > 0) {
        riskTimer = setInterval(async () => {
          try {
            const scores = await manager.assessRisk();
            const triggered = scores.filter((s) => s.triggered);
            if (triggered.length > 0) {
              const summary = triggered.map((s) => `  ${s.memoryId}: ${(s.totalRisk * 100).toFixed(0)}%`).join("\n");
              api.logger.info(`team-memory-engine: risk alerts:\n${summary}`);
            }
          } catch (err) {
            api.logger.warn(`team-memory-engine: risk check failed: ${String(err)}`);
          }
        }, cfg.riskCheckInterval);
      }
    },
    stop() {
      if (decayTimer) { clearInterval(decayTimer); decayTimer = null; }
      if (riskTimer) { clearInterval(riskTimer); riskTimer = null; }
      api.logger.info("team-memory-engine: stopped");
    },
  });

  // Pipeline service (event-log → extract → ledger → graph → TMS)
  if (!cfg.projectRoot) return;

  let pipelineTimer: ReturnType<typeof setInterval> | null = null;
  let dependencyTimer: ReturnType<typeof setInterval> | null = null;

  api.registerService({
    id: "team-memory-pipeline",
    async start() {
      api.logger.info(`team-memory-pipeline: starting (5min interval, batchSize: ${cfg.extractionBatchSize})`);

      pipelineTimer = setInterval(async () => {
        try {
          const eventLog = new EventLog(cfg.projectRoot);
          const unprocessed = await eventLog.getUnprocessed();
          if (unprocessed.length === 0) return;

          const batch = unprocessed.slice(0, cfg.extractionBatchSize);
          const extracted = await manager.injectFromEvent(batch);
          if (extracted.length === 0) return;

          await eventLog.markProcessed(batch.map((e) => e.id));
          api.logger.info(`team-memory-pipeline: extracted ${extracted.length} memories from ${batch.length} events`);
        } catch (err) {
          api.logger.warn(`team-memory-pipeline: failed: ${String(err)}`);
        }
      }, 5 * 60 * 1000);
    },
    stop() {
      if (pipelineTimer) { clearInterval(pipelineTimer); pipelineTimer = null; }
      api.logger.info("team-memory-pipeline: stopped");
    },
  });

  // Dependency inference service — periodically scans ledger for cross-memory dependencies
  if (cfg.modelEndpoint && cfg.modelApiKey) {
    api.registerService({
      id: "team-memory-dependency-inference",
      async start() {
        api.logger.info("team-memory-dependency-inference: starting (30min interval)");

        dependencyTimer = setInterval(async () => {
          try {
            const result = await manager.inferDependencies();
            if (result.dependencies.length > 0) {
              api.logger.info(`team-memory-dependency-inference: inferred ${result.dependencies.length} dependencies across ${result.updatedEntries.length} entries`);
              // Rebuild graph to include new dependency edges
              if (cfg.enableGraph) {
                await manager.rebuildGraph();
                api.logger.info("team-memory-dependency-inference: graph rebuilt with new dependencies");
              }
            }
          } catch (err) {
            api.logger.warn(`team-memory-dependency-inference: failed: ${String(err)}`);
          }
        }, 30 * 60 * 1000);
      },
      stop() {
        if (dependencyTimer) { clearInterval(dependencyTimer); dependencyTimer = null; }
        api.logger.info("team-memory-dependency-inference: stopped");
      },
    });
  }
}
