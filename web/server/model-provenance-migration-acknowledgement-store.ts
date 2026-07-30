import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface PersistedAcknowledgements {
  version: 1;
  acknowledgements: Record<string, number>;
}

function validAcknowledgedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export class ModelProvenanceMigrationAcknowledgementStore {
  private readonly acknowledgements = new Map<string, number>();
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = join(homedir(), ".companion", "model-provenance-migration-acknowledgements.json"),
  ) {}

  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.acknowledgements.clear();
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedAcknowledgements>;
      for (const [eventId, acknowledgedAt] of Object.entries(parsed.acknowledgements ?? {})) {
        if (eventId.trim() && validAcknowledgedAt(acknowledgedAt)) {
          this.acknowledgements.set(eventId, acknowledgedAt);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[model-provenance] Failed to load acknowledgement state:", error);
      }
    }
  }

  getAcknowledgedAt(eventId: string): number | undefined {
    return this.acknowledgements.get(eventId);
  }

  async acknowledge(eventId: string, requestedAt = Date.now()): Promise<number> {
    const normalizedId = eventId.trim();
    if (!normalizedId) throw new Error("Migration event ID is required");
    const existing = this.acknowledgements.get(normalizedId);
    if (existing !== undefined) return existing;

    this.acknowledgements.set(normalizedId, requestedAt);
    const write = this.pendingWrite
      .catch(() => {})
      .then(async () => {
        const payload: PersistedAcknowledgements = {
          version: 1,
          acknowledgements: Object.fromEntries(this.acknowledgements),
        };
        await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      });
    this.pendingWrite = write;
    try {
      await write;
    } catch (error) {
      if (this.acknowledgements.get(normalizedId) === requestedAt) {
        this.acknowledgements.delete(normalizedId);
      }
      throw error;
    }
    return requestedAt;
  }

  async flushForTest(): Promise<void> {
    await this.pendingWrite;
  }
}
