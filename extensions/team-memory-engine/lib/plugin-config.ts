// Configuration types, defaults, and environment parsing for the team-memory-engine plugin

export interface TeamMemoryConfig {
  teamId: string;
  decayCheckInterval: number;
  riskCheckInterval: number;
  feishuChatId: string;
  teamSize: number;
  enableGraph: boolean;
  projectRoot: string;
  modelEndpoint: string;
  modelApiKey: string;
  modelName: string;
  modelXApiKey: string;
  extractionBatchSize: number;
  // Proactive Memory Capture
  enableProactiveCapture: boolean;
  proactivePromptInterval: number;
  proactiveMaxPerSession: number;
  // Vector search embedding config
  embeddingEndpoint: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingXApiKey: string;
}

const ALLOWED_CONFIG_KEYS = [
  "teamId", "decayCheckInterval", "riskCheckInterval",
  "feishuChatId", "teamSize", "enableGraph",
  "projectRoot", "modelEndpoint", "modelApiKey", "modelName", "modelXApiKey", "extractionBatchSize",
  "enableProactiveCapture", "proactivePromptInterval", "proactiveMaxPerSession",
  "embeddingEndpoint", "embeddingApiKey", "embeddingModel", "embeddingXApiKey",
];

function defaultConfig(): TeamMemoryConfig {
  return {
    teamId: "openclaw-team",
    decayCheckInterval: 30 * 60 * 1000,
    riskCheckInterval: 60 * 60 * 1000,
    feishuChatId: "",
    teamSize: 5,
    enableGraph: true,
    projectRoot: "",
    modelEndpoint: "",
    modelApiKey: "",
    modelName: "qwen-plus",
    modelXApiKey: "",
    extractionBatchSize: 20,
    enableProactiveCapture: true,
    proactivePromptInterval: 2 * 60 * 1000,
    proactiveMaxPerSession: 10,
    embeddingEndpoint: "",
    embeddingApiKey: "",
    embeddingModel: "text-embedding-3-small",
    embeddingXApiKey: "",
  };
}

export function parseConfig(value: Record<string, unknown>): TeamMemoryConfig {
  const def = defaultConfig();
  return {
    teamId: typeof value.teamId === "string" && value.teamId ? value.teamId : def.teamId,
    decayCheckInterval: typeof value.decayCheckInterval === "number" ? value.decayCheckInterval : def.decayCheckInterval,
    riskCheckInterval: typeof value.riskCheckInterval === "number" ? value.riskCheckInterval : def.riskCheckInterval,
    feishuChatId: typeof value.feishuChatId === "string" && value.feishuChatId ? value.feishuChatId : def.feishuChatId,
    teamSize: typeof value.teamSize === "number" && value.teamSize > 0 ? value.teamSize : def.teamSize,
    enableGraph: typeof value.enableGraph === "boolean" ? value.enableGraph : def.enableGraph,
    projectRoot: typeof value.projectRoot === "string" && value.projectRoot ? value.projectRoot : def.projectRoot,
    modelEndpoint: typeof value.modelEndpoint === "string" ? value.modelEndpoint : def.modelEndpoint,
    modelApiKey: typeof value.modelApiKey === "string" ? value.modelApiKey : def.modelApiKey,
    modelName: typeof value.modelName === "string" && value.modelName ? value.modelName : def.modelName,
    modelXApiKey: typeof value.modelXApiKey === "string" ? value.modelXApiKey : def.modelXApiKey,
    extractionBatchSize: typeof value.extractionBatchSize === "number" && value.extractionBatchSize > 0 ? value.extractionBatchSize : def.extractionBatchSize,
    enableProactiveCapture: typeof value.enableProactiveCapture === "boolean" ? value.enableProactiveCapture : def.enableProactiveCapture,
    proactivePromptInterval: typeof value.proactivePromptInterval === "number" ? value.proactivePromptInterval : def.proactivePromptInterval,
    proactiveMaxPerSession: typeof value.proactiveMaxPerSession === "number" ? value.proactiveMaxPerSession : def.proactiveMaxPerSession,
    embeddingEndpoint: typeof value.embeddingEndpoint === "string" ? value.embeddingEndpoint : def.embeddingEndpoint,
    embeddingApiKey: typeof value.embeddingApiKey === "string" ? value.embeddingApiKey : def.embeddingApiKey,
    embeddingModel: typeof value.embeddingModel === "string" && value.embeddingModel ? value.embeddingModel : def.embeddingModel,
    embeddingXApiKey: typeof value.embeddingXApiKey === "string" ? value.embeddingXApiKey : def.embeddingXApiKey,
  };
}

export function getConfigFromEnv(api: { config?: Record<string, unknown> }): Record<string, unknown> {
  const env = (api.config as Record<string, unknown> | undefined)?.env;
  const vars = env && typeof env === "object" && "vars" in env ? (env as Record<string, unknown>).vars : {};
  const get = (key: string): string | undefined => {
    if (typeof process !== "undefined" && process.env && typeof (process.env as Record<string, string>)[key] === "string") {
      return (process.env as Record<string, string>)[key];
    }
    if (typeof vars === "object" && vars && key in vars) {
      return (vars as Record<string, string>)[key];
    }
    return undefined;
  };

  const cfg: Record<string, unknown> = {};
  const teamId = get("TEAM_MEMORY_TEAM_ID");
  const decayInterval = get("TEAM_MEMORY_DECAY_INTERVAL");
  const riskInterval = get("TEAM_MEMORY_RISK_INTERVAL");
  const chatId = get("TEAM_MEMORY_FEISHU_CHAT_ID");
  const teamSize = get("TEAM_MEMORY_TEAM_SIZE");
  if (teamId) cfg.teamId = teamId;
  if (decayInterval) cfg.decayCheckInterval = parseInt(decayInterval, 10);
  if (riskInterval) cfg.riskCheckInterval = parseInt(riskInterval, 10);
  if (chatId) cfg.feishuChatId = chatId;
  if (teamSize) cfg.teamSize = parseInt(teamSize, 10);

  // API keys from env (security: don't hardcode in openclaw.json)
  const modelEndpoint = get("TEAM_MEMORY_MODEL_ENDPOINT");
  const modelApiKey = get("TEAM_MEMORY_MODEL_API_KEY");
  const modelXApiKey = get("TEAM_MEMORY_MODEL_X_API_KEY");
  const modelName = get("TEAM_MEMORY_MODEL_NAME");
  const embeddingEndpoint = get("TEAM_MEMORY_EMBEDDING_ENDPOINT");
  const embeddingApiKey = get("TEAM_MEMORY_EMBEDDING_API_KEY");
  const embeddingXApiKey = get("TEAM_MEMORY_EMBEDDING_X_API_KEY");
  const embeddingModel = get("TEAM_MEMORY_EMBEDDING_MODEL");
  if (modelEndpoint) cfg.modelEndpoint = modelEndpoint;
  if (modelApiKey) cfg.modelApiKey = modelApiKey;
  if (modelXApiKey) cfg.modelXApiKey = modelXApiKey;
  if (modelName) cfg.modelName = modelName;
  if (embeddingEndpoint) cfg.embeddingEndpoint = embeddingEndpoint;
  if (embeddingApiKey) cfg.embeddingApiKey = embeddingApiKey;
  if (embeddingXApiKey) cfg.embeddingXApiKey = embeddingXApiKey;
  if (embeddingModel) cfg.embeddingModel = embeddingModel;

  return cfg;
}
