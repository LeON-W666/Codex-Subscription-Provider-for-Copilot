import { existsSync, readdirSync, statSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve
} from "node:path";

export type RuntimeMode = "auto" | "external" | "bundled";
export type CodexRuntimeSource =
  | "configured"
  | "path"
  | "official-extension"
  | "bundled";

export interface CodexRuntime {
  readonly executablePath: string;
  readonly source: CodexRuntimeSource;
}

interface RuntimeTarget {
  readonly triple: string;
  readonly executable: string;
  readonly officialExtensionDirectory: string;
}

export interface RuntimeResolutionOptions {
  readonly extensionRoot: string;
  readonly configuredPath: string;
  readonly mode: RuntimeMode;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly pathValue?: string;
  readonly isFile?: (path: string) => boolean;
  readonly extensionSearchRoots?: readonly string[];
  readonly readDirectoryNames?: (path: string) => readonly string[];
}

export function resolveCodexRuntime(
  options: RuntimeResolutionOptions
): CodexRuntime {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const isFile = options.isFile ?? isRegularFile;
  const attempts: string[] = [];

  if (options.mode !== "bundled" && options.configuredPath) {
    const configuredPath = resolveConfiguredPath(options.configuredPath);
    attempts.push(`configured: ${configuredPath}`);
    if (isFile(configuredPath)) {
      return { executablePath: configuredPath, source: "configured" };
    }
    throw new Error(
      `Configured Codex executable was not found: ${configuredPath}`
    );
  }

  if (options.mode !== "bundled") {
    const pathRuntime = findCodexOnPath(
      options.pathValue ?? readPathEnvironment(),
      platform,
      isFile
    );
    if (pathRuntime !== undefined) {
      return { executablePath: pathRuntime, source: "path" };
    }
    attempts.push("PATH: codex executable not found");

    const officialExtensionRuntime = findCodexInOfficialExtension({
      extensionRoot: options.extensionRoot,
      platform,
      architecture,
      isFile,
      searchRoots: options.extensionSearchRoots,
      readDirectoryNames: options.readDirectoryNames
    });
    if (officialExtensionRuntime !== undefined) {
      return {
        executablePath: officialExtensionRuntime,
        source: "official-extension"
      };
    }
    attempts.push("official OpenAI VS Code extension: codex executable not found");
  }

  if (options.mode !== "external") {
    const bundledPath = bundledCodexPath(
      options.extensionRoot,
      platform,
      architecture
    );
    if (bundledPath !== undefined) {
      attempts.push(`bundled: ${bundledPath}`);
      if (isFile(bundledPath)) {
        return { executablePath: bundledPath, source: "bundled" };
      }
    } else {
      attempts.push(`bundled: unsupported target ${platform}/${architecture}`);
    }
  }

  const guidance = options.mode === "bundled"
    ? "Install the Full distribution for this platform or change runtimeMode to auto."
    : "Install the official OpenAI Codex VS Code extension or Codex app/CLI, or set copilotCodexProvider.codexExecutablePath.";
  throw new Error(
    `Codex runtime is unavailable (${options.mode} mode). ${guidance}\nChecked:\n- ${attempts.join("\n- ")}`
  );
}

export function findCodexOnPath(
  pathValue: string,
  platform: NodeJS.Platform,
  isFile: (path: string) => boolean = isRegularFile
): string | undefined {
  const executableNames = platform === "win32"
    ? ["codex.exe", "codex"]
    : ["codex"];

  const pathDelimiter = platform === "win32" ? ";" : ":";
  for (const rawDirectory of pathValue.split(pathDelimiter)) {
    const directory = stripQuotes(rawDirectory.trim());
    if (!directory) {
      continue;
    }
    for (const executableName of executableNames) {
      const candidate = normalize(join(directory, executableName));
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function bundledCodexPath(
  extensionRoot: string,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): string | undefined {
  const target = runtimeTarget(platform, architecture);
  if (target === undefined) {
    return undefined;
  }
  return join(
    extensionRoot,
    "runtime",
    target.triple,
    "bin",
    target.executable
  );
}

interface OfficialExtensionSearchOptions {
  readonly extensionRoot: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly isFile: (path: string) => boolean;
  readonly searchRoots?: readonly string[];
  readonly readDirectoryNames?: (path: string) => readonly string[];
}

export function findCodexInOfficialExtension(
  options: OfficialExtensionSearchOptions
): string | undefined {
  const target = runtimeTarget(options.platform, options.architecture);
  if (target === undefined) {
    return undefined;
  }

  const roots = options.searchRoots ?? defaultExtensionSearchRoots(
    options.extensionRoot
  );
  const readDirectoryNames = options.readDirectoryNames ?? safeReadDirectoryNames;
  for (const root of deduplicatePaths(roots, options.platform)) {
    const extensionDirectories = readDirectoryNames(root)
      .filter(name => name.toLowerCase().startsWith("openai.chatgpt-"))
      .sort((left, right) => right.localeCompare(left));
    for (const extensionDirectory of extensionDirectories) {
      const candidate = join(
        root,
        extensionDirectory,
        "bin",
        target.officialExtensionDirectory,
        target.executable
      );
      if (options.isFile(candidate)) {
        return normalize(candidate);
      }
    }
  }
  return undefined;
}

export function formatRuntimeSource(source: CodexRuntimeSource): string {
  switch (source) {
    case "configured":
      return "configured path";
    case "path":
      return "system PATH";
    case "official-extension":
      return "official OpenAI VS Code extension";
    case "bundled":
      return "bundled runtime";
  }
}

function runtimeTarget(
  platform: NodeJS.Platform,
  architecture: string
): RuntimeTarget | undefined {
  const executable = platform === "win32" ? "codex.exe" : "codex";
  const targets: Record<string, RuntimeTarget> = {
    "win32/x64": {
      triple: "x86_64-pc-windows-msvc",
      executable,
      officialExtensionDirectory: "windows-x86_64"
    },
    "win32/arm64": {
      triple: "aarch64-pc-windows-msvc",
      executable,
      officialExtensionDirectory: "windows-aarch64"
    },
    "linux/x64": {
      triple: "x86_64-unknown-linux-musl",
      executable,
      officialExtensionDirectory: "linux-x86_64"
    },
    "linux/arm64": {
      triple: "aarch64-unknown-linux-musl",
      executable,
      officialExtensionDirectory: "linux-aarch64"
    },
    "darwin/x64": {
      triple: "x86_64-apple-darwin",
      executable,
      officialExtensionDirectory: "macos-x86_64"
    },
    "darwin/arm64": {
      triple: "aarch64-apple-darwin",
      executable,
      officialExtensionDirectory: "macos-aarch64"
    }
  };
  return targets[`${platform}/${architecture}`];
}

function defaultExtensionSearchRoots(extensionRoot: string): readonly string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return [
    dirname(extensionRoot),
    process.env.VSCODE_EXTENSIONS ?? "",
    home ? join(home, ".vscode", "extensions") : "",
    home ? join(home, ".vscode-insiders", "extensions") : "",
    home ? join(home, ".vscode-server", "extensions") : "",
    home ? join(home, ".vscode-server-insiders", "extensions") : ""
  ].filter(root => root.length > 0);
}

function deduplicatePaths(
  paths: readonly string[],
  platform: NodeJS.Platform
): readonly string[] {
  const seen = new Set<string>();
  return paths.filter(path => {
    const normalizedPath = normalize(path);
    const key = platform === "win32"
      ? normalizedPath.toLowerCase()
      : normalizedPath;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function safeReadDirectoryNames(path: string): readonly string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

function resolveConfiguredPath(configuredPath: string): string {
  const expanded = configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")
    ? join(process.env.USERPROFILE ?? process.env.HOME ?? "", configuredPath.slice(2))
    : configuredPath;
  const normalized = stripQuotes(expanded.trim());
  return isAbsolute(normalized) ? normalize(normalized) : resolve(normalized);
}

function readPathEnvironment(): string {
  const entry = Object.entries(process.env).find(
    ([key]) => key.toLowerCase() === "path"
  );
  return entry?.[1] ?? "";
}

function stripQuotes(value: string): string {
  return value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function isRegularFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && extname(path) !== ".cmd";
  } catch {
    return false;
  }
}
