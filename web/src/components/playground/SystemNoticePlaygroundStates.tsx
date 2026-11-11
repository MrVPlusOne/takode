import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { HOST_EXEC_MESSAGE_SOURCE } from "../../../shared/host-exec.js";
import { MEMORY_GUARD_MESSAGE_SOURCE } from "../../../shared/memory-guard.js";
import { STOPPED_BACKGROUND_TASKS_SOURCE } from "../../../shared/injected-event-message.js";
import { stoppedBackgroundTasksNotice } from "../../../shared/stopped-background-tasks.js";
import { formatSlackUpdatesNotice, SLACK_UPDATES_SOURCE } from "../../../shared/slack-updates.js";

const LANDING_QUEUE_SOURCE = { sessionId: "landing-queue", sessionLabel: "Landing Queue" };

const LANDING_MESSAGES: Record<"landed" | "bounced", string> = {
  landed: [
    "[Landing queue] q-12 landed on jiayi and Takode completed it with final Memory's results.",
    "Target SHAs in order: e26ee0c65e679d8342964f9dd4484f4c73d99217",
    "Delivery a1b285f5b2ffc1ee6b63adbb3d5bb1c3: `quest commit-links q-12 --delivery a1b285f5b2ffc1ee6b63adbb3d5bb1c3`",
  ].join("\n"),
  bounced: [
    "[Landing queue] Your change for q-12 bounced from jiayi (run lr-4f2 on devbox, log /tmp/landing/lr-4f2.log) and did not land.",
    "",
    "Reason: 2 test files failed",
    "",
    "```",
    "FAIL src/components/MessageBubble.test.tsx > renders chips",
    "```",
    "",
    "Fix it (or rebase onto origin/jiayi), rerun `takode land test`, then `takode land submit` again.",
  ].join("\n"),
};

export function PlaygroundLandingQueueMessage({ outcome }: { outcome: "landed" | "bounced" }) {
  const message: ChatMessage = {
    id: `playground-landing-queue-${outcome}`,
    role: "user",
    content: LANDING_MESSAGES[outcome],
    timestamp: Date.now() - 13_000,
    agentSource: LANDING_QUEUE_SOURCE,
  };
  return <MessageBubble message={message} sessionId="playground-landing-queue" showTimestamp={false} />;
}

export function PlaygroundSessionRecoveryMessage() {
  const message: ChatMessage = {
    id: "playground-session-recovery-msg",
    role: "user",
    content: [
      "Takode had to rebuild part of this session before this launch. What was kept and what was lost:",
      "- Worktree: /home/coder/worktrees/app-wt-12 no longer existed (it was removed, or the session's machine was replaced), so Takode created /home/coder/worktrees/app-wt-12 on your branch app-wt-12. Kept: the commits on app-wt-12. Lost: uncommitted changes and untracked files that were only in the old folder.",
      "Check `git status` and `git log` before continuing, and redo any lost work you still need.",
    ].join("\n\n"),
    timestamp: Date.now() - 12_500,
    agentSource: { sessionId: "system:session-recovery", sessionLabel: "System" },
  };
  return <MessageBubble message={message} sessionId="playground-session-recovery" showTimestamp={false} />;
}

export function PlaygroundSkillChangeMessage() {
  const message: ChatMessage = {
    id: "playground-skill-change-msg",
    role: "user",
    content: [
      "[Skills changed] These skills changed after you loaded them: `quest`, `takode-orchestration`.",
      "",
      "`quest` changed only as shown; the rest is as you loaded it, so you need not load it again:",
      "```diff",
      "@@ -41,5 +41,5 @@",
      " ## When assigned a quest",
      " ",
      "-1. **Read and verify**: `quest show q-N` first.",
      "+1. **Read and verify**: `quest show q-N`, then check its feedback.",
      " 2. **Claim immediately**: `quest claim q-N`.",
      " 3. **Polish metadata**.",
      "```",
      "",
      "`takode-orchestration` changed too much to show here (64 lines added, 31 removed, a 9,412-character diff). Your copy is out of date: load it again (the Skill tool, or read its SKILL.md) only if you need it for what you are doing now.",
    ].join("\n"),
    timestamp: Date.now() - 12_000,
    agentSource: {
      sessionId: "system:skill-change-notice",
      sessionLabel: "Skills Changed",
    },
  };
  return <MessageBubble message={message} sessionId="playground-skill-change" showTimestamp={false} />;
}

const COMMAND_FINISHED_MESSAGES: Record<"succeeded" | "failed", string> = {
  succeeded: [
    "[Command finished] x-12 on condor1-cpu-takode: exit 0 after 14m 3s.",
    "",
    "```text",
    "$ cd ~/images && docker build -t trainer:latest .",
    "#12 exporting layers 41.2s done",
    "#12 naming to docker.io/library/trainer:latest done",
    "```",
    "",
    "All of its output: `takode exec logs x-12`.",
  ].join("\n"),
  failed: [
    "[Command finished] x-13 on condor1-cpu-takode: exit 2 after 8s.",
    "",
    "```text",
    "$ python publish_dataset.py --split eval",
    "FileNotFoundError: /mnt/vast/data/eval/manifest.json",
    "```",
    "",
    "All of its output: `takode exec logs x-13`.",
  ].join("\n"),
};

export function PlaygroundCommandFinishedMessage({ outcome }: { outcome: "succeeded" | "failed" }) {
  const message: ChatMessage = {
    id: `playground-command-finished-${outcome}`,
    role: "user",
    content: COMMAND_FINISHED_MESSAGES[outcome],
    timestamp: Date.now() - 11_000,
    agentSource: HOST_EXEC_MESSAGE_SOURCE,
  };
  return <MessageBubble message={message} sessionId="playground-command-finished" showTimestamp={false} />;
}

/** The memory guard killed a session's runaway build, as the server words it. */
export function PlaygroundMemoryGuardMessage() {
  const message: ChatMessage = {
    id: "playground-memory-guard",
    role: "user",
    content: [
      "[Memory guard] Killed 94 processes of this session on `devbox`, holding 47.3 GB: `lean ×93`, `lake`.",
      "",
      "The machine was nearly out of memory (54.2 of 56.0 GB in use), and these were the largest user among its sessions. Running out of memory there can stall or kill the Takode server and every other session, so Takode stopped them. If you need that work, rerun it with less parallelism (fewer jobs, workers or threads), or run it on a machine with more room using `takode exec --host <machine>`.",
    ].join("\n"),
    timestamp: Date.now() - 7_000,
    agentSource: MEMORY_GUARD_MESSAGE_SOURCE,
  };
  return <MessageBubble message={message} sessionId="playground-memory-guard" showTimestamp={false} />;
}

/** A worker's process ended with sub-agents and a command running, as the server words the notice. */
export function PlaygroundStoppedBackgroundTasksMessage() {
  const message: ChatMessage = {
    id: "playground-stopped-background-tasks",
    role: "user",
    content: stoppedBackgroundTasksNotice([
      { id: "a783ea05743767263", description: "Formalize C batch c-18", kind: "agent" },
      { id: "acf42518b6dc4af95", description: "VST probe group A", kind: "agent" },
      { id: "a9c0e11b2f6d3a774", description: "Check one problem", kind: "agent", nested: true },
      { id: "b2c51d9e", description: "Run the Lean checks for c-18", kind: "shell" },
    ]),
    timestamp: Date.now() - 5_000,
    agentSource: STOPPED_BACKGROUND_TASKS_SOURCE,
  };
  return <MessageBubble message={message} sessionId="playground-stopped-background-tasks" showTimestamp={false} />;
}

/** New messages in two Slack conversations the session read, as attached to its next input. */
export function PlaygroundSlackUpdatesMessage() {
  const message: ChatMessage = {
    id: "playground-slack-updates",
    role: "user",
    content: formatSlackUpdatesNotice([
      {
        channelId: "C0AMX973N8P",
        threadTs: "1793914798.906149",
        label: "formal verification public benchmark nll eval proposal :thread:",
        messages: [
          {
            ts: "1794358314.762619",
            author: "Weixin Wu",
            time: "2026-11-10 16:51:54 PST",
            text: "yeah, I was discussing exactly the same thing with Aroma about diversity.\nWe can sample uniformly and dedupe before the scaling fit.",
          },
          {
            ts: "1794358401.100200",
            author: "Aroma Mahendru",
            time: "2026-11-10 16:53:21 PST",
            text: "Sounds good, let's do both.",
          },
        ],
        omitted: 2,
        threadKey: "q-12",
      },
      {
        channelId: "D0A1B2C3D4E",
        label: "@Yang Zou",
        messages: [
          {
            ts: "1794359000.000100",
            author: "Yang Zou",
            time: "2026-11-10 17:03:20 PST",
            text: "Sent you the decontam script.",
          },
        ],
        omitted: 0,
      },
    ]),
    timestamp: Date.now() - 4_000,
    agentSource: SLACK_UPDATES_SOURCE,
  };
  return <MessageBubble message={message} sessionId="playground-slack-updates" showTimestamp={false} />;
}
