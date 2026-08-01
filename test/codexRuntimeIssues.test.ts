import { describe, expect, it } from "vitest";
import {
  SKILL_DESCRIPTIONS_SHORTENED,
  UNKNOWN_RUNTIME_ERROR,
  classifyCodexRuntimeIssue,
  detectRuntimeIssueForDiagnostics
} from "../src/codexRuntimeIssues";

const warningMessage = [
  "Skill descriptions were shortened to fit the 2% skills context budget.",
  "Codex can still see every skill, but some descriptions are shorter."
].join("\n");

describe("detectRuntimeIssueForDiagnostics", () => {
  it("recognizes the exact description-shortening warning without relying on 2%", () => {
    const detected = detectRuntimeIssueForDiagnostics({
      type: "error",
      message: warningMessage.replace("2%", "configured")
    });

    expect(detected).toBe(SKILL_DESCRIPTIONS_SHORTENED);
  });

  it("normalizes case and whitespace", () => {
    expect(detectRuntimeIssueForDiagnostics({
      type: "error",
      message:
        "SKILL DESCRIPTIONS WERE SHORTENED\n skills context budget\tCODEX CAN STILL SEE EVERY SKILL"
    })).toBe(SKILL_DESCRIPTIONS_SHORTENED);
  });

  it.each([
    "Skill descriptions were shortened. Codex can still see every skill.",
    "Skill descriptions were shortened because of the skills context budget.",
    "The skills context budget changed. Codex can still see every skill."
  ])("keeps partial matches fatal: %s", message => {
    expect(detectRuntimeIssueForDiagnostics({ type: "error", message }))
      .toBe("UNKNOWN_ERROR");
  });

  it("keeps overlong messages fatal", () => {
    expect(detectRuntimeIssueForDiagnostics({
      type: "error",
      message: `${warningMessage}${"x".repeat(8_192)}`
    })).toBe("UNKNOWN_ERROR");
  });

  it("prefers an exact structured warning when available", () => {
    expect(detectRuntimeIssueForDiagnostics({
      type: "error",
      code: SKILL_DESCRIPTIONS_SHORTENED,
      severity: "warning"
    })).toBe(SKILL_DESCRIPTIONS_SHORTENED);
  });
});

describe("classifyCodexRuntimeIssue", () => {
  it("classifies only the known warning as recoverable", () => {
    expect(classifyCodexRuntimeIssue({
      type: "error",
      message: warningMessage
    })).toMatchObject({
      kind: "recoverable_warning",
      code: SKILL_DESCRIPTIONS_SHORTENED
    });
  });

  it("sanitizes unknown runtime errors", () => {
    const secret = "C:\\Users\\private\\skills\\secret.md";
    const issue = classifyCodexRuntimeIssue({
      type: "error",
      message: secret
    });

    expect(issue).toEqual({
      kind: "fatal_error",
      code: UNKNOWN_RUNTIME_ERROR,
      publicMessage: "Codex runtime failed"
    });
    expect(JSON.stringify(issue)).not.toContain(secret);
  });
});
