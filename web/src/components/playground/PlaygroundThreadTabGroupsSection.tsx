/**
 * Phone thread tabs as status groups: the bar with its chips, each chip's list, the
 * switcher sheet with search and closing, at the top and at the bottom of the screen.
 */
import { useState } from "react";
import { getQuestJourneyPhase } from "../../../shared/quest-journey.js";
import { getQuestPhaseAccentValue, getQuestPhaseThreadTabTitleColorValue } from "../../utils/quest-phase-theme.js";
import { ThreadTabGroupBar } from "../ThreadTabGroups.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.now();
const MINUTE = 60_000;

function questTab(
  questId: string,
  title: string,
  phaseId: string | null,
  overrides: Partial<PrimaryThreadChip> = {},
): PrimaryThreadChip {
  const phase = phaseId ? getQuestJourneyPhase(phaseId) : null;
  return {
    threadKey: questId,
    questId,
    title,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: !phase,
    completed: !phase,
    titleColor: phase ? getQuestPhaseThreadTabTitleColorValue(phase.color) : "var(--color-cc-muted)",
    accentColor: phase ? getQuestPhaseAccentValue(phase.color) : "var(--color-cc-muted)",
    stateLabel: phase?.label ?? "Done",
    updatedAt: NOW - 5 * MINUTE,
    ...overrides,
  };
}

const MAIN: PrimaryThreadChip = {
  threadKey: "main",
  title: "Main Thread",
  needsInput: false,
  mutedNeedsInput: false,
  blueNudge: true,
  canClose: false,
  updatedAt: NOW,
};

const TABS: PrimaryThreadChip[] = [
  questTab("q-9482", "Redesign thread tabs around what the user scans", "work"),
  questTab("q-9481", "Thumb-reachable mobile layout for top-bar actions", "user-checkpoint", { needsInput: true }),
  questTab("q-9480", "Keep the screen awake while recording voice", "memory"),
  questTab("q-9476", "Fix login-shell PATH capture on remote hosts", "landing"),
  questTab("q-9479", "Walk the paw down the feed as answers arrive", null, { blueNudge: true }),
  ...["Attribute a dismissed question to the leader", "Board dots contrast in light theme", "Sync unsent drafts"].map(
    (title, index) => questTab(`q-${9470 - index}`, title, null, { updatedAt: NOW - (index + 2) * 60 * MINUTE }),
  ),
];

function PhoneFrame({ placement }: { placement: "top" | "bottom" }) {
  const [current, setCurrent] = useState("q-9482");
  const [tabs, setTabs] = useState(TABS);
  return (
    <div
      className="w-[430px] max-w-full rounded-lg border border-cc-border bg-cc-card px-3"
      data-testid="playground-thread-tab-groups"
    >
      <ThreadTabGroupBar
        main={MAIN}
        tabs={tabs}
        placement={placement}
        currentThreadKey={current}
        activeOutputThreadKey="q-9482"
        threadStatuses={{
          "q-9479": {
            kind: "ready",
            label: "Thread Ready",
            threadKey: "q-9479",
            questId: "q-9479",
            summary: "landed; watch a live answer on the phone",
            messageId: "ready-9479",
            timestamp: NOW,
            updatedAt: NOW,
          },
        }}
        onSelect={setCurrent}
        onClose={(threadKey) => setTabs((existing) => existing.filter((tab) => tab.threadKey !== threadKey))}
      />
    </div>
  );
}

export function PlaygroundThreadTabGroupsSection() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Thread Tab Groups"
        description="Leader thread tabs on every screen size: Main, one item per kind of tab (prompts waiting, in progress with phase-color dots, unread results, done) and search; wide screens add each group's name. The quest strip names the current quest, so the bar only marks the group that holds it. A group lists its tabs (a group of one opens its tab directly; long-press shows the list); search opens every tab with search by title or quest number, and closing."
      >
        <div className="space-y-4">
          <Card label="At the top (tap a group, or search)">
            <PhoneFrame placement="top" />
          </Card>
          <Card label="At the bottom (lists open upward)">
            <div className="pt-72">
              <PhoneFrame placement="bottom" />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
