import { existsSync } from "node:fs";
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

new sdk.Codex({ codexPathOverride: process.execPath, env: {} });
console.log("Vendored Codex SDK initialized with a valid import.meta.url.");
