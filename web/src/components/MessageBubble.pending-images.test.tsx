// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { BrowserIncomingMessage, ChatMessage } from "../types.js";

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string, variant?: "thumbnail" | "full") => {
      const params = new URLSearchParams({ path });
      if (variant) params.set("variant", variant);
      return `/api/fs/image?${params.toString()}`;
    },
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

import { MessageBubble } from "./MessageBubble.js";
import { useStore } from "../store.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";

beforeEach(() => {
  useStore.setState({
    quests: [],
    questDetails: new Map(),
    questDetailEtags: new Map(),
    compactToolActivity: false,
    sessions: new Map(),
    messages: new Map(),
  });
});

function userMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "user-message",
    role: "user",
    content: "Inspect these images",
    timestamp: 1,
    ...overrides,
  };
}

describe("MessageBubble pending image attachments", () => {
  it("hydrates exact pending slots and replaces them in place as thumbnails load", () => {
    // This is the producer-shaped reconnect form: ordered server ImageRefs,
    // not a client-invented count inferred from image request timing.
    const historyMessage: BrowserIncomingMessage = {
      type: "user_message",
      id: "history-user",
      content: "Inspect these images",
      timestamp: 1,
      images: [
        { imageId: "first", media_type: "image/png", sourceName: "first.png" },
        { imageId: "second", media_type: "image/jpeg", sourceName: "second.jpg" },
      ],
    };
    const message = normalizeHistoryMessageToChatMessages(historyMessage, 4)[0]!;

    render(<MessageBubble message={message} sessionId="session-1" />);

    const group = screen.getByTestId("user-image-preview-group");
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(2);
    const slots = within(group).getAllByRole("button");
    const firstSlot = slots[0]!;
    const secondSlot = slots[1]!;
    const thumbnails = within(group).getAllByTestId("image-preview-thumbnail-image");

    fireEvent.load(thumbnails[1]!);
    expect(within(group).getByRole("button", { name: "Open image second.jpg" })).toBe(secondSlot);
    expect(within(group).getByRole("button", { name: "Loading image first.png" })).toBe(firstSlot);
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(1);

    fireEvent.load(thumbnails[0]!);
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(within(group).getByRole("button", { name: "Open image first.png" })).toBe(firstSlot);
    expect(within(group).getAllByTestId("image-preview-thumbnail-image")).toHaveLength(2);

    fireEvent.click(firstSlot);
    expect(screen.getByTestId("lightbox-image").getAttribute("src")).toBe("/api/images/session-1/first/full");
  });

  it("removes terminally failed slots instead of leaving loading placeholders", () => {
    render(
      <MessageBubble
        message={userMessage({
          images: [
            { imageId: "missing", media_type: "image/png", sourceName: "missing.png" },
            { imageId: "slow", media_type: "image/png", sourceName: "slow.png" },
          ],
        })}
        sessionId="session-1"
      />,
    );

    const group = screen.getByTestId("user-image-preview-group");
    const thumbnails = within(group).getAllByTestId("image-preview-thumbnail-image");
    fireEvent.error(thumbnails[0]!);

    expect(within(group).queryByRole("button", { name: /missing\.png/ })).toBeNull();
    expect(within(group).getByRole("button", { name: "Loading image slow.png" }).hasAttribute("disabled")).toBe(true);

    fireEvent.error(thumbnails[1]!);
    expect(screen.queryByTestId("user-image-preview-group")).toBeNull();
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
  });

  it("uses one local pending-delivery preview instead of duplicating its stored ref", () => {
    render(
      <MessageBubble
        message={userMessage({
          localImages: [{ name: "origin.png", mediaType: "image/png", base64: "ZmFrZQ==" }],
          images: [{ imageId: "stored-copy", media_type: "image/png", sourceName: "origin.png" }],
          pendingState: "delivering",
        })}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("Sending…")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Loading image origin.png" })).toHaveLength(1);
    const thumbnail = screen.getByTestId("image-preview-thumbnail-image");
    expect(thumbnail.getAttribute("src")).toBe("data:image/png;base64,ZmFrZQ==");
    fireEvent.load(thumbnail);
    expect(screen.getAllByRole("button", { name: "Open image origin.png" })).toHaveLength(1);
  });

  it("does not invent a lasting placeholder for an unowned stored ref", () => {
    render(<MessageBubble message={userMessage({ images: [{ imageId: "unowned", media_type: "image/png" }] })} />);

    expect(screen.queryByTestId("user-image-preview-group")).toBeNull();
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
  });
});
