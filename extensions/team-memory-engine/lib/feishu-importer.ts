// Feishu Content Importer — import docs, bitable, and calendar events as memories
//
// This bridges the gap between Feishu collaboration tools and the team memory engine.
// Content from Feishu docs, Bitable spreadsheets, and calendar events are automatically
// converted into structured memories via LLM extraction.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { LedgerStorageBackend } from "./storage/ledger-storage.js";
import type { LedgerEntry } from "./storage/types.js";

// ===========================================================================
// Feishu Open API client
// ===========================================================================

interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

class FeishuClient {
  private creds: FeishuCredentials;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(creds: FeishuCredentials) {
    this.creds = creds;
  }

  /** Get tenant access token (cached) */
  async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.creds.appId,
        app_secret: this.creds.appSecret,
      }),
    });

    if (!resp.ok) throw new Error(`Feishu auth failed: ${resp.status} ${resp.statusText}`);
    const data = await resp.json() as { code: number; tenant_access_token: string };
    if (data.code !== 0) throw new Error(`Feishu auth error: ${JSON.stringify(data)}`);

    this.tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return data.tenant_access_token;
  }

  private async apiFetch(urlPath: string, token: string): Promise<unknown> {
    const resp = await fetch(`https://open.feishu.cn/open-apis${urlPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Feishu API error: ${resp.status} ${urlPath}`);
    return resp.json();
  }

  /** Fetch a Feishu doc (docx) content as plain text */
  async getDocContent(docToken: string): Promise<string> {
    const token = await this.getToken();
    const data = await this.apiFetch(`/docx/v1/documents/${docToken}/raw_content`, token) as {
      code: number;
      data?: { title: string; content: string };
    };
    if (data.code !== 0) throw new Error(`Feishu doc fetch failed: ${JSON.stringify(data)}`);
    return `${data.data?.title ?? "Untitled"}\n\n${data.data?.content ?? ""}`;
  }

  /** Fetch Bitable (spreadsheet) records as structured text */
  async getBitableRecords(appToken: string, tableId: string): Promise<string> {
    const token = await this.getToken();
    const data = await this.apiFetch(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100`,
      token
    ) as { code: number; data?: { items: Array<{ fields: Record<string, unknown> }> } };
    if (data.code !== 0) throw new Error(`Feishu bitable fetch failed: ${JSON.stringify(data)}`);

    const items = data.data?.items ?? [];
    const lines: string[] = [];
    for (const item of items) {
      const fields = item.fields;
      const parts: string[] = [];
      for (const [k, v] of Object.entries(fields)) {
        if (v != null && v !== "") parts.push(`${k}: ${v}`);
      }
      if (parts.length > 0) lines.push(parts.join(" | "));
    }
    return lines.join("\n");
  }

  /** Fetch upcoming calendar events */
  async getCalendarEvents(daysAhead = 7): Promise<string> {
    const token = await this.getToken();
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 86400000);

    const timeMin = now.toISOString();
    const timeMax = future.toISOString();

    const data = await this.apiFetch(
      `/calendar/v4/calendars/primary/events?time_min=${encodeURIComponent(timeMin)}&time_max=${encodeURIComponent(timeMax)}&page_size=50`,
      token
    ) as { code: number; data?: { items: Array<{ summary: string; description?: string; start_time?: { date_time?: string; date?: string }; end_time?: { date_time?: string; date?: string } }> } };
    if (data.code !== 0) throw new Error(`Feishu calendar fetch failed: ${JSON.stringify(data)}`);

    const items = data.data?.items ?? [];
    const lines: string[] = [];
    for (const ev of items) {
      const startTime = ev.start_time?.date_time ?? ev.start_time?.date ?? "TBD";
      const desc = ev.description ? ` - ${ev.description}` : "";
      lines.push(`📅 ${ev.summary} (${startTime})${desc}`);
    }
    return lines.join("\n") || "No upcoming events";
  }
}

// ===========================================================================
// LLM-based memory extraction from Feishu content
// ===========================================================================

interface ExtractionConfig {
  modelEndpoint: string;
  modelApiKey: string;
  modelName?: string;
  xApiKey?: string;
}

async function extractMemoriesFromContent(
  content: string,
  sourceType: "doc" | "bitable" | "calendar",
  config: ExtractionConfig
): Promise<Array<{ entity: string; attribute: string; value: string; category: string }>> {
  const systemPrompt = `You are a team memory extraction engine.
Analyze the provided content and extract important facts, decisions, agreements, and commitments.

Source type: ${sourceType}

For each important piece of information, extract:
- entity: The main subject (person, project, system, team)
- attribute: What aspect of the entity (decision, deadline, configuration, process, preference)
- value: The actual fact/decision in one clear sentence
- category: One of "decision", "api", "process", "security", "experience"

Output ONLY valid JSON array. No markdown, no explanation.
Example: [{"entity":"客户A","attribute":"交付格式","value":"交付格式改为PDF","category":"decision"}]`;

  const userPrompt = `Content to analyze:\n\n${content.substring(0, 8000)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.modelApiKey}`,
  };
  if (config.xApiKey) headers["x-api-key"] = config.xApiKey;

  const resp = await fetch(config.modelEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.modelName ?? "doubao-seed-2.0-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!resp.ok) throw new Error(`LLM extraction error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<{ entity: string; attribute: string; value: string; category: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Try to extract JSON from markdown code block
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1].trim()) as Array<{ entity: string; attribute: string; value: string; category: string }>;
    }
    return [];
  }
}

// ===========================================================================
// Memory injection into ledger
// ===========================================================================

function injectExtractedMemories(
  memories: Array<{ entity: string; attribute: string; value: string; category: string }>,
  sourceType: string,
  sourceId: string,
  ledger: LedgerStorageBackend,
  teamId: string,
  injectedBy = "feishu-importer"
): string[] {
  const ids: string[] = [];
  const now = new Date().toISOString();

  for (const mem of memories) {
    const id = `mem-${sourceType}-${crypto.randomUUID().substring(0, 8)}`;
    const entry: LedgerEntry = {
      id,
      entity: mem.entity,
      attribute: mem.attribute,
      claims: [{
        version: 1,
        value: mem.value,
        valid_from: now,
        valid_to: null,
        confidence: 0.8,
        source: `feishu_${sourceType}`,
        injected_by: injectedBy,
        confirmed_by: [],
        status: "active",
      }],
      current_version: 1,
      category: mem.category,
      tags: [sourceType, "auto-extracted"],
      dependency_graph: [],
      recall_half_life: getHalfLifeForCategory(mem.category),
      access_count: 0,
      teamId,
      createdAt: now,
      updatedAt: now,
    };
    ledger.set(id, entry);
    ids.push(id);
  }

  return ids;
}

export function getHalfLifeForCategory(category: string): number {
  const map: Record<string, number> = { decision: 14, api: 21, process: 10, security: 30, experience: 7 };
  return map[category] ?? 14;
}

// ===========================================================================
// Feishu credentials resolver
// ===========================================================================

function resolveFeishuCredentials(): FeishuCredentials {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "FEISHU_APP_ID and FEISHU_APP_SECRET environment variables required. "
      + "Set them in your shell or in openclaw.json env.vars."
    );
  }
  return { appId, appSecret };
}

// ===========================================================================
// Public API
// ===========================================================================

export interface FeishuImportResult {
  sourceType: string;
  sourceId: string;
  contentLength: number;
  memoriesExtracted: number;
  memoryIds: string[];
}

/**
 * Import content from a Feishu doc and convert to team memories.
 */
export async function importFeishuDoc(
  docToken: string,
  config: ExtractionConfig,
  teamId: string,
  ledgerPath: string
): Promise<FeishuImportResult> {
  const client = new FeishuClient(resolveFeishuCredentials());
  const content = await client.getDocContent(docToken);

  const memories = await extractMemoriesFromContent(content, "doc", config);
  const ledger = new LedgerStorageBackend(ledgerPath);
  await ledger.load();
  const ids = injectExtractedMemories(memories, "doc", docToken, ledger, teamId);
  await ledger.save();

  return { sourceType: "doc", sourceId: docToken, contentLength: content.length, memoriesExtracted: memories.length, memoryIds: ids };
}

/**
 * Import records from a Feishu Bitable and convert to team memories.
 */
export async function importFeishuBitable(
  appToken: string,
  tableId: string,
  config: ExtractionConfig,
  teamId: string,
  ledgerPath: string
): Promise<FeishuImportResult> {
  const client = new FeishuClient(resolveFeishuCredentials());
  const content = await client.getBitableRecords(appToken, tableId);

  const memories = await extractMemoriesFromContent(content, "bitable", config);
  const ledger = new LedgerStorageBackend(ledgerPath);
  await ledger.load();
  const ids = injectExtractedMemories(memories, "bitable", `${appToken}/${tableId}`, ledger, teamId);
  await ledger.save();

  return { sourceType: "bitable", sourceId: `${appToken}/${tableId}`, contentLength: content.length, memoriesExtracted: memories.length, memoryIds: ids };
}

/**
 * Import upcoming calendar events as process memories.
 */
export async function importFeishuCalendar(
  config: ExtractionConfig,
  teamId: string,
  ledgerPath: string,
  daysAhead = 7
): Promise<FeishuImportResult> {
  const client = new FeishuClient(resolveFeishuCredentials());
  const content = await client.getCalendarEvents(daysAhead);

  const memories = await extractMemoriesFromContent(content, "calendar", config);
  const ledger = new LedgerStorageBackend(ledgerPath);
  await ledger.load();
  const ids = injectExtractedMemories(memories, "cal", "primary", ledger, teamId);
  await ledger.save();

  return { sourceType: "calendar", sourceId: "primary", contentLength: content.length, memoriesExtracted: memories.length, memoryIds: ids };
}

/**
 * Batch import: doc + bitable + calendar in one call.
 */
export async function importAllFeishuSources(
  config: ExtractionConfig,
  teamId: string,
  ledgerPath: string,
  options: { docTokens?: string[]; bitables?: Array<{ appToken: string; tableId: string }>; calendarDaysAhead?: number } = {}
): Promise<FeishuImportResult[]> {
  const results: FeishuImportResult[] = [];

  for (const docToken of options.docTokens ?? []) {
    try {
      const r = await importFeishuDoc(docToken, config, teamId, ledgerPath);
      results.push(r);
    } catch (err) {
      console.error(`  ✗ Doc ${docToken} failed: ${String(err)}`);
    }
  }

  for (const b of options.bitables ?? []) {
    try {
      const r = await importFeishuBitable(b.appToken, b.tableId, config, teamId, ledgerPath);
      results.push(r);
    } catch (err) {
      console.error(`  ✗ Bitable ${b.appToken}/${b.tableId} failed: ${String(err)}`);
    }
  }

  try {
    const r = await importFeishuCalendar(config, teamId, ledgerPath, options.calendarDaysAhead ?? 7);
    results.push(r);
  } catch (err) {
    console.error(`  ✗ Calendar failed: ${String(err)}`);
  }

  return results;
}
