import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderConfiguration } from "./config";
import { resolveCodexRuntime } from "./runtime";
import {
  assertChatGptSubscriptionAuth,
  createSubscriptionEnvironment
} from "./subscriptionAuth";

const PROVIDER_MODEL_PREFIX = "codex-subscription:";
const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

export interface CodexModelDescriptor {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly supportedReasoningEfforts: readonly string[];
  readonly defaultReasoningEffort: string;
  readonly isDefault: boolean;
  readonly hidden: boolean;
  readonly inputModalities: readonly string[];
}

interface CatalogLogger {
  info(message: string): void;
  debug(message: string): void;
  error(message: string, error?: unknown): void;
}

interface CatalogCache {
  readonly key: string;
  readonly expiresAt: number;
  readonly models: readonly CodexModelDescriptor[];
}

interface JsonRpcResponse {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

export class CodexModelCatalog {
  private cache: CatalogCache | undefined;
  private inFlight: Promise<readonly CodexModelDescriptor[]> | undefined;

  public constructor(
    private readonly extensionRoot: string,
    private readonly logger: CatalogLogger
  ) {}

  public async getModels(
    configuration: ProviderConfiguration,
    forceRefresh = false
  ): Promise<readonly CodexModelDescriptor[]> {
    const key = catalogKey(configuration);
    const now = Date.now();

    if (!forceRefresh && this.cache?.key === key && this.cache.expiresAt > now) {
      return this.cache.models;
    }
    if (!forceRefresh && this.inFlight !== undefined) {
      return this.inFlight;
    }

    const stale = this.cache?.key === key ? this.cache : undefined;
    const load = this.loadModels(configuration)
      .then(models => {
        if (models.length === 0) {
          throw new Error("No explicit Codex models are available after filtering.");
        }
        this.cache = {
          key,
          expiresAt: Date.now() + configuration.modelCacheTtlMinutes * 60_000,
          models
        };
        return models;
      })
      .catch(error => {
        if (!forceRefresh && stale !== undefined) {
          this.logger.error("Model refresh failed; using the last known catalog", error);
          return stale.models;
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight === load) {
          this.inFlight = undefined;
        }
      });

    this.inFlight = load;
    return load;
  }

  public invalidate(): void {
    this.cache = undefined;
  }

  private async loadModels(
    configuration: ProviderConfiguration
  ): Promise<readonly CodexModelDescriptor[]> {
    let models: readonly CodexModelDescriptor[];

    if (configuration.modelSource === "manual") {
      models = createManualModels(configuration.manualModels);
    } else {
      assertChatGptSubscriptionAuth();
      const runtime = resolveCodexRuntime({
        extensionRoot: this.extensionRoot,
        configuredPath: configuration.codexExecutablePath,
        mode: configuration.runtimeMode
      });
      this.logger.info(
        `Codex runtime selected source=${runtime.source} path=${runtime.executablePath}`
      );
      models = await discoverCodexModels(
        runtime.executablePath,
        createSubscriptionEnvironment(),
        MODEL_DISCOVERY_TIMEOUT_MS
      );
    }

    const filtered = filterModels(models, configuration.enabledModels);
    this.logger.info(
      `Model catalog loaded source=${configuration.modelSource} visible=${filtered.length}`
    );
    this.logger.debug(
      `Available explicit models=${filtered.map(model => model.model).join(",")}`
    );
    return filtered;
  }
}

export async function discoverCodexModels(
  executablePath: string,
  environment: Record<string, string>,
  timeoutMs: number
): Promise<readonly CodexModelDescriptor[]> {
  const child = spawn(
    executablePath,
    ["app-server", "--listen", "stdio://"],
    {
      env: environment,
      windowsHide: true,
      stdio: "pipe"
    }
  );
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let stderr = "";
  let spawnError: Error | undefined;

  child.stderr.on("data", chunk => {
    if (stderr.length < 16_384) {
      stderr += Buffer.from(chunk).toString("utf8");
    }
  });
  child.once("error", error => {
    spawnError = error;
  });

  const protocol = async (): Promise<readonly CodexModelDescriptor[]> => {
    writeMessage(child.stdin, {
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "copilot-codex-provider",
          title: "Codex Subscription Provider for Copilot",
          version: "0.6.1"
        },
        capabilities: null
      }
    });
    await readResponse(iterator, 1, () => spawnError, () => stderr);
    writeMessage(child.stdin, { method: "initialized" });

    const models: CodexModelDescriptor[] = [];
    let cursor: string | null = null;
    let requestId = 2;

    do {
      writeMessage(child.stdin, {
        method: "model/list",
        id: requestId,
        params: { cursor, limit: 100, includeHidden: false }
      });
      const result = await readResponse(
        iterator,
        requestId,
        () => spawnError,
        () => stderr
      );
      const page = parseModelListResponse(result);
      models.push(...page.models);
      cursor = page.nextCursor;
      requestId += 1;
    } while (cursor !== null);

    return deduplicateModels(models);
  };

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Codex model discovery timed out after ${timeoutMs}ms.`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([protocol(), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    child.stdin.end();
    lines.close();
    if (!child.killed) {
      child.kill();
    }
  }
}

export function parseModelListResponse(value: unknown): {
  readonly models: readonly CodexModelDescriptor[];
  readonly nextCursor: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Codex model/list returned an invalid response.");
  }

  const models = value.data.map((item, index) => parseModel(item, index));
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("Codex model/list returned an invalid pagination cursor.");
  }

  return { models, nextCursor };
}

export function createManualModels(
  modelIds: readonly string[]
): readonly CodexModelDescriptor[] {
  return deduplicateModels(
    modelIds
      .map(model => model.trim())
      .filter(model => model.length > 0)
      .map(model => ({
        id: model,
        model,
        displayName: model,
        description: "Manually configured Codex subscription model",
        supportedReasoningEfforts: [],
        defaultReasoningEffort: "medium",
        isDefault: false,
        hidden: false,
        inputModalities: ["text", "image"]
      }))
  );
}

export function filterModels(
  models: readonly CodexModelDescriptor[],
  enabledModels: readonly string[]
): readonly CodexModelDescriptor[] {
  const enabled = new Set(
    enabledModels.map(model => model.trim()).filter(model => model.length > 0)
  );
  return models.filter(
    model => !model.hidden && (enabled.size === 0 || enabled.has(model.model))
  );
}

export function toProviderModelId(modelId: string): string {
  return `${PROVIDER_MODEL_PREFIX}${encodeURIComponent(modelId)}`;
}

export function fromProviderModelId(providerModelId: string): string {
  if (!providerModelId.startsWith(PROVIDER_MODEL_PREFIX)) {
    throw new Error(`Unsupported Codex provider model ID: ${providerModelId}`);
  }
  return decodeURIComponent(providerModelId.slice(PROVIDER_MODEL_PREFIX.length));
}

async function readResponse(
  iterator: AsyncIterator<string>,
  expectedId: number,
  getSpawnError: () => Error | undefined,
  getStderr: () => string
): Promise<unknown> {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      const spawnError = getSpawnError();
      const detail = getStderr().trim();
      throw spawnError ?? new Error(
        `Codex App Server closed before response ${expectedId}.${detail ? ` ${detail}` : ""}`
      );
    }

    let message: JsonRpcResponse;
    try {
      message = JSON.parse(next.value) as JsonRpcResponse;
    } catch {
      continue;
    }
    if (message.id !== expectedId) {
      continue;
    }
    if (message.error !== undefined) {
      throw new Error(
        `Codex App Server error ${message.error.code ?? "unknown"}: ${message.error.message ?? "unknown error"}`
      );
    }
    return message.result;
  }
}

function writeMessage(
  input: NodeJS.WritableStream,
  message: Record<string, unknown>
): void {
  input.write(`${JSON.stringify(message)}\n`);
}

function parseModel(value: unknown, index: number): CodexModelDescriptor {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.model !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.description !== "string" ||
    typeof value.hidden !== "boolean" ||
    typeof value.defaultReasoningEffort !== "string" ||
    typeof value.isDefault !== "boolean" ||
    !Array.isArray(value.supportedReasoningEfforts)
  ) {
    throw new Error(`Codex model/list entry ${index + 1} is malformed.`);
  }

  const inputModalities = parseInputModalities(value.inputModalities, index);
  const supportedReasoningEfforts = value.supportedReasoningEfforts.map(
    (option, effortIndex) => {
      if (!isRecord(option) || typeof option.reasoningEffort !== "string") {
        throw new Error(
          `Codex model/list entry ${index + 1} reasoning effort ${effortIndex + 1} is malformed.`
        );
      }
      return option.reasoningEffort;
    }
  );

  return {
    id: value.id,
    model: value.model,
    displayName: value.displayName,
    description: value.description,
    hidden: value.hidden,
    supportedReasoningEfforts,
    defaultReasoningEffort: value.defaultReasoningEffort,
    isDefault: value.isDefault,
    inputModalities
  };
}

function parseInputModalities(value: unknown, index: number): readonly string[] {
  if (value === undefined) {
    return ["text", "image"];
  }
  if (!Array.isArray(value) || value.some(modality => typeof modality !== "string")) {
    throw new Error(`Codex model/list entry ${index + 1} input modalities are malformed.`);
  }
  return [...new Set(value.map(modality => modality.trim().toLowerCase()))]
    .filter(modality => modality.length > 0);
}

function deduplicateModels(
  models: readonly CodexModelDescriptor[]
): readonly CodexModelDescriptor[] {
  const seen = new Set<string>();
  return models.filter(model => {
    if (seen.has(model.model)) {
      return false;
    }
    seen.add(model.model);
    return true;
  });
}

function catalogKey(configuration: ProviderConfiguration): string {
  return JSON.stringify({
    source: configuration.modelSource,
    manualModels: configuration.manualModels,
    enabledModels: configuration.enabledModels,
    runtimeMode: configuration.runtimeMode,
    executable: configuration.codexExecutablePath
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
