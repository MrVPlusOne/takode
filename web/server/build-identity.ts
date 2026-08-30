import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const TAKODE_BUILD_ID_ENV = "TAKODE_BUILD_ID";
export const TAKODE_BUILD_MANIFEST_FILENAME = "takode-build.json";
export const TAKODE_BUILD_MANIFEST_VERSION = 1;
export const TAKODE_DEVELOPMENT_BUILD_ID = "development";

const MAX_BUILD_ID_LENGTH = 128;
const MAX_BUILD_MANIFEST_BYTES = 4 * 1024;
const BUILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface TakodeBuildManifest {
  version: typeof TAKODE_BUILD_MANIFEST_VERSION;
  buildId: string;
}

export interface TakodeBuildEnvironment {
  NODE_ENV?: string;
  TAKODE_BUILD_ID?: string;
}

/** Normalizes an opaque build ID, rejecting values unsafe for compact JSON and logs. */
export function normalizeTakodeBuildId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_BUILD_ID_LENGTH || !BUILD_ID_RE.test(normalized)) return null;
  return normalized;
}

/** Creates a fresh opaque identity for one production frontend build. */
export function generateTakodeBuildId(uuid: () => string = randomUUID): string {
  return `build-${uuid()}`;
}

export function createTakodeBuildManifest(buildId: string): TakodeBuildManifest {
  const normalized = normalizeTakodeBuildId(buildId);
  if (!normalized) throw new Error("Invalid Takode build ID");
  return { version: TAKODE_BUILD_MANIFEST_VERSION, buildId: normalized };
}

export function serializeTakodeBuildManifest(buildId: string): string {
  return `${JSON.stringify(createTakodeBuildManifest(buildId))}\n`;
}

export async function readTakodeBuildManifest(frontendRoot: string): Promise<TakodeBuildManifest> {
  const manifestPath = join(resolve(frontendRoot), TAKODE_BUILD_MANIFEST_FILENAME);
  const source = await readFile(manifestPath, "utf-8");
  if (Buffer.byteLength(source, "utf-8") > MAX_BUILD_MANIFEST_BYTES) {
    throw new Error("Takode build manifest is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Takode build manifest is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Takode build manifest must be an object");
  }

  const candidate = parsed as { version?: unknown; buildId?: unknown };
  const buildId = normalizeTakodeBuildId(candidate.buildId);
  if (candidate.version !== TAKODE_BUILD_MANIFEST_VERSION || !buildId) {
    throw new Error("Takode build manifest has an unsupported shape");
  }
  return { version: TAKODE_BUILD_MANIFEST_VERSION, buildId };
}

/** Returns the identity advertised by this backend process. */
export function getTakodeProcessBuildId(environment: TakodeBuildEnvironment = process.env): string | null {
  if (environment.NODE_ENV !== "production") return TAKODE_DEVELOPMENT_BUILD_ID;
  return normalizeTakodeBuildId(environment.TAKODE_BUILD_ID);
}
