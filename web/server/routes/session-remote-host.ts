import type { Context } from "hono";
import { isAbsolute } from "node:path";
import type { CreationStepId } from "../session-types.js";
import type { HostRegistry } from "../remote-host/host-registry.js";
import { hostIsOnline } from "../remote-host/session-machine.js";
import type { SessionPreparationStatus } from "./sessions-helpers.js";

type Fail = (message: string, status: SessionPreparationStatus, step?: CreationStepId) => never;

/**
 * Validate a session-create request that names a remote host and return the
 * host id, or undefined for a session on this machine. Paths in such a request
 * refer to the host's filesystem, so they are not checked here.
 */
export async function resolveRemoteHostForCreate(options: {
  body: Record<string, unknown>;
  cwd: string | undefined;
  registry: HostRegistry | undefined;
  fail: Fail;
}): Promise<string | undefined> {
  const { body, cwd, registry, fail } = options;
  if (body.hostId === undefined || body.hostId === null || body.hostId === "") return undefined;
  if (typeof body.hostId !== "string") return fail("hostId must be a string", 400, "resolving_env");
  if (!registry || !(await registry.get(body.hostId))) {
    return fail(`Unknown host: ${body.hostId}`, 400, "resolving_env");
  }
  // These are not supported on remote hosts; refuse rather than run them on this machine.
  if (body.assistantMode === true) return fail("Assistant mode is not available on remote hosts", 400);
  if (body.container) return fail("Container sessions are not available on remote hosts", 400);
  if (!cwd || !isAbsolute(cwd)) {
    return fail("A session on a remote host needs an absolute working directory on that host", 400, "resolving_env");
  }
  return body.hostId;
}

/**
 * Answer for a request that a remote host could not serve: 503 naming the host
 * when it is offline, otherwise 502 with the error the host reported.
 */
export async function remoteHostFailure(
  c: Context,
  error: unknown,
  hostId: string,
  registry: HostRegistry | undefined,
): Promise<Response> {
  if (!hostIsOnline(hostId)) {
    const name = (await registry?.get(hostId))?.name ?? hostId;
    return c.json({ error: `Host ${name} is offline` }, 503);
  }
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
}
