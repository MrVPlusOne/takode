// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";

const updateSdkSession = vi.hoisted(() => vi.fn());
vi.mock("../store.js", () => ({
  useStore: (selector: (state: { updateSdkSession: typeof updateSdkSession }) => unknown) =>
    selector({ updateSdkSession }),
}));

vi.mock("../api.js", () => ({
  api: {
    updateLeaderProfilePortrait: vi.fn(async (_sessionId: string, portraitId: string) => ({
      ok: true,
      sessionId: "s1",
      leaderProfilePortraitId: portraitId,
      leaderProfilePortrait: LEADER_PROFILE_PORTRAITS.find((portrait) => portrait.id === portraitId),
    })),
  },
}));

import { LeaderProfilePortraitButton } from "./LeaderProfilePortraitButton.js";

const TAKO_PORTRAIT = LEADER_PROFILE_PORTRAITS[0];
const SHMI_PORTRAIT = LEADER_PROFILE_PORTRAITS.find((portrait) => portrait.poolId === "shmi")!;

function renderButton(portrait = TAKO_PORTRAIT) {
  return render(
    <LeaderProfilePortraitButton sessionId="s1" portrait={portrait} ariaLabel="Edit leader profile picture">
      <span>{portrait.label}</span>
    </LeaderProfilePortraitButton>,
  );
}

// The picker opens only from this button, which Session Info shows; sidebar portraits are display-only.
describe("LeaderProfilePortraitButton", () => {
  beforeEach(() => {
    updateSdkSession.mockClear();
  });

  it("shows the portrait with its label and opens the picker", () => {
    renderButton();

    const button = screen.getByRole("button", { name: "Edit leader profile picture" });
    expect(button.querySelector("img")).toHaveAttribute("src", TAKO_PORTRAIT.smallUrl);
    expect(button).toHaveTextContent(TAKO_PORTRAIT.label);

    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Leader profile" })).toBeInTheDocument();
    expect(screen.getByTitle(SHMI_PORTRAIT.label)).toBeInTheDocument();
  });

  it("groups picker options by the current portrait pool first", () => {
    renderButton(SHMI_PORTRAIT);
    fireEvent.click(screen.getByRole("button", { name: "Edit leader profile picture" }));

    const dialog = screen.getByRole("dialog", { name: "Leader profile" });
    const shmiGroup = within(dialog).getByRole("region", { name: "Shmi" });
    const takoGroup = within(dialog).getByRole("region", { name: "Tako" });
    expect(shmiGroup.compareDocumentPosition(takoGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(shmiGroup).getByTitle(SHMI_PORTRAIT.label)).toBeInTheDocument();
    expect(within(takoGroup).getByTitle(TAKO_PORTRAIT.label)).toBeInTheDocument();
  });

  it("changes the leader portrait through the picker", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Edit leader profile picture" }));
    fireEvent.click(screen.getByTitle(SHMI_PORTRAIT.label));

    await waitFor(() => {
      expect(updateSdkSession).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ leaderProfilePortraitId: SHMI_PORTRAIT.id }),
      );
    });
    expect(screen.queryByRole("dialog", { name: "Leader profile" })).toBeNull();
  });

  it("keeps all 96 portrait options selectable from a constrained viewport", async () => {
    // A phone-height viewport with the button low on screen: the picker moves up to fit and its grid scrolls.
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    window.innerWidth = 430;
    window.innerHeight = 640;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 36,
      y: 600,
      width: 20,
      height: 20,
      top: 600,
      right: 56,
      bottom: 620,
      left: 36,
      toJSON: () => ({}),
    });

    try {
      renderButton();
      fireEvent.click(screen.getByRole("button", { name: "Edit leader profile picture" }));

      const dialog = screen.getByRole("dialog", { name: "Leader profile" });
      expect(dialog).toHaveStyle({ top: "108px", width: "300px", maxHeight: "520px" });
      expect(screen.getByTestId("leader-profile-portrait-grid-scroll")).toHaveClass("min-h-0", "overflow-y-auto");
      expect(LEADER_PROFILE_PORTRAITS).toHaveLength(96);

      const lastPortrait = LEADER_PROFILE_PORTRAITS[LEADER_PROFILE_PORTRAITS.length - 1];
      fireEvent.click(screen.getByRole("button", { name: lastPortrait.label }));

      await waitFor(() => {
        expect(updateSdkSession).toHaveBeenCalledWith(
          "s1",
          expect.objectContaining({ leaderProfilePortraitId: lastPortrait.id }),
        );
      });
    } finally {
      rectSpy.mockRestore();
      window.innerWidth = originalInnerWidth;
      window.innerHeight = originalInnerHeight;
    }
  });
});
