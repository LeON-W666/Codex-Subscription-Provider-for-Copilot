import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = join(projectRoot, "node_modules", "@openai", "codex-sdk");
const destination = join(projectRoot, "vendor", "codex-sdk");
const sdkPackage = JSON.parse(
  readFileSync(join(sdkRoot, "package.json"), "utf8")
);

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
copyFileSync(
  join(sdkRoot, "dist", "index.js"),
  join(destination, "index.js")
);
writeFileSync(
  join(destination, "package.json"),
  `${JSON.stringify({
    name: "@openai/codex-sdk-runtime",
    version: sdkPackage.version,
    private: true,
    type: "module",
    license: sdkPackage.license
  }, null, 2)}\n`,
  "utf8"
);
console.log(`Prepared Codex SDK ESM runtime ${sdkPackage.version}.`);
