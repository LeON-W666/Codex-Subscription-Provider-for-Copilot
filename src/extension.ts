import { join } from "node:path";
import * as vscode from "vscode";
import { readConfiguration } from "./config";
import { ProviderLogger } from "./logger";
import { CodexLanguageModelProvider } from "./provider";
import { formatRuntimeSource, resolveCodexRuntime } from "./runtime";
import { assertChatGptSubscriptionAuth } from "./subscriptionAuth";

const PROVIDER_ID = "openai-codex-subscription";
const COMMAND_MANAGE = "copilotCodexProvider.manage";
const COMMAND_REFRESH_MODELS = "copilotCodexProvider.refreshModels";
const COMMAND_SHOW_MODELS = "copilotCodexProvider.showAvailableModels";
const COMMAND_SHOW_LAST_REQUEST = "copilotCodexProvider.showLastRequestDetails";
const COMMAND_SHOW_RUNTIME = "copilotCodexProvider.showRuntimeStatus";

export function activate(context: vscode.ExtensionContext): void {
  const logger = new ProviderLogger(readConfiguration().logLevel);
  const provider = new CodexLanguageModelProvider(
    context.extensionUri.fsPath,
    join(context.globalStorageUri.fsPath, "isolated-codex-workspace"),
    logger
  );

  const refreshModels = async (): Promise<void> => {
    try {
      const models = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Refreshing Codex subscription models"
        },
        () => provider.refreshModels()
      );
      void vscode.window.showInformationMessage(
        `Codex model catalog refreshed: ${models.length} explicit models available.`
      );
    } catch (error) {
      showError(error);
    }
  };

  const showAvailableModels = async (): Promise<void> => {
    try {
      const models = await provider.getAvailableModels();
      await vscode.window.showQuickPick(
        models.map(model => ({
          label: model.displayName,
          description: model.model,
          detail: `Reasoning: ${model.supportedReasoningEfforts.join(", ") || "manual configuration"} · Inputs: ${model.inputModalities.join(", ")}`
        })),
        {
          title: "Available Codex Subscription Models",
          placeHolder: "Select the actual model from the Copilot Chat model picker"
        }
      );
    } catch (error) {
      showError(error);
    }
  };

  const showLastRequestDetails = (): void => {
    const details = provider.formatLastRequestDetails();
    logger.info(`Last request diagnostics\n${details}`);
    logger.show();
  };

  const showRuntimeStatus = (): void => {
    try {
      const configuration = readConfiguration();
      const runtime = resolveCodexRuntime({
        extensionRoot: context.extensionUri.fsPath,
        configuredPath: configuration.codexExecutablePath,
        mode: configuration.runtimeMode
      });
      const details = [
        `Mode: ${configuration.runtimeMode}`,
        `Source: ${formatRuntimeSource(runtime.source)}`,
        `Executable: ${runtime.executablePath}`
      ].join("\n");
      logger.info(`Codex runtime diagnostics\n${details}`);
      void vscode.window.showInformationMessage(
        `Codex runtime ready: ${formatRuntimeSource(runtime.source)}.`
      );
    } catch (error) {
      logger.error("Codex runtime diagnostics failed", error);
      showError(error);
    }
  };

  context.subscriptions.push(
    logger,
    provider,
    vscode.lm.registerLanguageModelChatProvider(PROVIDER_ID, provider),
    vscode.commands.registerCommand(COMMAND_REFRESH_MODELS, refreshModels),
    vscode.commands.registerCommand(COMMAND_SHOW_MODELS, showAvailableModels),
    vscode.commands.registerCommand(COMMAND_SHOW_LAST_REQUEST, showLastRequestDetails),
    vscode.commands.registerCommand(COMMAND_SHOW_RUNTIME, showRuntimeStatus),
    vscode.commands.registerCommand(COMMAND_MANAGE, async () => {
      const selection = await vscode.window.showQuickPick(
        [
          { label: "$(pass) Check ChatGPT Subscription Login", action: "check" },
          { label: "$(terminal) Check Codex Runtime", action: "runtime" },
          { label: "$(refresh) Refresh Explicit Models", action: "refresh" },
          { label: "$(list-flat) Show Available Models", action: "models" },
          { label: "$(inspect) Show Last Request Details", action: "request" },
          { label: "$(settings-gear) Open Settings", action: "settings" },
          { label: "$(output) Show Logs", action: "logs" }
        ],
        {
          title: "Manage Codex Subscription Provider",
          placeHolder: "Choose an action"
        }
      );

      if (selection?.action === "check") {
        try {
          const auth = assertChatGptSubscriptionAuth();
          void vscode.window.showInformationMessage(
            `Codex ChatGPT subscription login is ready (${auth.authPath}).`
          );
        } catch (error) {
          showError(error);
        }
      } else if (selection?.action === "runtime") {
        showRuntimeStatus();
      } else if (selection?.action === "refresh") {
        await refreshModels();
      } else if (selection?.action === "models") {
        await showAvailableModels();
      } else if (selection?.action === "request") {
        showLastRequestDetails();
      } else if (selection?.action === "settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `@ext:${context.extension.id}`
        );
      } else if (selection?.action === "logs") {
        logger.show();
      }
    })
  );

  logger.info("Codex Subscription Provider 0.6.3 Tool Activation Recovery activated.");
}

export function deactivate(): void {
  // VS Code disposes registered resources through ExtensionContext.
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(
    error instanceof Error ? error.message : String(error)
  );
}
