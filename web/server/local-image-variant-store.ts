import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_QUALITY,
  createImageThumbnailBuffer,
  fileExists,
  MIME_TO_EXT,
  optimizeImageBufferForStore,
  SHARP_UNAVAILABLE_MESSAGE,
  isSharpUnavailableError,
} from "./image-optimizer.js";

export type LocalImageVariantKind = "thumbnail" | "full";

export interface LocalImageVariant {
  path: string;
  contentType: string;
  cacheHit: boolean;
}

const DEFAULT_BASE_DIR = join(homedir(), ".companion", "image-variants");
const CACHE_VERSION = "v1";
const THUMBNAIL_MAX_DIM = 300;
const THUMBNAIL_QUALITY = 80;

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
    const absolutePath = resolve(sourcePath);
    const sourceStat = await stat(absolutePath);
    if (!sourceStat.isFile()) {
      throw new Error("image path is not a file");
    }

    if (sourceContentType === "image/svg+xml") {
      return {
        path: absolutePath,
        contentType: sourceContentType,
        cacheHit: false,
      };
    }

    const cacheKey = this.cacheKeyFor(absolutePath, sourceStat.size, sourceStat.mtimeMs, kind);
    const cached = await this.findCachedVariant(cacheKey);
    if (cached) {
      return cached;
    }

    await mkdir(this.baseDir, { recursive: true });
    const source = (await readFile(absolutePath)) as Buffer;
    let data: Buffer;
    let contentType = kind === "thumbnail" ? "image/jpeg" : sourceContentType;

    try {
      if (kind === "thumbnail") {
        data = await createImageThumbnailBuffer(source, sourceContentType, {
          maxDim: THUMBNAIL_MAX_DIM,
          jpegQuality: THUMBNAIL_QUALITY,
        });
        contentType = "image/jpeg";
      } else {
        const optimized = await optimizeImageBufferForStore(source, sourceContentType, {
          jpegQuality: AGENT_QUALITY,
        });
        data = optimized.data;
        contentType = optimized.mediaType;
      }
    } catch (error) {
      if (isSharpUnavailableError(error)) {
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
    };
  }

  private cacheKeyFor(
    absolutePath: string,
    sourceSize: number,
    sourceMtimeMs: number,
    kind: LocalImageVariantKind,
  ): { kind: LocalImageVariantKind; hash: string } {
    const key = createHash("sha256")
      .update(CACHE_VERSION)
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

  private async findCachedVariant(key: {
    kind: LocalImageVariantKind;
    hash: string;
  }): Promise<LocalImageVariant | null> {
    if (!(await fileExists(this.baseDir))) return null;
    const prefix = `${key.kind}-${key.hash}.`;
    const files = await readdir(this.baseDir);
    const match = files.find((file) => file.startsWith(prefix));
    if (!match) return null;
    return {
      path: join(this.baseDir, match),
      contentType: contentTypeFromExtension(match),
      cacheHit: true,
    };
  }
}

function contentTypeFromExtension(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return Object.entries(MIME_TO_EXT).find(([, ext]) => ext === extension)?.[0] ?? "application/octet-stream";
}
