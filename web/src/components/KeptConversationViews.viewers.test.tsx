// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { KeptConversationViews } from "./KeptConversationViews.js";
import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import { Lightbox } from "./Lightbox.js";

// A full-screen image viewer is portaled to document.body, outside its conversation's hidden
// Activity, which hides only the conversation's own DOM. On a phone the viewer of a chat the
// user left stayed on top of the next chat (and Copy image there could read an object URL the
// hidden chat had released), so the viewers render nothing while their conversation is hidden.

function KeptChats({ visible, view }: { visible: "a" | "b"; view: ReactNode }) {
  return (
    <KeptConversationViews
      conversations={[
        { sessionId: "a", view },
        { sessionId: "b", view: <p>Other chat</p> },
      ]}
      visibleSessionId={visible}
    />
  );
}

describe("image viewers in kept conversations", () => {
  it("hides the Lightbox while its conversation is hidden", async () => {
    const lightbox = <Lightbox src="/full/a.png" alt="attachment" onClose={() => {}} />;
    const view = render(<KeptChats visible="a" view={lightbox} />);
    expect(await screen.findByTestId("lightbox-image")).toBeInTheDocument();

    view.rerender(<KeptChats visible="b" view={lightbox} />);
    expect(screen.queryByTestId("lightbox-backdrop")).toBeNull();

    view.rerender(<KeptChats visible="a" view={lightbox} />);
    expect(await screen.findByTestId("lightbox-image")).toBeInTheDocument();
  });

  it("hides the thumbnail viewer while its conversation is hidden", async () => {
    const group = (
      <ImagePreviewGroup
        images={[{ id: "a", filename: "a.png", thumbnailUrl: "/thumb/a.png", fullUrl: "/full/a.png" }]}
      />
    );
    const view = render(<KeptChats visible="a" view={group} />);
    fireEvent.load(screen.getByTestId("image-preview-preload"));
    fireEvent.click(screen.getByRole("button", { name: "Open image a.png" }));
    expect(await screen.findByTestId("image-preview-modal")).toBeInTheDocument();

    view.rerender(<KeptChats visible="b" view={group} />);
    expect(screen.queryByTestId("image-preview-modal")).toBeNull();

    view.rerender(<KeptChats visible="a" view={group} />);
    expect(await screen.findByTestId("image-preview-modal")).toBeInTheDocument();
  });
});
