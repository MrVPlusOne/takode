const BASE = "/api";

async function checkServerStatus(
  path: "/health" | "/ready",
  label: "health" | "readiness",
  requireJsonOk = false,
): Promise<boolean> {
  const start = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(10_000),
      ...(requireJsonOk ? { cache: "no-store" as const } : {}),
    });
    const elapsed = performance.now() - start;
    if (elapsed > 5000) {
      console.warn(`[${label}] slow response: ${Math.round(elapsed)}ms`);
    }
    if (!response.ok || !requireJsonOk) return response.ok;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return false;
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch (error) {
    const elapsed = performance.now() - start;
    console.warn(
      `[${label}] failed after ${Math.round(elapsed)}ms:`,
      error instanceof Error ? error.message : error,
      `visibility=${document.visibilityState}`,
    );
    return false;
  }
}

/** Backend process liveness. Keep this separate from application readiness. */
export function checkHealth(): Promise<boolean> {
  return checkServerStatus("/health", "health");
}

/** Production application readiness, including the frontend entry assets. */
export function checkReadiness(): Promise<boolean> {
  return checkServerStatus("/ready", "readiness", true);
}
