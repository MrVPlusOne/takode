const BASE = "/api";

export interface ServerStatusProbe {
  ok: boolean;
  buildId: string | null;
}

function normalizeBuildId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function probeServerStatus(
  path: "/health" | "/ready",
  label: "health" | "readiness",
): Promise<ServerStatusProbe> {
  const start = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const elapsed = performance.now() - start;
    if (elapsed > 5000) {
      console.warn(`[${label}] slow response: ${Math.round(elapsed)}ms`);
    }
    if (!response.ok) return { ok: false, buildId: null };

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return { ok: false, buildId: null };
    }

    const body = (await response.json().catch(() => null)) as { ok?: unknown; buildId?: unknown } | null;
    if (body?.ok !== true) return { ok: false, buildId: null };
    return { ok: true, buildId: normalizeBuildId(body.buildId) };
  } catch (error) {
    const elapsed = performance.now() - start;
    console.warn(
      `[${label}] failed after ${Math.round(elapsed)}ms:`,
      error instanceof Error ? error.message : error,
      `visibility=${document.visibilityState}`,
    );
    return { ok: false, buildId: null };
  }
}

/** Backend process liveness plus its server-authored build identity when available. */
export function checkHealthStatus(): Promise<ServerStatusProbe> {
  return probeServerStatus("/health", "health");
}

/** Production application readiness plus its server-authored build identity when available. */
export function checkReadinessStatus(): Promise<ServerStatusProbe> {
  return probeServerStatus("/ready", "readiness");
}

/** Backend process liveness. Keep this separate from application readiness. */
export async function checkHealth(): Promise<boolean> {
  return (await checkHealthStatus()).ok;
}

/** Production application readiness, including the frontend entry assets. */
export async function checkReadiness(): Promise<boolean> {
  return (await checkReadinessStatus()).ok;
}
