// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ThreadRow } from "./sidebar-threads/SidebarThreadsMode.js";
import type { SdkSessionInfo } from "../types.js";

// Universal Search shows every leader's threads by name above the open tab's results (Jiayi,
// Nov 10: a thread just read couldn't be found by search; the default Recent tab matches only the
// user's own messages and the thread's name was the leader's). Choosing one opens the thread.

const threadRowsMock = vi.fn<() => ThreadRow[]>(() => []);
vi.mock("./sidebar-threads/thread-search.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sidebar-threads/thread-search.js")>()),
  useAllThreadRows: () => threadRowsMock(),
}));
const navigateToSessionThread = vi.fn();
vi.mock("../utils/routing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/routing.js")>()),
  navigateToSessionThread: (...args: unknown[]) => navigateToSessionThread(...args),
}));
vi.mock("../api.js", () => ({ api: {} }));

import { UniversalSearchOverlay } from "./UniversalSearchOverlay.js";

const sessions: SdkSessionInfo[] = [
  {
    sessionId: "worker",
    sessionNum: 3442,
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    name: "T9 FV training progress plots",
    backendType: "claude-sdk",
  },
];

const thread = (title: string, threadKey: string, at: number): ThreadRow =>
  ({
    key: `daily:${threadKey}`,
    leader: { leader: { id: "daily", name: "Daily Leader", sessionNum: 2957 } },
    threadKey,
    questId: threadKey.startsWith("q-") ? threadKey : null,
    title,
    counts: { permission: 0, unread: 0, running: 0 },
    group: "idle",
    at,
    activityAt: at,
  }) as unknown as ThreadRow;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-universal-search-mode", "sessions");
  threadRowsMock.mockReturnValue([
    thread("T9 FV training progress plots", "q-3149", Date.now() - 60_000),
    thread("Slow server restart again", "q-3157", Date.now() - 30_000),
  ]);
});

function renderOverlay(initialQuery: string) {
  return render(
    <UniversalSearchOverlay
      open
      currentSessionId={null}
      sessions={sessions}
      initialQuery={initialQuery}
      onClose={() => undefined}
      onOpenQuest={() => undefined}
      onOpenMessage={() => undefined}
    />,
  );
}

it("lists matching threads under Threads, above the tab's own results, and opens the chosen thread", () => {
  renderOverlay("t9 fv");
  const list = screen.getByRole("listbox");
  const rows = within(list).getAllByRole("option");
  expect(rows).toHaveLength(2);
  // The thread first, then the Sessions tab's own match (the worker of the same name).
  expect(rows[0]).toHaveTextContent("q-3149");
  expect(rows[0]).toHaveTextContent("Daily Leader #2957");
  expect(rows[1]).toHaveTextContent("#3442");
  expect(within(list).getByText("Threads")).toBeInTheDocument();
  expect(within(list).getByText("Sessions")).toBeInTheDocument();

  fireEvent.click(rows[0]!);
  expect(navigateToSessionThread).toHaveBeenCalledWith("daily", "q-3149", false, "daily", {
    preserveMainThreadRoute: true,
  });
});

it("lists the threads last dealt with or viewed when nothing is typed", () => {
  renderOverlay("");
  const rows = within(screen.getByRole("listbox")).getAllByRole("option");
  expect(rows[0]).toHaveTextContent("Slow server restart again");
  expect(rows[1]).toHaveTextContent("T9 FV training progress plots");
});
