/**
 * Set to "1" by `takode node` in the environment of the session processes it
 * starts for a coordinator on another machine. Takode's data (quests, memory,
 * streams, settings) lives on that coordinator; any copy under this machine's
 * `~/.companion` is not the server's, so CLIs here must not answer from it.
 */
export const REMOTE_HOST_ENV = "TAKODE_REMOTE_HOST";

/** Whether this process runs on a remote host, whose coordinator holds all Takode data. */
export function runsOnRemoteHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REMOTE_HOST_ENV] === "1";
}
