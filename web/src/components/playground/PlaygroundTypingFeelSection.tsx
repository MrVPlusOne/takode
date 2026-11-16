/**
 * Typing feel: a composer-like chat input over the scenic painting, to type in and see the feel
 * every chat input gets while the Typing Effect setting has it on (it is marked as a chat input like
 * the real ones, so the same shared installer drives it), and a new answer arriving in ink to
 * replay. With the effect off, the section says how to turn it on.
 */
import { useEffect, useRef, useState } from "react";
import { ScenicBackdrop } from "../../scenic/ScenicBackdrop.js";
import { arrive } from "../../scenic/ink-motion.js";
import { useTypingEffectOn } from "../../scenic/scenic-styles.js";
import { ChatTextBox } from "../ChatTextBox.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const ANSWERS = [
  "The sidebar change has landed. Thread rows now show the quest title as the name, then a short marked update.",
  "All 40 scenic tests pass, and the typecheck is clean. The change is in the landing queue.",
  "I found the cause: the caret position ignored the page zoom. It now measures in the page's own pixels.",
];

export function PlaygroundTypingFeelSection() {
  const effectOn = useTypingEffectOn();
  const [answers, setAnswers] = useState([0]);
  const area = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const newest = useRef<HTMLDivElement>(null);
  const arrived = useRef(0);

  // Each added answer arrives in ink, as a new answer does in a conversation.
  useEffect(() => {
    if (answers.length > 1 && newest.current && arrived.current !== answers.at(-1)) {
      arrived.current = answers.at(-1)!;
      arrive(newest.current);
    }
  }, [answers]);

  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Typing Feel"
        description="What every chat input (composers, side chats, comments and answers) does while you type with a scenic background on: the caret glows like forged iron, hotter the faster you type, the composer's edge glows warm, and every key throws a small burst out right of the caret: sparks at night, and by day a flake of gold leaf drifting out on the air and falling. The text box draws the text as always. A new answer arriving spreads in like ink on xuan paper."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setAnswers((list) => [...list.slice(-1), (list.at(-1) ?? 0) + 1])}
            className="rounded-md border border-cc-border px-2 py-1 text-xs text-cc-fg hover:bg-cc-hover cursor-pointer"
          >
            Replay a new answer
          </button>
        </div>
        <p className="mt-2 text-[11px] text-cc-muted">
          {effectOn
            ? "Type in the box below, in English or Chinese."
            : "Turn on a scenic background above, or set Typing Effect to Always in Settings, to see it."}
        </p>
        <div
          data-testid="playground-typing-feel-pane"
          className="relative isolate mt-4 flex h-[440px] flex-col overflow-hidden rounded-xl border border-cc-border bg-cc-bg"
        >
          <ScenicBackdrop />
          <div className="relative flex flex-1 flex-col justify-end overflow-hidden px-4 pt-6 sm:px-10">
            <div className="turn-container mx-auto w-full max-w-xl space-y-3 text-sm leading-relaxed text-cc-fg">
              {answers.map((answer, index) => (
                <div key={answer} ref={index === answers.length - 1 ? newest : undefined}>
                  <p>{ANSWERS[answer % ANSWERS.length]}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-xl px-4 py-4 sm:px-0">
            <div
              data-typing-frame
              className="rounded-[14px] border border-cc-border bg-cc-input-bg"
              style={{ borderColor: "var(--scenic-edge)", boxShadow: "var(--scenic-shadow)" }}
            >
              <div className="relative">
                <ChatTextBox
                  ref={area}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder="Type here to try it..."
                  aria-label="Try the typing feel"
                  className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 font-sans-ui text-base text-cc-fg placeholder:text-cc-muted focus:outline-none sm:text-sm"
                />
              </div>
              <div className="flex justify-end px-3 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft("");
                    area.current?.focus();
                  }}
                  className="rounded-md px-2 py-1 text-[11px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
        <Card label="Reduced motion">
          <p className="text-[11px] text-cc-muted">
            With reduced motion no typing feel plays and new answers appear without the ink arrival.
          </p>
        </Card>
      </Section>
    </PlaygroundSectionGroup>
  );
}
