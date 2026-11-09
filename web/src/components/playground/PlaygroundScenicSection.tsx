/**
 * Scenic backgrounds: pick a style for this page (not saved), see its painted scene behind a
 * sample conversation, and replay a quest finishing and a change landing through their real
 * components to see that style's fanfare. Off shows today's look.
 */
import type { ScenicBackground } from "../../../shared/scenic-background.js";
import { ScenicBackdrop } from "../../scenic/ScenicBackdrop.js";
import { SCENIC_STYLES } from "../../scenic/scenic-styles.js";
import { useStore } from "../../store.js";
import { SegmentedControl } from "../settings-controls.js";
import { LandingDemo, QuestCompleteDemo } from "./PlaygroundCelebrationsSection.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

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
        description="The Settings > Appearance choice of a painted landscape behind the conversation, with day and night versions. Picking one here changes this page only and is not saved. A quest finishing lifts the reading veil so the whole painting shows behind its card."
      >
        <SegmentedControl
          label="Scenic background"
          options={options}
          value={value}
          onChange={(next) => useStore.setState({ scenicBackground: next })}
        />
        <div
          data-testid="playground-scenic-pane"
          className="relative isolate mt-4 h-[420px] overflow-hidden rounded-xl border border-cc-border bg-cc-bg"
        >
          <ScenicBackdrop />
          <div className="mx-auto max-w-xl space-y-3 px-6 py-10 text-sm leading-relaxed text-cc-fg">
            <p className="font-medium">The sidebar change has landed.</p>
            <p>
              Thread rows now show the quest title as the name, then a short marked update. The setting carries over
              unchanged and takes effect the next time the server restarts.
            </p>
            <p className="text-cc-muted">Wed 2:01 PM</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <QuestCompleteDemo />
          <LandingDemo />
        </div>
        <Card label="Reduced motion">
          <p className="text-[11px] text-cc-muted">
            With reduced motion the painting stays still and no fanfare plays.
          </p>
        </Card>
      </Section>
    </PlaygroundSectionGroup>
  );
}
