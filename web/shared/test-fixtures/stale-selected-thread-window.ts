import type { BrowserIncomingMessage } from "../../server/session-types.js";

const threadKey = "q-sanitized";
const herdSource = { sessionId: "herd-events", sessionLabel: "Herd" };

export const staleSelectedThreadHistoryFixture: BrowserIncomingMessage[] = [
  {
    type: "user_message",
    id: "user-main-source",
    content: "Investigate the selected-thread issue.",
    timestamp: 1,
    threadKey: "main",
    threadRefs: [{ threadKey, questId: threadKey, source: "backfill", attachedAt: 2 }],
  },
  {
    type: "thread_attachment_marker",
    id: "attach-main-source",
    timestamp: 2,
    threadKey,
    questId: threadKey,
    markerKey: "attach-main-source",
    sourceThreadKey: "main",
    attachedAt: 2,
    attachedBy: "sanitized-fixture",
    messageIds: ["user-main-source"],
    messageIndices: [0],
    ranges: ["0"],
    count: 1,
  },
  ...Array.from(
    { length: 6 },
    (_, index): BrowserIncomingMessage => ({
      type: "user_message",
      id: `herd-routed-${index + 1}`,
      content: `1 event from 1 session\n\n#200${index} | turn_end | ✓ | sanitized`,
      timestamp: 10 + index * 10,
      agentSource: herdSource,
      threadKey,
      questId: threadKey,
      threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
      takodeHerdEventKeys: [`event-${index + 1}`],
      takodeHerdEvents: [
        {
          event: "turn_end",
          sessionId: `worker-${index + 1}`,
          sessionNum: 2000 + index,
          ts: 10 + index * 10,
          routine: true,
        },
      ],
    }),
  ),
  {
    type: "leader_user_message",
    id: "leader-response-one",
    content: "First routed leader response.",
    timestamp: 80,
    threadKey,
    questId: threadKey,
  },
  {
    type: "leader_user_message",
    id: "leader-response-two",
    content: "Second routed leader response.",
    timestamp: 90,
    threadKey,
    questId: threadKey,
  },
];

export const staleSelectedThreadKey = threadKey;
export const staleSelectedThreadHerdIds = Array.from({ length: 6 }, (_, index) => `herd-routed-${index + 1}`);
