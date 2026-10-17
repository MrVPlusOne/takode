import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";

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
      "Your copies of them are out of date. Load again only the ones you need for what you are doing now (the Skill tool, or read its SKILL.md), and skip the rest until you need them.",
    ].join("\n"),
    timestamp: Date.now() - 12_000,
    agentSource: {
      sessionId: "system:skill-change-notice",
      sessionLabel: "Skills Changed",
    },
  };
  return <MessageBubble message={message} sessionId="playground-skill-change" showTimestamp={false} />;
}
