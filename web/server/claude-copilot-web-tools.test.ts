import { describe, expect, it, vi } from "vitest";
import { copilotBaseUrl, CopilotWebTools } from "./claude-copilot-web-tools.js";

/** A stand-in for the SDK query, answering `getSettings()` with these effective settings. */
function fakeQuery(effective: { env?: Record<string, string>; apiKeyHelper?: string } | undefined) {
  return {
    getSettings: vi.fn(async () => (effective ? { effective } : undefined)),
    setMcpServers: vi.fn(async () => ({ added: [], removed: [], errors: {} })),
    applyFlagSettings: vi.fn(async () => {}),
  };
}

/** Run the WebSearch PreToolUse hook the way Claude Code would and return its answer. */
async function webSearchHookAnswer(tools: CopilotWebTools) {
  const [matcher] = tools.hooks.PreToolUse!;
  expect(matcher.matcher).toBe("WebSearch");
  return matcher.hooks[0]!({} as never, "tool-1", { signal: new AbortController().signal });
}

describe("copilotBaseUrl", () => {
  it("recognizes GitHub Copilot hosts, including account-specific ones", () => {
    expect(copilotBaseUrl({ ANTHROPIC_BASE_URL: "https://api.githubcopilot.com" }, {})).toBe(
      "https://api.githubcopilot.com",
    );
    expect(copilotBaseUrl({}, { ANTHROPIC_BASE_URL: "https://api.business.githubcopilot.com/" })).toBe(
      "https://api.business.githubcopilot.com/",
    );
  });

  it("ignores Anthropic, other gateways, look-alike hosts and malformed URLs", () => {
    expect(copilotBaseUrl(undefined, {})).toBeNull();
    expect(copilotBaseUrl({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }, {})).toBeNull();
    expect(copilotBaseUrl({ ANTHROPIC_BASE_URL: "https://notgithubcopilot.com" }, {})).toBeNull();
    expect(copilotBaseUrl({ ANTHROPIC_BASE_URL: "not a url" }, {})).toBeNull();
  });

  it("prefers Claude's settings over the environment it was started with", () => {
    // A launcher's --settings file can point Claude elsewhere than the server's own environment.
    expect(
      copilotBaseUrl(
        { ANTHROPIC_BASE_URL: "https://gateway.example.com" },
        { ANTHROPIC_BASE_URL: "https://api.githubcopilot.com" },
      ),
    ).toBeNull();
  });
});

describe("CopilotWebTools", () => {
  it("adds web search, redirects WebSearch and pins the helper model for a Copilot session", async () => {
    const tools = new CopilotWebTools({});
    const query = fakeQuery({
      env: { ANTHROPIC_BASE_URL: "https://api.githubcopilot.com" },
      apiKeyHelper: "gh auth token",
    });

    expect(await tools.attach(query)).toBe(true);

    // The server runs on Claude's machine with Claude's Copilot address and key helper.
    expect(query.setMcpServers).toHaveBeenCalledWith({
      "takode-web": {
        type: "stdio",
        command: "takode-web-search-mcp",
        args: [],
        env: {
          TAKODE_COPILOT_BASE_URL: "https://api.githubcopilot.com",
          TAKODE_COPILOT_API_KEY_HELPER: "gh auth token",
        },
        alwaysLoad: true,
      },
    });
    // WebFetch summarizes pages with the helper model, which must not be Opus on Copilot.
    expect(query.applyFlagSettings).toHaveBeenCalledWith({
      env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5" },
    });
    const answer = await webSearchHookAnswer(tools);
    expect(answer).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    expect(JSON.stringify(answer)).toContain("mcp__takode-web__web_search");
  });

  it("keeps a helper model the user already chose", async () => {
    const tools = new CopilotWebTools({ ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4.5" });
    const query = fakeQuery({ env: { ANTHROPIC_BASE_URL: "https://api.githubcopilot.com" } });

    await tools.attach(query);

    expect(query.setMcpServers).toHaveBeenCalled();
    expect(query.applyFlagSettings).not.toHaveBeenCalled();
  });

  it("leaves a session on the Anthropic API untouched, WebSearch included", async () => {
    const tools = new CopilotWebTools({});
    const query = fakeQuery({ env: {} });

    expect(await tools.attach(query)).toBe(false);

    expect(query.setMcpServers).not.toHaveBeenCalled();
    expect(query.applyFlagSettings).not.toHaveBeenCalled();
    expect(await webSearchHookAnswer(tools)).toEqual({});
  });

  it("leaves WebSearch alone when Claude's settings cannot be read", async () => {
    const tools = new CopilotWebTools({});
    const query = fakeQuery(undefined);
    query.getSettings.mockRejectedValueOnce(new Error("Unsupported control request subtype: get_settings"));

    await expect(tools.attach(query)).rejects.toThrow("get_settings");
    expect(await webSearchHookAnswer(tools)).toEqual({});
  });

  it("holds a WebSearch call until it is known whether the session runs on Copilot", async () => {
    // Claude may try WebSearch in its first turn, before the settings answer arrives.
    const tools = new CopilotWebTools({});
    const query = fakeQuery({ env: { ANTHROPIC_BASE_URL: "https://api.githubcopilot.com" } });
    const answer = webSearchHookAnswer(tools);

    await tools.attach(query);

    expect(await answer).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
});
