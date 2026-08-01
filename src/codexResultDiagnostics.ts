import {
  SKILL_DESCRIPTIONS_SHORTENED,
  detectRuntimeIssueForDiagnostics,
  type CodexRuntimeItemLike
} from "./codexRuntimeIssues";

const KNOWN_ITEM_TYPES = new Set([
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "todo_list",
  "error"
]);

export type FinalResponseValidation =
  | "not_attempted"
  | "valid"
  | "invalid";

export type ObservedTurnStatus =
  | "completed"
  | "failed"
  | "interrupted"
  | "in_progress"
  | "unavailable"
  | "unknown";

export interface CodexResultLike {
  readonly items: readonly CodexRuntimeItemLike[];
  readonly finalResponse: string;
}

export interface CodexResultDiagnostics {
  readonly itemTypes: readonly string[];
  readonly errorItemCount: number;
  readonly fatalErrorCount: number;
  readonly recognizedIssueCodes: readonly string[];
  readonly hasSkillDescriptionShorteningWarning: boolean;
  readonly hasUnknownError: boolean;
  readonly hasFinalResponse: boolean;
  readonly finalResponseLength: number;
  readonly finalResponseValidation: FinalResponseValidation;
  readonly resultItemCount: number;
  readonly turnStatus: ObservedTurnStatus;
  readonly turnCompleted: true | false | "unknown";
}

export function collectCodexResultDiagnostics(
  result: CodexResultLike,
  observeFinalResponse: (response: string) => void
): CodexResultDiagnostics {
  const issueCodes = result.items
    .map(detectRuntimeIssueForDiagnostics)
    .filter((code): code is NonNullable<typeof code> => code !== undefined);
  const recognizedIssueCodes = [
    ...new Set(
      issueCodes.filter(code => code !== "UNKNOWN_ERROR")
    )
  ];
  const errorItemCount = issueCodes.length;
  const fatalErrorCount = issueCodes.filter(code => code === "UNKNOWN_ERROR").length;
  const hasFinalResponse = result.finalResponse.trim().length > 0;
  let finalResponseValidation: FinalResponseValidation = "not_attempted";

  if (hasFinalResponse) {
    try {
      observeFinalResponse(result.finalResponse);
      finalResponseValidation = "valid";
    } catch {
      finalResponseValidation = "invalid";
    }
  }

  return {
    itemTypes: result.items.map(item =>
      KNOWN_ITEM_TYPES.has(item.type) ? item.type : "unknown"
    ),
    errorItemCount,
    fatalErrorCount,
    recognizedIssueCodes,
    hasSkillDescriptionShorteningWarning: issueCodes.includes(
      SKILL_DESCRIPTIONS_SHORTENED
    ),
    hasUnknownError: issueCodes.includes("UNKNOWN_ERROR"),
    hasFinalResponse,
    finalResponseLength: result.finalResponse.length,
    finalResponseValidation,
    resultItemCount: result.items.length,
    turnStatus: "unavailable",
    turnCompleted: "unknown"
  };
}

export function formatCodexResultDiagnostics(
  diagnostics: CodexResultDiagnostics
): string {
  return `Codex result diagnostics=${JSON.stringify(diagnostics)}`;
}
