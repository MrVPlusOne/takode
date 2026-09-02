import type { ChatMessage } from "../../types.js";
import { HerdEventMessage } from "../MessageBubble.js";
import { CompactFeedActivity } from "../CompactFeedActivity.js";
import { MOCK_SESSION_ID } from "./fixtures.js";
import { Card, PlaygroundHerdEventDemo, Section } from "./shared.js";

const ROUTINE_HERD_MESSAGES: ChatMessage[] = [
  {
    id: "herd-routine-1",
    role: "user",
    content:
      '1 event from 1 session\n\n#2444 | turn_end | ok 31.3s | tools: 5 | [1160]-[1174]\n  [1174] asst: "Low remains healthy."',
    timestamp: Date.now() - 90_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      { event: "turn_end", sessionId: "worker-2444", sessionNum: 2444, ts: Date.now() - 90_000, routine: true },
    ],
  },
  {
    id: "herd-routine-2",
    role: "user",
    content:
      '1 event from 1 session\n\n#2444 | turn_end | ok 36.6s | tools: 5 | [1176]-[1190]\n  [1190] asst: "Monitoring continues."',
    timestamp: Date.now() - 45_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      { event: "turn_end", sessionId: "worker-2444", sessionNum: 2444, ts: Date.now() - 45_000, routine: true },
    ],
  },
  {
    id: "herd-routine-3",
    role: "user",
    content:
      '1 event from 1 session\n\n#2444 | turn_end | ok 35.0s | tools: 5 | [1192]-[1206]\n  [1206] asst: "Medium/high remain pending."',
    timestamp: Date.now() - 10_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      { event: "turn_end", sessionId: "worker-2444", sessionNum: 2444, ts: Date.now() - 10_000, routine: true },
    ],
  },
];

const LIFECYCLE_HERD_MESSAGES: ChatMessage[] = [
  {
    id: "herd-waiting",
    role: "user",
    content:
      "1 event from 1 session\n\n#2596 | turn_end | ✓ turn complete 12.0s | waiting for decision; Work preserved",
    timestamp: Date.now() - 75_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2596",
        sessionNum: 2596,
        ts: Date.now() - 75_000,
        routine: false,
        lifecycle: ["waiting_for_decision"],
      },
    ],
  },
  {
    id: "herd-resumed",
    role: "user",
    content:
      "1 event from 1 session\n\n#2596 | turn_end | ✓ turn complete 18.0s | same Work resumed after decision wait",
    timestamp: Date.now() - 50_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2596",
        sessionNum: 2596,
        ts: Date.now() - 50_000,
        routine: false,
        lifecycle: ["resumed_after_decision"],
      },
    ],
  },
  {
    id: "herd-compacted",
    role: "user",
    content:
      "1 event from 1 session\n\n#2596 | turn_end | ✓ turn complete 35.0s | context compacted; same Work continued",
    timestamp: Date.now() - 25_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2596",
        sessionNum: 2596,
        ts: Date.now() - 25_000,
        routine: false,
        lifecycle: ["context_continued"],
      },
    ],
  },
  {
    id: "herd-interrupted",
    role: "user",
    content: "1 event from 1 session\n\n#2596 | turn_end | Work interrupted (by system; recovery pending) 5.0s",
    timestamp: Date.now() - 5_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2596",
        sessionNum: 2596,
        ts: Date.now() - 5_000,
        routine: false,
        lifecycle: ["interrupted"],
      },
    ],
  },
];

export function PlaygroundHerdEventStates() {
  return (
    <Section
      title="Herd Event Chips"
      description="Worker events collapse to count-only activity, while expansion preserves lifecycle labels, navigation, and full original details."
    >
      <div className="space-y-4 max-w-3xl">
        <Card label="Routine worker events grouped as activity">
          <CompactFeedActivity
            segments={[{ kind: "worker_event", messages: ROUTINE_HERD_MESSAGES }]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Lifecycle detail behind count-only grouping">
          <CompactFeedActivity
            segments={[{ kind: "worker_event", messages: LIFECYCLE_HERD_MESSAGES }]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Single event chip (no activity - click to expand header)">
          <div className="py-2">
            <HerdEventMessage
              showTimestamp={false}
              message={{
                id: "herd-no-activity-demo",
                role: "user",
                content: "1 event from 1 session\n\n#35 | session_archived (user-initiated) | 2s ago",
                timestamp: Date.now(),
                agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
              }}
            />
          </div>
        </Card>
        <Card label="Event chip with activity (click #8 to navigate, rest expands)">
          <div className="py-2">
            <PlaygroundHerdEventDemo
              id="herd-chip-demo"
              content={
                '1 event from 1 session\n\n#8 | turn_end | ok 15.3s | tools: 5 | [169]-[172] | "Fixed login validation"\n  [169] user: "Fix the login bug in auth.ts"\n  [172] ok "Fixed the login validation logic"\nTool Calls not shown above: 2 Read, 1 Grep, 1 Edit, 1 Bash.'
              }
            />
          </div>
        </Card>
        <Card label="Event with key message content (markdown headings in activity)">
          <div className="py-2">
            <HerdEventMessage
              showTimestamp={false}
              message={{
                id: "herd-keymsg-demo",
                role: "user",
                content:
                  "1 event from 1 session\n\n#287 | turn_end | ok 53.6s | tools: 15 | [1]-[22] | 1s ago\n  [1] asst: I'll load the required skills first.\n  [5] asst: Skills loaded. Now let me gather the evidence.\n  [22] asst: I now have all the evidence. Let me compile the review.\nTool Calls not shown above: 1 Read, 11 Bash, 3 Skill.\n## Skeptic Review: Session #286 / Quest q-180\n### Task\nFix the autonamer regex to handle edge cases.\n### Assessment\n**ACCEPT**: The work is thorough and the claims are honest.",
                timestamp: Date.now(),
                agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
              }}
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
