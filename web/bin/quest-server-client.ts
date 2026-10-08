/**
 * The Takode server is the only writer of quest data. Quest CLI mutations go
 * through this client instead of touching the store files, so a CLI that runs
 * on another machine can never write a divergent local copy.
 */

/** Generous on purpose: once the request is sent, the server owns the write. */
export const QUEST_SERVER_TIMEOUT_MS = 30_000;

export type QuestServerResponse<T> = { value: T; headers: Headers };

/** Reads give up on the server sooner than writes and fall back to the local store. */
export const QUEST_SERVER_READ_TIMEOUT_MS = 5_000;

export interface QuestServerClient {
  /** Send one request to `/api<path>` and return the parsed JSON body, or exit with a clear error. */
  request<T>(method: string, path: string, body?: unknown): Promise<QuestServerResponse<T>>;
  /**
   * GET `/api<path>` from the server's cached store. Returns undefined when no
   * server is configured or it does not answer with the data (including 404),
   * so the caller reads the local store instead and keeps its usual messages.
   */
  read<T>(path: string): Promise<T | undefined>;
}

/**
 * Build the client for one CLI invocation. `port` is undefined when neither
 * COMPANION_PORT nor session credentials name a server; writes then fail
 * instead of guessing a server whose data may not belong to this caller.
 */
export function createQuestServerClient(deps: {
  port: string | undefined;
  authHeaders: (extra?: Record<string, string>) => Record<string, string>;
  die: (message: string) => never;
}): QuestServerClient {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<QuestServerResponse<T>> {
      const port = deps.port;
      if (!port) {
        deps.die(
          "No Takode server is configured for this command. Quest changes are written by the Takode server: " +
            "run it from a Takode session or set COMPANION_PORT to the server's port.",
        );
      }
      const isForm = body instanceof FormData;
      const headers = deps.authHeaders(body === undefined || isForm ? {} : { "Content-Type": "application/json" });
      let response: Response;
      try {
        response = await fetch(`http://localhost:${port}/api${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
          signal: AbortSignal.timeout(QUEST_SERVER_TIMEOUT_MS),
        });
      } catch (error) {
        deps.die(describeRequestFailure(error, port));
      }
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
        deps.die(failure.error || response.statusText);
      }
      return { value: (await response.json()) as T, headers: response.headers };
    },
    async read<T>(path: string): Promise<T | undefined> {
      if (!deps.port) return undefined;
      try {
        const response = await fetch(`http://localhost:${deps.port}/api${path}`, {
          headers: deps.authHeaders(),
          signal: AbortSignal.timeout(QUEST_SERVER_READ_TIMEOUT_MS),
        });
        return response.ok ? ((await response.json()) as T) : undefined;
      } catch {
        // Reads are safe to answer from the local store when the server is down.
        return undefined;
      }
    },
  };
}

function describeRequestFailure(error: unknown, port: string): string {
  const server = `the Takode server at http://localhost:${port}`;
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return (
      `${capitalize(server)} did not answer within ${QUEST_SERVER_TIMEOUT_MS / 1000}s. ` +
      "The change may still have been applied: check with `quest show` before retrying."
    );
  }
  return (
    `Cannot reach ${server}. Quest changes are written by the server: ` +
    "start Takode (or correct COMPANION_PORT) and retry."
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
