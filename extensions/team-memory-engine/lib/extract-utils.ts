// Extract entity/attribute/value from free text using natural language patterns.
//
// Shared between manager.ts (real-time inject) and migrate.ts (v1 migration)
// to ensure consistent parsing behavior.

export interface ExtractedField {
  entity: string;
  attribute: string;
  value: string;
}

/**
 * Extract structured entity/attribute/value from free text.
 *
 * Handles patterns like:
 * - "客户A的交付格式为PDF" → entity: 客户A, attribute: 交付格式, value: PDF
 * - "客户A要PDF格式" → entity: 客户A, attribute: 格式, value: PDF
 * - "API的端点改为v3了" → entity: API, attribute: 端点, value: v3
 * - "数据库连接池设为10" → entity: 数据库连接池, attribute: 连接池, value: 10
 * - "部署流程改为灰度发布" → entity: 部署流程, attribute: 流程, value: 灰度发布
 */
export function extractEntityAttribute(text: string, category: string): ExtractedField {
  const trimmed = text.trim();

  // Pattern 1: "X的Y[为是:：]Z" — possessive + copula
  const possessive = /^(.+?)的(.+?)(?:为|是|设为|改为|变为|即是|为:|为：|:|：)(.+)$/;
  let m = trimmed.match(possessive);
  if (m) {
    return {
      entity: m[1].trim(),
      attribute: m[2].trim(),
      value: m[3].trim().replace(/[了呢啊呀。！!?！?]+$/, ''),
    };
  }

  // Pattern 2: "X[verb]Y" — subject + action verb + object/preference
  const verbPattern = /^(.+?)(?:改为|设为|变为|调整为|更新为|切换为|换为|需要|要|需|使用|采用|启用|选择|定)(.+)$/;
  m = trimmed.match(verbPattern);
  if (m) {
    const entity = m[1].trim();
    const rawValue = m[2].trim().replace(/[了呢啊呀。！!?！?]+$/, '');
    const attrMatch = rawValue.match(/^(.+?)(格式|方案|流程|方式|版本|端口|连接池|密码|规则|策略|规范|标准|协议|风格|语言|工具|框架)$/);
    if (attrMatch) {
      return {
        entity,
        attribute: attrMatch[2],
        value: attrMatch[1].trim(),
      };
    }
    return {
      entity,
      attribute: category !== "general" ? category : "preference",
      value: rawValue,
    };
  }

  // Pattern 3: "X-->Y" — explicit mapping
  m = trimmed.match(/^(.+?)-->(.+)$/);
  if (m) {
    return {
      entity: m[1].trim(),
      attribute: "value",
      value: m[2].trim(),
    };
  }

  // Pattern 4: Topic-comment structure
  const subjectMatch = trimmed.match(/^(.+?)(?:应该|需要|必须|得|可以|会|已|将)(.+)$/);
  if (subjectMatch) {
    const subject = subjectMatch[1].trim();
    const action = subjectMatch[2].trim();
    if (subject.length >= 2) {
      return {
        entity: subject,
        attribute: category !== "general" ? category : "action",
        value: action,
      };
    }
  }

  // Pattern 5: Noun-phrase extraction
  const nounExtract = trimmed.match(/(?:用|选|定|换|采)(.+)$/);
  if (nounExtract) {
    const candidate = nounExtract[1].trim().replace(/[了呢啊呀。！!?！?]+$/, '');
    if (candidate.length >= 2 && candidate.length < 20) {
      return {
        entity: candidate,
        attribute: category !== "general" ? category : "preference",
        value: trimmed,
      };
    }
  }

  // Fallback — avoid graph degeneration
  const firstSegment = trimmed.split(/[,，。！？\s]/)[0];
  if (firstSegment.length >= 2 && firstSegment.length <= 10) {
    const remaining = trimmed.slice(firstSegment.length).trim();
    if (remaining.length > 0 && /[为是设为改选用需应已]/.test(remaining)) {
      return {
        entity: firstSegment,
        attribute: category !== "general" ? category : "observation",
        value: remaining,
      };
    }
  }

  return {
    entity: "general",
    attribute: category !== "general" ? category : "memory",
    value: text,
  };
}

// ---- Role-based confidence adjustment ----

/**
 * Compute confidence adjustment based on the injector's role.
 * - Owner (deploy-time configured user): +0.1 (high trust, capped at 0.85 max base)
 * - Agent/system: +0.0 (neutral)
 * - Unknown user: -0.1 (lower trust until confirmed by multiple members)
 */
export function roleConfidenceAdjustment(injectedBy: string, defaultUserId: string): number {
  if (injectedBy === defaultUserId) return 0.1;
  if (injectedBy === "agent" || injectedBy === "memory-extractor") return 0.0;
  return -0.1;
}
