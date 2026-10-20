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

const READ = { messageId: MESSAGE.id, sessionId: MOCK_SESSION_ID };
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

const BUTTON = "rounded border border-cc-border px-2 py-1 text-xs text-cc-muted hover:bg-cc-hover";

export function PlaygroundReadAloudSection() {
  useEffect(() => () => previewReadAloudState(null), []);
  return (
    <Section
      title="Read aloud"
      description="Message options > Read aloud rewrites the message for listening when needed, then plays OpenAI speech in a player under the message with seek, back and forward 5 seconds, voice and speed. A failure shows beside the options button until tapped."
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
      </div>
    </Section>
  );
}
