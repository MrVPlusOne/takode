import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME = "model-provenance-migration-acknowledgements.json";
export const MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_SUFFIX = ".takode-candidate";
export const MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME = `${MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME}${MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_SUFFIX}`;

type AcknowledgementWriter = (filePath: string, contents: string) => Promise<void>;
type AtomicRename = (candidatePath: string, committedPath: string) => Promise<void>;

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function modelProvenanceMigrationAcknowledgementTempPath(filePath: string): string {
  return `${filePath}${MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_SUFFIX}`;
}

export function isModelProvenanceMigrationAcknowledgementStateFile(fileName: string): boolean {
  return (
    fileName === MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME ||
    fileName === MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME
  );
}

async function removeOwnedCandidate(candidatePath: string): Promise<void> {
  try {
    await unlink(candidatePath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

export async function replaceModelProvenanceMigrationAcknowledgementsAtomically(
  filePath: string,
  contents: string,
  renameFile: AtomicRename = rename,
): Promise<void> {
  const candidatePath = modelProvenanceMigrationAcknowledgementTempPath(filePath);
  await mkdir(dirname(filePath), { recursive: true });
  await removeOwnedCandidate(candidatePath);
  const candidate = await open(candidatePath, "wx", 0o600);
  try {
    await candidate.writeFile(contents, "utf8");
    await candidate.sync();
  } finally {
    await candidate.close();
  }
  await renameFile(candidatePath, filePath);
}

const defaultAcknowledgementWriter: AcknowledgementWriter = replaceModelProvenanceMigrationAcknowledgementsAtomically;

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
      if (!isMissingFile(error)) {
        console.warn("[model-provenance] Failed to load acknowledgement state:", error);
      }
    }
    try {
      await removeOwnedCandidate(modelProvenanceMigrationAcknowledgementTempPath(this.filePath));
    } catch (error) {
      console.warn("[model-provenance] Failed to remove stale acknowledgement candidate:", error);
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
