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

  it("uses the server copy for an image whose local attachment has no bytes (synced from another browser)", () => {
    // A draft image synced from another device carries only its server reference.
    const items = buildUserImagePreviewItems(
      message({
        localImages: [
          { imageId: "image-1", name: "phone.png", mediaType: "image/png", base64: "" },
          { imageId: "image-2", name: "desk.png", mediaType: "image/png", base64: "ZGVzaw==" },
        ],
        images: [
          { imageId: "image-1", media_type: "image/png", sourceName: "phone.png" },
          { imageId: "image-2", media_type: "image/png", sourceName: "desk.png" },
        ],
      }),
      "session-1",
    );

    expect(items.map((item) => item.thumbnailUrl)).toEqual([
      "/api/images/session-1/image-1/thumb",
      "data:image/png;base64,ZGVzaw==",
    ]);
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

  it("reserves Markdown image syntax as a deliberate image that stays visible when missing", () => {
    // `![caption](path)` is how agents ask to show an image, so it gets a slot from the
    // first render and resolves through the session (a remote host's path works). A plain
    // mention of the same path is the same image, and syntax quoted as code shows nothing.
    const items = buildAssistantImagePreviewItems(
      message({
        role: "assistant",
        content: [
          "Before: ![Main before](/tmp/shots/main.png)",
          "After: ![quest tab](file:artifacts/quest.png) and again /tmp/shots/main.png",
          "Plain: /tmp/shots/plain.png",
          "Example syntax: `![caption](/tmp/shots/example.png)`",
          "```",
          "![caption](/tmp/shots/fenced.png)",
          "```",
        ].join("\n"),
      }),
      "session-1",
    );

    expect(items.filter((item) => item.showWhenMissing).map((item) => item.id)).toEqual([
      "path:/tmp/shots/main.png",
      "file:artifacts/quest.png",
    ]);
    expect(items.filter((item) => item.id === "path:/tmp/shots/main.png")).toHaveLength(1);
    expect(items.slice(0, 3).map((item) => item.id)).toEqual([
      "path:/tmp/shots/main.png",
      "file:artifacts/quest.png",
      "path:/tmp/shots/plain.png",
    ]);
    expect(items[0]).toMatchObject({
      expectedAttachment: true,
      showWhenMissing: true,
      sourcePath: "/tmp/shots/main.png",
      thumbnailUrl:
        "/api/fs/file-link/image?path=%2Ftmp%2Fshots%2Fmain.png&isRelative=0&variant=thumbnail&sessionId=session-1",
    });
    expect(items[1]).toMatchObject({ expectedAttachment: true, showWhenMissing: true });
    // Plain paths keep the hidden-until-loaded behavior.
    expect(items[2]?.expectedAttachment).toBeUndefined();
    expect(items[2]?.showWhenMissing).toBeUndefined();
  });

  it("finds images linked by paths with spaces in angle-bracket form", () => {
    // iCloud Drive paths hold a space ("Mobile Documents"), which agents write as `<...>` targets.
    const icloud = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Shots";
    const items = buildAssistantImagePreviewItems(
      message({
        role: "assistant",
        content: `![before](<${icloud}/before 1.png>) and [after](<file:${icloud}/after 2.png>)`,
      }),
      "session-1",
    );

    expect(items.map((item) => item.id)).toEqual([`path:${icloud}/before 1.png`, `path:${icloud}/after 2.png`]);
    expect(items[0]?.showWhenMissing).toBe(true);
  });

  it("finds screenshot paths in leader messages shaped like real stored history", () => {
    // Text copied from a leader session's stored messages (README screenshots review). A text
    // block listing bare paths on their own lines, followed by a tool call in the same message,
    // and an answer linking page images with file: links beside non-image file links. Every
    // image must yield a thumbnail in order; non-image links and tool input must not.
    const listed = buildAssistantImagePreviewItems(
      message({
        role: "assistant",
        contentBlocks: [
          {
            type: "text",
            text: [
              "1. **Hero option A:** a leader's quest tab.",
              "/tmp/readme-shots/final/leader-quest-thread.jpg",
              "2. **Hero option B:** the same layout from another leader.",
              "/tmp/readme-shots/final/leader-quest-thread-alt.jpg",
            ].join("\n"),
          },
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "ls /tmp/readme-shots/final/not-shown.jpg" },
          },
        ],
      }),
      "session-1",
    );
    expect(listed.map((item) => item.title)).toEqual([
      "/tmp/readme-shots/final/leader-quest-thread.jpg",
      "/tmp/readme-shots/final/leader-quest-thread-alt.jpg",
    ]);

    const linked = buildAssistantImagePreviewItems(
      message({
        role: "assistant",
        content: [
          "- **The README draft itself (Markdown):** [README.md](file:/Users/me/worktree/README.md)",
          "- **The rendered page:** [README.html](file:/tmp/readme-shots/render/README.html)",
          "- **Page images:** [page 0](file:/tmp/readme-shots/render/page-0.takode-agent.jpeg) (hero), [page 1](file:/tmp/readme-shots/render/page-1.takode-agent.jpeg) (how a leader runs your work).",
        ].join("\n"),
      }),
      "session-1",
    );
    expect(linked.map((item) => item.thumbnailUrl)).toEqual([
      "/api/fs/image?path=%2Ftmp%2Freadme-shots%2Frender%2Fpage-0.takode-agent.jpeg&variant=thumbnail",
      "/api/fs/image?path=%2Ftmp%2Freadme-shots%2Frender%2Fpage-1.takode-agent.jpeg&variant=thumbnail",
    ]);
  });
});
