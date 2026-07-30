import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const triple = "x86_64-pc-windows-msvc";
const source = join(
  projectRoot,
  "node_modules",
  "@openai",
  "codex-win32-x64",
  "vendor",
  triple
);
const destination = join(projectRoot, "runtime", triple);

if (!existsSync(source)) {
  throw new Error(
    `Official Codex Win64 runtime was not installed: ${source}. Run npm ci on Windows before packaging the Full distribution.`
  );
}

rmSync(join(projectRoot, "runtime"), { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log(`Prepared Full Win64 runtime at ${destination}`);
