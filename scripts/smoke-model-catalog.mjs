import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const executable = process.env.CODEX_EXECUTABLE || join(
  process.cwd(),
  "node_modules",
  "@openai",
  "codex-win32-x64",
  "vendor",
  "x86_64-pc-windows-msvc",
  "bin",
  "codex.exe"
);
if (!existsSync(executable)) {
  throw new Error(`Bundled Codex executable not found: ${executable}`);
}

const excluded = new Set([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_BASE_URL"
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => value !== undefined && !excluded.has(key.toUpperCase())
  )
);
const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
  env,
  windowsHide: true,
  stdio: "pipe"
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();

function write(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}
async function response(id) {
  while (true) {
    const next = await iterator.next();
    if (next.done) throw new Error(`App Server closed before response ${id}.`);
    const message = JSON.parse(next.value);
    if (message.id !== id) continue;
    if (message.error) throw new Error(message.error.message);
    return message.result;
  }
}

const timeout = setTimeout(() => child.kill(), 20_000);
try {
  write({
    method: "initialize",
    id: 1,
    params: {
      clientInfo: {
        name: "copilot-codex-provider-smoke",
        title: "Codex Provider Model Smoke",
        version: "0.5.1"
      },
      capabilities: null
    }
  });
  await response(1);
  write({ method: "initialized" });
  write({
    method: "model/list",
    id: 2,
    params: { cursor: null, limit: 100, includeHidden: false }
  });
  const result = await response(2);
  if (!Array.isArray(result?.data) || result.data.length === 0) {
    throw new Error("Codex model/list returned no visible models.");
  }
  const models = result.data.map(model => ({
    model: model.model,
    displayName: model.displayName,
    inputModalities: model.inputModalities,
    efforts: model.supportedReasoningEfforts.map(item => item.reasoningEffort)
  }));
  console.log(JSON.stringify(models, null, 2));
} finally {
  clearTimeout(timeout);
  child.stdin.end();
  lines.close();
  if (!child.killed) child.kill();
}
