// Proactive Memory Capture — real-time detection of decision-making statements in conversation
//
// Scans incoming user messages for "memory-worthy" content (decisions, commitments,
// preferences, facts) and extracts a candidate structured memory for team confirmation.
//
// This turns the memory system from a passive "wait for pipeline" tool into an
// active "teammate who remembers" experience.

import { extractEntityAttribute } from "./extract-utils.js";

// ============================================================================
// Types
// ============================================================================

export interface ProactiveCaptureResult {
  /** Whether this message looks like it contains team-worthy memory */
  detected: boolean;
  /** Which pattern triggered the detection */
  triggerType: TriggerType;
  /** Confidence in the detection (0-1) */
  confidence: number;
  /** The extracted memory text (cleaned up) */
  memoryText: string;
  /** Suggested category */
  category: string;
  /** Extracted entity/attribute/value if parseable */
  entity?: string;
  attribute?: string;
  value?: string;
  /** Suggested confirmation prompt to show user */
  confirmationPrompt: string;
}

export type TriggerType =
  | "explicit_save"        // "记住..." / "记下来..." / "mark this..."
  | "decision_made"        // "我们决定..." / "就用方案X" / "confirmed..."
  | "future_commitment"    // "以后都..." / "from now on..." / "以后..."
  | "policy_change"        // "改为..." / "切换为..." / "changed to..."
  | "fact_stated"          // "API密钥是..." / "the port is..."
  | "process_defined"      // "流程是..." / "步骤为..."
  | "preference_declared"  // "我喜欢..." / "prefer..."
  | "deadline_noted"       // "截止日期是..." / "due by..."
  | "api_noted"            // "端点是..." / "endpoint is..."
  | "security_noted"       // "密码是..." / "密钥更新为..."
  | null;

// ============================================================================
// Detection Patterns
// ============================================================================

interface DetectionPattern {
  type: TriggerType;
  regex: RegExp;
  category: string;
  confidenceBoost: number;
}

/** Ordered list of patterns to check. Order matters — first match wins. */
const PATTERNS: DetectionPattern[] = [
  // 1. Explicit "remember this" — highest confidence
  {
    type: "explicit_save",
    regex: /(?:记住|记下来|记一下|记录下来|mark this|write this down|note this|帮我记|添加到记忆|记录.*这个)/i,
    category: "decision",
    confidenceBoost: 0.9,
  },
  // 2. Future commitment / "from now on"
  {
    type: "future_commitment",
    regex: /(?:以后都|以后|从现在开始|from now on|往后|今后|以后都|以后一律|以后默认)/i,
    category: "process",
    confidenceBoost: 0.85,
  },
  // 3. Decision made
  {
    type: "decision_made",
    regex: /(?:我们决定|决定了|确定用|就选|就用|确认用|最终决定|confirm.*use|decided|agreed.*to|we'll go with|we decided)/i,
    category: "decision",
    confidenceBoost: 0.85,
  },
  // 4. Policy / process change
  {
    type: "policy_change",
    regex: /(?:改为|切换为|换成|调整为|变更为|流程变为|方案改为|格式改为|方式改为|changed to|switched to|migrated to)/i,
    category: "process",
    confidenceBoost: 0.75,
  },
  // 5. Deadline / milestone
  {
    type: "deadline_noted",
    regex: /(?:截止日期|截止日|ddl|due date|deadline|交付时间|上线时间|发布日期|delivery date)/i,
    category: "decision",
    confidenceBoost: 0.8,
  },
  // 6. API / config fact
  {
    type: "api_noted",
    regex: /(?:端点|endpoint|端口|port|连接串|connection string|配置为|设为|set to|API.*[是:：]|url.*[是:：])/i,
    category: "api",
    confidenceBoost: 0.7,
  },
  // 7. Security credential
  {
    type: "security_noted",
    regex: /(?:密钥|密码|token|secret|access.*key|凭据|认证方式|auth.*method|api key)/i,
    category: "security",
    confidenceBoost: 0.8,
  },
  // 8. Process / workflow definition
  {
    type: "process_defined",
    regex: /(?:流程是|步骤为|规范是|要求是|规则是|workflow.*is|process.*is|procedure)/i,
    category: "process",
    confidenceBoost: 0.7,
  },
  // 9. Preference
  {
    type: "preference_declared",
    regex: /(?:我倾向|我更喜欢|偏好是|prefer|偏好|建议用|推荐使用)/i,
    category: "experience",
    confidenceBoost: 0.65,
  },
];

// ============================================================================
// Memory Text Extraction
// ============================================================================

/**
 * Extract the core memory-worthy content from a message.
 * Strips conversational fluff and keeps the factual/decision core.
 */
function extractMemoryText(text: string): string {
  let cleaned = text.trim();

  // Remove leading conversational markers
  cleaned = cleaned.replace(/^(?:对了|对了、?|顺便|哦|嗯|那个|啊|话说|对了啊|对了，?)/, "");

  // Remove trailing conversational particles
  cleaned = cleaned.replace(/[了呢啊呀哦吧嘛。！!?！?]+$/, "").trim();

  // If the message is short, keep it as-is
  if (cleaned.length < 50) return cleaned;

  // For longer messages, try to extract the core sentence
  // Look for sentences containing decision keywords
  const sentences = cleaned.split(/[。！？\n]/);
  for (const pattern of PATTERNS) {
    for (const sentence of sentences) {
      if (pattern.regex.test(sentence.trim())) {
        const trimmed = sentence.trim().replace(/[了呢啊呀。！!?！?]+$/, "").trim();
        if (trimmed.length >= 3) return trimmed;
      }
    }
  }

  // Fallback: return first 100 chars
  return cleaned.length > 120 ? cleaned.slice(0, 120) + "..." : cleaned;
}

/**
 * Generate a natural confirmation prompt for the user.
 * Adapts to the trigger type for contextual relevance.
 */
function buildConfirmationPrompt(triggerType: TriggerType, memoryText: string): string {
  const prompts: Record<string, string> = {
    explicit_save: "我注意到你想记录这个信息，要保存到团队记忆中吗？",
    decision_made: "我注意到你们似乎达成了某个决定，要记录下来吗？",
    future_commitment: "这看起来是一个长期约定，要记入团队记忆吗？",
    policy_change: "检测到流程/方案变更，要更新团队记忆吗？",
    fact_stated: "这条信息可能对团队有用，要保存到记忆中吗？",
    process_defined: "这看起来是一个流程规范，要记录下来吗？",
    preference_declared: "注意到你的偏好，要记入团队记忆供后续参考吗？",
    deadline_noted: "检测到截止日期信息，要提醒团队记住这个时间吗？",
    api_noted: "检测到 API/配置信息，要保存到团队记忆中吗？",
    security_noted: "检测到安全相关信息，要记录到团队记忆中吗？",
  };
  return prompts[triggerType ?? "fact_stated"] ?? prompts.fact_stated;
}

// ============================================================================
// Main Capture Function
// ============================================================================

/**
 * Analyze a user message for memory-worthy content.
 * Returns a capture result if detected, or { detected: false } otherwise.
 *
 * This is designed to be lightweight — regex-based detection that runs
 * synchronously on every `before_agent_start` event. No LLM call here.
 */
export function analyzeForProactiveCapture(
  text: string,
  context: {
    /** Whether the sender is the team owner */
    isOwner: boolean;
    /** Whether we're in a group chat */
    isGroup: boolean;
  } = { isOwner: true, isGroup: false }
): ProactiveCaptureResult {
  if (!text || text.trim().length < 3) {
    return { detected: false, triggerType: null, confidence: 0, memoryText: "", category: "general", confirmationPrompt: "" };
  }

  const trimmed = text.trim();

  // Skip system messages, commands, and non-substantive content
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("<") ||
    trimmed.startsWith("{") ||
    /^(好的|收到|ok|OK|嗯嗯|没问题|行|可以|谢谢|明白|了解|done)/i.test(trimmed)
  ) {
    return { detected: false, triggerType: null, confidence: 0, memoryText: "", category: "general", confirmationPrompt: "" };
  }

  // Check each pattern in priority order
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(trimmed)) {
      const memoryText = extractMemoryText(trimmed);

      // Strip imperative markers before structured extraction
      // e.g., "记住客户A的交付格式为PDF" → "客户A的交付格式为PDF"
      const cleanForExtraction = memoryText.replace(
        /^(?:记住|记下来|记一下|记录下来|mark this|write this down|note this|帮我记|添加到记忆)/i,
        ""
      ).replace(/^(?:了|，|,)\s*/, "").trim();

      // Try to extract structured entity/attribute/value
      const eav = extractEntityAttribute(cleanForExtraction || memoryText, pattern.category);

      // Owner in DM gets slightly higher confidence (more trustworthy)
      const confidence = context.isOwner
        ? Math.min(1.0, pattern.confidenceBoost + 0.05)
        : pattern.confidenceBoost;

      return {
        detected: true,
        triggerType: pattern.type,
        confidence,
        memoryText,
        category: pattern.category,
        entity: eav.entity !== "general" ? eav.entity : undefined,
        attribute: eav.attribute !== pattern.category ? eav.attribute : undefined,
        value: eav.value !== memoryText ? eav.value : undefined,
        confirmationPrompt: buildConfirmationPrompt(pattern.type, memoryText),
      };
    }
  }

  return { detected: false, triggerType: null, confidence: 0, memoryText: "", category: "general", confirmationPrompt: "" };
}

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Simple in-memory rate limiter to avoid prompting the user too frequently.
 * Tracks per-session prompt count and enforces a minimum interval between prompts.
 */
export class PromptRateLimiter {
  private lastPromptTime: number = 0;
  private promptCount: number = 0;
  private sessionStart: number = Date.now();

  /** Minimum interval between prompts (default: 2 minutes) */
  private minIntervalMs: number;
  /** Max prompts per session (default: 10) */
  private maxPerSession: number;

  constructor(options?: { minIntervalMs?: number; maxPerSession?: number }) {
    this.minIntervalMs = options?.minIntervalMs ?? 2 * 60 * 1000;
    this.maxPerSession = options?.maxPerSession ?? 10;
  }

  /** Check if a prompt is allowed right now */
  canPrompt(): boolean {
    if (this.promptCount >= this.maxPerSession) return false;
    const now = Date.now();
    if (now - this.lastPromptTime < this.minIntervalMs) return false;
    return true;
  }

  /** Record that a prompt was just sent */
  recordPrompt(): void {
    this.lastPromptTime = Date.now();
    this.promptCount++;
  }

  /** Reset the limiter (new session) */
  reset(): void {
    this.lastPromptTime = 0;
    this.promptCount = 0;
    this.sessionStart = Date.now();
  }

  /** Stats for debugging */
  getStats(): { count: number; remaining: number; lastPrompt: number } {
    return {
      count: this.promptCount,
      remaining: Math.max(0, this.maxPerSession - this.promptCount),
      lastPrompt: this.lastPromptTime,
    };
  }
}
