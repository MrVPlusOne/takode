import { afterEach, describe, expect, it, vi } from "vitest";

const mockGetEnrichedPath = vi.hoisted(() => vi.fn(() => "/usr/bin:/usr/local/bin"));
vi.mock("./path-resolver.js", () => ({
  getEnrichedPath: mockGetEnrichedPath,
}));

const sdkMocks = vi.hoisted(() => {
  class MockTransport {
    options: Record<string, unknown> = {};
    initialize(): void {}
  }

  class MockQuery {
    initConfig: Record<string, unknown> = {};
    initialize(): Promise<void> {
      return Promise.resolve();
    }
  }

  const makeSession = () => ({
    close: vi.fn(),
    query: {
      transport: new MockTransport(),
      constructor: MockQuery,
    },
  });

  // Like the real SDK, resuming constructs the process transport and initializes it
  // synchronously, which is when CLI arguments are derived from transport options.
  const resumedTransports: MockTransport[] = [];
  const resumeSession = (_sessionId: string, _options: unknown) => {
    const transport = new MockTransport();
    transport.initialize();
    resumedTransports.push(transport);
    return makeSession();
  };

  return {
    createSession: vi.fn((_options: unknown) => makeSession()),
    resumeSession: vi.fn(resumeSession),
    resumedTransports,
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  unstable_v2_createSession: sdkMocks.createSession,
  unstable_v2_resumeSession: sdkMocks.resumeSession,
}));

import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";

describe("ClaudeSdkAdapter launch env", () => {
  const originalGitEditor = process.env.GIT_EDITOR;
  const originalGitSequenceEditor = process.env.GIT_SEQUENCE_EDITOR;

  afterEach(() => {
    vi.clearAllMocks();
    sdkMocks.resumedTransports.length = 0;
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

  it("enforces noninteractive Git editors in SDK sessionOptions.env", async () => {
    // The SDK adapter builds sessionOptions.env itself, so launcher-level spawn
    // assertions do not cover the subprocess environment used by Claude SDK.
    process.env.GIT_EDITOR = "code --wait";
    process.env.GIT_SEQUENCE_EDITOR = "vim";

    new ClaudeSdkAdapter("sdk-session", {
      cwd: process.cwd(),
      env: {
        COMPANION_SERVER_ID: "test-server-id",
        GIT_EDITOR: "nano",
        GIT_SEQUENCE_EDITOR: "emacs",
        EDITOR: "code --wait",
        VISUAL: "code --wait",
      },
    });

    await vi.waitFor(() => expect(sdkMocks.createSession).toHaveBeenCalledTimes(2));

    const sessionOptions = sdkMocks.createSession.mock.calls[1][0] as {
      env: Record<string, string | undefined>;
    };
    expect(sessionOptions.env.GIT_EDITOR).toBe("true");
    expect(sessionOptions.env.GIT_SEQUENCE_EDITOR).toBe("true");
    expect(sessionOptions.env.EDITOR).toBe("code --wait");
    expect(sessionOptions.env.VISUAL).toBe("code --wait");
  });

  it("passes reasoning effort and betas into SDK session options", async () => {
    new ClaudeSdkAdapter("sdk-session", {
      cwd: process.cwd(),
      reasoningEffort: "max",
      betas: ["context-1m-2025-08-07"],
    });

    await vi.waitFor(() => expect(sdkMocks.createSession).toHaveBeenCalled());

    const sessionOptions = sdkMocks.createSession.mock.calls.at(-1)?.[0] as {
      effort?: string;
      betas?: string[];
    };
    expect(sessionOptions.effort).toBe("max");
    expect(sessionOptions.betas).toEqual(["context-1m-2025-08-07"]);
  });

  it("lets Claude retry model requests longest inside a turn unless a value is configured", async () => {
    // Longer in-turn retries let most network outages end without a hidden
    // continue prompt; an explicit session or server setting must still win.
    const launchEnv = async (env?: Record<string, string>) => {
      const before = sdkMocks.createSession.mock.calls.length;
      new ClaudeSdkAdapter("sdk-session", { cwd: process.cwd(), ...(env ? { env } : {}) });
      await vi.waitFor(() => expect(sdkMocks.createSession.mock.calls.length).toBeGreaterThan(before));
      return (sdkMocks.createSession.mock.calls.at(-1)?.[0] as { env: Record<string, unknown> }).env;
    };
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
    new ClaudeSdkAdapter("sdk-session", { cwd: process.cwd() });

    await vi.waitFor(() => expect(sdkMocks.createSession).toHaveBeenCalled());

    const sessionOptions = sdkMocks.createSession.mock.calls.at(-1)?.[0] as { env: Record<string, unknown> };
    expect(sessionOptions.env.CLAUDECODE).toBeUndefined();
  });

  it("passes allowed tools into SDK session options", async () => {
    new ClaudeSdkAdapter("sdk-session", { cwd: process.cwd(), allowedTools: ["Read", "Bash"] });

    await vi.waitFor(() => expect(sdkMocks.createSession).toHaveBeenCalled());

    const sessionOptions = sdkMocks.createSession.mock.calls.at(-1)?.[0] as { allowedTools?: string[] };
    expect(sessionOptions.allowedTools).toEqual(["Read", "Bash"]);
  });

  it("injects the Revert point into the resumed transport so Claude truncates its context", async () => {
    // The v2 session API clears resumeSessionAt; the transport patch must restore it
    // so the CLI receives --resume-session-at for the chosen assistant message.
    new ClaudeSdkAdapter("sdk-session", {
      cwd: process.cwd(),
      cliSessionId: "cli-session-1",
      resumeSessionAt: "assistant-uuid-7",
    });

    await vi.waitFor(() => expect(sdkMocks.resumeSession).toHaveBeenCalled());

    expect(sdkMocks.resumeSession.mock.calls.at(-1)?.[0]).toBe("cli-session-1");
    expect(sdkMocks.resumedTransports.at(-1)?.options.resumeSessionAt).toBe("assistant-uuid-7");
  });

  it("does not set a Revert point on an ordinary resume", async () => {
    new ClaudeSdkAdapter("sdk-session", { cwd: process.cwd(), cliSessionId: "cli-session-1" });

    await vi.waitFor(() => expect(sdkMocks.resumeSession).toHaveBeenCalled());

    expect(sdkMocks.resumedTransports.at(-1)?.options.resumeSessionAt).toBeUndefined();
  });
});
