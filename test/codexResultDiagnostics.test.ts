import { describe, expect, it, vi } from "vitest";
import {
  collectCodexResultDiagnostics,
  formatCodexResultDiagnostics
} from "../src/codexResultDiagnostics";

const warningMessage =
  "Skill descriptions were shortened for the skills context budget. Codex can still see every skill.";

describe("collectCodexResultDiagnostics", () => {
  it("records safe evidence for a warning and valid final response", () => {
    const observer = vi.fn();
    const diagnostics = collectCodexResultDiagnostics({
      items: [
        { type: "error", message: warningMessage },
        { type: "agent_message" }
      ],
      finalResponse: "{\"kind\":\"text\"}"
    }, observer);

    expect(observer).toHaveBeenCalledOnce();
    expect(diagnostics).toMatchObject({
      itemTypes: ["error", "agent_message"],
      errorItemCount: 1,
      fatalErrorCount: 0,
      recognizedIssueCodes: ["SKILL_DESCRIPTIONS_SHORTENED"],
      hasSkillDescriptionShorteningWarning: true,
      hasUnknownError: false,
      hasFinalResponse: true,
      finalResponseValidation: "valid",
      resultItemCount: 2,
      turnStatus: "unavailable",
      turnCompleted: "unknown"
    });
  });

  it("observes invalid responses without throwing or retaining their content", () => {
    const secretResponse = "private response contents";
    const diagnostics = collectCodexResultDiagnostics({
      items: [{ type: "error", message: "private runtime path" }],
      finalResponse: secretResponse
    }, () => {
      throw new Error("invalid");
    });
    const formatted = formatCodexResultDiagnostics(diagnostics);

    expect(diagnostics.finalResponseValidation).toBe("invalid");
    expect(diagnostics.fatalErrorCount).toBe(1);
    expect(formatted).not.toContain(secretResponse);
    expect(formatted).not.toContain("private runtime path");
  });

  it("does not attempt validation for an empty final response", () => {
    const observer = vi.fn();
    const diagnostics = collectCodexResultDiagnostics({
      items: [],
      finalResponse: "  "
    }, observer);

    expect(observer).not.toHaveBeenCalled();
    expect(diagnostics.finalResponseValidation).toBe("not_attempted");
  });

  it("sanitizes unknown item type strings", () => {
    const diagnostics = collectCodexResultDiagnostics({
      items: [{ type: "C:\\private\\item" }],
      finalResponse: ""
    }, () => undefined);

    expect(diagnostics.itemTypes).toEqual(["unknown"]);
  });
});
