import { access, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export const STORE_MAX_DIM = 1920;
/**
 * WebP settings per `OptimizeOptions.priority`: one for lossless sources such as
 * screenshots, one for lossy sources such as photos (where a lossless encode would
 * grow the file) and for lossless results over `LOSSLESS_SOURCE_MAX_BYTES`.
 * - size: near-lossless level 60 looks identical and keeps small text crisp at about
 *   40% of the PNG, but takes about 1-1.5 s for a full-size screenshot.
 * - speed: exact lossless pixels at the lowest effort take about 0.1 s, at roughly
 *   the size of the JPEG q85 copies Takode used to make.
 */
const WEBP_SETTINGS: Record<OptimizePriority, { lossless: WebpOptions; lossy: WebpOptions }> = {
  size: { lossless: { quality: 60, nearLossless: true }, lossy: { quality: 90 } },
  speed: { lossless: { lossless: true, effort: 0 }, lossy: { quality: 90, effort: 2 } },
};
/**
 * Largest lossless-source encode kept; a larger one (photo-like content) uses the lossy
 * setting. This keeps every stored image well inside model providers' per-image limits
 * (Claude's is 5 MB).
 */
const LOSSLESS_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const TAKODE_AGENT_IMAGE_MARKER = ".takode-agent.";

export const SHARP_UNAVAILABLE_MESSAGE =
  "Image processing unavailable because sharp failed to load its native runtime.";

export const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

export interface ImageDimensions {
  width?: number;
  height?: number;
  format?: string;
  bytes: number;
}

export interface BufferOptimizationResult {
  data: Buffer;
  mediaType: string;
  before?: ImageDimensions;
  after?: ImageDimensions;
  resized: boolean;
  /** Whether the image was re-encoded (as WebP); false when the source was kept. */
  reencoded: boolean;
}

export interface FileOptimizationResult {
  inputPath: string;
  outputPath: string;
  alreadyOptimized: boolean;
  wroteOutput: boolean;
  resized: boolean;
  reencoded: boolean;
  before?: ImageDimensions;
  after?: ImageDimensions;
}

type OptimizePriority = "size" | "speed";

interface WebpOptions {
  quality?: number;
  nearLossless?: boolean;
  lossless?: boolean;
  effort?: number;
}

interface OptimizeOptions {
  maxDim?: number;
  /**
   * Whether to favour small files (default) or fast encoding; see `WEBP_SETTINGS`.
   * Copies made for models favour speed: agents make one per screenshot, and the
   * extra bytes do not change what the model sees.
   */
  priority?: OptimizePriority;
}

interface OptimizeFileOptions extends OptimizeOptions {
  outputPath?: string;
}

export class SharpUnavailableError extends Error {
  constructor(feature: string) {
    super(`${SHARP_UNAVAILABLE_MESSAGE} (${feature})`);
    this.name = "SharpUnavailableError";
  }
}

export function isSharpUnavailableError(error: unknown): error is SharpUnavailableError {
  return error instanceof SharpUnavailableError;
}

export function setSharpLoaderForTest(loader: (() => Promise<SharpModule>) | null): void {
  sharpLoader = loader ?? defaultSharpLoader;
  sharpModulePromise = null;
  sharpLoadFailureLogged = false;
}

export function resetSharpLoaderForTest(): void {
  setSharpLoaderForTest(null);
}

export async function resizeImageBufferForStore(
  data: Buffer,
  mimeType: string,
  maxDim = STORE_MAX_DIM,
): Promise<Buffer> {
  if (mimeType === "image/svg+xml") return data;
  const sharp = await requireSharp("resize images");
  return resizeRasterForStore(data, sharp, maxDim);
}

/**
 * Compress an image as WebP while keeping it close to the original: lossless sources
 * such as screenshots keep small text crisp where JPEG smeared it, and lossy sources
 * such as photos become quality-90 WebP (see `WEBP_SETTINGS`). Images larger than
 * `maxDim` (default {@link STORE_MAX_DIM}) are scaled down first. Vector and animated
 * images, and images the encode would not make smaller, come back unchanged. This is
 * the one policy for every copy Takode makes: model-readable `.takode-agent.` files,
 * chat uploads, quest attachments and the image viewer's full view.
 */
export async function optimizeImageBufferForStore(
  data: Buffer,
  mimeType: string,
  options: OptimizeOptions = {},
): Promise<BufferOptimizationResult> {
  if (mimeType === "image/svg+xml") {
    const svg = { bytes: data.length, format: "svg" };
    return { data, mediaType: mimeType, resized: false, reencoded: false, before: svg, after: svg };
  }

  const sharp = await requireSharp("optimize images");
  const maxDim = options.maxDim ?? STORE_MAX_DIM;

  try {
    const meta = await sharp(data).metadata();
    const before = dimensionsFromMetadata(meta, data.length);
    const unchanged = {
      data,
      mediaType: mimeTypeFromSharpFormat(meta.format) ?? mimeType,
      before,
      after: before,
      resized: false,
      reencoded: false,
    };
    if ((meta.pages ?? 1) > 1) return unchanged;

    const resized = exceedsMaxDim(meta, maxDim);
    const settings = WEBP_SETTINGS[options.priority ?? "size"];
    const encode = (webp: WebpOptions) => {
      let pipeline = sharp(data).rotate();
      if (resized)
        pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
      return pipeline.webp(webp).toBuffer();
    };
    let encoded = isLosslessRasterFormat(meta.format) ? await encode(settings.lossless) : null;
    if (!encoded || encoded.length > LOSSLESS_SOURCE_MAX_BYTES) encoded = await encode(settings.lossy);
    if (!resized && encoded.length >= data.length) return unchanged;

    const afterMeta = await sharp(encoded).metadata();
    return {
      data: encoded,
      mediaType: "image/webp",
      before,
      after: dimensionsFromMetadata(afterMeta, encoded.length),
      resized,
      reencoded: true,
    };
  } catch (err) {
    console.warn("[image-optimizer] Failed to optimize image buffer, keeping original:", err);
    return {
      data,
      mediaType: mimeType,
      resized: false,
      reencoded: false,
      before: { bytes: data.length },
      after: { bytes: data.length },
    };
  }
}

/** A small WebP preview for the feed: `maxDim` (default 300) on its longer side, at `quality` (default 80). */
export async function createImageThumbnailBuffer(
  data: Buffer,
  options: { maxDim?: number; quality?: number } = {},
): Promise<Buffer> {
  const sharp = await requireSharp("create image thumbnails");
  return sharp(data)
    .rotate()
    .resize({ width: options.maxDim ?? 300, height: options.maxDim ?? 300, fit: "inside", withoutEnlargement: true })
    .webp({ quality: options.quality ?? 80 })
    .toBuffer();
}

/**
 * Write the model-readable `.takode-agent.` copy of an image file beside it, favouring
 * encode speed (see `OptimizeOptions.priority`). A path already marked is left alone.
 */
export async function optimizeAgentImageFile(
  inputPath: string,
  options: OptimizeFileOptions = {},
): Promise<FileOptimizationResult> {
  const fileStat = await stat(inputPath);

  if (isTakodeAgentOptimizedPath(inputPath)) {
    return {
      inputPath,
      outputPath: inputPath,
      alreadyOptimized: true,
      wroteOutput: false,
      resized: false,
      reencoded: false,
      before: { bytes: fileStat.size },
      after: { bytes: fileStat.size },
    };
  }

  const original = (await readFile(inputPath)) as Buffer;
  const sharp = await requireSharp("optimize image files");
  let meta: SharpMetadata;
  try {
    meta = await sharp(original).metadata();
  } catch (err) {
    throw new Error(`Could not read image metadata for ${inputPath}: ${(err as Error).message}`);
  }

  const inputMimeType = mimeTypeFromSharpFormat(meta.format) ?? mimeTypeFromExtension(inputPath);
  const optimized = await optimizeImageBufferForStore(original, inputMimeType, { priority: "speed", ...options });
  const outputPath = options.outputPath ?? buildTakodeAgentImagePath(inputPath, optimized.mediaType);

  if (outputPath === inputPath) {
    return {
      inputPath,
      outputPath,
      alreadyOptimized: true,
      wroteOutput: false,
      resized: optimized.resized,
      reencoded: optimized.reencoded,
      before: optimized.before,
      after: optimized.after,
    };
  }

  await writeFile(outputPath, optimized.data);
  return {
    inputPath,
    outputPath,
    alreadyOptimized: false,
    wroteOutput: true,
    resized: optimized.resized,
    reencoded: optimized.reencoded,
    before: optimized.before,
    after: optimized.after,
  };
}

export function buildTakodeAgentImagePath(inputPath: string, mediaType = "image/webp"): string {
  const ext = MIME_TO_EXT[mediaType] ?? (extname(inputPath).replace(/^\./, "") || "bin");
  const inputBase = basename(inputPath);
  const inputExt = extname(inputBase);
  const baseWithoutExt = inputExt ? inputBase.slice(0, -inputExt.length) : inputBase;
  return join(dirname(inputPath), `${baseWithoutExt}.takode-agent.${ext}`);
}

export function buildStoredImageFilename(imageId: string, mediaType: string, options: { optimized: boolean }): string {
  const ext = MIME_TO_EXT[mediaType] ?? "bin";
  return options.optimized ? `${imageId}.takode-agent.${ext}` : `${imageId}.orig.${ext}`;
}

export function isTakodeAgentOptimizedPath(path: string): boolean {
  return basename(path).includes(TAKODE_AGENT_IMAGE_MARKER);
}

export function wasImageBufferProcessed(result: Pick<BufferOptimizationResult, "resized" | "reencoded">): boolean {
  return result.resized || result.reencoded;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function requireSharp(feature: string): Promise<SharpModule> {
  const sharp = await loadSharp();
  if (!sharp) {
    throw new SharpUnavailableError(feature);
  }
  return sharp;
}

interface SharpMetadata {
  width?: number;
  height?: number;
  format?: string;
  /** Frame count of an animated image. */
  pages?: number;
}

interface SharpPipeline {
  metadata(): Promise<SharpMetadata>;
  rotate(): SharpPipeline;
  resize(options: { width: number; height: number; fit: "inside"; withoutEnlargement?: boolean }): SharpPipeline;
  webp(options: WebpOptions): SharpPipeline;
  toBuffer(): Promise<Buffer>;
  toFile(path: string): Promise<unknown>;
}

export type SharpModule = (input: Buffer) => SharpPipeline;

const LOSSLESS_RASTER_FORMATS = new Set(["png", "gif", "bmp", "tiff", "tif"]);

const defaultSharpLoader = async (): Promise<SharpModule> => {
  const module = (await import("sharp")) as { default?: SharpModule };
  const sharp = module.default;
  if (!sharp) {
    throw new Error("sharp module did not expose a default export");
  }
  return sharp;
};

let sharpLoader: () => Promise<SharpModule> = defaultSharpLoader;
let sharpModulePromise: Promise<SharpModule | null> | null = null;
let sharpLoadFailureLogged = false;

async function resizeRasterForStore(data: Buffer, sharp: SharpModule, maxDim = STORE_MAX_DIM): Promise<Buffer> {
  try {
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return data;
    if (meta.width <= maxDim && meta.height <= maxDim) return data;
    return await sharp(data)
      .rotate()
      .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
      .toBuffer();
  } catch (err) {
    console.warn("[image-optimizer] Failed to resize image, saving original:", err);
    return data;
  }
}

async function loadSharp(): Promise<SharpModule | null> {
  if (!sharpModulePromise) {
    sharpModulePromise = sharpLoader().catch((err) => {
      if (!sharpLoadFailureLogged) {
        sharpLoadFailureLogged = true;
        console.warn("[image-optimizer] sharp unavailable, image processing disabled:", err);
      }
      return null;
    });
  }
  return sharpModulePromise;
}

function dimensionsFromMetadata(meta: SharpMetadata, bytes: number): ImageDimensions {
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format,
    bytes,
  };
}

function exceedsMaxDim(meta: SharpMetadata, maxDim: number): boolean {
  return Boolean(meta.width && meta.height && (meta.width > maxDim || meta.height > maxDim));
}

function isLosslessRasterFormat(format: string | undefined): boolean {
  return Boolean(format && LOSSLESS_RASTER_FORMATS.has(format));
}

function mimeTypeFromSharpFormat(format: string | undefined): string | undefined {
  if (!format) return undefined;
  if (format === "jpg") return "image/jpeg";
  if (format === "svg") return "image/svg+xml";
  return `image/${format}`;
}

function mimeTypeFromExtension(path: string): string {
  const ext = extname(path).toLowerCase().replace(/^\./, "");
  const match = Object.entries(MIME_TO_EXT).find(([, value]) => value === ext);
  return match?.[0] ?? "application/octet-stream";
}
