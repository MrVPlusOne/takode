import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentDirectory } from "../attachment-paths.js";
import { ImageStore } from "../image-store.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { createTakodeRoutes } from "./takode.js";

// `takode send <worker> --forward uN` passes a user message the leader received on to another
// session: the server looks the ID up in the sender's own history and inserts the message
// verbatim (with its comments and images) after the leader's optional note, so the leader
// never retypes it. These tests drive the real route with a real image store on a temp dir.

const LEADER = "leader-a";
const WORKER = "worker-1";
const WRITTEN_AT = new Date(2026, 10, 14, 0, 20).getTime();

function userMessage(id: string, leaderUserMessageId: string, extra: Record<string, unknown> = {}) {
  return {
    type: "user_message",
    id,
    content: `${id} text`,
    timestamp: WRITTEN_AT,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId,
    ...extra,
  } as BrowserIncomingMessage;
}

const REVIEW_ANSWERS = [
  "Guided review answers: Forwarding",
  "",
  "1. Keep the old flag?",
  "   Answer: no, retire it",
  "",
  "Comments on the code (lines numbered as in the file after the change, removed lines as before it):",
  "",
  "web/server/a.ts, lines 5-7:",
  "```diff",
  "+const a = 1;",
  "```",
  "Comment: rename this",
].join("\n");

let imageRoot: string | undefined;

afterEach(async () => {
  if (imageRoot) await rm(imageRoot, { recursive: true, force: true });
  imageRoot = undefined;
});

async function createTestApp(leaderHistory: BrowserIncomingMessage[]) {
  imageRoot = await mkdtemp(join(tmpdir(), "takode-forward-images-"));
  const imageStore = new ImageStore(imageRoot);
  // The leader's stored copy of a screenshot the user attached (and its thumbnail).
  await mkdir(join(imageRoot, LEADER), { recursive: true });
  await writeFile(join(imageRoot, LEADER, "img-1.orig.png"), "png-bytes");
  await writeFile(join(imageRoot, LEADER, "img-1.thumb.webp"), "thumb-bytes");

  const injectUserMessage = vi.fn((..._args: unknown[]) => "sent");
  const sessions: Record<string, { messageHistory: BrowserIncomingMessage[]; state: { pause: null } }> = {
    [LEADER]: { messageHistory: leaderHistory, state: { pause: null } },
    [WORKER]: { messageHistory: [userMessage("worker-msg", "u9")], state: { pause: null } },
  };
  const app = new Hono();
  app.route(
    "/api",
    createTakodeRoutes({
      launcher: {
        resolveSessionId: (id: string) => id,
        getSession: (id: string) => ({ sessionId: id, isOrchestrator: id === LEADER, herdedBy: LEADER }),
      },
      wsBridge: { getSession: (id: string) => sessions[id], injectUserMessage },
      authenticateTakodeCaller: () => ({ callerId: LEADER, caller: { sessionId: LEADER, isOrchestrator: true } }),
      resolveId: (id: string) => id,
      imageStore,
      options: {},
    } as any),
  );
  const send = async (body: Record<string, unknown>) => {
    const res = await app.request(`/api/sessions/${WORKER}/message`, { method: "POST", body: JSON.stringify(body) });
    const call = injectUserMessage.mock.calls.at(-1);
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
      content: call?.[1] as string | undefined,
      options: call?.[5] as { deliveryContent?: string; imageRefs?: Array<{ imageId: string }> } | undefined,
      injected: injectUserMessage.mock.calls.length,
    };
  };
  return { send, imageRoot };
}

describe("takode send --forward", () => {
  it("passes plain text on verbatim after the leader's note, marked as the user's words", async () => {
    const { send } = await createTestApp([userMessage("m1", "u1", { content: "Please keep **both** modes." })]);
    const result = await send({ content: "From the user; please apply.", forwardUserMessageIds: ["u1"] });

    expect(result.status).toBe(200);
    const written = new Date(WRITTEN_AT);
    const when = `${written.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${written.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    expect(result.content).toBe(
      [
        "From the user; please apply.",
        "",
        `[Forwarded user message u1, written ${when}: the user's exact words]`,
        "Please keep **both** modes.",
        "[End of forwarded user message u1]",
      ].join("\n"),
    );
    // Without images, the agent reads exactly what the feed shows.
    expect(result.options?.deliveryContent).toBe(result.content);
  });

  it("forwards guided review answers with their line comments unchanged, with no note", async () => {
    const { send } = await createTestApp([userMessage("m1", "u1", { content: REVIEW_ANSWERS })]);
    const result = await send({ content: "", forwardUserMessageIds: ["u1"] });

    expect(result.status).toBe(200);
    expect(result.content).toMatch(/^\[Forwarded user message u1, written /);
    expect(result.content).toContain(`]\n${REVIEW_ANSWERS}\n[End of forwarded user message u1]`);
  });

  it("includes comments on quoted passages as the leader's agent read them", async () => {
    const annotations = [{ id: "a1", selectedText: "the old flag", comment: "drop it" }];
    const { send } = await createTestApp([userMessage("m1", "u1", { content: "See my comment", annotations })]);
    const result = await send({ content: "", forwardUserMessageIds: ["u1"] });

    expect(result.content).toContain("> the old flag\n[comment 1] drop it\n\n---\nSee my comment");
  });

  it("copies images to the recipient and names the copies where its agent reads them", async () => {
    const images = [{ imageId: "img-1", media_type: "image/png" }];
    const { send, imageRoot } = await createTestApp([userMessage("m1", "u1", { content: "Look at this", images })]);
    const result = await send({ content: "", forwardUserMessageIds: ["u1"] });

    expect(result.status).toBe(200);
    // The recipient gets its own copy (and thumbnail) under a new ID, shown in its feed.
    const copy = result.options?.imageRefs?.[0];
    expect(copy).toMatchObject({ media_type: "image/png" });
    expect(copy?.imageId).not.toBe("img-1");
    expect((await readdir(join(imageRoot, WORKER))).sort()).toEqual(
      [`${copy?.imageId}.orig.png`, `${copy?.imageId}.thumb.webp`].sort(),
    );
    // Its agent reads the path inside the forwarded block; the feed text carries no path.
    const path = join(attachmentDirectory(WORKER), `${copy?.imageId}.orig.png`);
    expect(result.options?.deliveryContent).toContain(`Look at this\n[📎 Image attachments`);
    expect(result.options?.deliveryContent).toContain(`Attachment 1: ${path}]\n[End of forwarded user message u1]`);
    expect(result.content).not.toContain(path);
  });

  it("says when a forwarded message's image is no longer stored", async () => {
    const images = [{ imageId: "gone", media_type: "image/png" }];
    const { send } = await createTestApp([userMessage("m1", "u1", { content: "Old screenshot", images })]);
    const result = await send({ content: "", forwardUserMessageIds: ["u1"] });

    expect(result.content).toContain(
      "Old screenshot\n[1 image is no longer stored]\n[End of forwarded user message u1]",
    );
    expect(result.options?.imageRefs).toEqual([]);
  });

  it("forwards several messages in the order given", async () => {
    const { send } = await createTestApp([userMessage("m1", "u1"), userMessage("m2", "u2")]);
    const result = await send({ content: "", forwardUserMessageIds: ["u2", "u1"] });

    expect(result.content!.indexOf("m2 text")).toBeLessThan(result.content!.indexOf("m1 text"));
  });

  it("refuses IDs the sender does not have, without delivering anything", async () => {
    // u9 exists only in the recipient's history: IDs are scoped to the sender's own session.
    const { send } = await createTestApp([userMessage("m1", "u1")]);
    const result = await send({ content: "note", forwardUserMessageIds: ["u1", "u9"] });

    expect(result.status).toBe(400);
    expect(result.body.error).toContain("No user message u9 in this session");
    expect(result.injected).toBe(0);
  });

  it("still requires content when nothing is forwarded", async () => {
    const { send } = await createTestApp([]);
    const result = await send({ content: "  " });
    expect(result.status).toBe(400);
  });
});
