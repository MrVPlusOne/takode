import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME = "model-provenance-migration-acknowledgements.json";

type AcknowledgementWriter = (filePath: string, contents: string) => Promise<void>;

const defaultAcknowledgementWriter: AcknowledgementWriter = async (filePath, contents) => {
  await writeFile(filePath, contents, "utf8");
};

interface PersistedAcknowledgements {
  version: 1;
  acknowledgements: Record<string, number>;
}

function validAcknowledgedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export class ModelProvenanceMigrationAcknowledgementStore {
  private readonly acknowledgements = new Map<string, number>();
  private readonly inFlightAcknowledgements = new Map<string, Promise<number>>();
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = join(homedir(), ".companion", MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME),
    private readonly writer: AcknowledgementWriter = defaultAcknowledgementWriter,
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

  acknowledge(eventId: string, requestedAt = Date.now()): Promise<number> {
    const normalizedId = eventId.trim();
    if (!normalizedId) return Promise.reject(new Error("Migration event ID is required"));
    const existing = this.acknowledgements.get(normalizedId);
    if (existing !== undefined) return Promise.resolve(existing);
    const inFlight = this.inFlightAcknowledgements.get(normalizedId);
    if (inFlight) return inFlight;

    const write = this.pendingWrite
      .catch(() => {})
      .then(async () => {
        const nextAcknowledgements = new Map(this.acknowledgements);
        nextAcknowledgements.set(normalizedId, requestedAt);
        const payload: PersistedAcknowledgements = {
          version: 1,
          acknowledgements: Object.fromEntries(nextAcknowledgements),
        };
        await this.writer(this.filePath, `${JSON.stringify(payload, null, 2)}\n`);
        this.acknowledgements.set(normalizedId, requestedAt);
      });
    this.pendingWrite = write;
    const operation = write.then(() => requestedAt);
    this.inFlightAcknowledgements.set(normalizedId, operation);
    void operation.then(
      () => {
        if (this.inFlightAcknowledgements.get(normalizedId) === operation) {
          this.inFlightAcknowledgements.delete(normalizedId);
        }
      },
      () => {
        if (this.inFlightAcknowledgements.get(normalizedId) === operation) {
          this.inFlightAcknowledgements.delete(normalizedId);
        }
      },
    );
    return operation;
  }

  async flushForTest(): Promise<void> {
    await this.pendingWrite;
  }
}
