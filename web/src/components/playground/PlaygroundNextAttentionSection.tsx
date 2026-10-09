import type { NextAttentionLanding } from "../../hooks/useNextAttention.js";
import { NextAttentionPill, NextAttentionToast } from "../NextAttentionButton.js";
import { SidebarQuickActions } from "../SidebarQuickActions.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const LANDINGS: NextAttentionLanding[] = [
  {
    item: {
      kind: "unread",
      key: "unread:s1:q-12",
      sessionId: "s1",
      threadKey: "q-12",
      label: "q-12 Enable browser checks",
      timestamp: 0,
    },
    sessionNum: 2851,
    position: 1,
    total: 15,
  },
  {
    item: {
      kind: "unread",
      key: "unread:s2:",
      sessionId: "s2",
      threadKey: null,
      label: "Codex login refresh",
      timestamp: 0,
    },
    sessionNum: 2855,
    position: 15,
    total: 15,
  },
];

/** Phone top bar mock: ≡ with its waiting dot, two-line identity, Next and Diffs. */
function PhoneTopBar() {
  return (
    <div className="flex w-[390px] shrink-0 items-center gap-2 rounded-lg border border-cc-border bg-cc-card px-2 py-1.5">
      <span className="relative h-9 w-9 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true">
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-cc-attention ring-2 ring-cc-card" />
      </span>
      <span className="relative shrink-0" aria-hidden="true">
        <span className="block h-8 w-8 rounded-full bg-cc-hover" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-cc-success ring-2 ring-cc-card" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-tight text-cc-fg">
          Remote terminal and host setup cleanup
        </span>
        <span className="text-[11px] leading-tight text-cc-muted">#2851</span>
      </span>
      <NextAttentionPill count={15} compact />
      <span className="h-9 w-9 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true" />
    </div>
  );
}

export function PlaygroundNextAttentionSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Next Attention and Phone Top Bar"
        description="Next opens the next item that needs the user: needs-input prompts, then Notify Me results, then unread Ready results, newest first in each group; a toast says where it landed. The top bar keeps only ≡, the title, Next and Diffs; Search, Needs input, Notify Me and Quests sit as a search field and chips at the top of the sessions panel, on desktop and phone."
      >
        <div className="grid gap-4" data-testid="playground-next-attention">
          <Card label="Next pill (desktop and phone)">
            <div className="flex items-center gap-3">
              <NextAttentionPill count={3} />
              <NextAttentionPill count={15} compact />
            </div>
          </Card>
          <Card label="Toast after a jump">
            <div className="max-w-md space-y-2">
              {LANDINGS.map((landing) => (
                <NextAttentionToast key={landing.item.key} landing={landing} inline />
              ))}
            </div>
          </Card>
          <Card label="Phone top bar">
            <div className="overflow-x-auto">
              <PhoneTopBar />
            </div>
          </Card>
          <Card label="Sessions panel quick actions (desktop and phone)">
            <div className="w-[228px]">
              <SidebarQuickActions closePanelOnOpen={false} />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
