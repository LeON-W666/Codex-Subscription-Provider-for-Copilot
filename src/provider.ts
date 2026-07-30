import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Input, ModelReasoningEffort, ThreadItem } from "@openai/codex-sdk";
import * as vscode from "vscode";
import {
  affectsProviderConfiguration,
  readConfiguration,
  type ProviderConfiguration
} from "./config";
import {
  cleanupImageInputs,
  cleanupStaleImageInputs,
  materializeImageInputs
} from "./imageInput";
import { ProviderLogger, safeErrorMessage } from "./logger";
import {
  CodexModelCatalog,
  fromProviderModelId,
  toProviderModelId,
  type CodexModelDescriptor
} from "./modelCatalog";
import {
  buildBridgeOutputSchema,
  buildCodexBridgeRequest,
  estimateMessageTokens,
  estimateTokens,
  parseBridgeResponse
} from "./protocol";
import {
  assertChatGptSubscriptionAuth,
  createSubscriptionEnvironment
} from "./subscriptionAuth";
import { resolveCodexRuntime } from "./runtime";

interface LastRequestDetails {
  readonly model: string;
  readonly reasoningEffort: string;
  readonly toolNames: readonly string[];
  readonly messageCount: number;
  readonly imageCount: number;
  readonly startedAt: number;
  readonly durationMs?: number;
  readonly result?: "text" | "tool_calls" | "cancelled" | "error";
  readonly error?: string;
}

export class CodexLanguageModelProvider
  implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly configurationListener: vscode.Disposable;
  private readonly modelCatalog: CodexModelCatalog;
  private lastRequest: LastRequestDetails | undefined;

  public readonly onDidChangeLanguageModelChatInformation =
    this.changeEmitter.event;

  public constructor(
    private readonly extensionRoot: string,
    private readonly isolatedWorkingDirectory: string,
    private readonly logger: ProviderLogger
  ) {
    this.modelCatalog = new CodexModelCatalog(extensionRoot, logger);
    try {
      const removed = cleanupStaleImageInputs(isolatedWorkingDirectory);
      if (removed > 0) {
        logger.info(`Removed ${removed} stale Codex image-input directories.`);
      }
    } catch (error) {
      logger.error("Unable to clean stale Codex image inputs", error);
    }
    this.configurationListener = vscode.workspace.onDidChangeConfiguration(
      event => {
        if (affectsProviderConfiguration(event)) {
          this.logger.setLevel(readConfiguration().logLevel);
          this.modelCatalog.invalidate();
          this.changeEmitter.fire();
        }
      }
    );
  }

  public async provideLanguageModelChatInformation(
    _options: { readonly silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    try {
      const configuration = readConfiguration();
      const models = await this.modelCatalog.getModels(configuration);
      if (token.isCancellationRequested) {
        return [];
      }
      return models.map(model => toLanguageModelInformation(model, configuration));
    } catch (error) {
      this.logger.error("Unable to provide explicit Codex model catalog", error);
      return [];
    }
  }

  public async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    assertChatGptSubscriptionAuth();

    const configuration = readConfiguration();
    const selectedModel = await this.resolveSelectedModel(model.id, configuration);
    const reasoningEffort = resolveReasoningEffort(
      selectedModel,
      configuration.reasoningEffort
    );
    const tools = options.tools ?? [];
    const toolNames = tools.map(tool => tool.name);
    const allowedTools = new Set(toolNames);
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const startedAt = Date.now();

    this.lastRequest = {
      model: selectedModel.model,
      reasoningEffort,
      toolNames,
      messageCount: messages.length,
      imageCount: 0,
      startedAt
    };

    mkdirSync(this.isolatedWorkingDirectory, { recursive: true });
    this.logger.info(
      `Request started model=${selectedModel.model} reasoning=${reasoningEffort} messages=${messages.length} tools=${tools.length}`
    );
    this.logger.debug(`Copilot tools received=${toolNames.join(",") || "none"}`);

    let imageInputDirectory: string | undefined;
    try {
      const { Codex } = await loadCodexSdk();
      const runtime = resolveCodexRuntime({
        extensionRoot: this.extensionRoot,
        configuredPath: configuration.codexExecutablePath,
        mode: configuration.runtimeMode
      });
      this.logger.info(
        `Codex runtime selected source=${runtime.source} path=${runtime.executablePath}`
      );
      const codex = new Codex({
        codexPathOverride: runtime.executablePath,
        env: createSubscriptionEnvironment(),
        config: { mcp_servers: {} }
      });
      const thread = codex.startThread({
        model: selectedModel.model,
        workingDirectory: this.isolatedWorkingDirectory,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        modelReasoningEffort: reasoningEffort as ModelReasoningEffort
      });
      const bridgeRequest = buildCodexBridgeRequest(
        messages,
        tools,
        vscode.LanguageModelChatMessageRole.User,
        options.toolMode === vscode.LanguageModelChatToolMode.Required,
        configuration.maxToolCalls,
        {
          provider: "Codex Subscription",
          modelId: selectedModel.model,
          modelDisplayName: selectedModel.displayName,
          reasoningEffort,
          orchestrator: "GitHub Copilot Agent"
        }
      );
      if (
        bridgeRequest.images.length > 0 &&
        !selectedModel.inputModalities.includes("image")
      ) {
        throw new Error(`Selected Codex model "${selectedModel.model}" does not support image input.`);
      }
      const materializedImages = materializeImageInputs(
        bridgeRequest.images,
        this.isolatedWorkingDirectory,
        randomUUID()
      );
      imageInputDirectory = materializedImages.directory;
      this.lastRequest = { ...this.lastRequest, imageCount: materializedImages.paths.length };
      this.logger.info(`Codex vision input images=${materializedImages.paths.length}`);
      const codexInput: Input = materializedImages.paths.length === 0
        ? bridgeRequest.prompt
        : [
            { type: "text", text: bridgeRequest.prompt },
            ...materializedImages.paths.map(path => ({ type: "local_image" as const, path }))
          ];
      const result = await thread.run(codexInput, {
        outputSchema: buildBridgeOutputSchema(configuration.maxToolCalls),
        signal: controller.signal
      });

      assertNoCodexSideEffects(result.items);
      const response = parseBridgeResponse(
        result.finalResponse,
        allowedTools,
        configuration.maxToolCalls
      );

      if (response.kind === "text") {
        progress.report(new vscode.LanguageModelTextPart(response.text));
      } else {
        for (const call of response.toolCalls) {
          const callId = randomUUID();
          progress.report(
            new vscode.LanguageModelToolCallPart(
              callId,
              call.name,
              call.arguments
            )
          );
          this.logger.debug(`Copilot tool requested name=${call.name} callId=${callId}`);
        }
      }

      this.lastRequest = {
        ...this.lastRequest,
        durationMs: Date.now() - startedAt,
        result: response.kind
      };
      this.logger.info(
        `Request completed model=${selectedModel.model} result=${response.kind} durationMs=${Date.now() - startedAt}`
      );
    } catch (error) {
      if (token.isCancellationRequested || isAbortError(error)) {
        this.lastRequest = {
          ...this.lastRequest,
          durationMs: Date.now() - startedAt,
          result: "cancelled"
        };
        this.logger.info(`Request cancelled model=${selectedModel.model}`);
        return;
      }

      this.lastRequest = {
        ...this.lastRequest,
        durationMs: Date.now() - startedAt,
        result: "error",
        error: safeErrorMessage(error)
      };
      this.logger.error("Request failed", error);
      throw toLanguageModelError(error);
    } finally {
      cancellation.dispose();
      cleanupImageInputs(imageInputDirectory);
    }
  }

  public async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    return typeof text === "string"
      ? estimateTokens(text)
      : estimateMessageTokens(text);
  }

  public async refreshModels(): Promise<readonly CodexModelDescriptor[]> {
    const models = await this.modelCatalog.getModels(readConfiguration(), true);
    this.changeEmitter.fire();
    return models;
  }

  public getAvailableModels(): Promise<readonly CodexModelDescriptor[]> {
    return this.modelCatalog.getModels(readConfiguration());
  }

  public formatLastRequestDetails(): string {
    if (this.lastRequest === undefined) {
      return "No Codex request has been made in this VS Code session.";
    }

    const details = this.lastRequest;
    return [
      `Model: ${details.model}`,
      `Reasoning effort: ${details.reasoningEffort}`,
      `Messages: ${details.messageCount}`,
      `Images sent to Codex: ${details.imageCount}`,
      `Copilot tools received (${details.toolNames.length}): ${details.toolNames.join(", ") || "none"}`,
      `Result: ${details.result ?? "in progress"}`,
      `Duration: ${details.durationMs === undefined ? "in progress" : `${details.durationMs}ms`}`,
      ...(details.error ? [`Error: ${details.error}`] : [])
    ].join("\n");
  }

  public dispose(): void {
    this.configurationListener.dispose();
    this.changeEmitter.dispose();
  }

  private async resolveSelectedModel(
    providerModelId: string,
    configuration: ProviderConfiguration
  ): Promise<CodexModelDescriptor> {
    const requestedModel = fromProviderModelId(providerModelId);
    const availableModels = await this.modelCatalog.getModels(configuration);
    const selected = availableModels.find(model => model.model === requestedModel);
    if (selected === undefined) {
      throw new Error(
        `Selected Codex model "${requestedModel}" is no longer available or enabled. Refresh models and select another explicit model.`
      );
    }
    return selected;
  }
}

let codexSdkPromise: Promise<typeof import("@openai/codex-sdk")> | undefined;

function loadCodexSdk(): Promise<typeof import("@openai/codex-sdk")> {
  const sdkUrl = pathToFileURL(
    join(__dirname, "..", "vendor", "codex-sdk", "index.js")
  ).href;
  codexSdkPromise ??= import(sdkUrl) as Promise<typeof import("@openai/codex-sdk")>;
  return codexSdkPromise;
}

function toLanguageModelInformation(
  model: CodexModelDescriptor,
  configuration: ProviderConfiguration
): vscode.LanguageModelChatInformation {
  const efforts = model.supportedReasoningEfforts.join(", ") || "manual";
  return {
    id: toProviderModelId(model.model),
    name: `Codex Subscription · ${model.displayName}`,
    family: model.model,
    version: model.model,
    maxInputTokens: configuration.modelMaxInputTokens,
    maxOutputTokens: configuration.modelMaxOutputTokens,
    tooltip: model.description || `Explicit Codex subscription model ${model.model}`,
    detail: `Explicit model · reasoning: ${efforts} · inputs: ${model.inputModalities.join(", ")}`,
    capabilities: {
      imageInput: model.inputModalities.includes("image"),
      toolCalling: true
    }
  };
}

function resolveReasoningEffort(
  model: CodexModelDescriptor,
  configuredEffort: string
): string {
  const effort = configuredEffort === "model-default"
    ? model.defaultReasoningEffort
    : configuredEffort;

  if (
    model.supportedReasoningEfforts.length > 0 &&
    !model.supportedReasoningEfforts.includes(effort)
  ) {
    throw new Error(
      `Model "${model.model}" does not support reasoning effort "${effort}". Supported values: ${model.supportedReasoningEfforts.join(", ")}.`
    );
  }
  return effort;
}

function assertNoCodexSideEffects(items: readonly ThreadItem[]): void {
  for (const item of items) {
    if (
      item.type === "command_execution" ||
      item.type === "file_change" ||
      item.type === "mcp_tool_call" ||
      item.type === "web_search"
    ) {
      throw new Error(
        `Codex attempted forbidden side activity (${item.type}); the response was rejected.`
      );
    }
    if (item.type === "error") {
      throw new Error(`Codex reported an error: ${item.message}`);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

function toLanguageModelError(error: unknown): vscode.LanguageModelError {
  if (error instanceof vscode.LanguageModelError) {
    return error;
  }
  return new vscode.LanguageModelError(safeErrorMessage(error));
}
