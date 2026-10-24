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
const CACHE_VERSIONS: Record<LocalImageVariantKind, string> = { thumbnail: "v3", full: "v5" };
const THUMBNAIL_MAX_DIM = 300;
const THUMBNAIL_QUALITY = 80;
/**
 * The full view is where people read an image, so it stays close to the original:
 * shrinking screenshots to the agent-reading size blurred their text. Only images
 * too large for a browser to show well are scaled down.
 */
const FULL_MAX_DIM = 4096;
/**
 * How long opening an image waits for its full-view copy before sending the original.
 * Encoding a large screenshot takes about 0.2 s, but several times that while other work
 * loads the machine, and the browser receives nothing meanwhile, whereas the original
 * starts downloading at once. The copy still finishes for later opens.
 */
const DEFAULT_FULL_WAIT_MS = 500;
/** Formats of the original an agent-readable `.takode-agent.` copy is made from, by extension. */
const AGENT_COPY_ORIGINAL_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

interface VariantSource {
  kind: LocalImageVariantKind;
  /** The file the variant is made from: for a full view, the original behind an agent copy. */
  original: LocalImageVariant;
  hash: string;
}

/**
 * Smaller copies of local images for the browser: a thumbnail for the feed and a full view
 * for the image viewer and the Library. Copies are cached on disk by the image's content, so
 * the same picture linked from a chat and saved in the Library is converted once.
 */
export class LocalImageVariantStore {
  private readonly baseDir: string;
  private readonly fullWaitMs: number;
  /** Encodes in progress by cache key, so requests for the same image share one encode. */
  private readonly encoding = new Map<string, Promise<LocalImageVariant>>();
  /** Content hashes by path, size and modification time, so a file is read for its hash once. */
  private readonly contentHashes = new Map<string, string>();

  constructor(baseDir = DEFAULT_BASE_DIR, options: { fullWaitMs?: number } = {}) {
    this.baseDir = baseDir;
    this.fullWaitMs = options.fullWaitMs ?? DEFAULT_FULL_WAIT_MS;
    mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * The cached variant of an image, made on first request. A full view that is not ready
   * within `fullWaitMs` is answered with the original (under its own ETag, so a browser
   * that cached it fetches the smaller copy next time) while the copy keeps encoding.
   */
  async getVariant(
    sourcePath: string,
    sourceContentType: string,
    kind: LocalImageVariantKind,
  ): Promise<LocalImageVariant> {
    const source = await this.sourceFor(sourcePath, sourceContentType, kind);
    const variant = this.variantFor(source);
    if (kind === "thumbnail") return variant;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<null>((resolveWait) => {
      timer = setTimeout(() => resolveWait(null), this.fullWaitMs);
    });
    const ready = await Promise.race([variant, waited]).finally(() => clearTimeout(timer));
    if (ready) return ready;
    variant.catch((error: unknown) =>
      console.warn("[image-variants] Full-view encode failed:", source.original.path, error),
    );
    return { ...source.original, etag: `"${source.hash}-original"` };
  }

  /** Makes an image's thumbnail and full view ahead of time, so they are ready when someone opens it. */
  async prepare(sourcePath: string, sourceContentType: string): Promise<void> {
    for (const kind of ["thumbnail", "full"] as const) {
      await this.variantFor(await this.sourceFor(sourcePath, sourceContentType, kind));
    }
  }

  private async sourceFor(
    sourcePath: string,
    sourceContentType: string,
    kind: LocalImageVariantKind,
  ): Promise<VariantSource> {
    let path = resolve(sourcePath);
    let contentType = sourceContentType;
    if (kind === "full") {
      // Agents often link the reduced copy they read themselves; people get its original.
      const original = await originalOfAgentCopy(path);
      if (original) ({ path, contentType } = original);
    }
    const sourceStat = await stat(path);
    if (!sourceStat.isFile()) {
      throw new Error("image path is not a file");
    }
    const hash = createHash("sha256")
      .update(`${CACHE_VERSIONS[kind]}\0${kind}\0`)
      .update(await this.contentHash(path, sourceStat.size, sourceStat.mtimeMs))
      .digest("hex")
      .slice(0, 32);
    return { kind, hash, original: { path, contentType, cacheHit: false, etag: `"${hash}"` } };
  }

  /** The cached variant, the encode already making it, or a new encode. */
  private async variantFor(source: VariantSource): Promise<LocalImageVariant> {
    if (source.original.contentType === "image/svg+xml") return source.original;
    // Checked before the disk cache, which may hold a variant file that is still being written.
    if (!this.encoding.has(source.hash)) {
      const cached = await this.findCachedVariant(source);
      if (cached) return cached;
    }
    let encoding = this.encoding.get(source.hash);
    if (!encoding) {
      encoding = this.encodeVariant(source).finally(() => this.encoding.delete(source.hash));
      this.encoding.set(source.hash, encoding);
    }
    return encoding;
  }

  private async contentHash(path: string, size: number, mtimeMs: number): Promise<string> {
    const key = `${path}\0${size}\0${mtimeMs}`;
    let hash = this.contentHashes.get(key);
    if (!hash) {
      hash = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      this.contentHashes.set(key, hash);
    }
    return hash;
  }

  private async encodeVariant(source: VariantSource): Promise<LocalImageVariant> {
    await mkdir(this.baseDir, { recursive: true });
    const data = (await readFile(source.original.path)) as Buffer;
    let encoded: Buffer;
    let contentType = source.original.contentType;

    try {
      if (source.kind === "thumbnail") {
        encoded = await createImageThumbnailBuffer(data, { maxDim: THUMBNAIL_MAX_DIM, quality: THUMBNAIL_QUALITY });
        contentType = "image/webp";
      } else {
        const viewable = await optimizeImageBufferForStore(data, contentType, { maxDim: FULL_MAX_DIM });
        if (!viewable.reencoded) return source.original;
        ({ data: encoded, mediaType: contentType } = viewable);
      }
    } catch (error) {
      if (isSharpUnavailableError(error)) {
        if (source.kind === "full") return source.original;
        throw new Error(SHARP_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }

    const variantPath = join(this.baseDir, `${source.kind}-${source.hash}.${MIME_TO_EXT[contentType] ?? "bin"}`);
    await writeFile(variantPath, encoded);
    return { path: variantPath, contentType, cacheHit: false, etag: source.original.etag };
  }

  private async findCachedVariant(source: VariantSource): Promise<LocalImageVariant | null> {
    if (!(await fileExists(this.baseDir))) return null;
    const prefix = `${source.kind}-${source.hash}.`;
    const files = await readdir(this.baseDir);
    const match = files.find((file) => file.startsWith(prefix));
    if (!match) return null;
    return {
      path: join(this.baseDir, match),
      contentType: contentTypeFromExtension(match),
      cacheHit: true,
      etag: source.original.etag,
    };
  }
}

let shared: LocalImageVariantStore | null = null;

/** The server's store, shared by the image routes and background preparation. */
export function sharedLocalImageVariantStore(): LocalImageVariantStore {
  shared ??= new LocalImageVariantStore();
  return shared;
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
