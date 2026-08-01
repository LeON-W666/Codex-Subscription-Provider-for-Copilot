import { describe, expect, it } from "vitest";
import { compactConversation } from "../src/conversationCompactor";

interface TestMessage {
  readonly role: number;
  readonly content: readonly unknown[];
  readonly tokens: number;
  readonly label: string;
}

const estimate = (message: TestMessage): number => message.tokens;

describe("compactConversation", () => {
  it("returns the original conversation when it fits", () => {
    const messages = [
      message("request", 1, 10, [{ value: "Do the work" }]),
      message("answer", 2, 10, [{ value: "Done" }])
    ];

    const result = compactConversation(messages, 1, 30, estimate);

    expect(result.applied).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("keeps the latest user instruction and newest evidence", () => {
    const messages = [
      message("old", 1, 30, [{ value: "Old request" }]),
      message("current", 1, 30, [{ value: "Current request" }]),
      message("latest", 2, 30, [{ value: "Latest response" }])
    ];

    const result = compactConversation(messages, 1, 60, estimate);

    expect(result.messages.map(item => item.label)).toEqual(["current", "latest"]);
    expect(result.omittedMessageCount).toBe(1);
  });

  it("keeps a tool call and matching result as one atomic group", () => {
    const messages = [
      message("request", 1, 10, [{ value: "Edit it" }]),
      message("old-noise", 2, 80, [{ value: "Old reasoning" }]),
      message("call", 2, 15, [{
        callId: "call-1",
        name: "apply_patch",
        input: { patch: "..." }
      }]),
      message("result", 1, 15, [{
        callId: "call-1",
        content: [{ value: "Success" }]
      }])
    ];

    const result = compactConversation(messages, 1, 40, estimate);

    expect(result.messages.map(item => item.label)).toEqual([
      "request",
      "call",
      "result"
    ]);
  });

  it("reports an unavoidable overrun when forced evidence exceeds the budget", () => {
    const messages = [
      message("request", 1, 30, [{ value: "Edit it" }]),
      message("result", 2, 30, [{ value: "Newest" }])
    ];

    const result = compactConversation(messages, 1, 20, estimate);

    expect(result.messages).toHaveLength(2);
    expect(result.overBudget).toBe(true);
  });
});

function message(
  label: string,
  role: number,
  tokens: number,
  content: readonly unknown[]
): TestMessage {
  return { label, role, tokens, content };
}
