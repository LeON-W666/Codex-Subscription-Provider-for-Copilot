import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = join(projectRoot, "vendor", "codex-sdk");
const sdkPackage = JSON.parse(
  readFileSync(join(sdkRoot, "package.json"), "utf8")
);
const { Codex } = await import(pathToFileURL(
  join(sdkRoot, "index.js")
).href);

const excludedEnvironmentVariables = new Set([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_BASE_URL"
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined &&
      !excludedEnvironmentVariables.has(key.toUpperCase())
  )
);

const smokeModel = process.env.CODEX_SMOKE_MODEL?.trim();
if (!smokeModel) {
  throw new Error(
    "Set CODEX_SMOKE_MODEL to one explicit model returned by npm run smoke:models."
  );
}

const runtimeExecutable =
  process.env.CODEX_EXECUTABLE?.trim() || "codex";
const requestedRuntimeSource =
  process.env.CODEX_RUNTIME_SOURCE?.trim();
const allowedRuntimeSources = new Set([
  "thin-path",
  "thin-official-extension",
  "full-win32-x64",
  "configured",
  "path"
]);
const runtimeSource =
  requestedRuntimeSource !== undefined &&
  allowedRuntimeSources.has(requestedRuntimeSource)
    ? requestedRuntimeSource
    : process.env.CODEX_EXECUTABLE
      ? "configured"
      : "path";

try {
  await runSmoke();
} catch {
  console.error("Codex runStreamed compatibility smoke: FAIL");
  process.exitCode = 1;
}

async function runSmoke() {
  const rawRuntimeVersion = execFileSync(
    runtimeExecutable,
    ["--version"],
    {
      encoding: "utf8",
      windowsHide: true
    }
  ).trim();
  const runtimeVersion = rawRuntimeVersion.match(
    /\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/u
  )?.[0];
  if (runtimeVersion === undefined) {
    throw new Error("RUNTIME_VERSION_UNAVAILABLE");
  }
  const codex = new Codex({
    ...(process.env.CODEX_EXECUTABLE
      ? { codexPathOverride: runtimeExecutable }
      : {}),
    env,
    config: { mcp_servers: {} }
  });
  const thread = codex.startThread({
    model: smokeModel,
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    modelReasoningEffort: "low"
  });

  if (typeof thread.runStreamed !== "function") {
    throw new Error("STREAMED_SDK_UNAVAILABLE");
  }

  const outputSchema = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["identity"] },
      provider: { type: "string", enum: ["Codex Subscription"] },
      modelId: { type: "string", enum: [smokeModel] },
      reasoningEffort: { type: "string", enum: ["low"] },
      orchestrator: { type: "string", enum: ["GitHub Copilot Agent"] },
      text: { type: "string" }
    },
    required: [
      "kind",
      "provider",
      "modelId",
      "reasoningEffort",
      "orchestrator",
      "text"
    ],
    additionalProperties: false
  };
  const identity = {
    provider: "Codex Subscription",
    modelId: smokeModel,
    modelDisplayName: smokeModel,
    reasoningEffort: "low",
    orchestrator: "GitHub Copilot Agent"
  };
  const streamed = await thread.runStreamed(
    [
      "Do not use tools or inspect files.",
      "You are the selected Codex model described by RUNTIME_IDENTITY_JSON.",
      "GitHub Copilot is the outer orchestrator, not your underlying model identity.",
      "Return the exact identity fields in the required schema.",
      `RUNTIME_IDENTITY_JSON: ${JSON.stringify(identity)}`
    ].join("\n"),
    { outputSchema }
  );

  const safeItemTypes = new Set([
    "agent_message",
    "reasoning",
    "todo_list",
    "error"
  ]);
  const forbiddenItemTypes = new Set([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "web_search"
  ]);
  const eventTypes = new Set();
  const itemTypes = new Set();
  let eventCount = 0;
  let terminalObserved = false;
  let agentMessageObserved = false;
  let finalResponse = "";
  let usage;

  for await (const rawEvent of streamed.events) {
    eventCount += 1;
    if (!isRecord(rawEvent) || typeof rawEvent.type !== "string") {
      throw new Error("STREAM_UNKNOWN_EVENT");
    }

    const eventType = rawEvent.type;
    if (terminalObserved) {
      throw new Error(
        eventType === "turn.completed" || eventType === "turn.failed"
          ? "STREAM_DUPLICATE_TERMINAL_EVENT"
          : "STREAM_EVENT_AFTER_COMPLETION"
      );
    }

    eventTypes.add(eventType);
    switch (eventType) {
      case "thread.started":
      case "turn.started":
        break;

      case "item.started":
      case "item.updated":
      case "item.completed": {
        if (
          !isRecord(rawEvent.item) ||
          typeof rawEvent.item.type !== "string"
        ) {
          throw new Error("STREAM_GENERATOR_FAILURE");
        }

        const itemType = rawEvent.item.type;
        if (forbiddenItemTypes.has(itemType)) {
          throw new Error("FORBIDDEN_RUNTIME_ACTIVITY");
        }
        if (!safeItemTypes.has(itemType)) {
          throw new Error("STREAM_UNKNOWN_ITEM_TYPE");
        }

        itemTypes.add(itemType);
        if (
          eventType === "item.completed" &&
          itemType === "agent_message"
        ) {
          if (
            typeof rawEvent.item.id !== "string" ||
            typeof rawEvent.item.text !== "string"
          ) {
            throw new Error("STREAM_GENERATOR_FAILURE");
          }
          agentMessageObserved = true;
          finalResponse = rawEvent.item.text;
        }
        break;
      }

      case "turn.completed":
        usage = readUsage(rawEvent.usage);
        if (usage === undefined) {
          throw new Error("STREAM_GENERATOR_FAILURE");
        }
        terminalObserved = true;
        break;

      case "turn.failed":
        throw new Error("STREAM_TURN_FAILED");

      case "error":
        throw new Error("STREAM_TOP_LEVEL_ERROR");

      default:
        throw new Error("STREAM_UNKNOWN_EVENT");
    }
  }

  if (!terminalObserved) {
    throw new Error("STREAM_ENDED_WITHOUT_COMPLETION");
  }
  if (!agentMessageObserved) {
    throw new Error("STREAM_MISSING_AGENT_MESSAGE");
  }

  let parsed;
  try {
    parsed = JSON.parse(finalResponse);
  } catch {
    throw new Error("STREAM_INVALID_FINAL_RESPONSE");
  }
  if (
    parsed.provider !== "Codex Subscription" ||
    parsed.modelId !== smokeModel ||
    parsed.reasoningEffort !== "low" ||
    parsed.orchestrator !== "GitHub Copilot Agent"
  ) {
    throw new Error("STREAM_IDENTITY_ASSERTION_FAILED");
  }

  console.log(`Runtime source: ${runtimeSource}`);
  console.log(`Runtime version: ${runtimeVersion}`);
  console.log(`SDK version: ${sdkPackage.version}`);
  console.log(`Event types: ${[...eventTypes].sort().join(",")}`);
  console.log(`Item types: ${[...itemTypes].sort().join(",")}`);
  console.log(`Event count: ${eventCount}`);
  console.log(
    "Usage: " +
    `input=${usage.input_tokens} ` +
    `cached=${usage.cached_input_tokens} ` +
    `cache-write=${usage.cache_write_input_tokens} ` +
    `output=${usage.output_tokens} ` +
    `reasoning=${usage.reasoning_output_tokens}`
  );
  console.log("Codex runStreamed compatibility smoke: PASS");
}

function isRecord(value) {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function readUsage(value) {
  if (!isRecord(value)) {
    return undefined;
  }

  const fields = [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens"
  ];
  if (
    fields.some(field =>
      typeof value[field] !== "number" ||
      !Number.isFinite(value[field]) ||
      value[field] < 0
    )
  ) {
    return undefined;
  }

  return {
    input_tokens: value.input_tokens,
    cached_input_tokens: value.cached_input_tokens,
    cache_write_input_tokens: value.cache_write_input_tokens,
    output_tokens: value.output_tokens,
    reasoning_output_tokens: value.reasoning_output_tokens
  };
}
