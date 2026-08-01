import * as vscode from "vscode";
import type { RuntimeMode } from "./runtime";

export type LogLevel = "error" | "info" | "debug";
export type ModelSource = "discovered" | "manual";

export interface ProviderConfiguration {
  readonly modelSource: ModelSource;
  readonly manualModels: readonly string[];
  readonly enabledModels: readonly string[];
  readonly modelCacheTtlMinutes: number;
  readonly runtimeMode: RuntimeMode;
  readonly codexExecutablePath: string;
  readonly reasoningEffort: string;
  readonly maxToolCalls: number;
  readonly bridgeInputTokenBudget: number;
  readonly modelMaxInputTokens: number;
  readonly modelMaxOutputTokens: number;
  readonly logLevel: LogLevel;
}

const CONFIGURATION_SECTION = "copilotCodexProvider";

export function readConfiguration(): ProviderConfiguration {
  const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

  return {
    modelSource: configuration.get<ModelSource>("modelSource", "discovered"),
    manualModels: readStringArray(configuration, "manualModels"),
    enabledModels: readStringArray(configuration, "enabledModels"),
    modelCacheTtlMinutes: clamp(
      Math.trunc(configuration.get<number>("modelCacheTtlMinutes", 10)),
      1,
      1440
    ),
    runtimeMode: configuration.get<RuntimeMode>("runtimeMode", "auto"),
    codexExecutablePath: configuration
      .get<string>("codexExecutablePath", "")
      .trim(),
    reasoningEffort: configuration
      .get<string>("reasoningEffort", "model-default")
      .trim(),
    maxToolCalls: clamp(
      Math.trunc(configuration.get<number>("maxToolCalls", 4)),
      1,
      16
    ),
    bridgeInputTokenBudget: clamp(
      Math.trunc(configuration.get<number>("bridgeInputTokenBudget", 45000)),
      16000,
      200000
    ),
    modelMaxInputTokens: Math.max(
      1024,
      Math.trunc(configuration.get<number>("modelMaxInputTokens", 200000))
    ),
    modelMaxOutputTokens: Math.max(
      1024,
      Math.trunc(configuration.get<number>("modelMaxOutputTokens", 32768))
    ),
    logLevel: configuration.get<LogLevel>("logLevel", "info")
  };
}

export function affectsProviderConfiguration(
  event: vscode.ConfigurationChangeEvent
): boolean {
  return event.affectsConfiguration(CONFIGURATION_SECTION);
}

function readStringArray(
  configuration: vscode.WorkspaceConfiguration,
  key: string
): readonly string[] {
  const values = configuration.get<unknown>(key, []);
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(value => value.length > 0);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
