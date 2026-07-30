import * as vscode from "vscode";
import type { LogLevel } from "./config";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2
};

export class ProviderLogger implements vscode.Disposable {
  private readonly output: vscode.LogOutputChannel;
  private level: LogLevel;

  public constructor(level: LogLevel) {
    this.level = level;
    this.output = vscode.window.createOutputChannel("Codex Model Provider", {
      log: true
    });
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public error(message: string, error?: unknown): void {
    const suffix = error === undefined ? "" : `: ${safeErrorMessage(error)}`;
    this.output.error(`${message}${suffix}`);
  }

  public info(message: string): void {
    if (LEVELS[this.level] >= LEVELS.info) {
      this.output.info(message);
    }
  }

  public debug(message: string): void {
    if (LEVELS[this.level] >= LEVELS.debug) {
      this.output.debug(message);
    }
  }

  public show(): void {
    this.output.show(true);
  }

  public dispose(): void {
    this.output.dispose();
  }
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
