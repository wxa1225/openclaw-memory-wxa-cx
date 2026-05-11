// Tests for Proactive Memory Confirmation Card

import { formatProactiveConfirmCard, formatConfirmResultCard, formatProactiveConfirmText } from "../lib/proactive-card.js";
import type { ProactiveCaptureResult } from "../lib/proactive-capture.js";

// ============================================================================
// Proactive Confirm Card
// ============================================================================

describe("formatProactiveConfirmCard", () => {
  const mockCapture: ProactiveCaptureResult = {
    detected: true,
    triggerType: "decision_made",
    confidence: 0.9,
    memoryText: "以后周报都发给张三",
    category: "decision",
    confirmationPrompt: "我注意到你们似乎达成了某个决定，要记录下来吗？",
  };

  it("generates valid JSON card", () => {
    const card = formatProactiveConfirmCard(mockCapture);
    const parsed = JSON.parse(card);
    expect(parsed.config).toBeDefined();
    expect(parsed.header).toBeDefined();
    expect(parsed.elements).toBeDefined();
    expect(Array.isArray(parsed.elements)).toBe(true);
  });

  it("has correct header title", () => {
    const card = JSON.parse(formatProactiveConfirmCard(mockCapture));
    expect(card.header.title.content).toBe("🧠 检测到可记录信息");
  });

  it("uses blue template for decision category", () => {
    const card = JSON.parse(formatProactiveConfirmCard(mockCapture));
    expect(card.header.template).toBe("blue");
  });

  it("uses green template for process category", () => {
    const capture: ProactiveCaptureResult = {
      ...mockCapture,
      category: "process",
      triggerType: "future_commitment",
    };
    const card = JSON.parse(formatProactiveConfirmCard(capture));
    expect(card.header.template).toBe("green");
  });

  it("uses red template for security category", () => {
    const capture: ProactiveCaptureResult = {
      ...mockCapture,
      category: "security",
      triggerType: "security_noted",
    };
    const card = JSON.parse(formatProactiveConfirmCard(capture));
    expect(card.header.template).toBe("red");
  });

  it("includes the confirmation prompt", () => {
    const card = JSON.parse(formatProactiveConfirmCard(mockCapture));
    const textContent = JSON.stringify(card);
    expect(textContent).toContain("要记录下来吗");
  });

  it("includes structured entity/attribute/value when available", () => {
    const capture: ProactiveCaptureResult = {
      ...mockCapture,
      entity: "开发团队",
      attribute: "周报接收人",
      value: "张三",
    };
    const card = JSON.parse(formatProactiveConfirmCard(capture));
    const textContent = JSON.stringify(card);
    expect(textContent).toContain("开发团队");
    expect(textContent).toContain("周报接收人");
    expect(textContent).toContain("张三");
  });

  it("has three action buttons", () => {
    const card = JSON.parse(formatProactiveConfirmCard(mockCapture));
    const actionElement = card.elements.find((e: { tag: string }) => e.tag === "action");
    expect(actionElement.actions).toHaveLength(3);
  });

  it("button actions have correct types", () => {
    const card = JSON.parse(formatProactiveConfirmCard(mockCapture));
    const actionElement = card.elements.find((e: { tag: string }) => e.tag === "action");
    const actions = actionElement.actions;
    expect(actions[0].value.action).toBe("confirm_save");
    expect(actions[1].value.action).toBe("dismiss_save");
    expect(actions[2].value.action).toBe("edit_save");
  });

  it("button values include memory text and category", () => {
    const card = JSON.parse(formatProactiveConfirmCard(mockCapture));
    const actionElement = card.elements.find((e: { tag: string }) => e.tag === "action");
    const firstAction = actionElement.actions[0];
    expect(firstAction.value.memory_text).toBe("以后周报都发给张三");
    expect(firstAction.value.category).toBe("decision");
  });
});

// ============================================================================
// Confirmation Result Card
// ============================================================================

describe("formatConfirmResultCard", () => {
  it("generates green card for confirmed action", () => {
    const card = JSON.parse(formatConfirmResultCard("confirmed", "mem-123", "周报发给张三"));
    expect(card.header.template).toBe("green");
    expect(card.header.title.content).toBe("🧠 记忆已记录");
  });

  it("generates grey card for dismissed action", () => {
    const card = JSON.parse(formatConfirmResultCard("dismissed"));
    expect(card.header.template).toBe("grey");
    expect(card.header.title.content).toBe("🧠 已忽略");
  });

  it("generates blue card for updated action", () => {
    const card = JSON.parse(formatConfirmResultCard("updated", "mem-456", "新内容"));
    expect(card.header.template).toBe("blue");
    expect(card.header.title.content).toBe("🧠 记忆已更新");
  });

  it("includes memory text in confirmed card", () => {
    const card = JSON.parse(formatConfirmResultCard("confirmed", "mem-123", "具体内容"));
    const textContent = JSON.stringify(card);
    expect(textContent).toContain("具体内容");
  });
});

// ============================================================================
// Text Confirmation (CLI)
// ============================================================================

describe("formatProactiveConfirmText", () => {
  const mockCapture: ProactiveCaptureResult = {
    detected: true,
    triggerType: "decision_made",
    confidence: 0.85,
    memoryText: "采用微服务架构",
    category: "decision",
    confirmationPrompt: "要记录这个决定吗？",
  };

  it("includes trigger type", () => {
    const text = formatProactiveConfirmText(mockCapture);
    expect(text).toContain("decision_made");
  });

  it("includes confidence", () => {
    const text = formatProactiveConfirmText(mockCapture);
    expect(text).toContain("85%");
  });

  it("includes memory content", () => {
    const text = formatProactiveConfirmText(mockCapture);
    expect(text).toContain("采用微服务架构");
  });

  it("includes confirmation prompt", () => {
    const text = formatProactiveConfirmText(mockCapture);
    expect(text).toContain("要记录这个决定吗");
  });

  it("includes action options", () => {
    const text = formatProactiveConfirmText(mockCapture);
    expect(text).toContain("记录");
    expect(text).toContain("忽略");
    expect(text).toContain("修改");
  });
});
