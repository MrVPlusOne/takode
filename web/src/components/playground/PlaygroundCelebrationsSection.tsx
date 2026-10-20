/**
 * Small celebrations for things that just got done, each driven through the real component
 * it plays in: a to-do completing, the Quest complete card arriving, a change landing, and
 * the last prompt waiting on the user being answered. Each button replays its event.
 */
import { useRef, useState } from "react";
import type { ChatMessage, QuestmasterTask } from "../../types.js";
import { useStore } from "../../store.js";
import { celebrationAnchor, playCompletionCelebration } from "../completion-celebration.js";
import { MessageBubble } from "../MessageBubble.js";
import { QuestCompletionSummaryCard } from "../QuestCompletionSummaryCard.js";
import { ThreadTabGroupBar } from "../ThreadTabGroups.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const QUEST_ID = "q-9530";
const BUTTON = "rounded-md border border-cc-border px-2.5 py-1 text-xs text-cc-fg hover:bg-cc-hover";

function tab(threadKey: string, title: string, overrides: Partial<PrimaryThreadChip> = {}): PrimaryThreadChip {
  return {
    threadKey,
    questId: threadKey,
    title,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 0,
    ...overrides,
  };
}

export function PlaygroundCelebrationsSection() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Celebrations"
        description="Small celebrations that play once when something gets done while the user is there, never for history and never with reduced motion. Completing a to-do keeps a struck-through copy of its row in place while confetti bursts from its check, then slides it away. The Quest complete card twinkles when it shows moments after the quest finished; a landed notice pops a check on its badge; and the Needs you group pops a check as its last prompt is answered."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TodoCompletionDemo />
          <QuestCompleteDemo />
          <LandingDemo />
          <PromptsClearedDemo />
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}

/** A stand-in to-do row with the page's circle and text; the celebration is the page's own. */
function TodoCompletionDemo() {
  const rowRef = useRef<HTMLElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  return (
    <Card label="To-do completed">
      <article ref={rowRef} className="flex items-start gap-2.5 rounded-lg bg-cc-bg py-1.5 pl-2 pr-1">
        <button
          ref={checkRef}
          type="button"
          aria-label="Complete Renew passport"
          onClick={() => playCompletionCelebration(celebrationAnchor(checkRef.current, rowRef.current))}
          className="-m-1.5 shrink-0 p-1.5"
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-cc-muted/60 text-[10px] text-transparent hover:border-emerald-500 hover:text-emerald-500">
            ✓
          </span>
        </button>
        <div role="button" className="min-w-0 flex-1 text-sm leading-snug">
          Renew passport
        </div>
      </article>
      <p className="mt-2 text-[11px] text-cc-muted">Tap the circle.</p>
    </Card>
  );
}

function QuestCompleteDemo() {
  const finish = () => {
    const now = Date.now();
    const record = {
      id: `${QUEST_ID}-v${now}`,
      questId: QUEST_ID,
      version: now,
      title: "Make informative motion easier to notice",
      createdAt: now - 3_600_000,
      updatedAt: now,
      status: "done",
      description: "",
      completedAt: now,
      debriefTldr: "Tab glides between status groups are slower and easier to follow.",
    } as unknown as QuestmasterTask;
    useStore.setState((state) => ({ questDetails: new Map(state.questDetails).set(QUEST_ID, record) }));
  };
  return (
    <Card label="Quest finishes">
      <QuestCompletionSummaryCard questId={QUEST_ID} questLinkSurface="legacy" />
      <button type="button" onClick={finish} className={`mt-2 ${BUTTON}`}>
        Finish the quest now
      </button>
    </Card>
  );
}

function LandingDemo() {
  const [landed, setLanded] = useState<ChatMessage | null>(null);
  const land = () => {
    const now = Date.now();
    setLanded({
      id: `playground-celebration-landed-${now}`,
      role: "user",
      content: "[Landing queue] q-12 landed on jiayi and Takode completed it with final Memory's results.",
      timestamp: now,
      agentSource: { sessionId: "landing-queue", sessionLabel: "Landing Queue" },
    });
  };
  return (
    <Card label="Change lands">
      {landed && (
        // A new key per landing, as each landing is a new message in the feed.
        <MessageBubble key={landed.id} message={landed} sessionId="playground-celebrations" showTimestamp={false} />
      )}
      <button type="button" onClick={land} className={`mt-2 ${BUTTON}`}>
        Land a change now
      </button>
    </Card>
  );
}

function PromptsClearedDemo() {
  const [waiting, setWaiting] = useState(true);
  const tabs = [
    tab("q-9531", "Thumb-reachable top-bar actions", { needsInput: waiting }),
    tab("q-9532", "Keep the screen awake while recording", { completed: true }),
  ];
  return (
    <Card label="Last prompt answered">
      <div className="w-[430px] max-w-full">
        <ThreadTabGroupBar tabs={tabs} currentThreadKey="main" activeOutputThreadKey={null} onSelect={() => {}} />
      </div>
      <button type="button" onClick={() => setWaiting((value) => !value)} className={`mt-2 ${BUTTON}`}>
        {waiting ? "Answer the prompt" : "Ask again"}
      </button>
    </Card>
  );
}
