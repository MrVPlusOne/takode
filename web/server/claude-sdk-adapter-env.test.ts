import { afterEach, describe, expect, it, vi } from "vitest";

const mockGetEnrichedPath = vi.hoisted(() => vi.fn(() => "/usr/bin:/usr/local/bin"));
vi.mock("./path-resolver.js", () => ({
  getEnrichedPath: mockGetEnrichedPath,
}));

const sdkMocks = vi.hoisted(() => ({
  // Records each query the adapter starts: its prompt input and options.
  query: vi.fn((_params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => ({
    close: vi.fn(),
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
  })),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdkMocks.query }));

/** Start an adapter and return the options of the query it started. */
async function launchOptions(options: Partial<ConstructorParameters<typeof ClaudeSdkAdapter>[1]> = {}) {
  const before = sdkMocks.query.mock.calls.length;
  const adapter = new ClaudeSdkAdapter("sdk-session", { cwd: process.cwd(), ...options });
  await vi.waitFor(() => expect(sdkMocks.query.mock.calls.length).toBeGreaterThan(before));
  const params = sdkMocks.query.mock.calls.at(-1)![0];
  return { adapter, options: params.options, prompt: params.prompt };
}

import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";

describe("ClaudeSdkAdapter launch env", () => {
  const originalGitEditor = process.env.GIT_EDITOR;
  const originalGitSequenceEditor = process.env.GIT_SEQUENCE_EDITOR;

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDECODE;
    if (originalGitEditor === undefined) {
      delete process.env.GIT_EDITOR;
    } else {
      process.env.GIT_EDITOR = originalGitEditor;
    }
    if (originalGitSequenceEditor === undefined) {
      delete process.env.GIT_SEQUENCE_EDITOR;
    } else {
      process.env.GIT_SEQUENCE_EDITOR = originalGitSequenceEditor;
    }
  });

  it("enforces noninteractive Git editors in the SDK query env", async () => {
    // The SDK adapter builds the query env itself, so launcher-level spawn
    // assertions do not cover the subprocess environment used by Claude SDK.
    process.env.GIT_EDITOR = "code --wait";
    process.env.GIT_SEQUENCE_EDITOR = "vim";

    const { options } = await launchOptions({
      env: {
        COMPANION_SERVER_ID: "test-server-id",
        GIT_EDITOR: "nano",
        GIT_SEQUENCE_EDITOR: "emacs",
        EDITOR: "code --wait",
        VISUAL: "code --wait",
      },
    });

    expect(options.env.GIT_EDITOR).toBe("true");
    expect(options.env.GIT_SEQUENCE_EDITOR).toBe("true");
    expect(options.env.EDITOR).toBe("code --wait");
    expect(options.env.VISUAL).toBe("code --wait");
  });

  it("passes reasoning effort and betas into the SDK query options", async () => {
    const { options } = await launchOptions({ reasoningEffort: "max", betas: ["context-1m-2025-08-07"] });

    expect(options.effort).toBe("max");
    expect(options.betas).toEqual(["context-1m-2025-08-07"]);
  });

  it("keeps Claude Code's own system prompt and appends Takode's instructions", async () => {
    // query() starts from an empty system prompt unless given the preset;
    // without it, Claude would lose its tool and coding instructions.
    const { options } = await launchOptions({ instructions: "Takode session #5" });
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "Takode session #5" });

    const { options: bare } = await launchOptions();
    expect(bare.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("loads user, project and local settings and the session's plugins", async () => {
    // Project settings carry CLAUDE.md loading and project permission rules.
    const { options } = await launchOptions({ pluginDirs: ["/plugins/takode"] });

    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.plugins).toEqual([{ type: "local", path: "/plugins/takode" }]);
  });

  it("uses a configured Claude binary and a host spawn hook, else the SDK's bundled Claude", async () => {
    const spawnProcess = vi.fn();
    const { options } = await launchOptions({ claudeBinary: "claude", spawnProcess });
    expect(options.pathToClaudeCodeExecutable).toBe("claude");
    expect(options.spawnClaudeCodeProcess).toBe(spawnProcess);

    const { options: defaults } = await launchOptions();
    expect(defaults).not.toHaveProperty("pathToClaudeCodeExecutable");
    expect(defaults).not.toHaveProperty("spawnClaudeCodeProcess");
  });

  it("delivers prompts on Claude's input stream in order, including ones sent before start", async () => {
    const { adapter, prompt } = await launchOptions();
    adapter.sendBrowserMessage({ type: "user_message", content: "first" });
    adapter.sendBrowserMessage({ type: "user_message", content: "second" });

    const input = prompt[Symbol.asyncIterator]();
    const texts = [(await input.next()).value, (await input.next()).value].map(
      (msg: any) => msg.message.content[0].text,
    );
    expect(texts).toEqual(["first", "second"]);
    expect(adapter.hasTurnInFlight()).toBe(true);

    // Disconnecting ends Claude's input so the SDK closes its stdin.
    await adapter.disconnect();
    expect((await input.next()).done).toBe(true);
  });

  it("lets Claude retry model requests longest inside a turn unless a value is configured", async () => {
    // Longer in-turn retries let most network outages end without a hidden
    // continue prompt; an explicit session or server setting must still win.
    const launchEnv = async (env?: Record<string, string>) => (await launchOptions(env ? { env } : {})).options.env;
    const original = process.env.CLAUDE_CODE_MAX_RETRIES;
    try {
      delete process.env.CLAUDE_CODE_MAX_RETRIES;
      expect((await launchEnv()).CLAUDE_CODE_MAX_RETRIES).toBe("15");
      expect((await launchEnv({ CLAUDE_CODE_MAX_RETRIES: "7" })).CLAUDE_CODE_MAX_RETRIES).toBe("7");
      process.env.CLAUDE_CODE_MAX_RETRIES = "4";
      expect((await launchEnv()).CLAUDE_CODE_MAX_RETRIES).toBe("4");
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CODE_MAX_RETRIES;
      else process.env.CLAUDE_CODE_MAX_RETRIES = original;
    }
  });

  it("strips an inherited CLAUDECODE so Claude's nesting guard does not trip", async () => {
    process.env.CLAUDECODE = "1";
    const { options } = await launchOptions();

    expect(options.env.CLAUDECODE).toBeUndefined();
  });

  it("passes allowed tools into the SDK query options", async () => {
    const { options } = await launchOptions({ allowedTools: ["Read", "Bash"] });

    expect(options.allowedTools).toEqual(["Read", "Bash"]);
  });

  it("resumes at the Revert point so Claude truncates its context", async () => {
    // The CLI receives --resume-session-at for the chosen assistant message.
    const { options } = await launchOptions({ cliSessionId: "cli-session-1", resumeSessionAt: "assistant-uuid-7" });

    expect(options.resume).toBe("cli-session-1");
    expect(options.resumeSessionAt).toBe("assistant-uuid-7");
  });

  it("does not set a Revert point on an ordinary resume or a new session", async () => {
    const { options } = await launchOptions({ cliSessionId: "cli-session-1" });
    expect(options.resume).toBe("cli-session-1");
    expect(options).not.toHaveProperty("resumeSessionAt");

    // A Revert point without a session to resume is meaningless.
    const { options: fresh } = await launchOptions({ resumeSessionAt: "assistant-uuid-7" });
    expect(fresh).not.toHaveProperty("resume");
    expect(fresh).not.toHaveProperty("resumeSessionAt");
  });
});
