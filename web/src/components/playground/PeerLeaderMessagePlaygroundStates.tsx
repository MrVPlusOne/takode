import { useEffect } from "react";
import { LEADER_PROFILE_PORTRAITS } from "../../../shared/leader-profile-portraits.js";
import { useStore } from "../../store.js";
import type { ChatMessage, SdkSessionInfo } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

// Another leader's message is recognized by its sender's session ID, so the mocks use UUIDs.
const FEED_LEADER_ID = "5f0c2a1e-7b7d-4c55-9a51-000000003094";
const DAILY_LEADER_ID = "3a2e4ef0-ecaf-4a5c-b65b-000000002957";
const LAPTOP_LEADER_ID = "061f02ac-cdab-48d2-a644-000000002763";
const NOW = Date.now();

const SENDERS: SdkSessionInfo[] = [
  sessionRow(FEED_LEADER_ID, 2851, "DevBox leader"),
  { ...sessionRow(DAILY_LEADER_ID, 2957, "Daily Leader"), leaderProfilePortraitId: LEADER_PROFILE_PORTRAITS[4]!.id },
];

const FEED: ChatMessage[] = [
  {
    id: "peer-leader-demo-user",
    role: "user",
    content: "Can you check why the to-do categories can't be archived?",
    timestamp: NOW - 40 * 60_000,
  },
  {
    id: "peer-leader-demo-daily",
    role: "user",
    content:
      "Second awkward point for [q-3079](quest:q-3079): a to-do category can only be archived when none of its to-dos remain unarchived, including Done ones.\n\n**Suggested behavior:** allow archiving a category whose to-dos are all Done, keeping them in Done history. Not yet approved by the user.",
    timestamp: NOW - 30 * 60_000,
    agentSource: { sessionId: DAILY_LEADER_ID, sessionLabel: "#2957 Daily Leader" },
  },
  {
    id: "peer-leader-demo-assistant",
    role: "assistant",
    content: "Daily Leader found a second problem while setting up your To-dos hub. I'll fold it into q-3079.",
    timestamp: NOW - 29 * 60_000,
  },
  {
    id: "peer-leader-demo-laptop",
    role: "user",
    content: "#2763 here, FYI: your spawn-base bug is fixed. No reply needed.",
    timestamp: NOW - 10 * 60_000,
    // A sender not in the session list (archived, say) shows the leader icon instead of its portrait.
    agentSource: { sessionId: LAPTOP_LEADER_ID, sessionLabel: "#2763 Claude Takode Leader" },
  },
  {
    id: "peer-leader-demo-user-2",
    role: "user",
    content: "Thanks. Ship it.",
    timestamp: NOW - 5 * 60_000,
  },
];

/** Other leaders' messages in a leader's feed: one light line each, beside the user's own bubbles. */
export function PlaygroundPeerLeaderMessageStates() {
  useEffect(() => {
    useStore.setState((state) => ({
      sdkSessions: [...state.sdkSessions.filter((s) => !SENDERS.some((x) => x.sessionId === s.sessionId)), ...SENDERS],
    }));
  }, []);
  return (
    <Section
      title="Messages From Other Leaders"
      description="In a leader's feed, another leader's message is a light line (sender, first line) that opens to the full text; the user's messages stay bubbles."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Leader feed with messages from other leaders">
          <div className="space-y-5 py-2" data-testid="playground-peer-leader-feed">
            {FEED.map((message) => (
              <MessageBubble key={message.id} message={message} sessionId={FEED_LEADER_ID} />
            ))}
          </div>
        </Card>
      </div>
    </Section>
  );
}

function sessionRow(sessionId: string, sessionNum: number, name: string): SdkSessionInfo {
  return {
    sessionId,
    sessionNum,
    name,
    state: "connected",
    cwd: "/repo/takode",
    createdAt: NOW - 3_600_000,
    isOrchestrator: true,
  };
}
