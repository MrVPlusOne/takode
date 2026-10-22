// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { SelectionContextMenu } from "./SelectionContextMenu.js";

const written: Array<Record<string, string>> = [];
const originalClipboardItem = globalThis.ClipboardItem;

beforeEach(() => {
  written.length = 0;
  (globalThis as any).ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  };
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(),
      write: vi.fn(async ([item]: Array<{ items: Record<string, Blob> }>) => {
        const out: Record<string, string> = {};
        for (const [type, blob] of Object.entries(item!.items)) out[type] = await blob.text();
        written.push(out);
      }),
    },
  });
});

afterEach(() => {
  (globalThis as any).ClipboardItem = originalClipboardItem;
});

describe("selection Copy menu", () => {
  it("copies a selection for Slack with its formatting in Slack's terms", async () => {
    // A selection inside a message gets the same Slack-friendly copy as the whole message.
    const message = document.createElement("div");
    message.innerHTML = '<h2 class="text-lg">Title</h2><p>Run is <strong class="font-semibold">healthy</strong>.</p>';
    document.body.appendChild(message);
    const range = document.createRange();
    range.selectNodeContents(message);
    const onClose = vi.fn();
    render(
      <SelectionContextMenu
        sessionId="s1"
        onClose={onClose}
        selection={{
          isActive: true,
          plainText: "Title Run is healthy.",
          range,
          position: { x: 10, y: 10 },
          clear: vi.fn(),
          dismiss: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "For Slack" }));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/html"]).toBe("<p><b>Title</b></p><p><br></p><p>Run is <b>healthy</b>.</p>");
    expect(onClose).toHaveBeenCalled();
    message.remove();
  });
});
