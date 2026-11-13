// @vitest-environment jsdom
/**
 * The landing page's demo is the real app fed by a stand-in server (demo-backend.ts). These tests
 * play every chapter of its story and check two things, so a change to Takode's UI or protocol
 * that breaks the demo fails here instead of on the published page:
 * - the server-shaped data the stand-in sends passes the shared validators the browser applies;
 * - the real app, rendered from it, shows what each chapter is about.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { isLeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import { isSessionAttentionProjectionValue } from "../../shared/session-attention-projection.js";
import { isSessionNavigationProjectionValue } from "../../shared/session-navigation-projection.js";
import type { BrowserIncomingMessage } from "../../server/session-types.js";
import { accentReview } from "./accent-search-review.js";
import { DemoBackend, DemoSocket, installDemoBackend } from "./demo-backend.js";
import { POCKET_LEDGER_CHAPTERS, createPocketLedgerStory } from "./pocket-ledger.js";

const VALIDATORS: Record<string, (value: unknown) => boolean> = {
  "leader-thread-tabs": isLeaderThreadTabsProjectionValue,
  "session-navigation": isSessionNavigationProjectionValue,
  "session-attention": isSessionAttentionProjectionValue,
};

/** Words that belong to Takode's internals and must never reach a visitor. */
const INTERNAL_LABELS = /USER_CHECKPOINT|WORKING|QUEUED|turn_end|herd|session_|Locating|undefined|\[object/;

/** Subscribes a browser socket to the leader and everything it can watch; returns what it received. */
async function subscribe(backend: DemoBackend, threads: string[]): Promise<BrowserIncomingMessage[]> {
  const received: BrowserIncomingMessage[] = [];
  const socket = new DemoSocket(`ws://demo/ws/browser/${backend.leaderId}`, backend);
  socket.onmessage = (event) => received.push(JSON.parse(String(event.data)) as BrowserIncomingMessage);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const subscriptions = [...backend.sessions.keys()].flatMap((key) =>
    ["session-navigation", "session-attention", ...(key === backend.leaderId ? ["leader-thread-tabs"] : [])].map(
      (projection) => ({ projection, key }),
    ),
  );
  socket.send(JSON.stringify({ type: "session_subscribe", synced_projection_subscriptions: subscriptions }));
  for (const thread of threads) socket.send(JSON.stringify({ type: "thread_window_request", thread_key: thread }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.close();
  return received;
}

function visibleText(messages: BrowserIncomingMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.type !== "thread_window_sync") return [];
    return message.entries.flatMap(({ message: entry }) => {
      if (entry.type === "user_message") return [entry.content];
      if (entry.type !== "assistant") return [];
      return entry.message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    });
  });
}

describe("the landing page demo", () => {
  beforeEach(() => {
    localStorage.clear();
    location.hash = "";
  });

  it("sends data the browser accepts, in every chapter", async () => {
    // Each chapter is rebuilt as it stands at its start, then checked through a fresh subscribe.
    const backend = new DemoBackend("pocket-ledger");
    const story = createPocketLedgerStory(backend);
    for (const [index, chapter] of POCKET_LEDGER_CHAPTERS.entries()) {
      story.goto(index);
      const threads = ["main", ...backend.threads.map((t) => t.key), ...backend.quests.keys()];
      const received = await subscribe(backend, threads);
      const snapshots = received.filter((m) => m.type === "synced_projection_snapshot");
      expect(snapshots.length, chapter).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        const validate = VALIDATORS[snapshot.projection];
        if (validate) expect(validate(snapshot.value), `${chapter}: ${snapshot.projection} ${snapshot.key}`).toBe(true);
      }
      for (const text of visibleText(received)) expect(text, chapter).not.toMatch(INTERNAL_LABELS);
    }
  });

  it("asks the question in the decision chapter and moves on once it is answered", async () => {
    const backend = new DemoBackend("pocket-ledger");
    const story = createPocketLedgerStory(backend);
    story.goto(POCKET_LEDGER_CHAPTERS.indexOf("decision"));
    // The question is asked at the chapter's first step: play it, then answer as the visitor.
    story.goto(POCKET_LEDGER_CHAPTERS.indexOf("decision"), { play: true });
    await waitFor(() => expect(backend.notifications.some((n) => !n.done)).toBe(true), { timeout: 8000 });
    const question = backend.notifications.find((n) => !n.done)!;
    expect(question.questions?.[0]?.suggestedAnswers).toEqual(["Fix it everywhere", "Report page only"]);
    const answered = new Promise((resolve) => story.onAnswered(resolve));
    backend.answer(question.id, "Report page only");
    await expect(answered).resolves.toBe("report");
    story.pause();
  });

  it("publishes a guided review the way the server prepares one", () => {
    const review = accentReview(Date.now(), "pocket-ledger", "q-25");
    // Every changed line is in a stop or a summary, with one decision for the user.
    expect(review.problems).toEqual([]);
    expect(review.content.kind === "review" && review.content.review?.meta.map.stops[0]?.tier).toBe("decide");
  });

  it("renders each chapter in the real app", async () => {
    const backend = new DemoBackend("pocket-ledger");
    installDemoBackend(backend);
    const story = createPocketLedgerStory(backend);
    story.goto(0);
    const { default: App } = await import("../App.js");
    render(<App />);
    // What each chapter shows, read from the screen the visitor sees.
    const expected: Record<string, RegExp> = {
      ask: /CSV export by month/,
      plan: /Five bug reports from this week's testers/,
      parallel: /I filed a quest for each report/,
      decision: /confirmed the cent/,
      land: /is fixing the gray everywhere/,
      results: /are on main: big OFX files import without freezing/,
      review: /All five reports are fixed and on main/,
    };
    for (const [index, chapter] of POCKET_LEDGER_CHAPTERS.entries()) {
      await act(async () => story.goto(index));
      expect(await screen.findByText(expected[chapter], {}, { timeout: 10_000 }), chapter).toBeInTheDocument();
      expect(document.body.textContent ?? "", chapter).not.toMatch(/USER_CHECKPOINT|Locating\.\.\./);
    }
  }, 120_000);
});
