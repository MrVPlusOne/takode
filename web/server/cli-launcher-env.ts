export const NON_INTERACTIVE_GIT_EDITOR_ENV_KEYS = ["GIT_EDITOR", "GIT_SEQUENCE_EDITOR"] as const;

/**
 * Variables a Claude Code session sets for the processes it runs (its Bash
 * tool, or an app hosting it, such as Claude Desktop). They describe that
 * session and how its host logs it in, never a setting for other Claude
 * sessions. A Takode server or `takode node` started from inside a Claude Code
 * session inherits them, and a Claude launched with them behaves like that
 * session's child: the host-auth markers make it expect the host to supply its
 * login, so it reports "Not logged in" instead of using its own.
 */
const PARENT_CLAUDE_SESSION_ENV = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_TMPDIR",
  "CLAUDE_CODE_DIAGNOSTICS_FILE",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_TERMINAL_MCP_TOOLS",
  "USE_LOCAL_OAUTH",
  "USE_STAGING_OAUTH",
  "AI_AGENT",
]);
const PARENT_CLAUDE_SESSION_ENV_PREFIXES = ["CLAUDE_CODE_MESSAGING_"];

/**
 * The part of this process's environment that agents, terminals and helper
 * processes it launches should inherit.
 *
 * Drops OpenTelemetry settings meant for this process and a parent Claude Code
 * session's variables (see `PARENT_CLAUDE_SESSION_ENV`), including the login
 * that session's host supplied in the variable `CLAUDE_CODE_HOST_AUTH_ENV_VAR`
 * names. Also drops empty `ANTHROPIC_*` and `CLAUDE_*` values, which hosts
 * export as unset placeholders. Provider settings a user set on purpose, such
 * as `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_USE_BEDROCK`,
 * are kept.
 */
export function inheritedLaunchEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const hostAuthVar = env.CLAUDE_CODE_HOST_AUTH_ENV_VAR;
  const inherited: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("OTEL_") || key === hostAuthVar || isParentClaudeSessionVar(key)) continue;
    if (value === "" && (key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_"))) continue;
    inherited[key] = value;
  }
  return inherited;
}

/**
 * A startup warning when this process was itself started from inside a Claude
 * Code session, or null. Launched processes do not inherit that session's
 * variables, but the user should know where they came from.
 */
export function parentClaudeSessionWarning(env: NodeJS.ProcessEnv): string | null {
  const found = Object.keys(env).filter(isParentClaudeSessionVar).sort();
  if (found.length === 0) return null;
  return (
    `This process was started from inside a Claude Code session (${found.join(", ")}). ` +
    "Sessions it launches will not inherit that session's variables or login; " +
    "start it from a clean shell to avoid this warning."
  );
}

function isParentClaudeSessionVar(key: string): boolean {
  return PARENT_CLAUDE_SESSION_ENV.has(key) || PARENT_CLAUDE_SESSION_ENV_PREFIXES.some((p) => key.startsWith(p));
}

export function withNonInteractiveGitEditorEnv(env: Record<string, string>): Record<string, string>;
export function withNonInteractiveGitEditorEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined>;
export function withNonInteractiveGitEditorEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
  };
}
