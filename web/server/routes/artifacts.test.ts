import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { RouteContext } from "./context.js";
import { ArtifactLibraryStore } from "../artifact-library-store.js";
import { ArtifactLibrary, type LibrarySessionLike } from "../artifact-library.js";
import { createArtifactRoutes } from "./artifacts.js";
import { LocalImageVariantStore } from "../local-image-variant-store.js";
import { makeScreenshotLikePng } from "../test-fixtures/images.js";

/**
 * The library API on a disposable store: an agent's list defaults to its own session's space,
 * the browser asks for all spaces, a figure is served from the library's own copy, and renaming
 * or merging refreshes the conversations that show the artifact.
 */

let root: string;
let fixtures: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifact-routes-"));
  fixtures = await mkdtemp(join(tmpdir(), "artifact-route-fixtures-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(fixtures, { recursive: true, force: true });
});

function assistant(id: string, text: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    timestamp: Date.now(),
  } as BrowserIncomingMessage;
}

async function setup() {
  const figure = join(fixtures, "evals.png");
  await writeFile(figure, "png bytes");
  const sessions: LibrarySessionLike[] = [
    {
      id: "msi-leader",
      messageHistory: [
        assistant("m1", "```draft\ntitle: T7 update\n---\nhello\n```"),
        assistant("m2", `![evals](${figure})`),
      ],
    },
    {
      id: "takode-leader",
      messageHistory: [assistant("m3", "```draft\ntitle: Release note\n---\nhi\n```")],
    },
  ];
  const refreshed: string[] = [];
  const store = new ArtifactLibraryStore(root);
  await store.load();
  const library = new ArtifactLibrary(store, {
    getSession: (id) => sessions.find((session) => session.id === id),
    listSessions: () => sessions,
    spaceFor: (id) => (id.startsWith("msi") ? "MSI" : "Takode"),
    refreshConversation: (id) => refreshed.push(id),
  });
  await library.backfill();
  refreshed.length = 0;
  let caller: string | null = null;
  const variants = new LocalImageVariantStore(join(root, "variants"), { fullWaitMs: 60_000 });
  const ctx = {
    localImageVariantStore: variants,
    resolveId: (raw: string) => raw,
    authenticateCompanionCallerOptional: () => (caller ? { callerId: caller, caller: {} } : null),
    launcher: { listSessions: () => [{ sessionId: "msi-worker", herdedBy: "msi-leader" }] },
  } as unknown as RouteContext;
  const thumbnails = {
    get: async (id: string) => (id === "missing" ? null : id === "drawing" ? "pending" : Buffer.from("webp")),
  };
  const app = createArtifactRoutes(
    ctx,
    () => library,
    () => thumbnails as never,
  );
  return {
    app,
    store,
    variants,
    sessions,
    library,
    refreshed,
    setCaller: (id: string | null) => (caller = id),
  };
}

describe("artifact routes", () => {
  it("lists an agent's own space by default, and every space on request", async () => {
    const { app, setCaller } = await setup();
    setCaller("msi-leader");
    const own = await (await app.request("/artifacts")).json();
    expect(own.space).toBe("MSI");
    expect(own.artifacts.map((artifact: { title: string }) => artifact.title).sort()).toEqual(["T7 update", "evals"]);

    const all = await (await app.request("/artifacts?space=all&kind=post")).json();
    expect(all.space).toBeNull();
    expect(all.artifacts.map((artifact: { title: string }) => artifact.title).sort()).toEqual([
      "Release note",
      "T7 update",
    ]);
    expect(all.spaces).toEqual(["MSI", "Takode"]);
  });

  it("serves a figure from the library's own copy and a version's text by ID prefix", async () => {
    const { app, store } = await setup();
    const figure = store.list({ kind: "figure" }).artifacts[0];
    const file = await app.request(`/artifacts/${figure.id}/file`);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(await file.text()).toBe("png bytes");

    const post = store.list({ query: "T7" }).artifacts[0];
    const content = await (await app.request(`/artifacts/${post.id.slice(0, 8)}/versions/1`)).json();
    expect(content).toEqual({ kind: "post", parts: ["hello"], figureIds: [] });
  });

  it("serves a figure as the full view the chat prepared, converted once for both", async () => {
    // The chat's copy of a screenshot is made when the agent shows it; the gallery's figure is
    // the Library's own copy of the same bytes, so it is served from that conversion.
    const { app, store, variants, sessions, library } = await setup();
    const shot = join(fixtures, "shot.png");
    await writeFile(shot, await makeScreenshotLikePng(800, 600));
    await variants.prepare(shot, "image/png");
    sessions[0]!.messageHistory.push(assistant("m4", `![shot](${shot})`));
    library.sessionSaved("msi-leader");
    await library.idle();

    const figure = store.list({ kind: "figure", query: "shot" }).artifacts[0]!;
    const file = await app.request(`/artifacts/${figure.id}/file`);
    expect(file.headers.get("content-type")).toBe("image/webp");
    const fullViews = (await readdir(join(root, "variants"))).filter((name) => name.startsWith("full-"));
    expect(fullViews).toHaveLength(1);
  });

  it("renames and merges, refreshing the conversations that show them", async () => {
    const { app, store, refreshed } = await setup();
    const [release, t7] = [store.list({ query: "Release" }).artifacts[0], store.list({ query: "T7" }).artifacts[0]];
    const renamed = await app.request(`/artifacts/${t7.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "T7 thread update", starred: true }),
    });
    expect(await renamed.json()).toMatchObject({
      title: "T7 thread update",
      starred: true,
    });
    expect(refreshed).toEqual(["msi-leader"]);

    const merged = await app.request(`/artifacts/${release.id}/merge`, {
      method: "POST",
      body: JSON.stringify({ into: t7.id }),
    });
    expect(await merged.json()).toMatchObject({ versionCount: 2 });
    expect(refreshed).toContain("takode-leader");
    expect((await app.request(`/artifacts/${release.id}`)).status).toBe(404);
  });

  it("scopes a leader's Library to it and its workers, and serves thumbnails for good under a versioned URL", async () => {
    const { app } = await setup();
    const own = await (await app.request("/artifacts?leader=msi-leader&space=all")).json();
    expect(own.artifacts.map((artifact: { title: string }) => artifact.title).sort()).toEqual(["T7 update", "evals"]);

    const versioned = await app.request("/artifacts/abc/thumb?v=0123456789abcdef&theme=light");
    expect(versioned.headers.get("content-type")).toBe("image/webp");
    expect(versioned.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect((await app.request("/artifacts/missing/thumb?v=1")).status).toBe(404);
    // A visual still being drawn answers at once, uncached, for the gallery to ask again.
    const drawing = await app.request("/artifacts/drawing/thumb?v=1");
    expect(drawing.status).toBe(202);
    expect(drawing.headers.get("cache-control")).toBe("no-store");
  });
});
