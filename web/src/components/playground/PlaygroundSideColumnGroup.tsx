import { useState } from "react";
import { NewThreadIcon } from "../library/library-icons.js";
import { SideGroupToggleButton } from "../side-column/SideGroupToggle.js";
import { Card, Section } from "./shared.js";

/**
 * The side column's top row with its group open or folded. Folded, the row says what waits in the
 * group's chats and how many it holds; the topic page then takes the column.
 */
export function PlaygroundSideColumnGroup() {
  return (
    <Section
      title="Side column group"
      description="Everything put in the side column is one group above the topic page. Its fold button sits in the column's top row; folded, it shows the amber bell for a question, the unread count and what the group holds. Click a row's button to fold or open it."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Open">
          <GroupRow initiallyFolded={false} questions={1} unread={3} chats={4} pages={0} />
        </Card>
        <Card label="Folded, a question and unread answers">
          <GroupRow initiallyFolded questions={1} unread={12} chats={7} pages={0} />
        </Card>
        <Card label="Folded, nothing waiting, with pages">
          <GroupRow initiallyFolded questions={0} unread={0} chats={2} pages={1} />
        </Card>
        <Card label="Folded, one chat">
          <GroupRow initiallyFolded questions={0} unread={1} chats={1} pages={0} />
        </Card>
      </div>
    </Section>
  );
}

function GroupRow({
  initiallyFolded,
  ...counts
}: {
  initiallyFolded: boolean;
  questions: number;
  unread: number;
  chats: number;
  pages: number;
}) {
  const [folded, setFolded] = useState(initiallyFolded);
  return (
    <div className="flex h-8 max-w-[440px] items-center gap-1 rounded-md border border-cc-border/80 bg-cc-bg px-2">
      <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-[13px] text-cc-primary">
        <NewThreadIcon className="h-4 w-4" />
        New thread
      </span>
      <span className="flex-1" />
      <SideGroupToggleButton folded={folded} onToggle={() => setFolded(!folded)} {...counts} />
    </div>
  );
}
