import { useRef, useState } from "react";
import { recordLiveAnswerArrival } from "../../utils/live-answer-arrivals.js";
import { PawCounterContext, PawTrailAvatar, PawTrailProvider, type PawCounterState } from "../PawTrail.js";

const DEMO_ANSWERS = [
  "Found the failing assertion: the fixture used a stale thread key.",
  "Fixed the fixture and reran the focused tests; all pass.",
  "Typecheck and formatting are clean.",
];

/**
 * Live paw trail: earlier answers rest as dots, the newest keeps its paw, and
 * each new answer's paw lands while the previous one settles into a dot.
 */
export function PlaygroundPawTrailDemo() {
  const counter = useRef<PawCounterState>({ next: 0, cache: new Map() });
  const [answers, setAnswers] = useState(() => DEMO_ANSWERS.map((text, index) => ({ id: `paw-demo-${index}`, text })));

  const addAnswer = () => {
    const id = `paw-demo-${answers.length}-${Date.now()}`;
    recordLiveAnswerArrival(id);
    setAnswers((current) => [
      ...current,
      { id, text: `New answer ${current.length - DEMO_ANSWERS.length + 1} arrived.` },
    ]);
  };

  return (
    <div className="px-4 py-3 space-y-3" data-testid="playground-paw-trail-demo">
      <PawTrailProvider scopeKey="playground-paw-trail" showNewestPaw>
        <PawCounterContext.Provider value={counter}>
          <div className="space-y-3">
            {answers.map((answer) => (
              <div key={answer.id} className="flex items-start gap-2 sm:gap-3">
                <PawTrailAvatar messageId={answer.id} />
                <p className="flex-1 min-w-0 text-sm text-cc-fg">{answer.text}</p>
              </div>
            ))}
          </div>
        </PawCounterContext.Provider>
      </PawTrailProvider>
      <button
        type="button"
        onClick={addAnswer}
        className="rounded-md border border-cc-border px-2.5 py-1 text-xs text-cc-fg hover:bg-cc-hover cursor-pointer"
      >
        New answer arrives
      </button>
      <p className="text-xs text-cc-muted">With reduce motion on, the paw moves without animating.</p>
    </div>
  );
}
