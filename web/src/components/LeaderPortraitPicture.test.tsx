// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import { FALLBACK_LEADER_PROFILE_PORTRAIT, LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";
import { LeaderPortraitPicture } from "./LeaderPortraitPicture.js";

const portrait = LEADER_PROFILE_PORTRAITS.find((p) => p.poolId === "animals")!;

afterEach(() => useStore.setState({ scenicBackground: "off", darkMode: false }));

describe("LeaderPortraitPicture", () => {
  it("shows the portrait's own painting unless Ink & Paper is on", () => {
    // Other scenic styles keep the original paintings, so the ink files are never requested.
    useStore.setState({ scenicBackground: "seaside", darkMode: true });
    render(<LeaderPortraitPicture portrait={portrait} alt="p" className="h-5" />);
    const img = screen.getByAltText("p");
    expect(img.getAttribute("src")).toBe(portrait.smallUrl);
    expect(img.className).toBe("h-5");
  });

  it("shows the ink painting with Ink & Paper on, undimmed in both themes", () => {
    useStore.setState({ scenicBackground: "ink", darkMode: false });
    const { rerender } = render(<LeaderPortraitPicture portrait={portrait} variant="large" alt="p" className="h-5" />);
    const img = screen.getByAltText("p");
    expect(img.getAttribute("src")).toBe(`/leader-profile-portraits/ink/${portrait.id}.v2.320.webp`);
    expect(img.getAttribute("width")).toBe("320");
    expect(img.className).toBe("h-5");

    // Each ink painting has its own coloured wash, so it keeps full brightness on dark panels too.
    useStore.setState({ darkMode: true });
    rerender(<LeaderPortraitPicture portrait={portrait} variant="large" alt="p" className="h-5" />);
    expect(img.className).toBe("h-5");
  });

  it("keeps the fallback picture under Ink & Paper, since it has no ink painting", () => {
    useStore.setState({ scenicBackground: "ink", darkMode: true });
    render(<LeaderPortraitPicture portrait={FALLBACK_LEADER_PROFILE_PORTRAIT} alt="p" />);
    const img = screen.getByAltText("p");
    expect(img.getAttribute("src")).toBe(FALLBACK_LEADER_PROFILE_PORTRAIT.smallUrl);
  });
});
