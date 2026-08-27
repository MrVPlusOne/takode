import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CODEX_SIDECAR_CAPABILITY_HEADER = "x-takode-sidecar-capability";
export const CODEX_SIDECAR_BINDING_HEADER = "x-takode-sidecar-binding";

const CAPABILITY_FILE_VERSION = 1;
const DEFAULT_BINDING_TTL_MS = 5 * 60_000;

export type CodexSidecarActorKind = "takode_session" | "codex_session";

export interface CodexSidecarActor {
  kind: CodexSidecarActorKind;
  sessionId: string;
  turnId?: string;
  toolUseId?: string;
  cwd?: string;
}

export interface CodexSidecarBinding {
  id: string;
  actor: CodexSidecarActor;
  expiresAt: number;
}

export interface CodexSidecarCapabilityFile {
  version: 1;
  baseUrl: string;
  capability: string;
  port: number;
  serverId: string;
}

interface CodexSidecarRegistryOptions {
  port: number;
  serverId: string;
  capability?: string;
  capabilityPath?: string;
  bindingTtlMs?: number;
  now?: () => number;
}

/**
 * Maintains the per-install sidecar capability and short-lived Codex task bindings.
 * A supplied capability keeps tests entirely in memory; production initializes a
 * mode-0600 capability file that the local stdio MCP process can read.
 */
export class CodexSidecarRegistry {
  private capability: string | null;
  private readonly bindings = new Map<string, CodexSidecarBinding>();
  private readonly capabilityPath: string;
  private readonly bindingTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: CodexSidecarRegistryOptions) {
    this.capability = normalizeOpaqueValue(options.capability);
    this.capabilityPath = options.capabilityPath ?? defaultCodexSidecarCapabilityPath(options.port);
    this.bindingTtlMs = options.bindingTtlMs ?? DEFAULT_BINDING_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Ensure the persistent capability exists and return its discovery metadata. */
  async initialize(): Promise<CodexSidecarCapabilityFile> {
    if (this.capability) return this.capabilityFile(this.capability);

    const existing = await this.readCapabilityFile();
    if (existing) {
      this.capability = existing.capability;
      await chmod(this.capabilityPath, 0o600).catch((error) => {
        console.warn(`[codex-sidecar] Unable to restrict ${this.capabilityPath} to mode 0600`, error);
      });
      return existing;
    }

    const capability = randomBytes(32).toString("base64url");
    const data = this.capabilityFile(capability);
    await mkdir(dirname(this.capabilityPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.capabilityPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    await rename(temporaryPath, this.capabilityPath);
    await chmod(this.capabilityPath, 0o600);
    this.capability = capability;
    return data;
  }

  /** Verify the local plugin's per-install capability without leaking it. */
  verifyCapability(candidate: string | undefined): boolean {
    if (!this.capability) throw new Error("Codex sidecar registry has not been initialized");
    const normalized = normalizeOpaqueValue(candidate);
    if (!normalized) return false;
    const expected = Buffer.from(this.capability);
    const actual = Buffer.from(normalized);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Bind a validated Codex task identity to a short-lived opaque handle. */
  bind(actorInput: unknown): CodexSidecarBinding {
    this.deleteExpiredBindings();
    const actor = normalizeCodexSidecarActor(actorInput);
    const binding: CodexSidecarBinding = {
      id: `csb_${randomBytes(24).toString("base64url")}`,
      actor,
      expiresAt: this.now() + this.bindingTtlMs,
    };
    this.bindings.set(binding.id, binding);
    return binding;
  }

  /** Resolve a binding, expiring stale entries before returning. */
  resolveBinding(bindingId: string | undefined): CodexSidecarBinding | null {
    const id = normalizeOpaqueValue(bindingId);
    if (!id) return null;
    const binding = this.bindings.get(id);
    if (!binding) return null;
    this.bindings.delete(id);
    if (binding.expiresAt <= this.now()) {
      return null;
    }
    return binding;
  }

  private deleteExpiredBindings(): void {
    const now = this.now();
    for (const [id, binding] of this.bindings) {
      if (binding.expiresAt <= now) this.bindings.delete(id);
    }
  }

  private capabilityFile(capability: string): CodexSidecarCapabilityFile {
    return {
      version: CAPABILITY_FILE_VERSION,
      baseUrl: `http://127.0.0.1:${this.options.port}/api/integrations/codex`,
      capability,
      port: this.options.port,
      serverId: this.options.serverId,
    };
  }

  private async readCapabilityFile(): Promise<CodexSidecarCapabilityFile | null> {
    try {
      const parsed = JSON.parse(await readFile(this.capabilityPath, "utf-8")) as Partial<CodexSidecarCapabilityFile>;
      const capability = normalizeOpaqueValue(parsed.capability);
      if (
        parsed.version !== CAPABILITY_FILE_VERSION ||
        parsed.port !== this.options.port ||
        parsed.serverId !== this.options.serverId ||
        !capability
      ) {
        return null;
      }
      return this.capabilityFile(capability);
    } catch (error) {
      if (!isMissingFileError(error)) {
        console.warn(`[codex-sidecar] Ignoring unreadable capability file ${this.capabilityPath}`, error);
      }
      return null;
    }
  }
}

/** Return the per-port capability discovery file used by the local MCP process. */
export function defaultCodexSidecarCapabilityPath(port: number): string {
  return join(homedir(), ".companion", "integrations", `codex-sidecar-${port}.json`);
}

/** Normalize and validate the task identity sent by the Codex plugin hook. */
export function normalizeCodexSidecarActor(value: unknown): CodexSidecarActor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("actor is required");
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "takode_session" && raw.kind !== "codex_session") {
    throw new Error("actor.kind must be takode_session or codex_session");
  }
  const sessionId = normalizeBoundedString(raw.sessionId, "actor.sessionId", 256, true)!;
  return {
    kind: raw.kind,
    sessionId,
    ...(normalizeBoundedString(raw.turnId, "actor.turnId", 256) ? { turnId: String(raw.turnId).trim() } : {}),
    ...(normalizeBoundedString(raw.toolUseId, "actor.toolUseId", 256)
      ? { toolUseId: String(raw.toolUseId).trim() }
      : {}),
    ...(normalizeBoundedString(raw.cwd, "actor.cwd", 4096) ? { cwd: String(raw.cwd).trim() } : {}),
  };
}

function normalizeBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  required = false,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new Error(`${label} is required`);
    return undefined;
  }
  if (normalized.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters`);
  return normalized;
}

function normalizeOpaqueValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingFileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
