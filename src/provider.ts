import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Input, ModelReasoningEffort } from "@openai/codex-sdk";
import * as vscode from "vscode";
import {
  collectCodexResultDiagnostics,
  formatCodexResultDiagnostics
} from "./codexResultDiagnostics";
import { createUnknownCodexRuntimeError } from "./codexRuntimeIssues";
import {
  inspectCodexResultItems,
  validateCodexResult
} from "./codexResultValidator";
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
  readonly estimatedInputTokens?: number;
  readonly originalConversationTokens?: number;
  readonly retainedConversationTokens?: number;
  readonly omittedMessageCount?: number;
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
        },
        configuration.bridgeInputTokenBudget
      );
      const compaction = bridgeRequest.conversationCompaction;
      this.lastRequest = {
        ...this.lastRequest,
        estimatedInputTokens: bridgeRequest.estimatedInputTokens,
        originalConversationTokens: compaction.originalTokenEstimate,
        retainedConversationTokens: compaction.retainedTokenEstimate,
        omittedMessageCount: compaction.omittedMessageCount
      };
      this.logger.info(
        `Bridge input estimatedTokens=${bridgeRequest.estimatedInputTokens} ` +
        `budget=${configuration.bridgeInputTokenBudget} ` +
        `conversationTokens=${compaction.originalTokenEstimate}->${compaction.retainedTokenEstimate} ` +
        `omittedMessages=${compaction.omittedMessageCount}`
      );
      if (bridgeRequest.estimatedInputTokens > configuration.bridgeInputTokenBudget) {
        this.logger.warn(
          `Bridge input exceeds budget because required current context or tool schemas cannot be safely omitted ` +
          `estimatedTokens=${bridgeRequest.estimatedInputTokens}`
        );
      }
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
      const result = await (async () => {
        try {
          return await thread.run(codexInput, {
            outputSchema: buildBridgeOutputSchema(configuration.maxToolCalls),
            signal: controller.signal
          });
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            throw error;
          }
          throw createUnknownCodexRuntimeError();
        }
      })();

      const diagnostics = collectCodexResultDiagnostics(result, responseJson => {
        parseBridgeResponse(
          responseJson,
          allowedTools,
          configuration.maxToolCalls
        );
      });
      this.logger.debug(formatCodexResultDiagnostics(diagnostics));

      const issues = inspectCodexResultItems(result.items);
      for (const issue of issues) {
        if (issue.kind === "recoverable_warning") {
          this.logger.warn(`Codex runtime warning code=${issue.code}`);
        }
      }
      const response = validateCodexResult(
        result,
        issues,
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
      `Estimated bridge input: ${details.estimatedInputTokens === undefined ? "not built" : `${details.estimatedInputTokens} tokens`}`,
      `Conversation compaction: ${
        details.originalConversationTokens === undefined ||
        details.retainedConversationTokens === undefined
          ? "not built"
          : `${details.originalConversationTokens} -> ${details.retainedConversationTokens} tokens, ` +
            `${details.omittedMessageCount ?? 0} messages omitted`
      }`,
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
