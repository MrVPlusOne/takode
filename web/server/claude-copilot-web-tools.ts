/**
 * Web tools for Claude sessions whose model API is GitHub Copilot.
 *
 * Copilot's Anthropic endpoint rejects Claude's server-side web search ("The
 * use of the web search tool is not supported"). WebFetch breaks too: without
 * a Haiku model configured, Claude Code summarizes fetched pages with the main
 * model and asks for thinking to be off, which Opus 5.5 refuses.
 *
 * Only Claude knows where it sends requests (a launcher's `--settings` file,
 * user settings, or its environment), so Takode asks the running process for
 * its effective settings. On Copilot it adds a `web_search` MCP tool that Claude
 * starts on its own machine (bin/takode-web-search-mcp.ts), turns WebSearch
 * calls away toward it, and points Claude's helper model at Haiku 4.5. Every
 * other Claude session keeps its built-in tools unchanged.
 */
import type { HookCallbackMatcher, HookEvent, Query } from "@anthropic-ai/claude-agent-sdk";

const WEB_SEARCH_SERVER = "takode-web";
const WEB_SEARCH_TOOL = `mcp__${WEB_SEARCH_SERVER}__web_search`;
/** Installed in ~/.companion/bin on every machine running Takode, which is on Claude's PATH. */
const WEB_SEARCH_COMMAND = "takode-web-search-mcp";
/**
 * Claude Code knows this Haiku ID's capabilities (no reasoning effort), and
 * Copilot accepts it as well as its own `claude-haiku-4.5`.
 */
const COPILOT_HELPER_MODEL = "claude-haiku-4-5";
/** Variables through which a user has already chosen Claude's helper model. */
const HELPER_MODEL_VARIABLES = ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL"];

type Env = Record<string, string | undefined>;

/** The parts of Claude's effective settings this module reads. */
type ClaudeSettings = { env?: Env; apiKeyHelper?: string };

/**
 * Claude Code answers `getSettings()` (effective settings merged from every
 * source), but the SDK's `Query` type does not declare it yet.
 */
type SettingsQuery = Pick<Query, "setMcpServers" | "applyFlagSettings"> & {
  getSettings?: () => Promise<{ effective?: ClaudeSettings } | undefined>;
};

/**
 * Claude's Copilot API address when its model requests go to GitHub Copilot
 * (`api.githubcopilot.com` or an account-specific `*.githubcopilot.com` host),
 * otherwise null. Claude's settings win over the environment it was started with.
 */
export function copilotBaseUrl(settingsEnv: Env | undefined, launchEnv: Env): string | null {
  const baseUrl = settingsEnv?.ANTHROPIC_BASE_URL || launchEnv.ANTHROPIC_BASE_URL;
  if (!baseUrl) return null;
  try {
    const host = new URL(baseUrl).hostname;
    return host === "githubcopilot.com" || host.endsWith(".githubcopilot.com") ? baseUrl : null;
  } catch {
    return null;
  }
}

/**
 * Sets up the Copilot web tools for one Claude process. Pass `hooks` in the
 * query options, then call `attach` once the query exists.
 */
export class CopilotWebTools {
  /** Turns WebSearch calls toward `web_search` once the session is known to run on Copilot. */
  readonly hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  private markCopilot!: (copilot: boolean) => void;
  private readonly copilot = new Promise<boolean>((resolve) => (this.markCopilot = resolve));

  constructor(private readonly launchEnv: Env) {
    // A hook rather than a permission rule: it applies in every permission mode,
    // tells Claude where to search instead, and leaves other sessions' WebSearch alone.
    this.hooks = {
      PreToolUse: [
        {
          matcher: "WebSearch",
          hooks: [
            async () =>
              (await this.copilot)
                ? {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "deny" as const,
                      permissionDecisionReason: `WebSearch does not work through GitHub Copilot. Use the ${WEB_SEARCH_TOOL} tool instead; it searches the web through Copilot.`,
                    },
                  }
                : {},
          ],
        },
      ],
    };
  }

  /**
   * Find whether this Claude runs on Copilot and, if so, add the tools; resolves
   * to that answer. When Claude's settings can't be read, WebSearch is left alone.
   */
  async attach(query: SettingsQuery): Promise<boolean> {
    try {
      const settings = (await query.getSettings?.())?.effective ?? {};
      const baseUrl = copilotBaseUrl(settings.env, this.launchEnv);
      this.markCopilot(!!baseUrl);
      if (!baseUrl) return false;
      await query.setMcpServers({
        [WEB_SEARCH_SERVER]: {
          type: "stdio",
          command: WEB_SEARCH_COMMAND,
          // Claude Code 2.1.289 fails to start a dynamic server that has no `args`.
          args: [],
          env: {
            TAKODE_COPILOT_BASE_URL: baseUrl,
            ...(settings.apiKeyHelper ? { TAKODE_COPILOT_API_KEY_HELPER: settings.apiKeyHelper } : {}),
          },
          // Always in the prompt, so Claude reaches for it instead of WebSearch.
          alwaysLoad: true,
        },
      });
      const helperModelChosen = HELPER_MODEL_VARIABLES.some((name) => settings.env?.[name] || this.launchEnv[name]);
      if (!helperModelChosen) {
        await query.applyFlagSettings({ env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: COPILOT_HELPER_MODEL } });
      }
      return true;
    } catch (error) {
      this.markCopilot(false);
      throw error;
    }
  }
}
