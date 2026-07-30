import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupImageInputs,
  cleanupStaleImageInputs,
  materializeImageInputs
} from "../src/imageInput";

describe("materializeImageInputs", () => {
  it("writes supported image bytes and removes the request directory", () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const result = materializeImageInputs(
      [{ mimeType: "image/png", data: bytes }],
      join(tmpdir(), "copilot-codex-provider-tests"),
      randomUUID()
    );
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.endsWith(".png")).toBe(true);
    expect(readFileSync(result.paths[0]!)).toEqual(Buffer.from(bytes));
    cleanupImageInputs(result.directory);
    expect(existsSync(result.directory!)).toBe(false);
  });

  it("rejects unsupported image formats", () => {
    expect(() => materializeImageInputs(
      [{ mimeType: "image/bmp", data: new Uint8Array([1]) }],
      join(tmpdir(), "copilot-codex-provider-tests"),
      randomUUID()
    )).toThrow("unsupported MIME type");
  });
});
describe("cleanupStaleImageInputs", () => {
  it("removes expired request directories and preserves recent ones", () => {
    const workingDirectory = join(
      tmpdir(),
      "copilot-codex-provider-tests",
      randomUUID()
    );
    const bytes = new Uint8Array([1]);
    const expired = materializeImageInputs(
      [{ mimeType: "image/png", data: bytes }],
      workingDirectory,
      "expired"
    );
    const recent = materializeImageInputs(
      [{ mimeType: "image/png", data: bytes }],
      workingDirectory,
      "recent"
    );
    const now = Date.now();
    const expiredAt = new Date(now - 2 * 60 * 60 * 1000);
    utimesSync(expired.directory!, expiredAt, expiredAt);

    expect(cleanupStaleImageInputs(workingDirectory, now, 60 * 60 * 1000)).toBe(1);
    expect(existsSync(expired.directory!)).toBe(false);
    expect(existsSync(recent.directory!)).toBe(true);

    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("does nothing when the image directory does not exist", () => {
    expect(cleanupStaleImageInputs(join(tmpdir(), randomUUID()))).toBe(0);
  });
});