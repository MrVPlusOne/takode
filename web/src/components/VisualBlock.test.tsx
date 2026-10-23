// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { visualSourceHash } from "../../shared/visual-block.js";
import { messageCopyForSlack } from "../utils/slack-copy.js";
import { clearVisualStillsForTest, keepVisualStill } from "../utils/visual-still-cache.js";
import { planVisual, VisualBlock } from "./VisualBlock.js";

// The isolation probe needs a real browser; tests choose the answer.
let isolation: "isolated" | "shared" = "shared";
vi.mock("../utils/visual-isolation.js", () => ({
  detectVisualIsolation: () => Promise.resolve(isolation),
  visualModeOverride: () => null,
}));

const KIT_VISUAL =
  'title: Two stages\nalt: Bake, then filter.\n---\n<div class="tk-flow"><div class="tk-box">Bake</div><div class="tk-box">Filter</div></div>';
const CHART_VISUAL =
  'title: Gains\nalt: T7 leads.\n---\n<script type="application/json" class="tk-chart">{"mark":"point"}</script>';

describe("planVisual", () => {
  it("runs every visual live the first time, checking scripted ones with the server where frames share the page's process", () => {
    // Desktop Chrome isolates frames, so scripted visuals run live straight away.
    expect(planVisual({ isolation: "isolated", usesScripts: true, stopped: false, forced: false })).toBe("live");
    // iPhone: the server draws it first; it runs only if that went well.
    expect(planVisual({ isolation: "shared", usesScripts: true, stopped: false, forced: false })).toBe("checked");
    // A visual that runs no code looks the same either way.
    expect(planVisual({ isolation: "shared", usesScripts: false, stopped: false, forced: false })).toBe("still");
  });

  it("shows a diagram as the server drew it where frames share the page's process", () => {
    // A Mermaid diagram runs no code of its own: running its helper inside the iPhone's page would
    // only cost a heavy script for the same picture. Charts and agent scripts still run.
    expect(
      planVisual({ isolation: "shared", usesScripts: true, interactive: false, stopped: false, forced: false }),
    ).toBe("still");
    expect(
      planVisual({ isolation: "shared", usesScripts: true, interactive: true, stopped: false, forced: false }),
    ).toBe("checked");
    expect(
      planVisual({ isolation: "isolated", usesScripts: true, interactive: false, stopped: false, forced: false }),
    ).toBe("live");
  });

  it("shows a still picture once a visual was stopped on this device, until the user taps Run", () => {
    expect(planVisual({ isolation: "shared", usesScripts: true, stopped: true, forced: false })).toBe("still");
    expect(planVisual({ isolation: "isolated", usesScripts: true, stopped: true, forced: false })).toBe("still");
    expect(planVisual({ isolation: "shared", usesScripts: true, stopped: true, forced: true })).toBe("live");
  });
});

describe("VisualBlock", () => {
  beforeEach(() => {
    localStorage.clear();
    clearVisualStillsForTest();
    isolation = "shared";
    // jsdom has no layout; the server's drawing is requested for the column's width.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });
  });

  it("shows the title and a sandboxed frame without access to Takode's origin", async () => {
    render(<VisualBlock source={KIT_VISUAL} />);
    await act(async () => {});
    expect(screen.getByText("Two stages")).toBeTruthy();
    const frame = await screen.findByTestId("visual-block-frame");
    // allow-scripts without allow-same-origin: an opaque origin that can't reach the app.
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("tk-flow");
  });

  it("copies as its plain-text version, without its controls", async () => {
    const { container } = render(<VisualBlock source={KIT_VISUAL} />);
    await act(async () => {});
    const copy = messageCopyForSlack(container as HTMLElement);
    expect(copy.plain).toBe("Two stages: Bake, then filter.");
  });

  it("shows a visual stopped on this device as a still picture with Run, and runs it on Run", async () => {
    const hash = visualSourceHash(CHART_VISUAL);
    localStorage.setItem("takode:visual-failed-v2", JSON.stringify([{ hash, reason: "it slowed Takode down" }]));
    isolation = "isolated";
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "ok", elementCount: 3, snapshotHtml: "<svg data-still></svg>" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VisualBlock source={CHART_VISUAL} />);
    await act(async () => {});
    expect(screen.getByTestId("visual-block-stopped").textContent).toContain(
      "Stopped on this device because it slowed Takode down.",
    );
    // The still picture is the server's drawing, with scripts removed.
    expect((await screen.findByTestId("visual-block-frame")).getAttribute("srcdoc")).toContain("data-still");
    fireEvent.click(screen.getByText("Run"));
    await act(async () => {});
    expect(screen.queryByTestId("visual-block-stopped")).toBeNull();
    expect(localStorage.getItem("takode:visual-failed-v2")).toBe("[]");
    // The live frame loads over the still picture, which stays until the live one has drawn.
    await waitFor(() => expect(document.querySelector("iframe[data-live]")).not.toBeNull());
    expect(document.querySelector("iframe[data-live]")!.getAttribute("srcdoc")).toContain("vega-embed.min.js");
    expect(document.querySelector("iframe[data-still]")!.getAttribute("srcdoc")).toContain("data-still");
    vi.unstubAllGlobals();
  });

  it("shows a kept still at once under the live frame when a visual it already drew remounts", async () => {
    // Scrolling back to a visual (or reopening its message) must not show a blank while the live
    // frame reloads: the still kept from its first drawing shows immediately, without the server.
    isolation = "isolated";
    keepVisualStill(visualSourceHash(CHART_VISUAL), "light", "<svg data-kept-still><script>alert(1)</script></svg>");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<VisualBlock source={CHART_VISUAL} />);
    await act(async () => {});
    const still = document.querySelector("iframe[data-still]")!;
    expect(still.getAttribute("srcdoc")).toContain("data-kept-still");
    // Kept stills never carry scripts, even when the frame that posted one tried to.
    expect(still.getAttribute("srcdoc")).not.toContain("alert(1)");
    expect(document.querySelector("iframe[data-live]")!.getAttribute("srcdoc")).toContain("vega-embed.min.js");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("doesn't run a scripted visual by itself when the server's check found it never finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "timeout", elementCount: 0 })),
    );
    render(<VisualBlock source={CHART_VISUAL} />);
    await act(async () => {});
    const problem = await screen.findByTestId("visual-block-problem");
    expect(problem.textContent).toContain("never finished drawing when Takode checked it");
    // The plain-text version stands in for it, and Run can force it.
    expect(problem.textContent).toContain("T7 leads.");
    expect(screen.getByText("Run anyway")).toBeTruthy();
    expect(screen.queryByTestId("visual-block-frame")).toBeNull();
    vi.unstubAllGlobals();
  });
});
