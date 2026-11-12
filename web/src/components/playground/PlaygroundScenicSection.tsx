/**
 * Scenic backgrounds: pick a style for this page (not saved), see its painted scene behind a
 * sample conversation, and replay a quest finishing and a change landing through their real
 * components to see that style's fanfare. The quest's completion card sits in the sample
 * conversation, a stand-in feed, so Ink & Paper's fireworks play under its messages as in a chat. Ink & Paper's living painting can be asked for its rare
 * moments (cranes, a fish ring) on cue. Off shows today's look.
 */
import type { ScenicBackground } from "../../../shared/scenic-background.js";
import { ScenicBackdrop } from "../../scenic/ScenicBackdrop.js";
import type { MomentKind } from "../../scenic/ink-alive/ink-alive-director.js";
import { SCENIC_INK_MOMENT_EVENT } from "../../scenic/ink-alive/ink-alive-gl.js";
import { SCENIC_STYLES } from "../../scenic/scenic-styles.js";
import { useStore } from "../../store.js";
import { SegmentedControl } from "../settings-controls.js";
import { QuestCompletionSummaryCard } from "../QuestCompletionSummaryCard.js";
import {
  finishPlaygroundQuest,
  LandingDemo,
  PLAYGROUND_BUTTON,
  PLAYGROUND_QUEST_ID,
} from "./PlaygroundCelebrationsSection.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const INK_MOMENTS: Array<{ kind: MomentKind; label: string }> = [
  { kind: "cranes", label: "Cranes fly over" },
  { kind: "ring", label: "Fish ring" },
];

export function PlaygroundScenicSection() {
  const value = useStore((state) => state.scenicBackground);
  const options: Array<{ value: ScenicBackground; label: string }> = [
    { value: "off", label: "Off" },
    ...SCENIC_STYLES.map((style) => ({ value: style.id, label: style.label })),
  ];
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Scenic Backgrounds"
        description="The Settings > Appearance choice of a painted landscape behind the conversation, with day and night versions. Picking one here changes this page only and is not saved. A quest finishing lifts the reading veil so the whole painting shows behind its card. In Ink & Paper, finishing the quest sets off ink fireworks under the messages and then presses a vermilion seal beside its card, clear of its text."
      >
        <SegmentedControl
          label="Scenic background"
          options={options}
          value={value}
          onChange={(next) => useStore.setState({ scenicBackground: next })}
        />
        {value === "ink" && (
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="playground-ink-moments">
            <span className="text-[11px] text-cc-muted">
              Ink &amp; Paper moves on its own every few quiet minutes; show a moment now:
            </span>
            {INK_MOMENTS.map((moment) => (
              <button
                key={moment.kind}
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent(SCENIC_INK_MOMENT_EVENT, { detail: moment.kind }))}
                className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-fg hover:bg-cc-hover cursor-pointer"
              >
                {moment.label}
              </button>
            ))}
          </div>
        )}
        <div
          data-testid="playground-scenic-pane"
          className="relative isolate mt-4 h-[420px] overflow-hidden rounded-xl border border-cc-border bg-cc-bg"
        >
          <ScenicBackdrop />
          {/* A stand-in for the conversation's feed: the celebration finds the card's feed by it. */}
          <div data-testid="message-feed-scroll-container" className="relative h-full overflow-y-auto px-4 py-8">
            <div data-feed-content-root="true" className="mx-auto max-w-xl text-sm leading-relaxed text-cc-fg">
              <div className="turn-container space-y-3">
                <div className="space-y-2 rounded-xl px-4 py-3">
                  <p className="font-medium">The sidebar change has landed.</p>
                  <p>
                    Thread rows now show the quest title as the name, then a short marked update. The setting carries
                    over unchanged and takes effect the next time the server restarts.
                  </p>
                </div>
                <div className="px-4 py-3">
                  <QuestCompletionSummaryCard questId={PLAYGROUND_QUEST_ID} questLinkSurface="legacy" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <button type="button" onClick={finishPlaygroundQuest} className={`mt-2 ${PLAYGROUND_BUTTON}`}>
          Finish the quest now
        </button>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <LandingDemo />
        </div>
        <Card label="Reduced motion">
          <p className="text-[11px] text-cc-muted">
            With reduced motion the painting stays still and no fanfare plays; Ink &amp; Paper shows one still frame of
            its living painting.
          </p>
        </Card>
      </Section>
    </PlaygroundSectionGroup>
  );
}
