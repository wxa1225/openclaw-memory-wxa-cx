// Proactive Memory Confirmation Card — Feishu interactive card for real-time memory capture
//
// When the proactive capture system detects a decision/commitment in conversation,
// it sends this card asking the user to confirm whether to record it.

import type { ProactiveCaptureResult } from "./proactive-capture.js";

// ============================================================================
// Confirmation Card
// ============================================================================

/** Format a proactive memory confirmation card as Feishu interactive card JSON */
export function formatProactiveConfirmCard(
  capture: ProactiveCaptureResult,
  memoryId?: string
): string {
  // Template colors by category
  const colorMap: Record<string, "blue" | "green" | "orange" | "red" | "purple"> = {
    decision: "blue",
    process: "green",
    api: "purple",
    security: "red",
    experience: "green",
    general: "blue",
  };

  const categoryLabels: Record<string, string> = {
    decision: "📋 决策",
    process: "⚙️ 流程",
    api: "🔌 API/配置",
    security: "🔒 安全",
    experience: "💡 经验",
    general: "📝 通用",
  };

  const template = colorMap[capture.category] ?? "blue";
  const categoryLabel = categoryLabels[capture.category] ?? "📝 通用";

  // Structured display if entity/attribute/value extracted
  let contentMd = "";
  if (capture.entity && capture.attribute && capture.value) {
    contentMd = [
      `**类别：** ${categoryLabel}`,
      `**实体：** ${capture.entity}`,
      `**属性：** ${capture.attribute}`,
      `**值：** ${capture.value}`,
      "",
      "确认要记录到团队记忆中吗？",
    ].join("\n");
  } else {
    contentMd = [
      `**类别：** ${categoryLabel}`,
      `**内容：** ${capture.memoryText}`,
      "",
      "确认要记录到团队记忆中吗？",
    ].join("\n");
  }

  // Action buttons value
  const actionValue = JSON.stringify({
    memory_text: capture.memoryText,
    category: capture.category,
    entity: capture.entity ?? "",
    attribute: capture.attribute ?? "",
    value: capture.value ?? "",
    action: "pending", // Will be set by button click
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: "🧠 检测到可记录信息" },
      template,
    },
    elements: [
      { tag: "div" as const, text: { tag: "plain_text" as const, content: capture.confirmationPrompt } },
      { tag: "hr" as const },
      { tag: "markdown" as const, content: contentMd },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "✓ 记录" },
            type: "primary" as const,
            value: { ...JSON.parse(actionValue), action: "confirm_save" },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "✗ 忽略" },
            type: "default" as const,
            value: { ...JSON.parse(actionValue), action: "dismiss_save" },
          },
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "✏️ 修改后记录" },
            type: "default" as const,
            value: { ...JSON.parse(actionValue), action: "edit_save" },
          },
        ],
      },
    ],
  };

  return JSON.stringify(card, null, 2);
}

// ============================================================================
// Confirmation Result Card (after user clicks)
// ============================================================================

/** Format a card showing the result of a confirmation action */
export function formatConfirmResultCard(
  action: "confirmed" | "dismissed" | "updated",
  memoryId?: string,
  memoryText?: string
): string {
  const templates: Record<string, { title: string; template: "green" | "grey" | "blue"; content: string }> = {
    confirmed: {
      title: "🧠 记忆已记录",
      template: "green",
      content: `✅ 已保存到团队记忆中\n\n**内容：** ${memoryText ?? "未知"}\n\n团队将记住这条信息，遗忘曲线已生效。`,
    },
    dismissed: {
      title: "🧠 已忽略",
      template: "grey",
      content: "已忽略此信息，不会保存到记忆中。",
    },
    updated: {
      title: "🧠 记忆已更新",
      template: "blue",
      content: `✅ 已更新团队记忆\n\n**内容：** ${memoryText ?? "未知"}\n\n旧版本已保留在历史中，可随时查看。`,
    },
  };

  const t = templates[action];
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text" as const, content: t.title },
      template: t.template,
    },
    elements: [
      { tag: "markdown" as const, content: t.content },
    ],
  };

  return JSON.stringify(card, null, 2);
}

// ============================================================================
// Simple Text Confirmation (for CLI / non-Feishu contexts)
// ============================================================================

/** Format a simple text confirmation for CLI or log output */
export function formatProactiveConfirmText(capture: ProactiveCaptureResult): string {
  const lines = [
    `🧠 检测到可记录信息 [${capture.triggerType ?? "unknown"}]`,
    `   类别: ${capture.category}`,
    `   置信度: ${(capture.confidence * 100).toFixed(0)}%`,
    `   内容: ${capture.memoryText}`,
    "",
    capture.confirmationPrompt,
    "   [✓ 记录] [✗ 忽略] [✏️ 修改]",
  ];
  return lines.join("\n");
}
