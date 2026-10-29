// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeaderThreadRowsFromSummaries } from "../../shared/leader-projection.js";
import { buildThreadMonitoringProjection } from "../../server/thread-monitoring-projection.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { useStore } from "../store.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { QuestThreadBanner } from "./QuestThreadBanner.js";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";

vi.mock("../api/thread-monitoring.js", () => ({ updateThreadMonitoring: vi.fn().mockResolvedValue({}) }));

function bannerRow(checkpoint = false) {
  // Use the shared producer so the view consumes the same assignment/Journey
  // relationship as a real leader banner, including a numerically newer reviewer.
  return buildLeaderThreadRowsFromSummaries({
    activeBoard: [
      {
        questId: "q-9001",
        title: "Review the navigation comparison and next steps",
        status: checkpoint ? "USER_CHECKPOINTING" : "WORKING",
        worker: "worker",
        workerNum: 10,
        createdAt: 1,
        updatedAt: 2,
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
          currentPhaseId: checkpoint ? "user-checkpoint" : "work",
          activePhaseIndex: checkpoint ? 2 : 1,
        },
      },
    ],
    completedBoard: [],
    threadSummaries: [],
    quests: [],
    rowSessionStatuses: {
      "q-9001": {
        worker: { sessionId: "worker", sessionNum: 10, status: "idle" },
        reviewer: { sessionId: "reviewer", sessionNum: 20, status: "disconnected" },
      },
    },
  })[0];
}

function setMonitoring(pending: boolean) {
  useStore.getState().applySyncedProjectionSnapshot({
    projection: THREAD_MONITORING_PROJECTION,
    key: "leader",
    generation: "mobile-banner",
    revision: pending ? 2 : 1,
    value: buildThreadMonitoringProjection({
      state: {
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-9001"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
        threadMonitoring: {
          revision: pending ? 2 : 1,
          alertVersion: 1,
          threads: {
            "q-9001": {
              trackedAt: 1,
              afterHistoryIndex: 0,
              pending: pending ? { id: "1", messageId: "answer-1", timestamp: 2, summary: "Ready" } : null,
            },
          },
        },
      },
    }),
  });
}

describe("mobile quest banner disclosure", () => {
  beforeEach(() => {
    useStore.getState().reset();
    vi.clearAllMocks();
    for (const questId of ["q-9001", "q-9002"]) {
      useStore.getState().upsertQuestTitlePreview({
        questId,
        title: "Banner example",
        version: 1,
        updatedAt: 1,
        commitShas: ["abc1234"],
      });
    }
    useStore.getState().setSdkSessions([
      { sessionId: "leader", sessionNum: 1, state: "connected", cwd: "/leader", createdAt: 1, isOrchestrator: true },
      { sessionId: "worker", sessionNum: 10, state: "connected", cwd: "/fixture", createdAt: 1 },
      { sessionId: "reviewer", sessionNum: 20, state: "exited", cwd: "/fixture", createdAt: 1 },
    ]);
    setMonitoring(false);
  });

  // A quest thread's strip keeps one line on phones: Worker, Reviewer and commits are in the phase
  // pill's card (a tap away), so there is no disclosure for them; Notify Me is an icon in the strip.
  it("keeps Worker, Reviewer and commits in the pill's card with no disclosure, and Notify as an icon", () => {
    setMonitoring(true);
    render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" monitorSessionId="leader" diffSessionId="leader" />);
    expect(screen.queryByRole("button", { name: /quest information/ })).not.toBeInTheDocument();
    const banner = screen.getByTestId("quest-thread-banner");
    expect(within(banner).queryByRole("link", { name: "Worker #10" })).not.toBeInTheDocument();
    // The Notify icon has no word but still acknowledges a waiting result. It sits on the strip's own
    // line right before the phase pill (Jiayi's pick, phones and desktop alike), not in the details
    // row below, where it once dangled alone on a phone.
    const acknowledge = within(banner).getByRole("button", { name: "Acknowledge" });
    expect(screen.getByTestId("quest-thread-details")).not.toContainElement(acknowledge);
    const order = [
      within(banner).getByText("q-9001"),
      acknowledge,
      screen.getByTestId("quest-thread-journey-hover-target"),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(acknowledge).not.toHaveTextContent("Acknowledge");
    fireEvent.click(acknowledge);
    expect(updateThreadMonitoring).toHaveBeenCalledWith("leader", "q-9001", "acknowledge", "1");

    fingerTap(screen.getByTestId("quest-thread-journey-hover-target"));
    const card = within(screen.getByTestId("quest-thread-journey-hover-card"));
    expect(card.getByRole("link", { name: "Worker #10" })).toHaveAttribute("href", "#/session/10");
    expect(card.getByRole("link", { name: "Reviewer #20" })).toHaveAttribute("href", "#/session/20");
    expect(card.getByTestId("quest-thread-diff-chip-commits")).toHaveTextContent("1 commit");
  });

  it("starts expanded and retains a deliberate collapse of the open questions across phase and result updates", () => {
    // Open questions to the user still sit in the strip, behind the phone disclosure.
    const withQuestions = (checkpoint = false) => {
      const row = bannerRow(checkpoint);
      return { ...row, boardRow: { ...row.boardRow!, openQuestions: ["n-1"] } };
    };
    const { rerender } = render(
      <QuestThreadBanner row={withQuestions()} threadKey="q-9001" monitorSessionId="leader" diffSessionId="leader" />,
    );
    const details = screen.getByTestId("quest-thread-details");
    const toggle = screen.getByRole("button", { name: "Collapse quest information" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", details.id);
    expect(within(details).getByTestId("quest-thread-open-questions-pill")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(details).toHaveClass("hidden");
    rerender(
      <QuestThreadBanner
        row={withQuestions(true)}
        threadKey="q-9001"
        monitorSessionId="leader"
        diffSessionId="leader"
      />,
    );
    act(() => setMonitoring(true));
    expect(screen.getByTestId("quest-journey-compact-summary")).toHaveTextContent("User Checkpoint3/5");
    expect(screen.getByRole("button", { name: "Expand quest information" })).toHaveAttribute("aria-expanded", "false");
    expect(details).toHaveClass("hidden");

    // A different quest starts expanded again.
    rerender(
      <QuestThreadBanner
        row={{ ...withQuestions(), questId: "q-9002", threadKey: "q-9002" }}
        threadKey="q-9002"
        diffSessionId="leader"
      />,
    );
    expect(screen.getByRole("button", { name: "Collapse quest information" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("quest-thread-details")).not.toHaveClass("hidden");
  });

  it("keeps the close button outside the content that wraps on wider screens", () => {
    // The strip's title and chips wrap onto more lines as the window narrows. The close
    // button must not be one of the wrapping items, or it drops onto its own line at the
    // left; as the row's last direct child it keeps the top right corner at every width.
    // Real widths are covered in browser validation.
    render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" diffSessionId="leader" onCloseTab={() => {}} />);
    const wrapping = screen.getByTestId("quest-thread-wrapping-content");
    const close = screen.getByTestId("quest-thread-close-tab");
    expect(within(wrapping).getByText("q-9001")).toBeInTheDocument();
    expect(within(wrapping).getByTestId("quest-thread-meta-strip")).toBeInTheDocument();
    expect(wrapping).not.toContainElement(close);
    expect(close.parentElement).toBe(wrapping.parentElement);
    expect(close.parentElement?.lastElementChild).toBe(close);
  });

  it("does not offer an empty disclosure on a session banner with only a Journey", () => {
    render(
      <QuestThreadBanner
        row={{ threadKey: "q-9001", title: "Journey only", journey: bannerRow().journey }}
        threadKey="q-9001"
        variant="session"
      />,
    );
    expect(screen.queryByRole("button", { name: /quest information/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Quest Journey preview" })).toBeInTheDocument();
  });

  it("toggles the Journey card with taps while a mouse still hovers it open", () => {
    // A tap emulates mouseover before its click. If that hover opened the card,
    // the click would close it again; and a second tap must close it, so an
    // accidental tap is undone on the same spot.
    render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" diffSessionId="leader" />);
    const target = screen.getByRole("button", { name: "Show Quest Journey preview" });
    const card = () => document.body.querySelector('[data-testid="quest-thread-journey-hover-card"]');

    fingerTap(target);
    expect(card()).toBeInTheDocument();
    fingerTap(target);
    expect(card()).not.toBeInTheDocument();

    fireEvent.pointerOver(target, { pointerType: "mouse" });
    fireEvent.mouseOver(target);
    expect(card()).toBeInTheDocument();
    // A mouse click keeps the hovered card open rather than toggling it shut.
    fireEvent.pointerDown(target, { pointerType: "mouse" });
    fireEvent.click(target);
    expect(card()).toBeInTheDocument();
  });
});

// The breadcrumb band on a phone (Jiayi's pick A of three built options): the phase chip is only
// the phase dot and position, and the quest number goes when the title would otherwise get too
// little room. jsdom has no layout, so the title's room and full width are stubbed per test.
describe("breadcrumb band on phones", () => {
  const layout = { room: 0, full: 0 };
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().upsertQuestTitlePreview({
      questId: "q-9001",
      title: "Find QA rollout run for the pretraining eval",
      version: 1,
      updatedAt: 1,
    });
    const widths = [
      vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
        return this.classList.contains("truncate") ? layout.room : 0;
      }),
      vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
        return this.classList.contains("truncate") ? layout.full : 0;
      }),
      // The quest number with its gap takes 56 px.
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(50),
    ];
    return () => {
      for (const width of widths) width.mockRestore();
    };
  });
  const numberBox = () => screen.getByText("q-9001").closest("span")!;

  it("shows only the phase dot and position on phones, and names the phase on hover", () => {
    layout.room = 300;
    layout.full = 300;
    render(<QuestThreadBanner row={bannerRow(true)} threadKey="q-9001" singleLine />);
    const chip = screen.getByTestId("quest-journey-compact-summary");
    expect(chip).toHaveAttribute("title", "User Checkpoint 3/5");
    expect(within(chip).getByText("User Checkpoint")).toHaveClass("max-sm:hidden");
    expect(within(chip).getByTestId("quest-journey-compact-position")).toHaveTextContent("3/5");
    // A worker's own quest banner keeps the named chip.
    render(<QuestThreadBanner row={bannerRow(true)} threadKey="q-9001" variant="session" />);
    const named = screen.getAllByTestId("quest-journey-compact-summary")[1]!;
    expect(within(named).getByText("User Checkpoint")).not.toHaveClass("max-sm:hidden");
  });

  it("keeps the quest number while the title fits or has room, and drops it when the title is cut short", () => {
    // Fits whole: nothing to gain from hiding the number.
    layout.room = 120;
    layout.full = 120;
    const fits = render(<QuestThreadBanner row={bannerRow(true)} threadKey="q-9001" singleLine />);
    expect(numberBox()).not.toHaveClass("max-sm:hidden");
    fits.unmount();
    // Cut short but with a fair amount of room left (over 176 px).
    layout.room = 200;
    layout.full = 400;
    const roomy = render(<QuestThreadBanner row={bannerRow(true)} threadKey="q-9001" singleLine />);
    expect(numberBox()).not.toHaveClass("max-sm:hidden");
    roomy.unmount();
    // Cut short to a few words: the number goes, and stays gone while the title (now wider by the
    // number's 56 px) would be short again with it.
    layout.room = 150;
    render(<QuestThreadBanner row={bannerRow(true)} threadKey="q-9001" singleLine />);
    expect(numberBox()).toHaveClass("max-sm:hidden");
  });
});
