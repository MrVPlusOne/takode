/**
 * Variables Takode sets in the environment of the agent sessions it runs. A test
 * run started from such a session would otherwise pass them to every CLI and
 * server a test spawns: session credentials, the session's server port (on a
 * remote host, the node's proxy) and the remote-host marker that stops CLIs from
 * reading local stores. Tests that need one set it explicitly.
 */
export const TAKODE_SESSION_ENV = [
  "COMPANION_PORT",
  "COMPANION_SERVER_ID",
  "COMPANION_SERVER_SLUG",
  "COMPANION_MEMORY_SPACE_SLUG",
  "COMPANION_SESSION_ID",
  "COMPANION_SESSION_NUMBER",
  "COMPANION_AUTH_TOKEN",
  "TAKODE_ROLE",
  "TAKODE_API_PORT",
  "TAKODE_REMOTE_HOST",
  "TAKODE_NODE_SUPERVISED",
  "TAKODE_CODEX_SESSION_ID",
  "TAKODE_CODEX_TURN_ID",
  "TAKODE_CODEX_TOOL_USE_ID",
  "TAKODE_CODEX_CWD",
  "TAKODE_DELEGATE_ROLE",
  "TAKODE_DELEGATE_ID",
  "TAKODE_DELEGATE_PARENT_SESSION_ID",
] as const;

/**
 * Vitest global setup: remove the session variables before workers start, so
 * tests behave the same whether run from a terminal or from a Takode session on
 * any machine. Workers inherit the cleaned environment.
 */
export default function setup(): void {
  for (const name of TAKODE_SESSION_ENV) delete process.env[name];
}
