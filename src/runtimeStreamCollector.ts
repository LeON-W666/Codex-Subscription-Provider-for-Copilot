import type {
  ThreadItem,
  Usage
} from "@openai/codex-sdk";

export type ForbiddenRuntimeActivityType =
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "web_search";

export type RuntimeStreamFailureCode =
  | "STREAM_TURN_FAILED"
  | "STREAM_TOP_LEVEL_ERROR"
  | "STREAM_ENDED_WITHOUT_COMPLETION"
  | "STREAM_DUPLICATE_TERMINAL_EVENT"
  | "STREAM_EVENT_AFTER_COMPLETION"
  | "STREAM_UNKNOWN_EVENT"
  | "STREAM_UNKNOWN_ITEM_TYPE"
  | "STREAM_GENERATOR_FAILURE";

export type RuntimeAbortReason =
  | "user_cancelled"
  | "forbidden_side_effect"
  | "runtime_failure";

export interface RuntimeAbortState {
  reason?: RuntimeAbortReason;
}

export class ForbiddenRuntimeActivityError extends Error {
  public readonly code = "FORBIDDEN_RUNTIME_ACTIVITY" as const;

  public constructor(
    public readonly activityType: ForbiddenRuntimeActivityType
  ) {
    super(
      `Codex attempted forbidden side activity (${activityType}); ` +
      "the response was rejected."
    );
    this.name = "ForbiddenRuntimeActivityError";
  }
}

export class RuntimeStreamFailureError extends Error {
  public constructor(
    public readonly code: RuntimeStreamFailureCode
  ) {
    super(`Codex stream failed (code=${code}).`);
    this.name = "RuntimeStreamFailureError";
  }
}

export class RuntimeUserCancelledError extends Error {
  public readonly code = "STREAM_ABORTED_BY_USER" as const;

  public constructor() {
    super("Codex request was cancelled by the user.");
    this.name = "RuntimeUserCancelledError";
  }
}

export interface RuntimeStreamMetrics {
  readonly eventCount: number;
  readonly startedItemCount: number;
  readonly updatedItemCount: number;
  readonly completedItemCount: number;
  readonly firstEventDelayMs?: number;
  readonly turnStartedDelayMs?: number;
  readonly turnCompletedDelayMs?: number;
  readonly threadStartedObserved: boolean;
  readonly turnStartedObserved: boolean;
  readonly turnCompletedObserved: boolean;
  readonly agentMessageObserved: boolean;
}

export interface RuntimeStreamResult {
  readonly items: readonly ThreadItem[];
  readonly finalResponse: string;
  readonly usage: Usage | null;
  readonly metrics: RuntimeStreamMetrics;
}

export interface CollectRuntimeStreamOptions {
  readonly events: AsyncIterable<unknown>;
  readonly runtimeStartedAt: number;
  readonly getAbortReason: () => RuntimeAbortReason | undefined;
  readonly abort: (reason: RuntimeAbortReason) => void;
}

type SafeRuntimeItemType =
  | "agent_message"
  | "reasoning"
  | "todo_list"
  | "error";

type SafeCompletedThreadItem = Extract<
  ThreadItem,
  {
    readonly type: SafeRuntimeItemType;
  }
>;

type RuntimeItemClassification =
  | {
      readonly kind: "safe";
      readonly type: SafeRuntimeItemType;
    }
  | {
      readonly kind: "forbidden";
      readonly type: ForbiddenRuntimeActivityType;
    }
  | {
      readonly kind: "unknown";
    };

interface RuntimeItemEnvelope {
  readonly type: string;
}

export function abortRuntime(
  state: RuntimeAbortState,
  controller: AbortController,
  reason: RuntimeAbortReason
): void {
  state.reason ??= reason;

  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
}

export function throwIfUserCancelled(
  state: RuntimeAbortState,
  cancellationRequested: boolean
): void {
  if (state.reason === "user_cancelled" || cancellationRequested) {
    throw new RuntimeUserCancelledError();
  }
}

export function rethrowRuntimeStreamError(
  error: unknown,
  abortReason: RuntimeAbortReason | undefined
): never {
  if (
    error instanceof ForbiddenRuntimeActivityError ||
    error instanceof RuntimeStreamFailureError ||
    error instanceof RuntimeUserCancelledError
  ) {
    throw error;
  }

  if (abortReason === "user_cancelled") {
    throw new RuntimeUserCancelledError();
  }

  throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
}

export function isForbiddenRuntimeActivityType(
  type: string
): type is ForbiddenRuntimeActivityType {
  switch (type) {
    case "command_execution":
    case "file_change":
    case "mcp_tool_call":
    case "web_search":
      return true;
    default:
      return false;
  }
}

export function assertAllowedRuntimeItem(itemType: string): void {
  const classification = classifyRuntimeItemType(itemType);

  if (classification.kind === "forbidden") {
    throw new ForbiddenRuntimeActivityError(classification.type);
  }

  if (classification.kind === "unknown") {
    throw new RuntimeStreamFailureError("STREAM_UNKNOWN_ITEM_TYPE");
  }
}

export async function collectRuntimeStream(
  options: CollectRuntimeStreamOptions
): Promise<RuntimeStreamResult> {
  const items: ThreadItem[] = [];
  let finalResponse = "";
  let usage: Usage | null = null;

  let eventCount = 0;
  let startedItemCount = 0;
  let updatedItemCount = 0;
  let completedItemCount = 0;

  let firstEventDelayMs: number | undefined;
  let turnStartedDelayMs: number | undefined;
  let turnCompletedDelayMs: number | undefined;

  let threadStartedObserved = false;
  let turnStartedObserved = false;
  let turnCompletedObserved = false;
  let agentMessageObserved = false;
  let terminalEventObserved = false;

  try {
    for await (const rawEvent of options.events) {
      eventCount += 1;
      firstEventDelayMs ??= Date.now() - options.runtimeStartedAt;

      const eventType = readEventType(rawEvent);
      if (eventType === undefined) {
        options.abort("runtime_failure");
        throw new RuntimeStreamFailureError("STREAM_UNKNOWN_EVENT");
      }

      if (terminalEventObserved) {
        const code: RuntimeStreamFailureCode =
          eventType === "turn.completed" || eventType === "turn.failed"
            ? "STREAM_DUPLICATE_TERMINAL_EVENT"
            : "STREAM_EVENT_AFTER_COMPLETION";
        options.abort("runtime_failure");
        throw new RuntimeStreamFailureError(code);
      }

      const event = rawEvent as Record<string, unknown>;

      switch (eventType) {
        case "thread.started":
          throwIfStreamCancelled(options);
          threadStartedObserved = true;
          break;

        case "turn.started":
          throwIfStreamCancelled(options);
          turnStartedObserved = true;
          turnStartedDelayMs = Date.now() - options.runtimeStartedAt;
          break;

        case "item.started": {
          const item = readRuntimeItemEnvelope(event);
          if (item === undefined) {
            options.abort("runtime_failure");
            throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
          }

          assertAllowedRuntimeItem(item.type);
          throwIfStreamCancelled(options);
          startedItemCount += 1;
          break;
        }

        case "item.updated": {
          const item = readRuntimeItemEnvelope(event);
          if (item === undefined) {
            options.abort("runtime_failure");
            throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
          }

          assertAllowedRuntimeItem(item.type);
          throwIfStreamCancelled(options);
          updatedItemCount += 1;
          break;
        }

        case "item.completed": {
          const envelope = readRuntimeItemEnvelope(event);
          if (envelope === undefined) {
            options.abort("runtime_failure");
            throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
          }

          assertAllowedRuntimeItem(envelope.type);

          const completedItem = readCompletedThreadItem(event);
          if (completedItem === undefined) {
            options.abort("runtime_failure");
            throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
          }

          throwIfStreamCancelled(options);
          completedItemCount += 1;
          items.push(completedItem);

          if (completedItem.type === "agent_message") {
            agentMessageObserved = true;
            finalResponse = completedItem.text;
          }
          break;
        }

        case "turn.completed": {
          const parsedUsage = readUsage(event.usage);
          if (parsedUsage === undefined) {
            options.abort("runtime_failure");
            throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
          }

          throwIfStreamCancelled(options);
          terminalEventObserved = true;
          turnCompletedObserved = true;
          turnCompletedDelayMs = Date.now() - options.runtimeStartedAt;
          usage = parsedUsage;
          break;
        }

        case "turn.failed":
          terminalEventObserved = true;
          options.abort("runtime_failure");
          throw new RuntimeStreamFailureError("STREAM_TURN_FAILED");

        case "error":
          options.abort("runtime_failure");
          throw new RuntimeStreamFailureError("STREAM_TOP_LEVEL_ERROR");

        default:
          options.abort("runtime_failure");
          throw new RuntimeStreamFailureError("STREAM_UNKNOWN_EVENT");
      }
    }
  } catch (error) {
    if (error instanceof ForbiddenRuntimeActivityError) {
      options.abort("forbidden_side_effect");
      throw error;
    }

    if (error instanceof RuntimeStreamFailureError) {
      options.abort("runtime_failure");
      throw error;
    }

    if (
      error instanceof RuntimeUserCancelledError ||
      options.getAbortReason() === "user_cancelled"
    ) {
      throw new RuntimeUserCancelledError();
    }

    options.abort("runtime_failure");
    throw new RuntimeStreamFailureError("STREAM_GENERATOR_FAILURE");
  }

  if (!turnCompletedObserved) {
    options.abort("runtime_failure");
    throw new RuntimeStreamFailureError("STREAM_ENDED_WITHOUT_COMPLETION");
  }

  return {
    items,
    finalResponse,
    usage,
    metrics: {
      eventCount,
      startedItemCount,
      updatedItemCount,
      completedItemCount,
      firstEventDelayMs,
      turnStartedDelayMs,
      turnCompletedDelayMs,
      threadStartedObserved,
      turnStartedObserved,
      turnCompletedObserved,
      agentMessageObserved
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function readEventType(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return typeof value.type === "string"
    ? value.type
    : undefined;
}

function readRuntimeItemEnvelope(
  event: Record<string, unknown>
): RuntimeItemEnvelope | undefined {
  const item = event.item;
  if (!isRecord(item) || typeof item.type !== "string") {
    return undefined;
  }

  return {
    type: item.type
  };
}

function readCompletedThreadItem(
  event: Record<string, unknown>
): SafeCompletedThreadItem | undefined {
  const item = event.item;
  if (
    !isRecord(item) ||
    typeof item.id !== "string" ||
    typeof item.type !== "string"
  ) {
    return undefined;
  }

  switch (item.type) {
    case "agent_message":
      return typeof item.text === "string"
        ? {
            id: item.id,
            type: "agent_message",
            text: item.text
          }
        : undefined;

    case "reasoning":
      return typeof item.text === "string"
        ? {
            id: item.id,
            type: "reasoning",
            text: item.text
          }
        : undefined;

    case "error":
      return typeof item.message === "string"
        ? {
            id: item.id,
            type: "error",
            message: item.message
          }
        : undefined;

    case "todo_list": {
      if (!Array.isArray(item.items)) {
        return undefined;
      }

      const todoItems: Array<{
        text: string;
        completed: boolean;
      }> = [];

      for (const rawTodoItem of item.items) {
        if (
          !isRecord(rawTodoItem) ||
          typeof rawTodoItem.text !== "string" ||
          typeof rawTodoItem.completed !== "boolean"
        ) {
          return undefined;
        }

        todoItems.push({
          text: rawTodoItem.text,
          completed: rawTodoItem.completed
        });
      }

      return {
        id: item.id,
        type: "todo_list",
        items: todoItems
      };
    }

    default:
      return undefined;
  }
}

function classifyRuntimeItemType(
  type: string
): RuntimeItemClassification {
  switch (type) {
    case "agent_message":
    case "reasoning":
    case "todo_list":
    case "error":
      return {
        kind: "safe",
        type
      };

    case "command_execution":
    case "file_change":
    case "mcp_tool_call":
    case "web_search":
      return {
        kind: "forbidden",
        type
      };

    default:
      return {
        kind: "unknown"
      };
  }
}

function throwIfStreamCancelled(
  options: CollectRuntimeStreamOptions
): void {
  if (options.getAbortReason() === "user_cancelled") {
    throw new RuntimeUserCancelledError();
  }
}

function isNonNegativeFiniteNumber(
  value: unknown
): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0;
}

function readUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = value.input_tokens;
  const cachedInputTokens = value.cached_input_tokens;
  const cacheWriteInputTokens = value.cache_write_input_tokens;
  const outputTokens = value.output_tokens;
  const reasoningOutputTokens = value.reasoning_output_tokens;

  if (
    !isNonNegativeFiniteNumber(inputTokens) ||
    !isNonNegativeFiniteNumber(cachedInputTokens) ||
    !isNonNegativeFiniteNumber(cacheWriteInputTokens) ||
    !isNonNegativeFiniteNumber(outputTokens) ||
    !isNonNegativeFiniteNumber(reasoningOutputTokens)
  ) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: cacheWriteInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens
  };
}
