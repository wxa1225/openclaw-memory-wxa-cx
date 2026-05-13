// Card Action Handler — process memory review card button clicks from Feishu

import { MemoryLedger } from "./ledger.js";
import type { LedgerEntry, ConflictResult } from "./storage/types.js";

export interface MemoryCardActionValue {
  action: "confirm" | "update" | "dismiss" | "review" | "dismiss_warning" | "confirm_save" | "dismiss_save" | "edit_save";
  memory_id: string;
  memory_text?: string;
  category?: string;
  entity?: string;
  attribute?: string;
  value?: string;
}

interface CardActionData {
  action?: {
    value?: MemoryCardActionValue;
  };
  operator?: {
    open_id: string;
    user_id?: string;
  };
  open_chat_id?: string;
  open_message_id?: string;
  context?: {
    open_chat_id?: string;
    open_message_id?: string;
  };
}

interface HandlerConfig {
  teamId: string;
  ledgerPath?: string;
  openMessageId?: string;
  accountId?: string;
  cfg?: unknown;
  // Model config for LLM-based EAV extraction in proactive capture
  modelEndpoint?: string;
  modelApiKey?: string;
  modelName?: string;
  modelXApiKey?: string;
  // Project root for event log feedback
  projectRoot?: string;
}

interface CardActionResult {
  toast: { type: "success" | "warning" | "error"; content: string };
  card?: {
    type: "raw";
    data: unknown;
  };
}

const ACTION_LABELS: Record<string, string> = {
  confirm: "已保留两个版本",
  update: "已用新版本替换",
  dismiss: "已保留旧版本",
  review: "已复习",
  dismiss_warning: "已忽略",
  confirm_save: "已保存",
  dismiss_save: "已忽略",
  edit_save: "已保存",
};

const ACTION_ICONS: Record<string, string> = {
  confirm: "✓ 两个都保留",
  update: "✓ 用新版本替换",
  dismiss: "✓ 保留旧版本",
  review: "✓ 已复习",
  dismiss_warning: "✓ 已忽略",
};

/** Build an updated card showing which action was selected, keeping all buttons clickable */
function buildUpdatedCard(
  entry: LedgerEntry,
  selectedAction: string
): { type: "raw"; data: unknown } {
  const claimsCount = entry.claims.length;

  // Build version list with status indicators
  const versionLines = entry.claims.map((c) => {
    const statusTag = c.status === "active" ? "✅ 活跃" : c.status === "superseded" ? "❌ 已废弃" : `⚠️ ${c.status}`;
    return `**v${c.version}** [${statusTag}] ${c.value} — 置信度 ${(c.confidence * 100).toFixed(0)}%`;
  });
  const claimsMd = versionLines.join("\n\n");

  const buttonLabels: Record<string, string> = {
    confirm: selectedAction === "confirm" ? "✓ 两个都保留" : "两个都保留",
    update: selectedAction === "update" ? "✓ 用新版本替换" : "用新版本替换",
    dismiss: selectedAction === "dismiss" ? "✓ 保留旧版本" : "保留旧版本",
  };

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🧠 记忆冲突 — 已处理" },
      template: selectedAction === "dismiss" ? "orange" as const : "green" as const,
    },
    elements: [
      { tag: "div" as const, text: { tag: "plain_text" as const, content: `当前操作：${ACTION_LABELS[selectedAction]}（共 ${claimsCount} 个版本）` } },
      {
        tag: "markdown" as const,
        content: `**记忆内容：**\n\n${claimsMd}\n\n💡 如选错，可点击其他按钮切换`,
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: buttonLabels.confirm },
            type: selectedAction === "confirm" ? ("primary" as const) : ("default" as const),
            value: { action: "confirm", memory_id: entry.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: buttonLabels.update },
            type: selectedAction === "update" ? ("danger" as const) : ("default" as const),
            value: { action: "update", memory_id: entry.id },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: buttonLabels.dismiss },
            type: "default" as const,
            value: { action: "dismiss", memory_id: entry.id },
          },
        ],
      },
    ],
  };

  return { type: "raw", data: card };
}

/**
 * Called from openclaw-lark's handleCardActionEvent when a memory review
 * card button is clicked. Returns undefined if not a memory action.
 */
export async function handleMemoryReviewAction(
  data: CardActionData,
  config: HandlerConfig
): Promise<CardActionResult | undefined> {
  const value = data.action?.value;
  if (!value || !value.action) return undefined;
  if (!["confirm", "update", "dismiss", "review", "dismiss_warning", "confirm_save", "dismiss_save", "edit_save"].includes(value.action)) return undefined;

  // Proactive save actions don't need memory_id (memory doesn't exist yet)
  if (value.action !== "confirm_save" && value.action !== "dismiss_save" && value.action !== "edit_save") {
    if (!value.memory_id) return undefined;
  }

  // Extract open_message_id from data for card update
  const openMessageId = data.open_message_id ?? data.context?.open_message_id ?? config.openMessageId;
  const enrichedConfig = { ...config, openMessageId };

  const ledger = new MemoryLedger(enrichedConfig.teamId, enrichedConfig.ledgerPath);
  const entry = await ledger.getEntry(value.memory_id);
  if (!entry) {
    return { toast: { type: "error", content: "记忆不存在或已被删除" } };
  }

  const resolverId = data.operator?.open_id ?? "unknown";

  // "review" — boost confidence and recency (Ebbinghaus reset)
  if (value.action === "review") {
    const conflict: ConflictResult = {
      type: "human-confirm",
      existingEntry: entry,
      newClaim: entry.claims[entry.claims.length - 1],
      confidenceDelta: 0.15,
      reason: "User reviewed memory via Feishu card",
    };
    await ledger.resolveConflict(conflict, {
      action: "confirm",
      entryId: value.memory_id,
      resolvedBy: resolverId,
    });

    const updated = await ledger.getEntry(value.memory_id);
    const val = updated?.claims[updated.claims.length - 1]?.value ?? '';
    const cat = updated?.category ?? '';
    return {
      toast: { type: "success", content: "✅ 已复习 — 记忆强度重置为 100%" },
      card: {
        type: "raw",
        data: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: "🧠 记忆已复习" },
            template: "green" as const,
          },
          elements: [
            { tag: "div" as const, text: { tag: "plain_text" as const, content: "✅ 已复习 — 记忆强度已重置" } },
            {
              tag: "markdown" as const,
              content: `**内容：** ${val}\n**类别：** ${cat}\n\n强度已重置为 100%，下次提醒时间已推迟`,
            },
          ],
        },
      },
    };
  }

  // "dismiss_warning" — acknowledge without boosting
  if (value.action === "dismiss_warning") {
    return {
      toast: { type: "warning", content: "已忽略，下次巡检再提醒" },
      card: {
        type: "raw",
        data: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: "🧠 已忽略" },
            template: "grey" as const,
          },
          elements: [
            { tag: "div" as const, text: { tag: "plain_text" as const, content: "已忽略，下次巡检再提醒" } },
          ],
        },
      },
    };
  }

  // ========================================================================
  // Proactive Memory Capture actions (real-time detection confirmation)
  // ========================================================================

  // "confirm_save" — save the detected memory to ledger
  if (value.action === "confirm_save") {
    const memoryText = value.memory_text ?? "Unknown memory";
    const category = value.category ?? "general";

    try {
      // Try LLM extraction first if model endpoint is configured, fallback to heuristic
      let eav: { entity: string; attribute: string; value: string };

      if (config.modelEndpoint && config.modelApiKey) {
        try {
          eav = await llmExtractSingleEAV(memoryText, category, config.modelEndpoint, config.modelApiKey, config.modelName, config.modelXApiKey);
        } catch (llmErr) {
          // Fallback to heuristic extraction
          const { extractEntityAttribute } = await import("./extract-utils.js");
          eav = extractEntityAttribute(memoryText, category);
        }
      } else {
        const { extractEntityAttribute } = await import("./extract-utils.js");
        eav = extractEntityAttribute(memoryText, category);
      }

      const { MemoryLedger } = await import("./ledger.js");
      const ledger = new MemoryLedger(enrichedConfig.teamId, enrichedConfig.ledgerPath);
      const entry = await ledger.injectClaim({
        entity: eav.entity,
        attribute: eav.attribute,
        value: eav.value,
        confidence: 0.75,
        source: "proactive_capture",
        injectedBy: resolverId,
        category,
        tags: ["proactive"],
        teamId: enrichedConfig.teamId,
        recallHalfLife: 14,
      });

      // Log card action result to event log for feedback loop
      if (config.projectRoot) {
        try {
          const { EventLog } = await import("./event-log.js");
          const eventLog = new EventLog(config.projectRoot);
          await eventLog.appendCardAction({
            chatId: data.open_chat_id ?? data.context?.open_chat_id ?? "unknown",
            chatType: (data.open_chat_id?.startsWith("oc_") ?? false) ? "group" : "p2p",
            senderId: resolverId,
            action: "confirm_save",
            memoryId: entry.id,
            memoryText: eav.value,
            category,
          });
        } catch {
          // Event log not critical — ignore errors
        }
      }

      return {
        toast: { type: "success", content: "✅ 已保存到团队记忆" },
        card: {
          type: "raw",
          data: {
            config: { wide_screen_mode: true },
            header: {
              title: { tag: "plain_text", content: "🧠 记忆已记录" },
              template: "green" as const,
            },
            elements: [
              { tag: "div" as const, text: { tag: "plain_text" as const, content: "✅ 已保存到团队记忆中" } },
              {
                tag: "markdown" as const,
                content: [
                  `**类别：** ${category}`,
                  `**内容：** ${eav.value}`,
                  `**ID：** ${entry.id} v${entry.current_version}`,
                  "",
                  "团队将记住这条信息，遗忘曲线已生效。",
                ].join("\n"),
              },
            ],
          },
        },
      };
    } catch (err) {
      return {
        toast: { type: "error", content: `保存失败: ${String(err)}` },
      };
    }
  }

  // "dismiss_save" — ignore the detected memory
  if (value.action === "dismiss_save") {
    return {
      toast: { type: "warning", content: "已忽略，不会保存此信息" },
      card: {
        type: "raw",
        data: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: "🧠 已忽略" },
            template: "grey" as const,
          },
          elements: [
            { tag: "div" as const, text: { tag: "plain_text" as const, content: "已忽略此信息，不会保存到记忆中" } },
          ],
        },
      },
    };
  }

  // "edit_save" — user wants to modify before saving
  // For now, treat as confirm_save but flag for follow-up.
  // In future, this could open a Feishu input form for editing.
  if (value.action === "edit_save") {
    // Same as confirm_save for now — the text was already extracted
    return handleMemoryReviewAction({
      ...data,
      action: { value: { ...value, action: "confirm_save" as const } },
    }, config);
  }

  const conflictingClaims = entry.claims.filter((c) => c.status === "conflicting");

  if (conflictingClaims.length === 0) {
    // No conflict — use resolveConflict with "confirm" to persist changes
    const conflict: ConflictResult = {
      type: "human-confirm",
      existingEntry: entry,
      newClaim: entry.claims[entry.claims.length - 1],
      confidenceDelta: 0,
      reason: "Card confirm action",
    };
    await ledger.resolveConflict(conflict, {
      action: "confirm",
      entryId: value.memory_id,
      resolvedBy: resolverId,
    });
    return {
      toast: { type: "success", content: ACTION_LABELS[value.action] },
      card: buildUpdatedCard(entry, value.action),
    };
  }

  // Build a ConflictResult for resolution
  const conflict: ConflictResult = {
    type: "human-confirm",
    existingEntry: entry,
    newClaim: entry.claims[entry.claims.length - 1],
    confidenceDelta: 0,
    reason: "Card action resolution",
  };

  const resolved = await ledger.resolveConflict(conflict, {
    action: value.action,
    entryId: value.memory_id,
    resolvedBy: resolverId,
  });

  // Get updated entry to show in card
  const updated = await ledger.getEntry(value.memory_id);

  return {
    toast: {
      type: "success",
      content: `${ACTION_LABELS[value.action]} — 记忆已更新`,
    },
    card: updated ? buildUpdatedCard(updated, value.action) : undefined,
  };
}

/**
 * LLM-based single-message EAV extraction for proactive capture.
 * Calls the configured model to extract entity/attribute/value from one message.
 * Falls back to heuristic extraction on any error.
 */
async function llmExtractSingleEAV(
  text: string,
  category: string,
  endpoint: string,
  apiKey: string,
  modelName?: string,
  xApiKey?: string
): Promise<{ entity: string; attribute: string; value: string }> {
  const prompt = `从以下对话中提取结构化的实体/属性/值信息。

对话内容："${text}"

返回 JSON 格式：{"entity": "具体的名称", "attribute": "属性名", "value": "值"}

要求：
- entity 必须是具体的名称（人名、项目名、系统名、客户名等），不要使用 "general"
- attribute 是 entity 的某个具体方面
- value 是提取的具体值
- 参考类别提示：${category}

只返回 JSON，不要其他文字。`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (xApiKey) {
    headers["x-api-key"] = xApiKey;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelName ?? "qwen-plus",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" as const },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM extraction error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  if (!content.trim()) {
    throw new Error("Empty LLM response");
  }

  let jsonStr = content.trim();
  const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFenceMatch) {
    jsonStr = codeFenceMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  if (!parsed.entity || !parsed.attribute || !parsed.value) {
    throw new Error("LLM response missing required fields");
  }

  return {
    entity: String(parsed.entity).trim(),
    attribute: String(parsed.attribute).trim(),
    value: String(parsed.value).trim(),
  };
}
