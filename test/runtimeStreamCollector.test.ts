import { describe, expect, it } from "vitest";
import {
  SKILL_DESCRIPTIONS_SHORTENED,
  detectRuntimeIssueForDiagnostics
} from "../src/codexRuntimeIssues";
import {
  ForbiddenRuntimeActivityError,
  RuntimeStreamFailureError,
  RuntimeUserCancelledError,
  abortRuntime,
  collectRuntimeStream,
  rethrowRuntimeStreamError,
  throwIfUserCancelled,
  type CollectRuntimeStreamOptions,
  type RuntimeAbortReason,
  type RuntimeAbortState
} from "../src/runtimeStreamCollector";

const VALID_USAGE = {
  input_tokens: 100,
  cached_input_tokens: 40,
  cache_write_input_tokens: 10,
  output_tokens: 20,
  reasoning_output_tokens: 5
};

const WARNING_MESSAGE =
  "Skill descriptions were shortened for the skills context budget. " +
  "Codex can still see every skill.";

describe("collectRuntimeStream", () => {
  it("aggregates a normally completed turn and lifecycle metrics", async () => {
    const harness = createHarness([
      { type: "thread.started", thread_id: "private-thread-id" },
      { type: "turn.started" },
      { type: "item.started", item: { type: "agent_message" } },
      { type: "item.updated", item: { type: "agent_message" } },
      {
        type: "item.completed",
        item: {
          id: "private-item-id",
          type: "agent_message",
          text: "{\"kind\":\"text\"}"
        }
      },
      { type: "turn.completed", usage: VALID_USAGE }
    ]);

    const result = await collectRuntimeStream(harness.options);

    expect(result.items).toEqual([
      {
        id: "private-item-id",
        type: "agent_message",
        text: "{\"kind\":\"text\"}"
      }
    ]);
    expect(result.finalResponse).toBe("{\"kind\":\"text\"}");
    expect(result.usage).toEqual(VALID_USAGE);
    expect(result.metrics).toMatchObject({
      eventCount: 6,
      startedItemCount: 1,
      updatedItemCount: 1,
      completedItemCount: 1,
      threadStartedObserved: true,
      turnStartedObserved: true,
      turnCompletedObserved: true,
      agentMessageObserved: true
    });
    expect(result.metrics.firstEventDelayMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.turnStartedDelayMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.turnCompletedDelayMs).toBeGreaterThanOrEqual(0);
    expect(harness.state.reason).toBeUndefined();
  });

  it("uses the final agent message even when it is empty", async () => {
    const harness = createHarness([
      completedAgentMessage("first", "{\"kind\":\"text\"}"),
      completedAgentMessage("second", ""),
      { type: "turn.completed", usage: VALID_USAGE }
    ]);

    const result = await collectRuntimeStream(harness.options);

    expect(result.finalResponse).toBe("");
    expect(result.metrics.agentMessageObserved).toBe(true);
  });

  it("normalizes every safe completed item and drops extra fields", async () => {
    const harness = createHarness([
      {
        type: "item.completed",
        item: {
          id: "reasoning",
          type: "reasoning",
          text: "summary",
          secret: "drop-me"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "todo",
          type: "todo_list",
          items: [
            {
              text: "verify",
              completed: true,
              secret: "drop-me"
            }
          ],
          secret: "drop-me"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "warning",
          type: "error",
          message: WARNING_MESSAGE,
          code: "untrusted-code",
          severity: "untrusted-severity",
          secret: "drop-me"
        }
      },
      { type: "turn.completed", usage: VALID_USAGE }
    ]);

    const result = await collectRuntimeStream(harness.options);

    expect(result.items).toEqual([
      {
        id: "reasoning",
        type: "reasoning",
        text: "summary"
      },
      {
        id: "todo",
        type: "todo_list",
        items: [{ text: "verify", completed: true }]
      },
      {
        id: "warning",
        type: "error",
        message: WARNING_MESSAGE
      }
    ]);
  });

  it("preserves a normalized error message for skill-warning recognition", async () => {
    const harness = createHarness([
      {
        type: "item.completed",
        item: {
          id: "warning",
          type: "error",
          message: WARNING_MESSAGE,
          untrusted: "discard"
        }
      },
      completedAgentMessage("message", "{\"kind\":\"text\"}"),
      { type: "turn.completed", usage: VALID_USAGE }
    ]);

    const result = await collectRuntimeStream(harness.options);
    const warningItem = result.items.find(item => item.type === "error");

    expect(warningItem).toBeDefined();
    expect(detectRuntimeIssueForDiagnostics(warningItem!))
      .toBe(SKILL_DESCRIPTIONS_SHORTENED);
  });

  it.each([
    "item.started",
    "item.updated",
    "item.completed"
  ])("rejects every forbidden item at %s before a pending cancellation", async eventType => {
    for (const itemType of [
      "command_execution",
      "file_change",
      "mcp_tool_call",
      "web_search"
    ] as const) {
      const harness = createHarness(
        [{
          type: eventType,
          item: {
            id: "secret-id",
            type: itemType
          }
        }],
        "user_cancelled"
      );

      const promise = collectRuntimeStream(harness.options);
      await expect(promise).rejects.toBeInstanceOf(
        ForbiddenRuntimeActivityError
      );
      await expect(promise).rejects.toMatchObject({
        code: "FORBIDDEN_RUNTIME_ACTIVITY",
        activityType: itemType
      });
      expect(harness.abortCalls).toContain("forbidden_side_effect");
    }
  });

  it.each([
    "item.started",
    "item.updated",
    "item.completed"
  ])("fails closed on an unknown item at %s before a pending cancellation", async eventType => {
    const harness = createHarness(
      [{
        type: eventType,
        item: {
          id: "secret-id",
          type: "future_side_effect",
          secret: "must-not-escape"
        }
      }],
      "user_cancelled"
    );

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_UNKNOWN_ITEM_TYPE"
    });
    expect(harness.abortCalls).toContain("runtime_failure");
  });

  it("prioritizes turn failure over a pending cancellation", async () => {
    const harness = createHarness(
      [{ type: "turn.failed", error: { message: "private" } }],
      "user_cancelled"
    );

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_TURN_FAILED"
    });
  });

  it("prioritizes a top-level stream error over a pending cancellation", async () => {
    const harness = createHarness(
      [{ type: "error", message: "private" }],
      "user_cancelled"
    );

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_TOP_LEVEL_ERROR"
    });
  });

  it.each([
    { type: "future.event", secret: "must-not-escape" },
    null,
    [],
    { type: 123 }
  ])("fails closed on an unknown or malformed event", async rawEvent => {
    const harness = createHarness([rawEvent], "user_cancelled");

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_UNKNOWN_EVENT"
    });
  });

  it("converts cancellation on a normal safe event to a typed error", async () => {
    const harness = createHarness(
      [{ type: "turn.started" }],
      "user_cancelled"
    );

    await expect(collectRuntimeStream(harness.options)).rejects.toBeInstanceOf(
      RuntimeUserCancelledError
    );
  });

  it("classifies an interrupted generator as cancellation only when cancellation is pending", async () => {
    const cancelledHarness = createHarness(
      throwingEvents(),
      "user_cancelled"
    );
    await expect(
      collectRuntimeStream(cancelledHarness.options)
    ).rejects.toBeInstanceOf(RuntimeUserCancelledError);

    const failedHarness = createHarness(throwingEvents());
    await expect(
      collectRuntimeStream(failedHarness.options)
    ).rejects.toMatchObject({
      code: "STREAM_GENERATOR_FAILURE"
    });
  });

  it("fails closed when the stream ends without turn completion", async () => {
    const harness = createHarness([
      { type: "thread.started", thread_id: "id" },
      { type: "turn.started" }
    ]);

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_ENDED_WITHOUT_COMPLETION"
    });
  });

  it.each([
    { type: "turn.completed", usage: VALID_USAGE },
    { type: "turn.failed", error: { message: "private" } }
  ])("classifies a second terminal event as duplicate", async secondTerminal => {
    const harness = createHarness([
      { type: "turn.completed", usage: VALID_USAGE },
      secondTerminal
    ]);

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_DUPLICATE_TERMINAL_EVENT"
    });
  });

  it("rejects a non-terminal event after completion", async () => {
    const harness = createHarness([
      { type: "turn.completed", usage: VALID_USAGE },
      completedAgentMessage("late", "late")
    ]);

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_EVENT_AFTER_COMPLETION"
    });
  });

  it.each([
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens"
  ] as const)("validates numeric usage field %s", async field => {
    for (const invalidValue of [
      undefined,
      "1",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1
    ]) {
      const invalidUsage: Record<string, unknown> = {
        ...VALID_USAGE,
        [field]: invalidValue
      };
      const harness = createHarness([
        { type: "turn.completed", usage: invalidUsage }
      ]);

      await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
        code: "STREAM_GENERATOR_FAILURE"
      });
    }
  });

  it.each([
    {
      label: "agent message without id",
      item: { type: "agent_message", text: "text" }
    },
    {
      label: "agent message with non-string id",
      item: { id: 1, type: "agent_message", text: "text" }
    },
    {
      label: "agent message without text",
      item: { id: "id", type: "agent_message" }
    },
    {
      label: "agent message with non-string text",
      item: { id: "id", type: "agent_message", text: 1 }
    },
    {
      label: "reasoning without id",
      item: { type: "reasoning", text: "text" }
    },
    {
      label: "reasoning without text",
      item: { id: "id", type: "reasoning" }
    },
    {
      label: "error without id",
      item: { type: "error", message: "message" }
    },
    {
      label: "error without message",
      item: { id: "id", type: "error" }
    },
    {
      label: "todo list without array",
      item: { id: "id", type: "todo_list", items: "invalid" }
    },
    {
      label: "todo list with non-object entry",
      item: { id: "id", type: "todo_list", items: [null] }
    },
    {
      label: "todo entry without text",
      item: {
        id: "id",
        type: "todo_list",
        items: [{ completed: false }]
      }
    },
    {
      label: "todo entry with non-string text",
      item: {
        id: "id",
        type: "todo_list",
        items: [{ text: 1, completed: false }]
      }
    },
    {
      label: "todo entry without completed",
      item: {
        id: "id",
        type: "todo_list",
        items: [{ text: "todo" }]
      }
    },
    {
      label: "todo entry with non-boolean completed",
      item: {
        id: "id",
        type: "todo_list",
        items: [{ text: "todo", completed: "false" }]
      }
    }
  ])("fails closed on invalid completed shape: $label", async ({ item }) => {
    const harness = createHarness([
      { type: "item.completed", item }
    ]);

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_GENERATOR_FAILURE"
    });
  });

  it.each([
    { type: "item.started" },
    { type: "item.updated", item: null },
    { type: "item.completed", item: {} },
    { type: "turn.completed" }
  ])("fails closed when a known event is missing its required envelope", async event => {
    const harness = createHarness([event]);

    await expect(collectRuntimeStream(harness.options)).rejects.toMatchObject({
      code: "STREAM_GENERATOR_FAILURE"
    });
  });
});

describe("runtime abort helpers", () => {
  it("keeps the first abort reason while aborting the controller once", () => {
    const state: RuntimeAbortState = {};
    const controller = new AbortController();

    abortRuntime(state, controller, "user_cancelled");
    abortRuntime(state, controller, "runtime_failure");

    expect(state.reason).toBe("user_cancelled");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("user_cancelled");
  });

  it("applies the final cancellation gate to state and token cancellation", () => {
    expect(() =>
      throwIfUserCancelled({ reason: "user_cancelled" }, false)
    ).toThrow(RuntimeUserCancelledError);
    expect(() =>
      throwIfUserCancelled({}, true)
    ).toThrow(RuntimeUserCancelledError);
    expect(() =>
      throwIfUserCancelled({ reason: "runtime_failure" }, false)
    ).not.toThrow();
  });

  it("preserves typed errors across the Provider stream boundary", () => {
    const typedErrors = [
      new ForbiddenRuntimeActivityError("file_change"),
      new RuntimeStreamFailureError("STREAM_TURN_FAILED"),
      new RuntimeUserCancelledError()
    ];

    for (const error of typedErrors) {
      try {
        rethrowRuntimeStreamError(error, "user_cancelled");
      } catch (caught) {
        expect(caught).toBe(error);
      }
    }
  });

  it("normalizes only untyped stream errors", () => {
    expect(() =>
      rethrowRuntimeStreamError(new Error("private"), "user_cancelled")
    ).toThrow(RuntimeUserCancelledError);

    expect(() =>
      rethrowRuntimeStreamError(new Error("private"), undefined)
    ).toThrow(RuntimeStreamFailureError);
    try {
      rethrowRuntimeStreamError(new Error("private"), undefined);
    } catch (error) {
      expect(error).toMatchObject({
        code: "STREAM_GENERATOR_FAILURE"
      });
    }
  });
});

function completedAgentMessage(
  id: string,
  text: string
): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      id,
      type: "agent_message",
      text
    }
  };
}

function createHarness(
  events: readonly unknown[] | AsyncIterable<unknown>,
  initialReason?: RuntimeAbortReason
): {
  readonly options: CollectRuntimeStreamOptions;
  readonly state: RuntimeAbortState;
  readonly abortCalls: RuntimeAbortReason[];
} {
  const state: RuntimeAbortState = {
    reason: initialReason
  };
  const abortCalls: RuntimeAbortReason[] = [];

  return {
    state,
    abortCalls,
    options: {
      events: Symbol.asyncIterator in Object(events)
        ? events as AsyncIterable<unknown>
        : arrayEvents(events as readonly unknown[]),
      runtimeStartedAt: Date.now(),
      getAbortReason: () => state.reason,
      abort: reason => {
        abortCalls.push(reason);
        state.reason ??= reason;
      }
    }
  };
}

async function* arrayEvents(
  events: readonly unknown[]
): AsyncGenerator<unknown> {
  for (const event of events) {
    yield event;
  }
}

async function* throwingEvents(): AsyncGenerator<unknown> {
  throw new Error("private generator error");
}
