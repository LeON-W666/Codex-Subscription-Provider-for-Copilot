import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkPath = join(projectRoot, "vendor", "codex-sdk", "index.js");
if (!existsSync(sdkPath)) {
  throw new Error(`Vendored Codex SDK runtime is missing: ${sdkPath}`);
}

const sdk = await import(pathToFileURL(sdkPath).href);
if (typeof sdk.Codex !== "function") {
  throw new Error("Vendored Codex SDK did not export Codex.");
}

const codex = new sdk.Codex({
  codexPathOverride: process.execPath,
  env: {}
});
const thread = codex.startThread({
  workingDirectory: projectRoot,
  skipGitRepoCheck: true,
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled"
});
if (typeof thread.runStreamed !== "function") {
  throw new Error("Vendored Codex SDK does not support runStreamed().");
}

const sdkPackage = JSON.parse(
  readFileSync(join(projectRoot, "vendor", "codex-sdk", "package.json"), "utf8")
);
console.log(
  `Vendored Codex SDK ${sdkPackage.version} initialized; runStreamed() is available.`
);
