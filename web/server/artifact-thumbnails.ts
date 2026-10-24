import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireSharp } from "./image-optimizer.js";
import type { ArtifactLibraryStore } from "./artifact-library-store.js";

/**
 * Small pictures for the Library's gallery: a figure scaled down, or a visual drawn by the
 * server's headless Chrome and scaled down. Each is made once per artifact version (and theme, for
 * visuals), kept on disk beside the library, and served under a URL that names the version, so
 * browsers cache it for good. Other kinds are shown from their text excerpt instead.
 */

/** Longer side of a thumbnail in pixels: two device pixels for a gallery card of up to 240 CSS px. */
export const THUMB_MAX_DIM = 480;
/** A visual is drawn at this CSS width before scaling, so its layout matches a desktop answer. */
const VISUAL_RENDER_WIDTH = 640;
/** Tall visuals keep their top part, at most this many times as tall as wide. */
const VISUAL_MAX_ASPECT = 1;
const THUMB_QUALITY = 72;

export type ThumbTheme = "dark" | "light";

export interface ArtifactThumbnailDeps {
  /**
   * Draws a visual and returns its PNG; null when the visual itself fails (it is not tried again
   * for that version). Throws when drawing is impossible for now, such as without Chrome.
   */
  renderVisual?: (source: string, theme: ThumbTheme, width: number) => Promise<Buffer | null>;
}

export class ArtifactThumbnails {
  private inFlight = new Map<string, Promise<Buffer | null>>();

  constructor(
    private readonly store: ArtifactLibraryStore,
    private readonly deps: ArtifactThumbnailDeps,
  ) {}

  /**
   * The thumbnail of an artifact's newest version, as WebP. Null when it has no picture thumbnail
   * (text kinds, figures not kept) or one could not be made. With `waitForVisual: false`, a visual
   * not drawn yet returns "pending" at once and is drawn in the background.
   */
  async get(
    id: string,
    theme: ThumbTheme,
    options: { waitForVisual?: boolean } = {},
  ): Promise<Buffer | null | "pending"> {
    const source = this.store.thumbnailSource(id);
    if (!source) return null;
    const name = `${source.key}-${source.kind === "visual" ? theme : "any"}.webp`;
    const path = join(this.store.root, "thumbs", name);
    const cached = await readFile(path).catch(() => null);
    if (cached) return cached;
    // A visual that could not be drawn (a timeout, a crash) is not tried again for that version.
    if (
      await readFile(`${path}.none`)
        .then(() => true)
        .catch(() => false)
    )
      return null;
    // Drawing a visual can take seconds; a caller that won't wait gets "pending" while it is drawn.
    const wait = source.kind !== "visual" || options.waitForVisual !== false;
    const running = this.inFlight.get(name);
    if (running) return wait ? running : "pending";
    const making = this.make(source, theme)
      .then(async (data) => {
        await (data ? writeAtomically(path, data) : writeAtomically(`${path}.none`, Buffer.alloc(0)));
        return data;
      })
      .catch((error) => {
        console.error(`[artifact-library] Thumbnail failed for ${id}:`, error);
        return null;
      })
      .finally(() => this.inFlight.delete(name));
    this.inFlight.set(name, making);
    return wait ? making : "pending";
  }

  private async make(
    source: NonNullable<ReturnType<ArtifactLibraryStore["thumbnailSource"]>>,
    theme: ThumbTheme,
  ): Promise<Buffer | null> {
    const sharp = await requireSharp("make Library thumbnails");
    if (source.kind === "figure") {
      return sharp(await readFile(source.filePath))
        .rotate()
        .resize({ width: THUMB_MAX_DIM, height: THUMB_MAX_DIM, fit: "inside", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
    }
    const png = await this.deps.renderVisual?.(await source.visualSource(), theme, VISUAL_RENDER_WIDTH);
    if (!png) return null;
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const keptHeight = Math.min(height, Math.round(width * VISUAL_MAX_ASPECT));
    return sharp(png)
      .extract({ left: 0, top: 0, width, height: keptHeight })
      .resize({ width: THUMB_MAX_DIM, height: THUMB_MAX_DIM, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  }
}

async function writeAtomically(path: string, data: Buffer): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

let active: ArtifactThumbnails | null = null;

export function getArtifactThumbnails(): ArtifactThumbnails | null {
  return active;
}

export function setArtifactThumbnails(thumbnails: ArtifactThumbnails | null): void {
  active = thumbnails;
}
