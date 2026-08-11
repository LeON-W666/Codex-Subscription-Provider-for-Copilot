import { describe, expect, it } from "vitest";
import {
  buildToolActivationRecoveryPrompt,
  planToolActivationRecovery,
  selectToolActivationResponse
} from "../src/toolActivationRecovery";
import type { ToolActivationRetryDecision } from "../src/toolCapabilities";

const decision: ToolActivationRetryDecision = {
  shouldRetry: true,
  actionRequest: true,
  responseClaimsUnavailable: true,
  requestedCategories: ["object-management/activate"],
  directTools: [],
  activators: ["activate_object_management_tools"]
};

describe("tool activation recovery planning", () => {
  it("builds a redacted correction prompt from categories and activator names only", () => {
    const prompt = buildToolActivationRecoveryPrompt(decision);

    expect(prompt).toContain("object-management/activate");
    expect(prompt).toContain("activate_object_management_tools");
    expect(prompt).toContain("AVAILABLE_TOOLS_JSON");
    expect(prompt).not.toContain("tool_result");
    expect(prompt).not.toContain("uri");
    expect(prompt).not.toContain("SECRET");
  });

  it("does not plan recovery for ordinary or unavailable decisions", () => {
    expect(planToolActivationRecovery({ ...decision, shouldRetry: false }, false)).toEqual({
      trigger: false,
      prompt: ""
    });
    expect(planToolActivationRecovery(decision, true)).toEqual({
      trigger: false,
      prompt: ""
    });
  });

  it("plans at most one correction and retains a tool-call decision", () => {
    const plan = planToolActivationRecovery(decision, false);
    expect(plan.trigger).toBe(true);
    expect(plan.prompt).toContain("kind=tool_calls");
    expect(planToolActivationRecovery(decision, true).trigger).toBe(false);
  });

  it("forwards a validated second tool-call response instead of the first text", () => {
    const final = selectToolActivationResponse(
      { kind: "text", text: "No tool is available." },
      {
        kind: "tool_calls",
        toolCalls: [
          {
            name: "activate_object_management_tools",
            arguments: {}
          }
        ]
      }
    );
    expect(final.kind).toBe("tool_calls");
    expect(final).toEqual({
      kind: "tool_calls",
      toolCalls: [
        {
          name: "activate_object_management_tools",
          arguments: {}
        }
      ]
    });
  });
});
