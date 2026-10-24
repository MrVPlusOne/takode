import { fileURLToPath } from "node:url";

/**
 * How Takode starts its own commands (`takode`, `quest`, `memory`, its MCP
 * servers) with Bun so they start quickly wherever they are run from.
 *
 * When Bun starts, its module resolver reads the full listing of the working
 * directory and of every directory above it, looking for package.json,
 * tsconfig.json, bunfig.toml and node_modules. Listing a directory costs about
 * 0.6 µs per entry, so one with hundreds of thousands of entries (a /tmp full
 * of test leftovers, a shared home on NFS) adds seconds to every start. Bun
 * offers no option to skip it, and compiled Bun binaries do it too.
 *
 * So Takode commands start with `bun --cwd <Takode web folder>`, whose parent
 * folders Bun lists anyway for the command's own imports, and get the caller's
 * directory in {@link CALLER_CWD_ENV}. Their first import, bin/caller-cwd.ts,
 * switches back to it before any other code runs. Changing directory after
 * startup costs nothing: Bun does not list the new directory's parents.
 */

/** Environment variable carrying the directory a Takode command was run from. */
export const CALLER_CWD_ENV = "TAKODE_CALLER_CWD";

/**
 * Bun arguments that start `script` from `webRoot` (by default this checkout's
 * web folder) instead of the caller's directory. Pass the caller's directory
 * in {@link CALLER_CWD_ENV}; see {@link bunCommandEnv}.
 */
export function bunCommandArgs(script: string, args: string[], webRoot = takodeWebRoot()): string[] {
  return ["--cwd", webRoot, script, ...args];
}

// Resolved on use: browser bundles and jsdom tests load modules that import this one, and there
// import.meta.url is not a file URL.
function takodeWebRoot(): string {
  return fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
}

/** `env` plus the caller's directory, for a command started with {@link bunCommandArgs}. */
export function bunCommandEnv<T extends Record<string, string | undefined>>(
  env: T,
  callerCwd: string,
): T & Record<typeof CALLER_CWD_ENV, string> {
  return { ...env, [CALLER_CWD_ENV]: callerCwd };
}
