import type { MemoryRepoOptions } from "../server/workstream-memory-types.js";

/** Client deadline for one server-run `memory` command; commits and catalog scans can take seconds. */
export const MEMORY_SERVER_COMMAND_TIMEOUT_MS = 60_000;

/** Body of `POST /api/memory/command`: one `memory` invocation run by the server. */
export interface MemoryServerCommandRequest {
  args: string[];
  /** Values the command would otherwise read from the caller's environment. */
  context: {
    /** The server always uses its own server slug, so the caller does not send one. */
    defaults?: Pick<MemoryRepoOptions, "root" | "serverId" | "sessionSpaceSlug">;
    session?: string;
    catalogSessionKey?: string;
  };
  /** Contents of files named on the command line, keyed by the path exactly as given. */
  files?: Record<string, string>;
}
