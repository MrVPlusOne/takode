import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkTrack } from "./work-tracks.js";

const TRACKS_DIR = join(homedir(), ".companion", "work-tracks");

/**
 * Declared tracks, one JSON file per server. A closed track stays on record
 * (with `closedAt`) so its name and history remain readable; only open tracks
 * take part in spawning and name checks. Writes are chained so they land in order.
 */
export class WorkTrackStore {
  private readonly filePath: string;
  private tracks: WorkTrack[] | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    namespace = "default",
    private readonly baseDir = TRACKS_DIR,
  ) {
    this.filePath = join(baseDir, `${namespace.trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "default"}.json`);
  }

  /** Open tracks, plus closed ones when asked, oldest first. */
  async list(options?: { closed?: boolean }): Promise<WorkTrack[]> {
    return (await this.load()).filter((track) => options?.closed || !track.closedAt);
  }

  /** The open track with this name, or null. */
  async get(name: string): Promise<WorkTrack | null> {
    return (await this.load()).find((track) => !track.closedAt && sameName(track.name, name)) ?? null;
  }

  async add(track: WorkTrack): Promise<void> {
    const tracks = await this.load();
    if (tracks.some((other) => !other.closedAt && sameName(other.name, track.name))) {
      throw new Error(`A track named ${track.name} is already open`);
    }
    tracks.push(track);
    await this.save(tracks);
  }

  async close(name: string, now = Date.now()): Promise<WorkTrack | null> {
    const tracks = await this.load();
    const track = tracks.find((candidate) => !candidate.closedAt && sameName(candidate.name, name));
    if (!track) return null;
    track.closedAt = now;
    await this.save(tracks);
    return track;
  }

  private async load(): Promise<WorkTrack[]> {
    if (this.tracks) return this.tracks;
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf-8")) as { tracks?: WorkTrack[] };
      this.tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
    } catch (error) {
      // An unreadable file must not read as "no tracks": the next save would overwrite it.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Cannot read the declared tracks in ${this.filePath}: ${error}`);
      }
      this.tracks = [];
    }
    return this.tracks;
  }

  private async save(tracks: WorkTrack[]): Promise<void> {
    const serialized = JSON.stringify({ version: 1, tracks }, null, 2);
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.baseDir, { recursive: true });
        await writeFile(this.filePath, serialized, "utf-8");
      });
    await this.pendingWrite;
  }
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
