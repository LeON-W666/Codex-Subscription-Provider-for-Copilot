import { describe, expect, it } from "vitest";
import {
  inspectCodexResultItems,
  validateCodexResult
} from "../src/codexResultValidator";
import {
  ForbiddenRuntimeActivityError
} from "../src/runtimeStreamCollector";

const warningMessage =
  "Skill descriptions were shortened for the skills context budget. Codex can still see every skill.";

describe("Codex result validation", () => {
  it.each([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "web_search"
  ])("rejects forbidden side effect %s", type => {
    expect(() => inspectCodexResultItems([{ type }])).toThrow(
      `forbidden side activity (${type})`
    );
    expect(() => inspectCodexResultItems([{ type }])).toThrow(
      ForbiddenRuntimeActivityError
    );
  });

  it("accepts a known warning only with a valid text response", () => {
    const result = {
      items: [{ type: "error", message: warningMessage }],
      finalResponse: JSON.stringify({
        kind: "text",
        text: "hello",
        toolCalls: []
      })
    };
    const issues = inspectCodexResultItems(result.items);

    expect(validateCodexResult(result, issues, new Set(), 4)).toEqual({
      kind: "text",
      text: "hello"
    });
  });

  it("rejects a known warning with an empty response", () => {
    const result = {
      items: [{ type: "error", message: warningMessage }],
      finalResponse: ""
    };
    const issues = inspectCodexResultItems(result.items);

    expect(() => validateCodexResult(result, issues, new Set(), 4)).toThrow(
      "Codex returned no final response."
    );
  });

  it("rejects a known warning with an invalid response", () => {
    const result = {
      items: [{ type: "error", message: warningMessage }],
      finalResponse: "{"
    };
    const issues = inspectCodexResultItems(result.items);

    expect(() => validateCodexResult(result, issues, new Set(), 4)).toThrow(
      "Codex returned invalid structured JSON."
    );
  });

  it("keeps mixed known and unknown errors fatal and hides raw messages", () => {
    const secret = "C:\\Users\\private\\skill.md";
    const result = {
      items: [
        { type: "error", message: warningMessage },
        { type: "error", message: secret }
      ],
      finalResponse: JSON.stringify({
        kind: "text",
        text: "hello",
        toolCalls: []
      })
    };
    const issues = inspectCodexResultItems(result.items);

    expect(() => validateCodexResult(result, issues, new Set(), 4)).toThrow(
      "Codex runtime failed (code=UNKNOWN_RUNTIME_ERROR)."
    );
    try {
      validateCodexResult(result, issues, new Set(), 4);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("still enforces Copilot tool authorization", () => {
    const result = {
      items: [{ type: "error", message: warningMessage }],
      finalResponse: JSON.stringify({
        kind: "tool_calls",
        text: null,
        toolCalls: [{ name: "write", arguments: "{}" }]
      })
    };
    const issues = inspectCodexResultItems(result.items);

    expect(() => validateCodexResult(result, issues, new Set(["read"]), 4))
      .toThrow('Copilot did not provide it');
  });
});
