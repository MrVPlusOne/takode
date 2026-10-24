/**
 * Switches a Takode command back to the directory it was run from. It must be
 * the first import of every command entry point, so no other module reads
 * process.cwd() before it runs. Takode starts its commands from its own web
 * folder so Bun does not list the caller's (possibly huge) parent folders at
 * startup; see shared/bun-command-launch.ts.
 */
import { CALLER_CWD_ENV } from "../shared/bun-command-launch.js";

const callerCwd = process.env[CALLER_CWD_ENV];
if (callerCwd !== undefined) {
  // Processes this command starts get their own working directory, not this one.
  delete process.env[CALLER_CWD_ENV];
  try {
    process.chdir(callerCwd);
  } catch (error) {
    // Carrying on from the Takode folder would apply relative paths and Git commands to the wrong place.
    console.error(`Cannot enter the directory this command was run from (${callerCwd}): ${(error as Error).message}`);
    process.exit(1);
  }
}
