import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSettings } from "./settings-manager.js";

const REVIEW_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * The diffs behind published guided reviews, one `<review id>.diff` per review, under
 * ~/.companion/guided-reviews/<server>/ by default. Reviews keep only their small map in
 * session history; browsers fetch the diff when a review is opened, so history stays light.
 */
export class GuidedReviewStore {
  /** Without a root, the default folder is resolved on each use, after settings load. */
  constructor(private readonly rootOverride?: string) {}

  private get root(): string {
    const serverSlug = (getSettings().serverSlug || "local").replace(/[^A-Za-z0-9._-]/g, "_");
    return this.rootOverride ?? join(homedir(), ".companion", "guided-reviews", serverSlug);
  }

  async saveDiff(reviewId: string, diff: string): Promise<void> {
    if (!REVIEW_ID_PATTERN.test(reviewId)) throw new Error("Invalid review id");
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, `${reviewId}.diff`), diff, "utf-8");
  }

  /** The review's diff, or null when there is no such review. */
  async readDiff(reviewId: string): Promise<string | null> {
    if (!REVIEW_ID_PATTERN.test(reviewId)) return null;
    try {
      return await readFile(join(this.root, `${reviewId}.diff`), "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
