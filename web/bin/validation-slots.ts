import { apiGet, getBase } from "./takode-core.js";

/**
 * Validation lease pools can hold several slots at once. Each slot number maps
 * to its own ports, state directory and browser session, so parallel holders
 * never share a server, a HOME or a browser.
 */

export const DEV_SERVER_LEASE = "dev-server:companion";
export const AGENT_BROWSER_LEASE = "agent-browser";

export interface DevServerSlot {
  slot: number;
  backendPort: number;
  vitePort: number;
  /** Owned by the slot's current holder: HOME, logs and the running-server record. */
  stateDir: string;
  /** HOME for the validation backend and Vite. */
  home: string;
}

/**
 * Resources of a `dev-server:companion` slot. The port ranges stay clear of the
 * live server (3456) and the default `make dev` ports (3457 and 5174).
 */
export function devServerSlot(slot: number): DevServerSlot {
  const stateDir = `/tmp/takode-validation/dev-server-${slot}`;
  return { slot, backendPort: 3470 + slot, vitePort: 5180 + slot, stateDir, home: `${stateDir}/home` };
}

/**
 * Environment for a slot's backend and Vite. Agent shells inherit the live
 * server's identity (server ID, frontend snapshot, supervision, session
 * credentials), which a validation server must not adopt. Its OpenAI calls use
 * the user's test key; an inherited OPENAI_API_KEY may be the live key, so it
 * is dropped, and without a test key the slot has none.
 */
export function validationServerEnv(
  inherited: NodeJS.ProcessEnv,
  res: DevServerSlot,
  openAITestKey: string | null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !key.startsWith("COMPANION_") && !key.startsWith("TAKODE_") && key !== "OPENAI_API_KEY",
    ),
  );
  if (openAITestKey) env.OPENAI_API_KEY = openAITestKey;
  return { ...env, HOME: res.home, PORT: String(res.backendPort), NODE_ENV: "development" };
}

/** agent-browser session name of an `agent-browser` slot. */
export function agentBrowserSession(slot: number): string {
  return `takode-browser-${slot}`;
}

/**
 * Slot the calling Takode session holds in `resourceKey`, or null when it holds
 * none or runs outside a Takode session. Throws when the server can't be asked.
 */
export async function findHeldSlot(resourceKey: string): Promise<number | null> {
  // Only the session's own env counts: the takode CLI's auth-file fallback can
  // exit the process, which a browser wrapper used outside Takode must not do.
  const sessionId = process.env.COMPANION_SESSION_ID;
  if (!sessionId || !process.env.COMPANION_AUTH_TOKEN) return null;
  const response = (await apiGet(getBase([]), `/resource-leases/${encodeURIComponent(resourceKey)}`)) as {
    resource: { leases: Array<{ slot: number; ownerSessionId: string }> };
  };
  return response.resource.leases.find((lease) => lease.ownerSessionId === sessionId)?.slot ?? null;
}
