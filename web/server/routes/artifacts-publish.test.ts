import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RouteContext } from "./context.js";
import { ArtifactLibraryStore } from "../artifact-library-store.js";
import { ArtifactLibrary } from "../artifact-library.js";
import { createArtifactRoutes } from "./artifacts.js";
import { makePptx } from "../test-fixtures/pptx.js";
import { makeScreenshotLikePng } from "../test-fixtures/images.js";

/**
 * `takode artifact publish` on a disposable store: a session uploads a PowerPoint deck (with or
 * without slide pictures) and it becomes a slide deck in its space, versioned by title, with its
 * file downloadable under its own name and each slide's picture served; the same upload again adds
 * no version, and pictures that don't match the shown slides are refused.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifact-publish-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const store = new ArtifactLibraryStore(root);
  await store.load();
  const versionsTold: number[] = [];
  const library = new ArtifactLibrary(store, {
    getSession: () => undefined,
    listSessions: () => [],
    spaceFor: () => "MSI",
    refreshConversation: () => {},
    onNewVersion: (version) => versionsTold.push(version.version),
  });
  const ctx = {
    resolveId: (raw: string) => raw,
    authenticateTakodeCaller: () => ({ callerId: "msi-worker", caller: {} }),
    authenticateCompanionCallerOptional: () => null,
    launcher: { listSessions: () => [{ sessionId: "msi-worker", herdedBy: "msi-leader" }] },
  } as unknown as RouteContext;
  return { app: createArtifactRoutes(ctx, () => library), store, versionsTold };
}

const DECK = makePptx([
  { title: "FV weekly", notes: "Open with the headline." },
  { title: "Results", boxes: [{ text: "31% → 44%" }] },
]);

function publish(
  app: Awaited<ReturnType<typeof setup>>["app"],
  options: { file?: Uint8Array; name?: string; title?: string; pictures?: Uint8Array[]; thread?: string } = {},
) {
  const form = new FormData();
  // Copied into a plain ArrayBuffer-backed array, as File takes.
  form.set("file", new File([new Uint8Array(options.file ?? DECK)], options.name ?? "fv_coding_weekly.pptx"));
  if (options.title) form.set("title", options.title);
  if (options.thread) form.set("threadKey", options.thread);
  options.pictures?.forEach((picture, index) =>
    form.append("pictures", new File([new Uint8Array(picture)], `slide${index + 1}.png`)),
  );
  return app.request("/artifacts/publish", { method: "POST", body: form });
}

describe("publishing a PowerPoint deck", () => {
  it("saves it as a slide deck with its slides, pictures and file, and versions it by title", async () => {
    const { app, store, versionsTold } = await setup();
    const pictures = [await makeScreenshotLikePng(64, 36), await makeScreenshotLikePng(80, 45)];
    const response = await publish(app, { pictures, thread: "q-7" });
    expect(response.status).toBe(201);
    const published = await response.json();
    // Titled by the file's name, so a revised deck keeps its history.
    expect(published).toMatchObject({ kind: "deck", title: "Fv coding weekly", space: "MSI", threadKey: "q-7" });
    expect(published).toMatchObject({ version: 1, added: true });
    expect(versionsTold).toEqual([1]);

    // Found under Slides, by a slide's text too, with slide 1 as its gallery thumbnail.
    const listed = store.list({ kind: "deck", query: "44%" }).artifacts;
    expect(listed.map((artifact) => artifact.id)).toEqual([published.id]);
    expect(listed[0]!.thumb).toBeTruthy();
    // It counts among the leader's artifacts, since its worker published it.
    expect((await (await app.request("/artifacts?leader=msi-leader&kind=deck")).json()).total).toBe(1);

    const content = await (await app.request(`/artifacts/${published.id}/versions/1`)).json();
    expect(content).toMatchObject({ kind: "pptx", name: "fv_coding_weekly.pptx", bytes: DECK.length });
    expect(content.slides).toEqual([
      expect.objectContaining({ title: "FV weekly", notes: "Open with the headline." }),
      expect.objectContaining({ title: "Results", text: "31% → 44%" }),
    ]);
    // The routes are mounted under /api in the server.
    const file = await app.request(content.fileUrl.replace(/^\/api/, ""));
    expect(file.headers.get("content-disposition")).toContain("fv_coding_weekly.pptx");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(DECK);
    const second = await app.request(content.slides[1].pictureUrl.replace(/^\/api/, ""));
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(pictures[1]!));

    // The same file and pictures again add nothing; a revised file is version 2, the first kept.
    expect(await (await publish(app, { pictures, thread: "q-7" })).json()).toMatchObject({ version: 1, added: false });
    const revised = makePptx([{ title: "FV weekly" }, { title: "Results", boxes: [{ text: "31% → 47%" }] }]);
    expect(await (await publish(app, { file: revised })).json()).toMatchObject({ id: published.id, version: 2 });
    expect((await app.request(`/artifacts/${published.id}/versions/1/file`)).status).toBe(200);
    expect(versionsTold).toEqual([1, 2]);
  });

  it("shows a deck published without pictures by its text, and refuses pictures that don't match", async () => {
    const { app, store } = await setup();
    const response = await publish(app, { title: "Game play weekly" });
    const published = await response.json();
    expect(published.title).toBe("Game play weekly");
    // Its gallery card draws the first slide's text.
    expect(store.list({ kind: "deck" }).artifacts[0]).toMatchObject({ excerpt: "# FV weekly" });
    expect(store.list({ kind: "deck" }).artifacts[0]!.thumb).toBeUndefined();

    const mismatch = await publish(app, { pictures: [await makeScreenshotLikePng(64, 36)] });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toContain("2 slide(s) but 1 picture(s)");
    const notPptx = await publish(app, { file: new TextEncoder().encode("hello"), name: "notes.pptx" });
    expect(notPptx.status).toBe(400);
    expect((await publish(app, { name: "deck.key" })).status).toBe(400);
    expect(store.list().total).toBe(1);
  });
});
