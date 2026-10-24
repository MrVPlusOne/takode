import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import type { BrowserIncomingMessage } from "./session-types.js";
import { extractFromTextBlocks } from "./artifact-extract.js";
import { ArtifactLibraryStore } from "./artifact-library-store.js";
import { ArtifactLibrary, type LibrarySessionLike } from "./artifact-library.js";
import { ArtifactThumbnails } from "./artifact-thumbnails.js";

/**
 * The Library gallery's server side on disposable state: tables in answers become artifacts (and a
 * library that started before tables reads its earlier history for them once), text kinds carry an
 * excerpt for their miniatures, a leader's Library holds what it and its workers made or showed,
 * and picture thumbnails are made once per version and theme, then served from disk.
 */

const NOW = Date.UTC(2026, 9, 23, 18, 0);
let root: string;
let fixtures: string;
let counter = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifact-gallery-"));
  fixtures = await mkdtemp(join(tmpdir(), "artifact-gallery-fixtures-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(fixtures, { recursive: true, force: true });
});

function assistant(text: string, at = NOW): BrowserIncomingMessage {
  counter += 1;
  return {
    type: "assistant",
    message: {
      id: `gallery-msg-${counter}`,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: at,
  } as BrowserIncomingMessage;
}

async function newLibrary(sessions: LibrarySessionLike[]) {
  const store = new ArtifactLibraryStore(root, () => NOW);
  await store.load();
  const library = new ArtifactLibrary(store, {
    getSession: (id) => sessions.find((session) => session.id === id),
    listSessions: () => sessions,
    spaceFor: () => "MSI",
    refreshConversation: () => {},
  });
  return { store, library };
}

const EVAL_TABLE = [
  "| Benchmark | Start | T7 latest |",
  "| --- | --- | --- |",
  "| SWE-bench Verified | 0.512 | 0.574 |",
  "| SB Pro hard | 0.451 | 0.618 |",
  "| DeepSWE | 0.159 | 0.230 |",
].join("\n");

describe("tables", () => {
  it("captures tables of three or more rows, titled by the line that introduces them", () => {
    const captures = extractFromTextBlocks([
      [
        "**4 PM T7 update: training is now clearly helping.** Details below.",
        "",
        EVAL_TABLE,
        "",
        "Per training domain, pass@1:",
        EVAL_TABLE,
        "",
        "Some prose with no title line.",
        "",
        EVAL_TABLE,
        "",
        // Two rows: part of the answer's wording, not something to find later.
        "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
        "```text",
        EVAL_TABLE,
        "```",
      ].join("\n"),
    ]);
    const tables = captures.filter((capture) => capture.kind === "table");
    expect(tables.map((table) => table.kind === "table" && table.title)).toEqual([
      "4 PM T7 update: training is now clearly helping",
      "Per training domain, pass@1",
      "Benchmark · Start · T7 latest",
    ]);
    expect(tables[0].kind === "table" && tables[0].markdown).toBe(EVAL_TABLE);
  });

  it("reads earlier history for tables once when the library predates them", async () => {
    const session: LibrarySessionLike = {
      id: "leader",
      messageHistory: [assistant(`**Evals so far**\n\n${EVAL_TABLE}\n\n\`\`\`draft\nQuick update\n\`\`\``)],
    };
    // An index written before tables existed: it read this history already, for posts only.
    const { store, library } = await newLibrary([session]);
    await library.backfill();
    const index = JSON.parse(await readFile(join(root, "index.json"), "utf-8"));
    for (const artifact of Object.values(index.artifacts) as Array<{ kind: string; id: string; key: string }>) {
      if (artifact.kind !== "table") continue;
      delete index.artifacts[artifact.id];
      delete index.keys[artifact.key];
    }
    for (const key of Object.keys(index.messages)) {
      index.messages[key] = index.messages[key].filter((entry: { label: string }) => !entry.label.startsWith("table"));
    }
    delete index.backfilledKinds;
    for (const artifact of Object.values(index.artifacts) as Array<{ excerpt?: string }>) delete artifact.excerpt;
    await writeFile(join(root, "index.json"), JSON.stringify(index));
    expect(store.list({ kind: "table" }).total).toBe(1);

    const reopened = await newLibrary([session]);
    // Excerpts are filled in for artifacts saved before them.
    expect(reopened.store.list({ kind: "post" }).artifacts[0].excerpt).toBe("Quick update");
    expect(reopened.store.list({ kind: "table" }).total).toBe(0);
    await reopened.library.backfill();
    const tables = reopened.store.list({ kind: "table" }).artifacts;
    expect(tables.map((table) => [table.title, table.excerpt])).toEqual([["Evals so far", EVAL_TABLE]]);
    expect(reopened.store.list({ kind: "post" }).total).toBe(1);
    // Done once: reading again adds nothing.
    await reopened.library.backfill();
    expect(reopened.store.list().total).toBe(2);
  });
});

describe("a leader's Library", () => {
  it("holds what the leader and its workers made, and what the leader showed", async () => {
    const figure = join(fixtures, "evals.png");
    await writeFile(
      figure,
      await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336" } })
        .png()
        .toBuffer(),
    );
    const sessions: LibrarySessionLike[] = [
      { id: "worker", messageHistory: [assistant(`![evals](${figure})`)] },
      {
        id: "leader",
        messageHistory: [assistant(`Here it is: ![evals](${figure})\n\n\`\`\`draft\nLeader post\n\`\`\``)],
      },
      { id: "other", messageHistory: [assistant("```draft\nSomeone else's post\n```")] },
    ];
    const { store, library } = await newLibrary(sessions);
    await library.backfill();
    const titles = (sessionIds: string[]) =>
      store
        .list({ sessionIds })
        .artifacts.map((artifact) => artifact.title)
        .sort();
    // The figure was first seen in the worker, and the leader showed it too.
    expect(titles(["leader"])).toEqual(["Leader post", "evals"]);
    expect(titles(["leader", "worker"])).toEqual(["Leader post", "evals"]);
    expect(titles(["other"])).toEqual(["Someone else's post"]);
  });
});

describe("thumbnails", () => {
  it("makes a figure's thumbnail once and a visual's once per theme, and none for text kinds", async () => {
    const figure = join(fixtures, "wide.png");
    await writeFile(
      figure,
      await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#c33" } })
        .png()
        .toBuffer(),
    );
    const sessions: LibrarySessionLike[] = [
      {
        id: "leader",
        messageHistory: [
          assistant(`![wide](${figure})`),
          assistant("```visual\ntitle: Pipeline\nalt: A pipeline\n---\n<div>hi</div>\n```"),
          assistant("```draft\nA post\n```"),
        ],
      },
    ];
    const { store, library } = await newLibrary(sessions);
    await library.backfill();
    const renders: string[] = [];
    const thumbnails = new ArtifactThumbnails(store, {
      renderVisual: async (_source, theme, width) => {
        renders.push(theme);
        return sharp({ create: { width: width * 2, height: width * 3, channels: 3, background: "#fff" } })
          .png()
          .toBuffer();
      },
    });
    const byKind = (kind: "figure" | "visual" | "post") => store.list({ kind }).artifacts[0];

    const figureThumb = (await thumbnails.get(byKind("figure").id, "dark")) as Buffer;
    expect(await sharp(figureThumb!).metadata()).toMatchObject({ format: "webp", width: 480, height: 240 });
    // Served from disk afterwards, for either theme.
    expect(await thumbnails.get(byKind("figure").id, "light")).toEqual(figureThumb);

    // Without waiting, a visual not drawn yet is "pending" and drawn in the background.
    expect(await thumbnails.get(byKind("visual").id, "dark", { waitForVisual: false })).toBe("pending");
    const dark = (await thumbnails.get(byKind("visual").id, "dark")) as Buffer;
    // A tall visual keeps its top, no taller than wide.
    expect(await sharp(dark!).metadata()).toMatchObject({ width: 480, height: 480 });
    await thumbnails.get(byKind("visual").id, "light");
    await thumbnails.get(byKind("visual").id, "dark");
    expect(renders).toEqual(["dark", "light"]);

    expect(await thumbnails.get(byKind("post").id, "dark")).toBeNull();
    // A visual that cannot be drawn is not tried again for that version.
    const failing = new ArtifactThumbnails(store, {
      renderVisual: async () => {
        renders.push("failed");
        return null;
      },
    });
    await rm(join(root, "thumbs"), { recursive: true });
    expect(await failing.get(byKind("visual").id, "dark")).toBeNull();
    expect(await failing.get(byKind("visual").id, "dark")).toBeNull();
    expect(renders.filter((entry) => entry === "failed")).toHaveLength(1);
    await thumbnails.get(byKind("figure").id, "dark");
    expect(byKind("post").thumb).toBeUndefined();
    expect(byKind("figure").thumb).toMatch(/^[0-9a-f]{16}$/);
    expect((await readdir(join(root, "thumbs"))).sort()).toEqual([
      expect.stringMatching(/-any\.webp$/),
      expect.stringMatching(/-dark\.webp\.none$/),
    ]);
  });
});
