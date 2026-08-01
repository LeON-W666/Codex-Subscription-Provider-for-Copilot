export const SKILL_DESCRIPTIONS_SHORTENED =
  "SKILL_DESCRIPTIONS_SHORTENED" as const;
export const UNKNOWN_RUNTIME_ERROR = "UNKNOWN_RUNTIME_ERROR" as const;

const MAX_RUNTIME_ERROR_MESSAGE_LENGTH = 8_192;
const SHORTENING_WARNING_FRAGMENTS = [
  "skill descriptions were shortened",
  "skills context budget",
  "codex can still see every skill"
] as const;

export interface CodexRuntimeItemLike {
  readonly type: string;
  readonly message?: unknown;
  readonly code?: unknown;
  readonly severity?: unknown;
}

export type DiagnosticIssueCode =
  | typeof SKILL_DESCRIPTIONS_SHORTENED
  | "UNKNOWN_ERROR";

export type CodexRuntimeIssue =
  | {
      readonly kind: "recoverable_warning";
      readonly code: typeof SKILL_DESCRIPTIONS_SHORTENED;
      readonly publicMessage: "Codex shortened skill descriptions to fit its context budget.";
    }
  | {
      readonly kind: "fatal_error";
      readonly code: typeof UNKNOWN_RUNTIME_ERROR;
      readonly publicMessage: "Codex runtime failed";
    };

export function detectRuntimeIssueForDiagnostics(
  item: CodexRuntimeItemLike
): DiagnosticIssueCode | undefined {
  if (item.type !== "error") {
    return undefined;
  }

  if (
    item.code === SKILL_DESCRIPTIONS_SHORTENED &&
    item.severity === "warning"
  ) {
    return SKILL_DESCRIPTIONS_SHORTENED;
  }

  if (
    typeof item.message !== "string" ||
    item.message.length === 0 ||
    item.message.length > MAX_RUNTIME_ERROR_MESSAGE_LENGTH
  ) {
    return "UNKNOWN_ERROR";
  }

  const normalized = item.message.replace(/\s+/gu, " ").trim().toLowerCase();
  return SHORTENING_WARNING_FRAGMENTS.every(fragment =>
    normalized.includes(fragment)
  )
    ? SKILL_DESCRIPTIONS_SHORTENED
    : "UNKNOWN_ERROR";
}

export function classifyCodexRuntimeIssue(
  item: CodexRuntimeItemLike
): CodexRuntimeIssue | undefined {
  const detected = detectRuntimeIssueForDiagnostics(item);
  if (detected === undefined) {
    return undefined;
  }
  if (detected === SKILL_DESCRIPTIONS_SHORTENED) {
    return {
      kind: "recoverable_warning",
      code: SKILL_DESCRIPTIONS_SHORTENED,
      publicMessage:
        "Codex shortened skill descriptions to fit its context budget."
    };
  }
  return {
    kind: "fatal_error",
    code: UNKNOWN_RUNTIME_ERROR,
    publicMessage: "Codex runtime failed"
  };
}

export function classifyCodexRuntimeIssues(
  items: readonly CodexRuntimeItemLike[]
): readonly CodexRuntimeIssue[] {
  return items.flatMap(item => {
    const issue = classifyCodexRuntimeIssue(item);
    return issue === undefined ? [] : [issue];
  });
}

export function createUnknownCodexRuntimeError(): Error {
  return new Error(
    `Codex runtime failed (code=${UNKNOWN_RUNTIME_ERROR}).`
  );
}
