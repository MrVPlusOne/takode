import { useState } from "react";
import type { SideTab } from "../../utils/side-column.js";
import { SideTabs, type ChatsCue } from "../side-column/SideTabs.js";
import { Card, Section } from "./shared.js";

const COUNTS = { chats: 5, quests: 2, pages: 1 };

/**
 * The side column's tabs. One tab fills the column at a time; the Chats tab, while another is on
 * screen, shows what waits in the chats: the bell and "N new", else a green dot while a leader writes.
 */
export function PlaygroundSideColumnTabs() {
  return (
    <Section
      title="Side column tabs"
      description="The side column shows one tab at a time: Chats, Quests and Pages while they hold something (with how many), then Topic. While another tab is on screen, the Chats tab shows the bell for a question and the unread count, else a green dot while a leader is writing in a side chat. Click a tab to switch."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Chats on screen">
          <Tabs start="chats" chats={{ questions: 1, unread: 2, running: false }} />
        </Card>
        <Card label="Topic on screen, a question and answers in the chats">
          <Tabs start="topic" chats={{ questions: 1, unread: 2, running: false }} />
        </Card>
        <Card label="Topic on screen, a leader writing in a chat">
          <Tabs start="topic" chats={{ questions: 0, unread: 0, running: true }} />
        </Card>
        <Card label="Narrow column, chats and topic only">
          <div className="max-w-[320px]">
            <Tabs start="topic" tabs={["chats", "topic"]} chats={{ questions: 0, unread: 3, running: false }} />
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Tabs({
  start,
  chats,
  tabs = ["chats", "quests", "pages", "topic"],
}: {
  start: SideTab;
  chats: ChatsCue;
  tabs?: SideTab[];
}) {
  const [active, setActive] = useState<SideTab>(start);
  return (
    <div className="max-w-[520px] overflow-hidden rounded-md border border-cc-border/80 bg-cc-bg">
      <SideTabs tabs={tabs} active={active} onSelect={setActive} counts={COUNTS} chats={chats} />
    </div>
  );
}
