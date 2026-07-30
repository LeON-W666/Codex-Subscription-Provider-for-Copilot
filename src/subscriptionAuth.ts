import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_CREDENTIAL_ENVIRONMENT_VARIABLES = new Set([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_BASE_URL"
]);

export interface SubscriptionAuthDetails {
  readonly authPath: string;
  readonly authMode: "chatgpt";
}

export function assertChatGptSubscriptionAuth(
  environment: NodeJS.ProcessEnv = process.env
): SubscriptionAuthDetails {
  const codexHome = environment.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const authPath = join(codexHome, "auth.json");

  if (!existsSync(authPath)) {
    throw new Error(
      `Codex login was not found at ${authPath}. Sign in to Codex with ChatGPT first.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(authPath, "utf8"));
  } catch {
    throw new Error(`Codex authentication file is unreadable: ${authPath}.`);
  }

  validateChatGptSubscriptionAuth(parsed, authPath);
  return { authPath, authMode: "chatgpt" };
}

export function validateChatGptSubscriptionAuth(
  value: unknown,
  authPath = "Codex auth.json"
): void {
  if (!isRecord(value) || value.auth_mode !== "chatgpt") {
    throw new Error(
      `${authPath} is not using ChatGPT subscription login (auth_mode=chatgpt).`
    );
  }

  if (typeof value.OPENAI_API_KEY === "string" && value.OPENAI_API_KEY.trim()) {
    throw new Error(
      `${authPath} contains an API key. This provider refuses API-billed authentication.`
    );
  }

  if (!isRecord(value.tokens) || !hasToken(value.tokens)) {
    throw new Error(
      `${authPath} does not contain ChatGPT login tokens. Sign in to Codex again.`
    );
  }
}

export function createSubscriptionEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(environment)) {
    if (
      typeof value === "string" &&
      !API_CREDENTIAL_ENVIRONMENT_VARIABLES.has(key.toUpperCase())
    ) {
      result[key] = value;
    }
  }

  return result;
}

function hasToken(tokens: Record<string, unknown>): boolean {
  return Object.values(tokens).some(
    value => typeof value === "string" && value.trim().length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}