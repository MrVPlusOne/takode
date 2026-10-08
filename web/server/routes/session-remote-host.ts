import { isAbsolute } from "node:path";
import type { BackendType, CreationStepId } from "../session-types.js";
import type { HostRegistry } from "../remote-host/host-registry.js";
import type { SessionPreparationStatus } from "./sessions-helpers.js";

type Fail = (message: string, status: SessionPreparationStatus, step?: CreationStepId) => never;

/**
 * Validate a session-create request that names a remote host and return the
 * host id, or undefined for a session on this machine. Paths in such a request
 * refer to the host's filesystem, so they are not checked here.
 */
export async function resolveRemoteHostForCreate(options: {
  body: Record<string, unknown>;
  backend: BackendType;
  cwd: string | undefined;
  registry: HostRegistry | undefined;
  fail: Fail;
}): Promise<string | undefined> {
  const { body, backend, cwd, registry, fail } = options;
  if (body.hostId === undefined || body.hostId === null || body.hostId === "") return undefined;
  if (typeof body.hostId !== "string") return fail("hostId must be a string", 400, "resolving_env");
  if (!registry || !(await registry.get(body.hostId))) {
    return fail(`Unknown host: ${body.hostId}`, 400, "resolving_env");
  }
  // These are not supported on remote hosts yet; refuse rather than run them on this machine.
  if (backend !== "claude-sdk") return fail("Sessions on remote hosts currently support Claude only", 400);
  if (body.useWorktree === true) return fail("Worktree sessions are not available on remote hosts yet", 400);
  if (body.assistantMode === true) return fail("Assistant mode is not available on remote hosts", 400);
  if (body.container) return fail("Container sessions are not available on remote hosts", 400);
  if (!cwd || !isAbsolute(cwd)) {
    return fail("A session on a remote host needs an absolute working directory on that host", 400, "resolving_env");
  }
  return body.hostId;
}
