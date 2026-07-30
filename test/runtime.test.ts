import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledCodexPath,
  findCodexOnPath,
  resolveCodexRuntime
} from "../src/runtime";

describe("Codex runtime resolution", () => {
  it("prefers an explicitly configured executable", () => {
    const expected = "C:\\tools\\codex.exe";
    const result = resolveCodexRuntime({
      extensionRoot: "C:\\extension",
      configuredPath: expected,
      mode: "auto",
      platform: "win32",
      architecture: "x64",
      pathValue: "C:\\other",
      isFile: path => path === expected
    });

    expect(result).toEqual({
      executablePath: expected,
      source: "configured"
    });
  });

  it("finds the official executable on PATH before a bundle", () => {
    const expected = join("C:\\official-codex", "codex.exe");
    const result = resolveCodexRuntime({
      extensionRoot: "C:\\extension",
      configuredPath: "",
      mode: "auto",
      platform: "win32",
      architecture: "x64",
      pathValue: "C:\\first;C:\\official-codex",
      isFile: path => path === expected
    });

    expect(result.source).toBe("path");
    expect(result.executablePath).toBe(expected);
  });

  it("falls back to the Full distribution runtime in auto mode", () => {
    const extensionRoot = "C:\\extension";
    const expected = bundledCodexPath(extensionRoot, "win32", "x64");
    const result = resolveCodexRuntime({
      extensionRoot,
      configuredPath: "",
      mode: "auto",
      platform: "win32",
      architecture: "x64",
      pathValue: "",
      isFile: path => path === expected
    });

    expect(result).toEqual({
      executablePath: expected,
      source: "bundled"
    });
  });

  it("discovers Codex from the official OpenAI VS Code extension", () => {
    const extensionRoot = "C:\\extensions\\leonbwang.provider-0.5.1";
    const officialDirectory = "openai.chatgpt-26.721.41059-win32-x64";
    const expected = join(
      "C:\\extensions",
      officialDirectory,
      "bin",
      "windows-x86_64",
      "codex.exe"
    );
    const result = resolveCodexRuntime({
      extensionRoot,
      configuredPath: "",
      mode: "auto",
      platform: "win32",
      architecture: "x64",
      pathValue: "",
      extensionSearchRoots: ["C:\\extensions"],
      readDirectoryNames: () => [
        "someone.else-1.0.0",
        officialDirectory
      ],
      isFile: path => path === expected
    });

    expect(result).toEqual({
      executablePath: expected,
      source: "official-extension"
    });
  });

  it("does not silently use a bundle in external mode", () => {
    expect(() => resolveCodexRuntime({
      extensionRoot: "C:\\extension",
      configuredPath: "",
      mode: "external",
      platform: "win32",
      architecture: "x64",
      pathValue: "",
      isFile: () => false
    })).toThrow("Codex runtime is unavailable (external mode)");
  });
});

describe("PATH discovery", () => {
  it("checks each Windows PATH entry for codex.exe", () => {
    const expected = join("C:\\Codex App", "codex.exe");
    expect(findCodexOnPath(
      "\"C:\\Codex App\";C:\\Other",
      "win32",
      path => path === expected
    )).toBe(expected);
  });
});
