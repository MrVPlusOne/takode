import { describe, expect, it, vi } from "vitest";
import type { VisualRenderer, VisualRenderResult } from "../visual-renderer.js";
import { checkVisual, createVisualRoutes } from "./visuals.js";

/** A rendered result as the server renderer reports it; tests override what they check. */
function render(
  label: "phone" | "desktop",
  overrides: Partial<VisualRenderResult> = {},
): VisualRenderResult & { label: "phone" | "desktop" } {
  return {
    label,
    status: "ok",
    width: label === "phone" ? 398 : 760,
    theme: "dark",
    height: 300,
    settleMs: 100,
    elementCount: 40,
    contentWidth: label === "phone" ? 398 : 760,
    smallestTextPx: 12,
    errors: [],
    ...overrides,
  };
}

describe("checkVisual", () => {
  it("passes a visual with alt text that fits the phone column", () => {
    const checks = checkVisual("alt: Two boxes.\n---\n<div></div>", [render("phone"), render("desktop")]);
    expect(checks.every((check) => check.level === "ok")).toBe(true);
  });

  it("warns about what an agent should fix before publishing", () => {
    // No alt, sideways scrolling on the phone, and text shrunk below 11px.
    const checks = checkVisual("<div></div>", [
      render("phone", { contentWidth: 929, smallestTextPx: 8 }),
      render("desktop"),
    ]);
    const text = checks.map((check) => `${check.level} ${check.text}`).join("\n");
    expect(text).toMatch(/warn No `alt:` line/);
    expect(text).toMatch(/warn On a phone the content is 929px wide/);
    expect(text).toMatch(/warn Smallest text is 8px/);
  });

  it("reports a visual that never settled as an error and stops there", () => {
    const checks = checkVisual("alt: x\n---\n<script>while(true){}</script>", [
      render("phone", { status: "timeout", detail: "A script kept the page busy." }),
      render("desktop"),
    ]);
    expect(checks.at(-1)).toEqual({
      level: "error",
      text: "Didn't render (timeout: A script kept the page busy.). Takode won't show it.",
    });
  });
});

describe("visual image export", () => {
  it("returns the visual drawn light at desktop width as a PNG, or why it couldn't draw", async () => {
    // A card's More menu exports its visual as an image the server draws.
    const renderMock = vi.fn(
      async (): Promise<VisualRenderResult> => ({
        ...render("desktop"),
        screenshotPng: Buffer.from("png").toString("base64"),
      }),
    );
    const app = createVisualRoutes({ renderer: { render: renderMock } as unknown as VisualRenderer });
    const request = (source: string) =>
      app.request("/api/visuals/image", { method: "POST", body: JSON.stringify({ source, theme: "light" }) });
    const response = await request("alt: Boxes.\n---\n<div></div>");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("png");
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ theme: "light", width: 760, screenshot: true }));

    renderMock.mockResolvedValueOnce({ ...render("desktop", { status: "timeout", detail: "Too slow" }) });
    const failed = await request("<div></div>");
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "The visual didn't render (Too slow)." });
  });
});
