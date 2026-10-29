// @vitest-environment jsdom
/**
 * The session-wide chips (Waiting, and Next to the next thing for the user) belong to the main feed:
 * a conversation open in the side column shows its own activity but not them, so they never show twice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("./NotificationChip.js", () => ({ NotificationChip: () => <span data-testid="mock-next-chip" /> }));
vi.mock("./WaitingChip.js", () => ({ WaitingChip: () => <span data-testid="mock-waiting-chip" /> }));
import { FeedStatusPill } from "./MessageFeedStatus.js";
import { SecondaryFeedContext } from "./secondary-feed.js";

afterEach(cleanup);

describe("FeedStatusPill session chips", () => {
  it("shows them in the main feed", () => {
    render(<FeedStatusPill sessionId="s1" currentThreadKey="q-2" />);
    expect(screen.getByTestId("mock-next-chip")).toBeTruthy();
    expect(screen.getByTestId("mock-waiting-chip")).toBeTruthy();
  });

  it("leaves them out of a feed in the side column", () => {
    render(
      <SecondaryFeedContext.Provider value>
        <FeedStatusPill sessionId="s1" currentThreadKey="q-2" />
      </SecondaryFeedContext.Provider>,
    );
    expect(screen.queryByTestId("mock-next-chip")).toBeNull();
    expect(screen.queryByTestId("mock-waiting-chip")).toBeNull();
  });
});
