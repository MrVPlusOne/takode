import { useState } from "react";
import { CollapseIcon, NewThreadIcon } from "../library/library-icons.js";
import { ChatsGroupToggle, FoldedChatButton, FoldedChatsBar, PageGroupBar } from "../side-column/SideGroupBars.js";
import type { ThreadGroupId } from "../ThreadTabGroups.js";
import { Card, Section } from "./shared.js";

const CHATS: { id: string; name: string; group: ThreadGroupId }[] = [
  { id: "a", name: "q-3101 Light climbability for FV data families", group: "needs-input" },
  { id: "b", name: "q-3099 Topic page intro links", group: "new-results" },
  { id: "c", name: "Release notes", group: "in-progress" },
  { id: "d", name: "q-3080 Node update before session restore", group: "idle" },
];

/**
 * The side column's groups. The chats fold from the column's top row, whose buttons never move;
 * folded, a bar names each chat with its status dot. Quest pages and other pages are groups of
 * their own, each folding from a quiet bar that lists them while folded.
 */
export function PlaygroundSideColumnGroup() {
  return (
    <Section
      title="Side column groups"
      description="The side column groups what was put in it by kind: Chats (folding from the top row, beside New thread and Collapse; one chat opens at a time), Quests and Pages, then the topic page. Folded, the chats show as one bar: the amber bell for a question, the unread count, then each chat with its status dot, the ones asking or with news first. Click a button or bar to fold or open it."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Chats, top row and folded bar">
          <ChatsGroup />
        </Card>
        <Card label="Chats folded, narrow column">
          <div className="max-w-[320px]">
            <ChatsGroup />
          </div>
        </Card>
        <Card label="Quests, folded">
          <GroupBar label="Quests" names={["q-3100 Tabbed side column", "q-3099 Topic page intro links"]} />
        </Card>
        <Card label="Pages, folded">
          <GroupBar label="Pages" names={["Home · DevBox takode", "Weekly report", "Leader navigation"]} />
        </Card>
      </div>
    </Section>
  );
}

function ChatsGroup() {
  const [folded, setFolded] = useState(true);
  return (
    <div className="max-w-[520px] overflow-hidden rounded-md border border-cc-border/80 bg-cc-bg">
      <div className="flex h-8 items-center gap-1 border-b border-cc-border/80 px-2">
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-[13px] text-cc-primary">
          <NewThreadIcon className="h-4 w-4" />
          New thread
        </span>
        <span className="flex-1" />
        <ChatsGroupToggle folded={folded} onToggle={() => setFolded(!folded)} chats={CHATS.length} />
        <span className="flex h-7 w-7 shrink-0 items-center justify-center text-cc-muted" aria-hidden="true">
          <CollapseIcon className="h-4 w-4" />
        </span>
      </div>
      {folded ? (
        <FoldedChatsBar questions={1} unread={2} onOpen={() => setFolded(false)}>
          {CHATS.map((chat, index) => (
            <FoldedChatButton
              key={chat.id}
              name={chat.name}
              group={chat.group}
              first={index === 0}
              onOpen={() => setFolded(false)}
            />
          ))}
        </FoldedChatsBar>
      ) : (
        <p className="px-3 py-2 text-[12px] text-cc-muted">The chats' own rows show here.</p>
      )}
    </div>
  );
}

function GroupBar({ label, names }: { label: string; names: string[] }) {
  const [folded, setFolded] = useState(true);
  return (
    <div className="max-w-[520px] overflow-hidden rounded-md border border-cc-border/80 bg-cc-bg">
      <PageGroupBar
        label={label}
        count={names.length}
        folded={folded}
        onToggle={() => setFolded(!folded)}
        names={names.join(" · ")}
      />
    </div>
  );
}
