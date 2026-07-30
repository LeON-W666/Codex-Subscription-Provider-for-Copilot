const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const bundlePath = path.join(__dirname, "..", "dist", "extension.js");
const bundle = fs.readFileSync(bundlePath, "utf8");
if (bundle.includes('require("@openai/codex-sdk")')) {
  throw new Error("Extension bundle still requires the ESM-only Codex SDK.");
}
if (bundle.includes("CodexExec = class") || bundle.includes("import_meta = {}")) {
  throw new Error("Extension bundle incorrectly embeds the ESM Codex SDK.");
}
if (!bundle.includes("vendor") || !bundle.includes("codex-sdk")) {
  throw new Error("Extension bundle is missing the vendored SDK loader.");
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const extension = require(bundlePath);
  if (typeof extension.activate !== "function") {
    throw new Error("Extension bundle did not export activate().");
  }
  console.log("Extension bundle loads with the external ESM SDK loader.");
} finally {
  Module._load = originalLoad;
}
