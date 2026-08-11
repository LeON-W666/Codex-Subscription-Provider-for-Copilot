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
import {
  ForbiddenRuntimeActivityError,
  isForbiddenRuntimeActivityType
} from "./runtimeStreamCollector";

export interface CodexValidationResultLike {
  readonly items: readonly CodexRuntimeItemLike[];
  readonly finalResponse: string;
}

export function assertNoForbiddenSideEffects(
  items: readonly CodexRuntimeItemLike[]
): void {
  const forbidden = items.find(item =>
    isForbiddenRuntimeActivityType(item.type)
  );
  if (
    forbidden !== undefined &&
    isForbiddenRuntimeActivityType(forbidden.type)
  ) {
    throw new ForbiddenRuntimeActivityError(forbidden.type);
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
