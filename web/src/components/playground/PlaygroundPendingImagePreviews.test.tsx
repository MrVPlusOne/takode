// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { PlaygroundPendingImagePreviews } from "./PlaygroundPendingImagePreviews.js";

describe("PlaygroundPendingImagePreviews", () => {
  it("contrasts sync-preserved local previews with normal backend loading slots", () => {
    // The Playground keeps both sides of the contract visible for responsive manual validation.
    render(<PlaygroundPendingImagePreviews />);

    const localGroup = screen.getByTestId("playground-origin-local-image-group");
    expect(within(localGroup).getAllByRole("button", { name: /^Open image / })).toHaveLength(2);
    expect(within(localGroup).queryByTestId("image-preview-loading-placeholder")).toBeNull();

    const backendGroup = screen.getByTestId("playground-pending-image-group");
    expect(within(backendGroup).getByRole("button", { name: "Loading image mobile-upload.png" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Finish thumbnail" }));
    for (const image of within(backendGroup).getAllByTestId("image-preview-thumbnail-image")) {
      fireEvent.load(image);
    }
    expect(within(backendGroup).getAllByRole("button", { name: /^Open image / })).toHaveLength(2);
  });
});
