import { useEffect } from "react";
import type { ChatMessage } from "../../types.js";
import { previewReadAloudState, type ReadAloudPlayback, type ReadAloudState } from "../../read-aloud-player.js";
import { MessageBubble } from "../MessageBubble.js";
import { MOCK_SESSION_ID } from "./fixtures.js";
import { Card, Section } from "./shared.js";

const MESSAGE: ChatMessage = {
  id: "playground-read-aloud",
  role: "assistant",
  content:
    "Done. Short answers now show their time below the **Message options** button on phones.\n\n- Tests pass\n- Desktop is unchanged",
  timestamp: Date.now() - 60_000,
};

const READ = {
  messageId: MESSAGE.id,
  sessionId: MOCK_SESSION_ID,
};
const STATES: Array<{ label: string; state: ReadAloudState | null; playback?: ReadAloudPlayback }> = [
  { label: "Idle", state: null },
  { label: "Preparing", state: { ...READ, status: "preparing" } },
  { label: "Playing", state: { ...READ, status: "ready" }, playback: { currentTime: 12, duration: 65, paused: false } },
  { label: "Paused", state: { ...READ, status: "ready" }, playback: { currentTime: 40, duration: 65, paused: true } },
  {
    label: "Failed",
    state: { ...READ, status: "error", error: "Read aloud failed. OpenAI /audio/speech failed with 429" },
  },
];

const REPORT: ChatMessage = {
  id: "playground-read-aloud-report",
  role: "assistant",
  content:
    "# Read aloud timing\n\nThe first read took 26 s on the server: 4.7 s for the rewrite and 21.7 s for speech.",
  timestamp: Date.now() - 30_000,
  metadata: {
    markdownReport: {
      sessionId: MOCK_SESSION_ID,
      reportId: "playground-report",
      sourcePath: "/tmp/read-aloud-timing.md",
      sha256: "0",
    },
  },
};

const DRAFT: ChatMessage = {
  id: "playground-read-aloud-draft",
  role: "assistant",
  content:
    "Here's the update for the thread.\n\n```draft\ntitle: T7 eval start\n---\nQuick update on **T7**: evals start at `iter 2`.\n```\n\n```draft\nNumbers so far are in the sheet.\n```",
  timestamp: Date.now() - 20_000,
};

const BUTTON = "rounded border border-cc-border px-2 py-1 text-xs text-cc-muted hover:bg-cc-hover";

export function PlaygroundReadAloudSection() {
  useEffect(() => () => previewReadAloudState(null), []);
  return (
    <Section
      title="Read aloud"
      description="Message options > Read aloud (or the speaker in a report or draft card header) rewrites the text for listening when needed, then plays OpenAI speech in a player with seek, back and forward 5 seconds, voice and speed. A failure shows beside the button until tapped."
    >
      <div className="max-w-3xl">
        <Card label="Assistant message and player">
          <div className="mb-3 flex flex-wrap gap-2">
            {STATES.map(({ label, state, playback }) => (
              <button
                key={label}
                type="button"
                onClick={() => previewReadAloudState(state, playback)}
                className={BUTTON}
              >
                {label}
              </button>
            ))}
          </div>
          <MessageBubble message={MESSAGE} sessionId={MOCK_SESSION_ID} />
        </Card>
        <Card label="Published report: Read aloud sits in its header">
          <button
            type="button"
            onClick={() =>
              previewReadAloudState(
                { messageId: REPORT.id, sessionId: MOCK_SESSION_ID, status: "ready" },
                { currentTime: 8, duration: 41, paused: false },
              )
            }
            className={`${BUTTON} mb-3`}
          >
            Report playing
          </button>
          <MessageBubble message={REPORT} sessionId={MOCK_SESSION_ID} />
        </Card>
        <Card label="Draft card: its speaker reads just the draft; the message's Read aloud reads drafts too">
          <button
            type="button"
            onClick={() =>
              previewReadAloudState(
                { messageId: DRAFT.id, sessionId: MOCK_SESSION_ID, status: "ready", part: "draft:T7 eval start" },
                { currentTime: 3, duration: 14, paused: false },
              )
            }
            className={`${BUTTON} mb-3`}
          >
            Draft playing
          </button>
          <MessageBubble message={DRAFT} sessionId={MOCK_SESSION_ID} />
        </Card>
      </div>
    </Section>
  );
}
