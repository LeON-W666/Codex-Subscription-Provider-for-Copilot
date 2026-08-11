import { describe, expect, it } from "vitest";
import {
  buildBridgeOutputSchema,
  buildCodexBridgeRequest,
  buildCodexPrompt,
  estimateMessageTokens,
  estimateTokens,
  parseBridgeResponse
} from "../src/protocol";

const runtimeIdentity = {
  provider: "Codex Subscription",
  modelId: "gpt-5.6-sol",
  modelDisplayName: "GPT-5.6-Sol",
  reasoningEffort: "high",
  orchestrator: "GitHub Copilot Agent"
};

describe("buildBridgeOutputSchema", () => {
  it("limits the number of structured tool calls", () => {
    const schema = buildBridgeOutputSchema(3) as any;
    expect(schema.properties.toolCalls.maxItems).toBe(3);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("buildCodexPrompt", () => {
  it("serializes Copilot tools and prior tool results", () => {
    const prompt = buildCodexPrompt(
      [
        {
          role: 1,
          content: [{ value: "Read the ABAP program." }]
        },
        {
          role: 2,
          content: [
            {
              callId: "call-1",
              name: "read_virtual_file",
              input: { uri: "abapfs:/ZTEST" }
            }
          ]
        },
        {
          role: 1,
          content: [
            {
              callId: "call-1",
              content: [{ value: "REPORT ztest." }]
            }
          ]
        }
      ],
      [
        {
          name: "read_virtual_file",
          description: "Read a virtual file",
          inputSchema: {
            type: "object",
            properties: { uri: { type: "string" } },
            required: ["uri"]
          }
        }
      ],
      1,
      false,
      4,
      runtimeIdentity
    );

    expect(prompt).toContain("Copilot owns all tool execution");
    expect(prompt).toContain("Never identify your underlying model as GitHub Copilot");
    expect(prompt).toContain('"modelId":"gpt-5.6-sol"');
    expect(prompt).toContain('"reasoningEffort":"high"');
    expect(prompt).toContain("must be grounded in a matching tool_result");
    expect(prompt).toContain("A prior tool_call without a matching tool_result is not evidence");
    expect(prompt).toContain("read_virtual_file");
    expect(prompt).toContain("abapfs:/ZTEST");
    expect(prompt).toContain("REPORT ztest.");
  });

  it("requires text when no tools are supplied", () => {
    const prompt = buildCodexPrompt([], [], 1, false, 4, runtimeIdentity);
    expect(prompt).toContain("No tools are available. Return kind=text.");
  });

  it("explains a Copilot-supplied virtual URI edit chain without adding tools", () => {
    const prompt = buildCodexPrompt(
      [{ role: 1, content: [{ value: "Update the virtual object." }] }],
      [
        {
          name: "get_object_workspace_uri",
          description: "Returns a virtual workspace URI usable with standard file operations."
        },
        {
          name: "apply_patch",
          description: "Apply a patch to a file.",
          inputSchema: {
            type: "object",
            properties: { patch: { type: "string" } },
            required: ["patch"]
          }
        }
      ],
      1,
      false,
      4,
      runtimeIdentity
    );

    expect(prompt).toContain("CAPABILITY_LINKS_JSON");
    expect(prompt).toContain('"resolver":"get_object_workspace_uri"');
    expect(prompt).toContain('"editor":"apply_patch"');
    expect(prompt).toContain("adt://");
    expect(prompt).toContain("Copilot remains responsible");
    expect(prompt).not.toContain('"name":"abap_activate"');
  });

  it("describes direct, loadable, and absent capability states without inventing tools", () => {
    const prompt = buildCodexPrompt(
      [{ role: 1, content: [{ value: "Activate the object." }] }],
      [
        {
          name: "activate_object_management_tools",
          description: "Activate the object management tool group."
        },
        {
          name: "create_object",
          description: "Create an object."
        }
      ],
      1,
      false,
      4,
      runtimeIdentity
    );

    expect(prompt).toContain('"category":"edit/create"');
    expect(prompt).toContain('"directTools":["create_object"]');
    expect(prompt).toContain('"category":"object-management/activate"');
    expect(prompt).toContain('"activators":["activate_object_management_tools"]');
    expect(prompt).toContain("request a matching tool-group activator first");
    expect(prompt).toContain("tool-group activation only loads tools and does not activate");
    expect(prompt).toContain("Only a tool listed in activations followed by its matching successful tool_result");
    expect(prompt).toContain("even when that capability group has create/manage directTools");
    expect(prompt).toContain("no direct tool or matching activator is supplied");
    expect(prompt).not.toContain('"name":"abap_activate"');
  });

  it("omits old messages as budgeted groups while retaining current instructions", () => {
    const oldMarker = `OLD_MARKER_${"x".repeat(20_000)}`;
    const request = buildCodexBridgeRequest(
      [
        { role: 1, content: [{ value: oldMarker }] },
        { role: 1, content: [{ value: "CURRENT_REQUEST" }] },
        { role: 2, content: [{ value: "LATEST_EVIDENCE" }] }
      ],
      [],
      1,
      false,
      4,
      runtimeIdentity,
      5_000
    );

    expect(request.conversationCompaction.applied).toBe(true);
    expect(request.conversationCompaction.omittedMessageCount).toBe(1);
    expect(request.prompt).toContain("CURRENT_REQUEST");
    expect(request.prompt).toContain("LATEST_EVIDENCE");
    expect(request.prompt).not.toContain("OLD_MARKER");
  });

  it("keeps a large synthetic bridge close to the configured total budget", () => {
    const tools = Array.from({ length: 94 }, (_, index) => ({
      name: `read_resource_${index}`,
      description: `Read resource ${index}. ${"description ".repeat(30)}`,
      inputSchema: {
        type: "object",
        properties: { uri: { type: "string" } },
        required: ["uri"]
      }
    }));
    const messages = [
      { role: 1, content: [{ value: "CURRENT_LARGE_REQUEST" }] },
      ...Array.from({ length: 20 }, (_, index) => ({
        role: 2,
        content: [{ value: `history-${index}-${"x".repeat(10_000)}` }]
      }))
    ];

    const request = buildCodexBridgeRequest(
      messages,
      tools,
      1,
      false,
      4,
      runtimeIdentity,
      45_000
    );

    expect(request.conversationCompaction.applied).toBe(true);
    expect(request.estimatedInputTokens).toBeLessThanOrEqual(46_000);
    expect(request.prompt).toContain("CURRENT_LARGE_REQUEST");
  });

  it("extracts image data for the Codex vision channel", () => {
    const image = new Uint8Array([137, 80, 78, 71]);
    const request = buildCodexBridgeRequest(
      [{ role: 1, content: [{ value: "What is shown?" }, { mimeType: "image/png", data: image }] }],
      [],
      1,
      false,
      4,
      runtimeIdentity
    );
    expect(request.images).toEqual([{ mimeType: "image/png", data: image }]);
    expect(request.prompt).toContain('"type":"image"');
    expect(request.prompt).toContain('"imageIndex":1');
    expect(request.prompt).not.toContain("iVBOR");
    expect(request.prompt).toContain("Analyze attached images directly");
  });
});

describe("parseBridgeResponse", () => {
  it("accepts a text response", () => {
    expect(
      parseBridgeResponse(
        JSON.stringify({ kind: "text", text: "Ready", toolCalls: [] }),
        new Set(),
        4
      )
    ).toEqual({ kind: "text", text: "Ready" });
  });

  it("accepts tool calls supplied by Copilot", () => {
    expect(
      parseBridgeResponse(
        JSON.stringify({
          kind: "tool_calls",
          text: null,
          toolCalls: [
            {
              name: "abapfs_edit",
              arguments: "{\"uri\":\"abapfs:/ZTEST\"}"
            }
          ]
        }),
        new Set(["abapfs_edit"]),
        4
      )
    ).toEqual({
      kind: "tool_calls",
      toolCalls: [
        { name: "abapfs_edit", arguments: { uri: "abapfs:/ZTEST" } }
      ]
    });
  });

  it("rejects unknown tools and malformed arguments", () => {
    const unknown = JSON.stringify({
      kind: "tool_calls",
      text: null,
      toolCalls: [{ name: "shell", arguments: "{}" }]
    });
    const malformed = JSON.stringify({
      kind: "tool_calls",
      text: null,
      toolCalls: [{ name: "read", arguments: "[1]" }]
    });

    expect(() => parseBridgeResponse(unknown, new Set(["read"]), 4)).toThrow(
      "did not provide"
    );
    expect(() => parseBridgeResponse(malformed, new Set(["read"]), 4)).toThrow(
      "non-object arguments"
    );
  });

  it("rejects invalid structured JSON and excess calls", () => {
    expect(() => parseBridgeResponse("{", new Set(), 4)).toThrow(
      "invalid structured JSON"
    );

    const response = JSON.stringify({
      kind: "tool_calls",
      text: null,
      toolCalls: [
        { name: "read", arguments: "{}" },
        { name: "read", arguments: "{}" }
      ]
    });
    expect(() => parseBridgeResponse(response, new Set(["read"]), 1)).toThrow(
      "expected between 1 and 1"
    );
  });
});

describe("estimateTokens", () => {
  it("handles ASCII and CJK text without returning zero", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("SAP\u5f00\u53d1")).toBe(3);
    expect(estimateTokens("")).toBe(1);
  });
});
describe("image reliability", () => {
  it("deduplicates repeated image bytes while preserving references", () => {
    const image = new Uint8Array([1, 2, 3, 4]);
    const request = buildCodexBridgeRequest(
      [{
        role: 1,
        content: [
          { mimeType: "image/png", data: image },
          { mimeType: "image/png", data: new Uint8Array(image) }
        ]
      }],
      [],
      1,
      false,
      4,
      runtimeIdentity
    );

    expect(request.images).toHaveLength(1);
    expect(request.prompt.match(/"imageIndex":1/g)).toHaveLength(2);
  });

  it("uses a bounded visual estimate instead of expanding image bytes", () => {
    const small = estimateMessageTokens({
      role: 1,
      content: [{ mimeType: "image/png", data: new Uint8Array(16) }]
    });
    const large = estimateMessageTokens({
      role: 1,
      content: [{ mimeType: "image/png", data: new Uint8Array(1_000_000) }]
    });

    expect(small).toBe(1028);
    expect(large).toBe(small);
  });
});
