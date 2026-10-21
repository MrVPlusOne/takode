import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createImageThumbnailBuffer,
  fileExists,
  MIME_TO_EXT,
  optimizeImageBufferForStore,
  SHARP_UNAVAILABLE_MESSAGE,
  isSharpUnavailableError,
  TAKODE_AGENT_IMAGE_MARKER,
} from "./image-optimizer.js";

export type LocalImageVariantKind = "thumbnail" | "full";

export interface LocalImageVariant {
  path: string;
  contentType: string;
  cacheHit: boolean;
  /** HTTP entity tag that changes whenever the source file or variant recipe changes. */
  etag: string;
}

const DEFAULT_BASE_DIR = join(homedir(), ".companion", "image-variants");
/** Bumped per kind when its recipe changes, so stale cached variants are not served. */
const CACHE_VERSIONS: Record<LocalImageVariantKind, string> = { thumbnail: "v2", full: "v4" };
const THUMBNAIL_MAX_DIM = 300;
const THUMBNAIL_QUALITY = 80;
/**
 * The full view is where people read an image, so it stays close to the original:
 * shrinking screenshots to the agent-reading size blurred their text. Only images
 * too large for a browser to show well are scaled down.
 */
const FULL_MAX_DIM = 4096;
/** Formats of the original an agent-readable `.takode-agent.` copy is made from, by extension. */
const AGENT_COPY_ORIGINAL_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export class LocalImageVariantStore {
  private readonly baseDir: string;

  constructor(baseDir = DEFAULT_BASE_DIR) {
    this.baseDir = baseDir;
    mkdirSync(this.baseDir, { recursive: true });
  }

  async getVariant(
    sourcePath: string,
    sourceContentType: string,
    kind: LocalImageVariantKind,
  ): Promise<LocalImageVariant> {
    let absolutePath = resolve(sourcePath);
    let contentType = sourceContentType;
    if (kind === "full") {
      // Agents often link the reduced copy they read themselves; people get its original.
      const original = await originalOfAgentCopy(absolutePath);
      if (original) ({ path: absolutePath, contentType } = original);
    }
    const sourceStat = await stat(absolutePath);
    if (!sourceStat.isFile()) {
      throw new Error("image path is not a file");
    }

    const cacheKey = this.cacheKeyFor(absolutePath, sourceStat.size, sourceStat.mtimeMs, kind);
    const etag = `"${cacheKey.hash}"`;
    const sourceVariant = { path: absolutePath, contentType, cacheHit: false, etag };
    if (contentType === "image/svg+xml") return sourceVariant;

    const cached = await this.findCachedVariant(cacheKey, etag);
    if (cached) {
      return cached;
    }

    await mkdir(this.baseDir, { recursive: true });
    const source = (await readFile(absolutePath)) as Buffer;
    let data: Buffer;

    try {
      if (kind === "thumbnail") {
        data = await createImageThumbnailBuffer(source, { maxDim: THUMBNAIL_MAX_DIM, quality: THUMBNAIL_QUALITY });
        contentType = "image/webp";
      } else {
        const viewable = await optimizeImageBufferForStore(source, contentType, { maxDim: FULL_MAX_DIM });
        if (!viewable.reencoded) return sourceVariant;
        ({ data, mediaType: contentType } = viewable);
      }
    } catch (error) {
      if (isSharpUnavailableError(error)) {
        if (kind === "full") return sourceVariant;
        throw new Error(SHARP_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }

    const variantPath = this.variantPathFor(cacheKey, contentType);
    await writeFile(variantPath, data);
    return {
      path: variantPath,
      contentType,
      cacheHit: false,
      etag,
    };
  }

  private cacheKeyFor(
    absolutePath: string,
    sourceSize: number,
    sourceMtimeMs: number,
    kind: LocalImageVariantKind,
  ): { kind: LocalImageVariantKind; hash: string } {
    const key = createHash("sha256")
      .update(CACHE_VERSIONS[kind])
      .update("\0")
      .update(kind)
      .update("\0")
      .update(absolutePath)
      .update("\0")
      .update(String(sourceSize))
      .update("\0")
      .update(String(sourceMtimeMs))
      .digest("hex")
      .slice(0, 32);
    return { kind, hash: key };
  }

  private variantPathFor(key: { kind: LocalImageVariantKind; hash: string }, contentType: string): string {
    const ext = MIME_TO_EXT[contentType] ?? "bin";
    return join(this.baseDir, `${key.kind}-${key.hash}.${ext}`);
  }

  private async findCachedVariant(
    key: {
      kind: LocalImageVariantKind;
      hash: string;
    },
    etag: string,
  ): Promise<LocalImageVariant | null> {
    if (!(await fileExists(this.baseDir))) return null;
    const prefix = `${key.kind}-${key.hash}.`;
    const files = await readdir(this.baseDir);
    const match = files.find((file) => file.startsWith(prefix));
    if (!match) return null;
    return {
      path: join(this.baseDir, match),
      contentType: contentTypeFromExtension(match),
      cacheHit: true,
      etag,
    };
  }
}

/** The original beside a `.takode-agent.` copy (`shot.png` for `shot.takode-agent.jpeg`), if it is still there. */
async function originalOfAgentCopy(path: string): Promise<{ path: string; contentType: string } | null> {
  const name = basename(path);
  const markerAt = name.indexOf(TAKODE_AGENT_IMAGE_MARKER);
  if (markerAt < 0) return null;
  const stem = join(dirname(path), name.slice(0, markerAt));
  for (const [extension, contentType] of Object.entries(AGENT_COPY_ORIGINAL_TYPES)) {
    if (await fileExists(`${stem}.${extension}`)) return { path: `${stem}.${extension}`, contentType };
  }
  return null;
}

function contentTypeFromExtension(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return Object.entries(MIME_TO_EXT).find(([, ext]) => ext === extension)?.[0] ?? "application/octet-stream";
}
