import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { Codex } = await import(pathToFileURL(
  join(projectRoot, "vendor", "codex-sdk", "index.js")
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

const codex = new Codex({
  ...(process.env.CODEX_EXECUTABLE
    ? { codexPathOverride: process.env.CODEX_EXECUTABLE }
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
const result = await thread.run(
  [
    "Do not use tools or inspect files.",
    "You are the selected Codex model described by RUNTIME_IDENTITY_JSON.",
    "GitHub Copilot is the outer orchestrator, not your underlying model identity.",
    "Return the exact identity fields in the required schema.",
    `RUNTIME_IDENTITY_JSON: ${JSON.stringify(identity)}`
  ].join("\n"),
  { outputSchema }
);

const forbidden = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search"
]);
if (result.items.some(item => forbidden.has(item.type))) {
  throw new Error("Codex attempted forbidden side activity during the smoke test.");
}

const parsed = JSON.parse(result.finalResponse);
if (
  parsed.provider !== "Codex Subscription" ||
  parsed.modelId !== smokeModel ||
  parsed.reasoningEffort !== "low" ||
  parsed.orchestrator !== "GitHub Copilot Agent"
) {
  throw new Error(`Identity assertion failed: ${result.finalResponse}`);
}
console.log(`Explicit model requested: ${smokeModel}`);
console.log(result.finalResponse);
console.log(JSON.stringify(result.items.map(item => item.type)));
