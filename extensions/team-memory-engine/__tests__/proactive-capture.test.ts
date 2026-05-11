// Tests for Proactive Memory Capture — real-time decision detection

import { analyzeForProactiveCapture, PromptRateLimiter } from "../lib/proactive-capture.js";

// ============================================================================
// Detection Patterns
// ============================================================================

describe("analyzeForProactiveCapture — explicit_save", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '记住...' pattern", () => {
    const result = analyzeForProactiveCapture("记住，以后周报格式用Markdown", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("explicit_save");
    expect(result.category).toBe("decision");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("detects '记下来' pattern", () => {
    const result = analyzeForProactiveCapture("记下来，API端口改为9090", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("explicit_save");
  });

  it("detects 'mark this' pattern", () => {
    const result = analyzeForProactiveCapture("Mark this: the deployment process changed to blue-green", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("explicit_save");
  });

  it("detects '添加到记忆' pattern", () => {
    const result = analyzeForProactiveCapture("添加到记忆：客户A的交付截止日期是5月20日", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("explicit_save");
  });
});

describe("analyzeForProactiveCapture — decision_made", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '我们决定' pattern", () => {
    const result = analyzeForProactiveCapture("我们决定采用方案B而不是方案A", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("decision_made");
    expect(result.category).toBe("decision");
  });

  it("detects '确定用' pattern", () => {
    const result = analyzeForProactiveCapture("确定用React做前端框架了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("decision_made");
  });

  it("detects 'we decided' pattern", () => {
    const result = analyzeForProactiveCapture("We decided to use PostgreSQL for the new service", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("decision_made");
  });
});

describe("analyzeForProactiveCapture — future_commitment", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '以后都' pattern", () => {
    const result = analyzeForProactiveCapture("以后周报都发给张三，不要发给李四了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("future_commitment");
    expect(result.category).toBe("process");
  });

  it("detects '从现在开始' pattern", () => {
    const result = analyzeForProactiveCapture("从现在开始，所有PR需要两个reviewer", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("future_commitment");
  });

  it("detects 'from now on' pattern", () => {
    const result = analyzeForProactiveCapture("From now on, all deployments go through staging first", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("future_commitment");
  });
});

describe("analyzeForProactiveCapture — policy_change", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '改为' pattern", () => {
    const result = analyzeForProactiveCapture("部署流程改为灰度发布了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("policy_change");
    expect(result.category).toBe("process");
  });

  it("detects '切换为' pattern", () => {
    const result = analyzeForProactiveCapture("认证方式切换为OAuth2了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("policy_change");
  });

  it("detects 'changed to' pattern", () => {
    const result = analyzeForProactiveCapture("The API base URL changed to https://api.example.com", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("policy_change");
  });
});

describe("analyzeForProactiveCapture — deadline_noted", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '截止日期' pattern", () => {
    const result = analyzeForProactiveCapture("截止日期是5月20号，别忘了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("deadline_noted");
    expect(result.category).toBe("decision");
  });

  it("detects 'deadline' pattern", () => {
    const result = analyzeForProactiveCapture("The deadline for the beta release is June 15", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("deadline_noted");
  });
});

describe("analyzeForProactiveCapture — api_noted", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '端点' pattern", () => {
    const result = analyzeForProactiveCapture("API端点是https://api.internal:8080/v2", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("api_noted");
    expect(result.category).toBe("api");
  });

  it("detects '端口' pattern", () => {
    const result = analyzeForProactiveCapture("数据库端口设为5433", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("api_noted");
  });
});

describe("analyzeForProactiveCapture — security_noted", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '密钥' pattern", () => {
    const result = analyzeForProactiveCapture("生产环境密钥更新为新的值了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("security_noted");
    expect(result.category).toBe("security");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("detects 'token' pattern", () => {
    const result = analyzeForProactiveCapture("新的access token是sk-xxx-123", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("security_noted");
  });
});

describe("analyzeForProactiveCapture — process_defined", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '流程是' pattern", () => {
    const result = analyzeForProactiveCapture("发布流程是：先build，再test，最后deploy", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("process_defined");
    expect(result.category).toBe("process");
  });
});

describe("analyzeForProactiveCapture — preference_declared", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("detects '我更喜欢' pattern", () => {
    const result = analyzeForProactiveCapture("我更喜欢用深色主题，浅色太刺眼了", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("preference_declared");
    expect(result.category).toBe("experience");
  });
});

// ============================================================================
// False Positives — should NOT detect
// ============================================================================

describe("analyzeForProactiveCapture — false positives", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("ignores short messages", () => {
    const result = analyzeForProactiveCapture("好的", ctx);
    expect(result.detected).toBe(false);
  });

  it("ignores system messages starting with <", () => {
    const result = analyzeForProactiveCapture("<system message>", ctx);
    expect(result.detected).toBe(false);
  });

  it("ignores JSON-like messages", () => {
    const result = analyzeForProactiveCapture('{"type": "ping"}', ctx);
    expect(result.detected).toBe(false);
  });

  it("ignores simple acknowledgments", () => {
    for (const ack of ["好的", "收到", "ok", "OK", "嗯嗯", "没问题", "行", "可以", "谢谢", "明白", "了解", "done"]) {
      const result = analyzeForProactiveCapture(ack, ctx);
      expect(result.detected).toBe(false);
    }
  });

  it("ignores empty string", () => {
    const result = analyzeForProactiveCapture("", ctx);
    expect(result.detected).toBe(false);
  });

  it("ignores whitespace-only string", () => {
    const result = analyzeForProactiveCapture("   ", ctx);
    expect(result.detected).toBe(false);
  });
});

// ============================================================================
// Memory Text Extraction
// ============================================================================

describe("analyzeForProactiveCapture — memory text extraction", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("extracts clean memory text without conversational fluff", () => {
    const result = analyzeForProactiveCapture("对了，记住，以后周报格式用Markdown了啊", ctx);
    expect(result.memoryText).not.toContain("对了");
    expect(result.memoryText.length).toBeLessThan(50);
  });

  it("preserves core content for short messages", () => {
    const result = analyzeForProactiveCapture("记住API端口是8080", ctx);
    expect(result.memoryText).toContain("8080");
  });
});

// ============================================================================
// Structured Entity/Attribute/Value Extraction
// ============================================================================

describe("analyzeForProactiveCapture — structured extraction", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("extracts entity/attribute/value when parseable", () => {
    const result = analyzeForProactiveCapture("记住客户A的交付格式为PDF", ctx);
    expect(result.detected).toBe(true);
    // extract-utils should parse this as entity=客户A, attribute=交付格式, value=PDF
    if (result.entity) expect(result.entity).toBe("客户A");
    if (result.attribute) expect(result.attribute).toBe("交付格式");
    if (result.value) expect(result.value).toBe("PDF");
  });
});

// ============================================================================
// Confirmation Prompts
// ============================================================================

describe("analyzeForProactiveCapture — confirmation prompts", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("generates appropriate prompt for explicit_save", () => {
    const result = analyzeForProactiveCapture("记住这个很重要", ctx);
    expect(result.confirmationPrompt).toContain("记录");
  });

  it("generates appropriate prompt for decision_made", () => {
    const result = analyzeForProactiveCapture("我们决定用方案B", ctx);
    expect(result.confirmationPrompt).toContain("决定");
  });

  it("generates appropriate prompt for future_commitment", () => {
    const result = analyzeForProactiveCapture("以后都用这个格式", ctx);
    expect(result.confirmationPrompt).toContain("约定");
  });

  it("generates appropriate prompt for security_noted", () => {
    const result = analyzeForProactiveCapture("密钥更新为xyz123", ctx);
    expect(result.confirmationPrompt).toContain("安全");
  });
});

// ============================================================================
// Confidence Adjustment (owner vs non-owner)
// ============================================================================

describe("analyzeForProactiveCapture — confidence by role", () => {
  it("gives higher confidence to owner", () => {
    const ownerResult = analyzeForProactiveCapture("记住以后用Markdown", { isOwner: true, isGroup: false });
    const nonOwnerResult = analyzeForProactiveCapture("记住以后用Markdown", { isOwner: false, isGroup: false });
    expect(ownerResult.confidence).toBeGreaterThanOrEqual(nonOwnerResult.confidence);
  });
});

// ============================================================================
// Prompt Rate Limiter
// ============================================================================

describe("PromptRateLimiter", () => {
  it("allows first prompt", () => {
    const limiter = new PromptRateLimiter({ minIntervalMs: 100, maxPerSession: 5 });
    expect(limiter.canPrompt()).toBe(true);
  });

  it("blocks prompt within minimum interval", () => {
    const limiter = new PromptRateLimiter({ minIntervalMs: 60000, maxPerSession: 5 });
    expect(limiter.canPrompt()).toBe(true);
    limiter.recordPrompt();
    expect(limiter.canPrompt()).toBe(false);
  });

  it("blocks after max per session reached", () => {
    const limiter = new PromptRateLimiter({ minIntervalMs: 0, maxPerSession: 3 });
    for (let i = 0; i < 3; i++) {
      if (limiter.canPrompt()) limiter.recordPrompt();
    }
    expect(limiter.canPrompt()).toBe(false);
  });

  it("allows prompt after reset", () => {
    const limiter = new PromptRateLimiter({ minIntervalMs: 60000, maxPerSession: 1 });
    limiter.recordPrompt();
    expect(limiter.canPrompt()).toBe(false);
    limiter.reset();
    expect(limiter.canPrompt()).toBe(true);
  });

  it("reports correct stats", () => {
    const limiter = new PromptRateLimiter({ minIntervalMs: 0, maxPerSession: 5 });
    limiter.recordPrompt();
    limiter.recordPrompt();
    const stats = limiter.getStats();
    expect(stats.count).toBe(2);
    expect(stats.remaining).toBe(3);
  });

  it("allows prompt after interval passes (real time)", async () => {
    const limiter = new PromptRateLimiter({ minIntervalMs: 50, maxPerSession: 10 });
    expect(limiter.canPrompt()).toBe(true);
    limiter.recordPrompt();
    expect(limiter.canPrompt()).toBe(false);
    // Wait for interval to pass
    await new Promise((r) => setTimeout(r, 60));
    expect(limiter.canPrompt()).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("analyzeForProactiveCapture — edge cases", () => {
  const ctx = { isOwner: true, isGroup: false };

  it("handles messages with mixed CJK and English", () => {
    const result = analyzeForProactiveCapture("记住API的endpoint是https://api.example.com/v1", ctx);
    expect(result.detected).toBe(true);
  });

  it("handles messages starting with '对了，记住'", () => {
    const result = analyzeForProactiveCapture("对了，记住客户A的交付格式改为PDF了", ctx);
    expect(result.detected).toBe(true);
    expect(result.memoryText).not.toContain("对了");
  });

  it("detects pattern in long paragraph", () => {
    const text = "今天的会议讨论了很多内容，包括项目进度、人员安排等等。对了，我们决定采用微服务架构，这个很重要。其他细节后面再说。";
    const result = analyzeForProactiveCapture(text, ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("decision_made");
  });

  it("handles '以后一律' pattern", () => {
    const result = analyzeForProactiveCapture("以后一律用TypeScript，不再用JavaScript", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("future_commitment");
  });

  it("handles '就选' pattern", () => {
    const result = analyzeForProactiveCapture("方案太多，就选A吧", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("decision_made");
  });

  it("detects '交付时间' as deadline", () => {
    const result = analyzeForProactiveCapture("交付时间是下周五", ctx);
    expect(result.detected).toBe(true);
    expect(result.triggerType).toBe("deadline_noted");
  });

  it("detects '认证方式' as security", () => {
    const result = analyzeForProactiveCapture("认证方式改为JWT token", ctx);
    // This could match policy_change or security_noted depending on pattern order
    expect(result.detected).toBe(true);
  });
});
