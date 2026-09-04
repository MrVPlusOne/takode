import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import {
  buildAssistantImagePreviewItems,
  buildQuestImagePreviewItems,
  buildStoredImagePreviewItems,
  buildUserImagePreviewItems,
} from "./image-preview-utils.js";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "user",
    content: "",
    timestamp: 1,
    ...overrides,
  };
}

describe("image preview item provenance", () => {
  it("marks stored refs as expected attachments with stable ordered URLs", () => {
    const items = buildStoredImagePreviewItems(
      [
        { imageId: "image-1", media_type: "image/png", sourceName: "first.png" },
        { imageId: "image-2", media_type: "image/jpeg" },
      ],
      "session-1",
    );

    expect(items).toEqual([
      {
        id: "stored:session-1:image-1",
        filename: "first.png",
        thumbnailUrl: "/api/images/session-1/image-1/thumb",
        fullUrl: "/api/images/session-1/image-1/full",
        title: "first.png",
        expectedAttachment: true,
      },
      {
        id: "stored:session-1:image-2",
        filename: "image-2",
        thumbnailUrl: "/api/images/session-1/image-2/thumb",
        fullUrl: "/api/images/session-1/image-2/full",
        title: "image-2",
        expectedAttachment: true,
      },
    ]);
  });

  it("marks quest feedback images as ordered expected attachments", () => {
    const items = buildQuestImagePreviewItems([
      { id: "desktop", filename: "desktop.png", mimeType: "image/png", path: "/tmp/desktop.png" },
      { id: "mobile", filename: "mobile.jpeg", mimeType: "image/jpeg", path: "/tmp/mobile.jpeg" },
    ]);

    expect(items).toEqual([
      {
        id: "quest:desktop",
        filename: "desktop.png",
        thumbnailUrl: "/api/quests/_images/desktop",
        fullUrl: "/api/quests/_images/desktop",
        title: "desktop.png",
        expectedAttachment: true,
      },
      {
        id: "quest:mobile",
        filename: "mobile.jpeg",
        thumbnailUrl: "/api/quests/_images/mobile",
        fullUrl: "/api/quests/_images/mobile",
        title: "mobile.jpeg",
        expectedAttachment: true,
      },
    ]);
  });

  it("keeps origin-local previews authoritative over duplicate stored refs", () => {
    const items = buildUserImagePreviewItems(
      message({
        localImages: [
          { name: "same.png", mediaType: "image/png", base64: "Zmlyc3Q=" },
          { name: "same.png", mediaType: "image/png", base64: "c2Vjb25k" },
        ],
        images: [{ imageId: "stored-copy", media_type: "image/png", sourceName: "same.png" }],
      }),
      "session-1",
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(["local:same.png:0", "local:same.png:1"]);
    expect(items.every((item) => item.expectedAttachment)).toBe(true);
    expect(items.every((item) => item.thumbnailUrl.startsWith("data:image/png;base64,"))).toBe(true);
  });

  it("overlays exact local attachments in authoritative order and keeps unmatched refs on the backend", () => {
    const items = buildUserImagePreviewItems(
      message({
        localImages: [
          {
            imageId: "image-2",
            name: "second.jpg",
            mediaType: "image/jpeg",
            previewUrl: "blob:second",
          },
        ],
        images: [
          { imageId: "image-1", media_type: "image/png", sourceName: "first.png" },
          { imageId: "image-2", media_type: "image/jpeg", sourceName: "second.jpg" },
        ],
      }),
      "session-1",
    );

    expect(items).toEqual([
      {
        id: "stored:session-1:image-1",
        filename: "first.png",
        thumbnailUrl: "/api/images/session-1/image-1/thumb",
        fullUrl: "/api/images/session-1/image-1/full",
        title: "first.png",
        expectedAttachment: true,
      },
      {
        id: "stored:session-1:image-2",
        filename: "second.jpg",
        thumbnailUrl: "blob:second",
        fullUrl: "blob:second",
        title: "second.jpg",
        expectedAttachment: true,
        immediatelyAvailable: true,
        localImageId: "image-2",
        fallback: {
          thumbnailUrl: "/api/images/session-1/image-2/thumb",
          fullUrl: "/api/images/session-1/image-2/full",
        },
      },
    ]);
  });

  it("does not create unresolved stored slots without a session owner", () => {
    const items = buildUserImagePreviewItems(message({ images: [{ imageId: "orphan", media_type: "image/png" }] }));

    expect(items).toEqual([]);
  });

  it("keeps speculative mentioned paths in silent-preload mode", () => {
    const items = buildAssistantImagePreviewItems(
      message({
        role: "assistant",
        localImages: [{ name: "attached.png", mediaType: "image/png", base64: "ZmFrZQ==" }],
        content: "Compare the attachment with /tmp/maybe-missing.png",
      }),
      "session-1",
    );

    expect(items).toHaveLength(2);
    expect(items[0]?.expectedAttachment).toBe(true);
    expect(items[1]?.id).toBe("path:/tmp/maybe-missing.png");
    expect(items[1]?.expectedAttachment).toBeUndefined();
  });
});
