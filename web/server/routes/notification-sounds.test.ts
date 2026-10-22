import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_CUSTOM_NOTIFICATION_SOUND_BYTES } from "../../shared/custom-notification-sounds.js";
import { createNotificationSoundRoutes } from "./notification-sounds.js";

// A neutral stand-in for an audio file: the server stores bytes as uploaded and never decodes them.
const SOUND = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

describe("custom notification sound routes", () => {
  let root: string;
  let app: ReturnType<typeof createNotificationSoundRoutes>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "notification-sounds-"));
    app = createNotificationSoundRoutes(() => root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function upload(slot: string, body: BodyInit, type = "audio/wav", name = "ping%20one.wav") {
    return app.request(`/notification-sounds/${slot}`, {
      method: "PUT",
      headers: { "Content-Type": type, "X-File-Name": name },
      body,
    });
  }

  it("lists nothing until a sound is uploaded", async () => {
    const res = await app.request("/notification-sounds");
    expect(await res.json()).toEqual({ "needs-input": null, review: null });
    expect((await app.request("/notification-sounds/review/audio")).status).toBe(404);
  });

  it("stores an upload, lists it and serves its bytes with a revalidation tag", async () => {
    const saved = await (await upload("review", SOUND)).json();
    expect(saved).toMatchObject({ name: "ping one.wav", mimeType: "audio/wav", size: SOUND.byteLength });

    const list = await (await app.request("/notification-sounds")).json();
    expect(list).toEqual({ "needs-input": null, review: saved });

    const audio = await app.request("/notification-sounds/review/audio");
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(SOUND);
    // Browsers revalidate before each alert; an unchanged sound answers 304 without the bytes.
    const etag = audio.headers.get("etag") ?? "";
    const again = await app.request("/notification-sounds/review/audio", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
  });

  it("removes a sound and leaves no temporary files behind", async () => {
    await upload("needs-input", SOUND);
    expect((await readdir(root)).sort()).toEqual(["needs-input.audio", "needs-input.json"]);

    expect((await app.request("/notification-sounds/needs-input", { method: "DELETE" })).status).toBe(200);
    expect(await readdir(root)).toEqual([]);
    expect((await (await app.request("/notification-sounds")).json())["needs-input"]).toBeNull();
  });

  it("rejects non-audio, empty, oversized and unknown uploads", async () => {
    expect((await upload("review", SOUND, "text/plain")).status).toBe(415);
    expect((await upload("review", new Uint8Array())).status).toBe(400);
    expect((await upload("review", new Uint8Array(MAX_CUSTOM_NOTIFICATION_SOUND_BYTES + 1))).status).toBe(413);
    expect((await upload("other", SOUND)).status).toBe(404);
    expect(await readdir(root)).toEqual([]);
  });
});
