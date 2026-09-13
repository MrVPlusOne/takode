// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer.js";

describe("hosted diff file navigation", () => {
  it("uses parsed code-first order and expands a selected collapsed file before scrolling", () => {
    // The toolbar portal must use the same file list as the renderer, including deleted paths.
    const target = document.createElement("div");
    document.body.append(target);
    const patch =
      "diff --git a/src/a.test.ts b/src/a.test.ts\n--- a/src/a.test.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old test\ndiff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old code\n+new code\n";
    const view = render(<DiffViewer unifiedDiff={patch} mode="full" collapsibleFiles fileNavigationTarget={target} />);
    const picker = screen.getByRole("combobox", { name: "Jump to file" });
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "2 files",
      "src/a.ts",
      "src/a.test.ts",
    ]);
    const files = view.container.querySelectorAll<HTMLElement>(".diff-file");
    fireEvent.click(files[1]!.querySelector("button")!);
    expect(files[1]!.querySelector(".diff-file-body")).toBeNull();
    const scroll = vi.fn(() => expect(files[1]!.querySelector(".diff-file-body")).not.toBeNull());
    files[1]!.scrollIntoView = scroll;
    fireEvent.change(picker, { target: { value: "1" } });
    expect(scroll).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
    fireEvent.change(picker, { target: { value: "1" } });
    expect(scroll).toHaveBeenCalledTimes(2);
    view.rerender(<DiffViewer oldText="same" newText="same" mode="full" fileNavigationTarget={target} />);
    expect(target.childElementCount).toBe(0);
    view.unmount();
    target.remove();
  });
});
