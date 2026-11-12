// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PendingCodexInput, PendingUserUpload } from "../types.js";

const mockSendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession: mockSendToSession }));

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
    markNotificationDone: vi.fn(async () => ({})),
    revertToMessage: vi.fn(async () => ({})),
    starMessage: vi.fn(async () => ({})),
    unstarMessage: vi.fn(async () => ({})),
  },
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string; components?: Record<string, (props: unknown) => ReactNode> }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("remark-gfm", () => ({ default: {} }));

import { PendingMessages } from "./PendingMessages.js";
import { useStore } from "../store.js";

const SID = "pending-session";

beforeEach(() => {
  mockSendToSession.mockClear();
  useStore.setState({
    quests: [],
    questDetails: new Map(),
    questDetailEtags: new Map(),
    sessions: new Map(),
    messages: new Map(),
    pendingUserUploads: new Map(),
    pendingUserUploadRestorations: new Map(),
    composerDrafts: new Map(),
  });
});

function codexInput(overrides: Partial<PendingCodexInput>): PendingCodexInput {
  return { id: "codex-1", content: "Queued request", timestamp: 10, cancelable: true, ...overrides };
}

function upload(overrides: Partial<PendingUserUpload>): PendingUserUpload {
  return { id: "upload-1", content: "Local send", timestamp: 5, stage: "delivering", images: [], ...overrides };
}

function itemFor(text: string): HTMLElement {
  return screen.getByText(text).closest("[data-pending-status]") as HTMLElement;
}

describe("PendingMessages", () => {
  it("draws a queued message as the user bubble it becomes, with a Cancel action", () => {
    // The pending message uses the delivered-message bubble so nothing changes shape when it lands.
    render(<PendingMessages sessionId={SID} uploads={[]} codexInputs={[codexInput({})]} />);

    const item = itemFor("Queued request");
    expect(item.getAttribute("data-pending-status")).toBe("queued");
    expect(within(item).getByTestId("user-message-bubble")).toBeTruthy();
    expect(within(item).getByText("Queued")).toBeTruthy();

    fireEvent.click(within(item).getByRole("button", { name: "Cancel" }));
    expect(mockSendToSession).toHaveBeenCalledWith(SID, { type: "cancel_pending_codex_input", id: "codex-1" });
  });

  it("orders local sends and server-queued messages by time", () => {
    render(
      <PendingMessages
        sessionId={SID}
        uploads={[upload({ content: "Sent second", timestamp: 20 })]}
        codexInputs={[codexInput({ content: "Sent first", timestamp: 10 })]}
      />,
    );

    const items = Array.from(document.querySelectorAll("[data-pending-status]"));
    expect(items.map((item) => item.getAttribute("data-pending-status"))).toEqual(["queued", "sending"]);
    expect(within(items[1] as HTMLElement).getByText("Sending…")).toBeTruthy();
    // A local send waiting for the server's acknowledgement has nothing to cancel yet.
    expect(within(items[1] as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("offers Retry and Edit for a failed local send and puts Edit's text back in the composer", () => {
    const failed = upload({
      stage: "failed",
      error: "Connection lost before delivery.",
      prepared: { deliveryContent: "Local send", imageRefs: [] },
    });
    useStore.getState().addPendingUserUpload(SID, failed);
    render(<PendingMessages sessionId={SID} uploads={[failed]} codexInputs={[]} />);

    const item = itemFor("Local send");
    expect(within(item).getByText("Connection lost before delivery.")).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "Retry" }));
    expect(mockSendToSession).toHaveBeenCalledWith(
      SID,
      expect.objectContaining({ type: "user_message", client_msg_id: "upload-1", content: "Local send" }),
    );

    fireEvent.click(within(item).getByRole("button", { name: "Edit" }));
    expect(useStore.getState().composerDrafts.get(SID)?.text).toBe("Local send");
    expect(useStore.getState().pendingUserUploads.get(SID)).toBeUndefined();
  });

  it("puts Edit's text back in the side chat's composer it was sent from", () => {
    // Sent from a side chat in the side column: Edit returns it there, not to the main composer.
    const sideKey = `${SID}#side:topic:aaaa0001`;
    const failed = upload({ stage: "failed", error: "Connection lost before delivery.", draftKey: sideKey });
    useStore.getState().addPendingUserUpload(SID, failed);
    render(<PendingMessages sessionId={SID} uploads={[failed]} codexInputs={[]} />);
    fireEvent.click(within(itemFor("Local send")).getByRole("button", { name: "Edit" }));
    expect(useStore.getState().composerDrafts.get(sideKey)?.text).toBe("Local send");
    expect(useStore.getState().composerDrafts.get(SID)).toBeUndefined();
  });

  it("labels a failed server input Edit only in the browser that keeps its draft", () => {
    const failed = codexInput({
      clientMsgId: "client-1",
      deliveryState: "failed",
      failureMessage: "Codex rejected this input before delivery.",
    });
    const view = render(<PendingMessages sessionId={SID} uploads={[]} codexInputs={[failed]} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    view.unmount();

    useStore.setState({
      pendingUserUploadRestorations: new Map([[SID, new Map([["client-1", upload({ id: "client-1" })]])]]),
    });
    render(<PendingMessages sessionId={SID} uploads={[]} codexInputs={[failed]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(mockSendToSession).toHaveBeenCalledWith(SID, { type: "cancel_pending_codex_input", id: "codex-1" });
  });

  it("puts the status under the icon for left-side event cards and offers no action for server-owned input", () => {
    render(
      <PendingMessages
        sessionId={SID}
        uploads={[]}
        codexInputs={[
          codexInput({
            content: "Background event",
            cancelable: false,
            agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
          }),
        ]}
      />,
    );

    const status = screen.getByTestId("pending-input-status");
    expect(status.className).toContain("left-9");
    expect(screen.getByText("Delivering…")).toBeTruthy();
    expect(within(status).queryByRole("button")).toBeNull();
  });
  // A pending message must already look like the delivered one, so nothing moves or reshapes when
  // it lands; these cover the differences that once made it change on delivery.
  describe("keeps the shape it will have once delivered", () => {
    it("keeps your bubble's backing and mutes only what is inside it", () => {
      // A faded bubble let the scenic painting show through it; the backing must stay as delivered.
      render(<PendingMessages sessionId={SID} uploads={[]} codexInputs={[codexInput({})]} />);
      const fade = within(itemFor("Queued request")).getByTestId("user-message-bubble").closest("[class*=opacity]");
      expect(fade?.className).not.toMatch(/(?:^|\s)opacity-/);
      expect(fade?.className).toContain("[&_[data-testid=user-message-bubble]>*]:opacity-55");
    });

    it("names its thread only when that is not the thread on screen, as a delivered message does", () => {
      const inThread = codexInput({ content: "Thread request", threadKey: "q-7" });
      const { rerender } = render(
        <PendingMessages sessionId={SID} uploads={[]} codexInputs={[inThread]} currentThreadKey="q-7" />,
      );
      expect(screen.queryByTestId("thread-source-badge")).toBeNull();

      rerender(<PendingMessages sessionId={SID} uploads={[]} codexInputs={[inThread]} currentThreadKey="q-8" />);
      expect(screen.getByTestId("thread-source-badge").textContent).toBe("thread:q-7");
    });

    it("shows the day divider a message opening a new day will get", () => {
      const evening = new Date(2026, 10, 10, 23, 50).getTime();
      const nextMorning = new Date(2026, 10, 11, 0, 10).getTime();
      const { rerender } = render(
        <PendingMessages
          sessionId={SID}
          uploads={[]}
          codexInputs={[codexInput({ timestamp: nextMorning })]}
          previousTimestamp={evening}
        />,
      );
      expect(screen.getByTestId("minute-boundary-timestamp").getAttribute("data-feed-time")).toBe(String(nextMorning));

      // Same day as the newest message above: no divider, as for the delivered message.
      rerender(
        <PendingMessages
          sessionId={SID}
          uploads={[]}
          codexInputs={[codexInput({ timestamp: nextMorning })]}
          previousTimestamp={nextMorning - 60_000}
        />,
      );
      expect(screen.queryByTestId("minute-boundary-timestamp")).toBeNull();
    });
  });
});
