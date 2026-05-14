// Tests for plugin-config resolveSecrets

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { resolveSecrets, type TeamMemoryConfig } from "../lib/plugin-config";

describe("resolveSecrets", () => {
  const baseConfig = (): TeamMemoryConfig => ({
    teamId: "test-team",
    decayCheckInterval: 1000,
    riskCheckInterval: 1000,
    feishuChatId: "",
    teamSize: 5,
    enableGraph: true,
    projectRoot: "/tmp/test",
    modelEndpoint: "",
    modelApiKey: "",
    modelName: "test-model",
    modelXApiKey: "",
    extractionBatchSize: 10,
    enableProactiveCapture: true,
    proactivePromptInterval: 1000,
    proactiveMaxPerSession: 5,
    embeddingEndpoint: "",
    embeddingApiKey: "",
    embeddingModel: "test-embedding",
    embeddingXApiKey: "",
  });

  // Point to a nonexistent file so readFromSecretsFile returns undefined
  const nonexistentSecretsPath = path.join(os.tmpdir(), `nonexistent-secrets-${Date.now()}.json`);

  const withMockedSecrets = async (fn: () => Promise<void>) => {
    const orig = process.env.TEAM_MEMORY_SECRETS_PATH;
    process.env.TEAM_MEMORY_SECRETS_PATH = nonexistentSecretsPath;
    try {
      await fn();
    } finally {
      if (orig !== undefined) {
        process.env.TEAM_MEMORY_SECRETS_PATH = orig;
      } else {
        delete process.env.TEAM_MEMORY_SECRETS_PATH;
      }
    }
  };

  it("returns empty strings when no secrets are configured", async () => {
    await withMockedSecrets(async () => {
      const cfg = baseConfig();
      const resolved = await resolveSecrets({ resolveConfig: undefined }, cfg);
      expect(resolved.modelApiKey).toBe("");
      expect(resolved.modelXApiKey).toBe("");
      expect(resolved.embeddingApiKey).toBe("");
    });
  });

  it("preserves existing config values", async () => {
    const cfg = baseConfig();
    cfg.modelApiKey = "existing-key";
    cfg.modelXApiKey = "existing-x-key";
    const resolved = await resolveSecrets({ resolveConfig: undefined }, cfg);
    expect(resolved.modelApiKey).toBe("existing-key");
    expect(resolved.modelXApiKey).toBe("existing-x-key");
  });

  it("uses api.resolveConfig when available", async () => {
    const cfg = baseConfig();
    const mockResolve = (key: string) => {
      if (key === "teamMemory.modelApiKey") return "resolved-key";
      return undefined;
    };
    const resolved = await resolveSecrets({ resolveConfig: mockResolve }, cfg);
    expect(resolved.modelApiKey).toBe("resolved-key");
  });

  it("falls back to process.env when resolveConfig returns undefined", async () => {
    await withMockedSecrets(async () => {
      const cfg = baseConfig();
      const origEnv = process.env.TEAM_MEMORY_MODEL_API_KEY;
      process.env.TEAM_MEMORY_MODEL_API_KEY = "env-key";
      try {
        const resolved = await resolveSecrets({ resolveConfig: undefined }, cfg);
        expect(resolved.modelApiKey).toBe("env-key");
      } finally {
        if (origEnv !== undefined) {
          process.env.TEAM_MEMORY_MODEL_API_KEY = origEnv;
        } else {
          delete process.env.TEAM_MEMORY_MODEL_API_KEY;
        }
      }
    });
  });
});
