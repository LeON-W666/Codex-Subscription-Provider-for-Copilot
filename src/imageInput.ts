import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeImageInput } from "./protocol";

const MAX_IMAGE_COUNT = 20;
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_STALE_IMAGE_AGE_MS = 24 * 60 * 60 * 1000;
const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

export interface MaterializedImageInput {
  readonly directory: string | undefined;
  readonly paths: readonly string[];
}

export function materializeImageInputs(
  images: readonly BridgeImageInput[],
  workingDirectory: string,
  requestId: string
): MaterializedImageInput {
  if (images.length === 0) return { directory: undefined, paths: [] };
  if (images.length > MAX_IMAGE_COUNT) {
    throw new Error(`Copilot supplied ${images.length} images; at most ${MAX_IMAGE_COUNT} images are supported per request.`);
  }
  const totalBytes = images.reduce((sum, image) => sum + image.data.byteLength, 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error(`Copilot image input is ${formatMiB(totalBytes)} MiB; the per-request limit is ${formatMiB(MAX_TOTAL_IMAGE_BYTES)} MiB.`);
  }

  const directory = join(workingDirectory, "image-inputs", requestId);
  mkdirSync(directory, { recursive: true });
  try {
    const paths = images.map((image, index) => {
      if (image.data.byteLength === 0) throw new Error(`Copilot image ${index + 1} is empty.`);
      const mimeType = image.mimeType.split(";", 1)[0]?.trim().toLowerCase();
      const extension = mimeType === undefined ? undefined : EXTENSION_BY_MIME_TYPE[mimeType];
      if (extension === undefined) {
        throw new Error(`Copilot image ${index + 1} has unsupported MIME type "${image.mimeType}". Supported types: PNG, JPEG, WebP, and GIF.`);
      }
      const path = join(directory, `image-${index + 1}${extension}`);
      writeFileSync(path, image.data, { flag: "wx" });
      return path;
    });
    return { directory, paths };
  } catch (error) {
    cleanupImageInputs(directory);
    throw error;
  }
}

export function cleanupStaleImageInputs(
  workingDirectory: string,
  now = Date.now(),
  maxAgeMs = DEFAULT_STALE_IMAGE_AGE_MS
): number {
  const imageRoot = join(workingDirectory, "image-inputs");
  let entries;
  try {
    entries = readdirSync(imageRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(imageRoot, entry.name);
    try {
      if (now - statSync(directory).mtimeMs < maxAgeMs) continue;
      cleanupImageInputs(directory);
      removed += 1;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  return removed;
}

export function cleanupImageInputs(directory: string | undefined): void {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
