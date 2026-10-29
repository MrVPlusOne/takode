// @vitest-environment jsdom
/**
 * The side chats list (the side column's Recent): threads with something for the user first
 * (not read yet, an unread answer, an open question, or the leader writing), then every thread
 * read, newest first and never cleared, filed under a topic or not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadSummary } from "../../shared/library-topics.js";
import { ThreadsList, type ThreadsMenu } from "./ThreadsMenu.js";

const thread = (handle: string, name: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: handle,
  key: `topic:${handle}`,
  name,
  leaderId: "leader",
  createdAt: 1,
  activityAt: 1,
  ...overrides,
});
const THREADS = [
  thread("aaaa0001", "Not read yet"),
  thread("aaaa0002", "Read, then answered again", { settledAt: 2 }),
  thread("aaaa0003", "Read and unfiled", { settledAt: 2 }),
  thread("aaaa0004", "Read and filed", { settledAt: 2, topic: { id: "t1", name: "Relay" } }),
];

afterEach(cleanup);

function renderList(menu: Partial<ThreadsMenu> = {}) {
  const onOpen = vi.fn();
  render(
    <ThreadsList
      menu={{ threads: THREADS, onOpen, unread: (key) => (key === "topic:aaaa0002" ? 1 : 0), ...menu }}
      currentKey=""
      writingKey={null}
    />,
  );
  return { onOpen };
}

const rowKeys = () => screen.getAllByTestId("threads-menu-row").map((row) => row.dataset.threadKey);

describe("ThreadsList", () => {
  it("lists active threads, then every read thread, filed under a topic or not", () => {
    const { onOpen } = renderList();
    const menu = screen.getByTestId("threads-menu");
    expect(menu.textContent).toContain("Active 2");
    expect(menu.textContent).toContain("Recent2");
    expect(rowKeys()).toEqual(["topic:aaaa0001", "topic:aaaa0002", "topic:aaaa0003", "topic:aaaa0004"]);
    const rows = screen.getAllByTestId("threads-menu-row");
    expect(rows[1]!.textContent).toContain("1 new");
    expect(rows[3]!.textContent).toContain("in Relay");
    // The search narrows Active as well as Recent; a topic's name finds the threads filed there.
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "answered" } });
    expect(rowKeys()).toEqual(["topic:aaaa0002"]);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "relay" } });
    expect(rowKeys()).toEqual(["topic:aaaa0004"]);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "" } });
    fireEvent.click(screen.getAllByTestId("threads-menu-row")[2]!);
    expect(onOpen).toHaveBeenCalledWith("topic:aaaa0003");
  });

  it("marks a thread whose first message never arrived and offers to remove it", () => {
    // A thread just started (its first message still on the way) is not marked.
    const onRemove = vi.fn();
    renderList({
      threads: [
        thread("cccc0001", "Never sent", { empty: true, createdAt: Date.now() - 5 * 60_000 }),
        thread("cccc0002", "Just started", { empty: true, createdAt: Date.now() }),
      ],
      onRemove,
    });
    expect(screen.getAllByTestId("threads-menu-row-unsent")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("threads-menu-remove"));
    expect(onRemove).toHaveBeenCalledWith("topic:cccc0001");
  });

  it("draws a long Recent list a page at a time, and searches all of it", () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      thread(`bbbb${String(index).padStart(4, "0")}`, `Old thread ${index}`, { settledAt: 2, activityAt: 100 - index }),
    );
    renderList({ threads: many, unread: () => 0 });
    expect(screen.getByTestId("threads-menu").textContent).toContain("Recent45");
    expect(screen.getAllByTestId("threads-menu-row")).toHaveLength(20);
    expect(screen.getByTestId("threads-menu-more").textContent).toBe("25 more");
    fireEvent.click(screen.getByTestId("threads-menu-more"));
    expect(screen.getAllByTestId("threads-menu-row")).toHaveLength(40);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "thread 44" } });
    expect(screen.getAllByTestId("threads-menu-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Old thread 44"),
    ]);
    expect(screen.queryByTestId("threads-menu-more")).toBeNull();
  });

  it("keeps a thread with an open question active and marks it", () => {
    renderList({ unread: () => 0, questions: (key) => (key === "topic:aaaa0003" ? 1 : 0) });
    expect(screen.getByTestId("threads-menu").textContent).toContain("Active 2");
    const asked = screen.getAllByTestId("threads-menu-row").find((row) => row.dataset.threadKey === "topic:aaaa0003")!;
    expect(asked.textContent).toContain("question");
  });
});
