import { describe, expect, it } from "vitest";
import { claudeLongSleepHook, detectLongSleepBashCommand, LONG_SLEEP_DENY_MESSAGE } from "./bash-sleep-policy.js";

describe("bash sleep policy", () => {
  it("allows sleep commands up to 60 seconds", () => {
    expect(detectLongSleepBashCommand("sleep 60")).toBeNull();
    expect(detectLongSleepBashCommand("sleep 30 && echo done")).toBeNull();
    expect(detectLongSleepBashCommand("sleep 30 && sleep 40")).toBeNull();
    expect(detectLongSleepBashCommand("sleep 1m")).toBeNull();
    expect(detectLongSleepBashCommand("sleep 60 2>&1")).toBeNull();
    expect(detectLongSleepBashCommand("sleep 60 2>/tmp/err")).toBeNull();
  });

  it("detects direct sleeps longer than 60 seconds", () => {
    expect(detectLongSleepBashCommand("sleep 61")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sleep 61" }),
    );
    expect(detectLongSleepBashCommand("/bin/sleep 600")).toEqual(
      expect.objectContaining({ durationSeconds: 600, subcommand: "/bin/sleep 600" }),
    );
  });

  it("detects long sleeps inside compound commands without using substring matching", () => {
    expect(detectLongSleepBashCommand("echo hi && sleep 61 && pwd")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sleep 61" }),
    );
    expect(detectLongSleepBashCommand("sleep 61 & echo hi")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sleep 61" }),
    );
    expect(detectLongSleepBashCommand("printf 'sleep 999' && true")).toBeNull();
  });

  it("handles boundary and GNU-style duration arguments correctly", () => {
    expect(detectLongSleepBashCommand("sleep 60.1")).toEqual(
      expect.objectContaining({ durationSeconds: 60.1, subcommand: "sleep 60.1" }),
    );
    expect(detectLongSleepBashCommand("sleep 30 31")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sleep 30 31" }),
    );
    expect(detectLongSleepBashCommand("sleep 1m 1s")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sleep 1m 1s" }),
    );
    expect(detectLongSleepBashCommand("sleep infinity")).toEqual(
      expect.objectContaining({ durationSeconds: Number.POSITIVE_INFINITY, subcommand: "sleep infinity" }),
    );
  });

  it("supports common wrappers around sleep while ignoring malformed matches", () => {
    expect(detectLongSleepBashCommand("env FOO=bar sleep 61")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "env FOO=bar sleep 61" }),
    );
    expect(detectLongSleepBashCommand("env -i sleep 61")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "env -i sleep 61" }),
    );
    expect(detectLongSleepBashCommand("time -p sleep 61")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "time -p sleep 61" }),
    );
    expect(detectLongSleepBashCommand("sudo -u root sleep 61")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sudo -u root sleep 61" }),
    );
    expect(detectLongSleepBashCommand("env FOO=bar sleep 61 &")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "env FOO=bar sleep 61" }),
    );
    expect(detectLongSleepBashCommand("command sleep 61 >/tmp/out")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "command sleep 61 > /tmp/out" }),
    );
    expect(detectLongSleepBashCommand("sleep --verbose 61")).toEqual(
      expect.objectContaining({ durationSeconds: 61, subcommand: "sleep --verbose 61" }),
    );
    expect(detectLongSleepBashCommand("sleep --help")).toBeNull();
  });

  describe("Claude PreToolUse hook", () => {
    // The hook is how Claude sessions get the guard in every permission mode:
    // it denies the one command instead of interrupting the turn, which would
    // cancel every running sub-agent.
    const runHook = (input: Record<string, unknown>) =>
      claudeLongSleepHook.hooks[0](
        {
          hook_event_name: "PreToolUse",
          session_id: "s",
          transcript_path: "/tmp/t",
          cwd: "/tmp",
          tool_name: "Bash",
          tool_use_id: "tu-1",
          ...input,
        } as never,
        "tu-1",
        { signal: new AbortController().signal },
      );

    it("applies to Bash only", () => {
      expect(claudeLongSleepHook.matcher).toBe("Bash");
    });

    it("denies the session's own long sleep with the timer guidance", async () => {
      expect(await runHook({ tool_input: { command: "sleep 120" } })).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: LONG_SLEEP_DENY_MESSAGE,
        },
      });
    });

    it("lets a sub-agent sleep as long as it likes", async () => {
      expect(
        await runHook({
          agent_id: "agent-1",
          agent_type: "general-purpose",
          tool_input: { command: "sleep 120" },
        }),
      ).toEqual({});
    });

    it("leaves short sleeps and other commands alone", async () => {
      expect(await runHook({ tool_input: { command: "sleep 60" } })).toEqual({});
      expect(await runHook({ tool_input: { command: "ls" } })).toEqual({});
      expect(await runHook({ tool_input: {} })).toEqual({});
    });
  });
});
