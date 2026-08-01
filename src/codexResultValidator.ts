import {
  classifyCodexRuntimeIssues,
  createUnknownCodexRuntimeError,
  type CodexRuntimeIssue,
  type CodexRuntimeItemLike
} from "./codexRuntimeIssues";
import {
  parseBridgeResponse,
  type BridgeResponse
} from "./protocol";

const FORBIDDEN_SIDE_EFFECT_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search"
]);

export interface CodexValidationResultLike {
  readonly items: readonly CodexRuntimeItemLike[];
  readonly finalResponse: string;
}

export function assertNoForbiddenSideEffects(
  items: readonly CodexRuntimeItemLike[]
): void {
  const forbidden = items.find(item =>
    FORBIDDEN_SIDE_EFFECT_TYPES.has(item.type)
  );
  if (forbidden !== undefined) {
    throw new Error(
      `Codex attempted forbidden side activity (${forbidden.type}); the response was rejected.`
    );
  }
}

export function inspectCodexResultItems(
  items: readonly CodexRuntimeItemLike[]
): readonly CodexRuntimeIssue[] {
  assertNoForbiddenSideEffects(items);
  return classifyCodexRuntimeIssues(items);
}

export function validateCodexResult(
  result: CodexValidationResultLike,
  issues: readonly CodexRuntimeIssue[],
  allowedTools: ReadonlySet<string>,
  maxToolCalls: number
): BridgeResponse {
  const fatalIssue = issues.find(issue => issue.kind === "fatal_error");
  if (fatalIssue !== undefined) {
    throw createUnknownCodexRuntimeError();
  }
  if (result.finalResponse.trim().length === 0) {
    throw new Error("Codex returned no final response.");
  }
  return parseBridgeResponse(result.finalResponse, allowedTools, maxToolCalls);
}
