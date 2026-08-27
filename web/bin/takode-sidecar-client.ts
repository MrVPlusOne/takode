import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CODEX_SIDECAR_CAPABILITY_HEADER, type CodexSidecarActor } from "../server/codex-sidecar-auth.js";

export type SidecarEnvironment = Record<string, string | undefined>;

export interface TakodeSidecarConnection {
  baseUrl: string;
  capability: string;
}

/** Resolve the Takode API port selected for the current caller. */
export function takodeSidecarPort(environment: SidecarEnvironment): number {
  const hasManagedIdentity = !!environment.COMPANION_SESSION_ID?.trim() && !!environment.COMPANION_AUTH_TOKEN?.trim();
  const candidates = hasManagedIdentity
    ? [environment.COMPANION_PORT, environment.TAKODE_API_PORT]
    : [environment.TAKODE_API_PORT, environment.COMPANION_PORT];
  for (const raw of candidates) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) return parsed;
  }
  return 3456;
}

/** Discover the local Takode sidecar without exposing its opaque capability. */
export async function resolveTakodeSidecarConnection(
  environment: SidecarEnvironment,
): Promise<TakodeSidecarConnection | null> {
  const port = takodeSidecarPort(environment);
  const home = environment.HOME?.trim() || homedir();
  const path = join(home, ".companion", "integrations", `codex-sidecar-${port}.json`);
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as {
      version?: unknown;
      baseUrl?: unknown;
      capability?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.baseUrl !== "string" || typeof parsed.capability !== "string") {
      return null;
    }
    const baseUrl = new URL(parsed.baseUrl);
    if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(baseUrl.hostname)) return null;
    const capability = parsed.capability.trim();
    if (!capability) return null;
    return { baseUrl: baseUrl.toString().replace(/\/$/, ""), capability };
  } catch {
    return null;
  }
}

/** Bind a hook-verified Codex actor and return its short-lived opaque binding id. */
export async function bindTakodeCodexActor(
  connection: TakodeSidecarConnection,
  actor: CodexSidecarActor,
): Promise<string> {
  const response = await fetch(new URL(`${connection.baseUrl}/bind`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CODEX_SIDECAR_CAPABILITY_HEADER]: connection.capability,
    },
    body: JSON.stringify({ actor }),
    signal: AbortSignal.timeout(10_000),
  });
  const value = (await response.json().catch(() => ({}))) as {
    binding?: { id?: unknown };
    error?: unknown;
  };
  const bindingId = value.binding?.id;
  if (!response.ok || typeof bindingId !== "string" || !bindingId) {
    throw new Error(
      typeof value.error === "string" ? value.error : `Takode identity binding failed with HTTP ${response.status}`,
    );
  }
  return bindingId;
}
