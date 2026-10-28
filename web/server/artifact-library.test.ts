import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserIncomingMessage } from "./session-types.js";
import { extractFromTextBlocks, extractMessageArtifacts } from "./artifact-extract.js";
import { ArtifactLibraryStore, UNTITLED_POST_GROUPING_MS } from "./artifact-library-store.js";
import { ArtifactLibrary, type ArtifactLibraryDeps, type LibrarySessionLike } from "./artifact-library.js";
import { ARTIFACT_PLACEHOLDER_LANGUAGE } from "../shared/artifact-library.js";
import { parseDraftBlock } from "../shared/draft-posts.js";

/**
 * The artifact library end to end on disposable state: what counts as an artifact in a message,
 * how revisions group into versions, what each version keeps (all text, newest figure file only),
 * and how messages are projected for browsers (superseded versions collapse, current ones get a
 * marker). Every store lives in a fresh temporary directory.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 23, 18, 0);

let root: string;
let fixtures: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifact-library-"));
  fixtures = await mkdtemp(join(tmpdir(), "artifact-fixtures-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(fixtures, { recursive: true, force: true });
});

let messageCounter = 0;

function assistant(text: string, at: number, threadKey = "main"): BrowserIncomingMessage {
  messageCounter += 1;
  return {
    type: "assistant",
    message: {
      id: `msg-${messageCounter}`,
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
    timestamp: at,
    threadKey,
  } as BrowserIncomingMessage;
}

function report(content: string, sourcePath: string, at: number, sessionId = "s1"): BrowserIncomingMessage {
  messageCounter += 1;
  return {
    type: "markdown_report",
    id: `report-${messageCounter}`,
    timestamp: at,
    content,
    threadKey: "main",
    source: {
      sessionId,
      reportId: `report-${messageCounter}`,
      sourcePath,
      sha256: "x",
    },
  };
}

function textOf(message: BrowserIncomingMessage): string {
  if (message.type === "markdown_report") return message.content;
  if (message.type !== "assistant") return "";
  return message.message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

async function setup(
  sessions: LibrarySessionLike[],
  now = NOW,
  hooks: Pick<ArtifactLibraryDeps, "onImagesShown" | "onFigureSaved"> = {},
) {
  const refreshed: string[] = [];
  const store = new ArtifactLibraryStore(root, () => now);
  await store.load();
  const library = new ArtifactLibrary(store, {
    getSession: (id) => sessions.find((session) => session.id === id),
    listSessions: () => sessions,
    spaceFor: () => "MSI",
    refreshConversation: (id) => refreshed.push(id),
    ...hooks,
  });
  return { store, library, refreshed };
}

describe("extraction", () => {
  it("groups an answer's draft blocks into one post, keeps figures, ignores code", () => {
    const captures = extractFromTextBlocks([
      [
        "Here's the update.",
        "",
        "````draft",
        "Quick T7 update (step ~163):",
        "```",
        "Eval  Start  Now",
        "```",
        "````",
        "",
        "```draft",
        "Part two",
        "```",
        "",
        "![T7 vs twin](/tmp/fig.png) and ![remote](https://example.com/a.png)",
        "```text",
        "![not a figure](/tmp/code.png)",
        "```",
      ].join("\n"),
    ]);
    expect(captures.map((capture) => capture.kind)).toEqual(["figure", "post"]);
    const post = captures[1];
    expect(post.kind === "post" && post.parts).toEqual([
      "Quick T7 update (step ~163):\n```\nEval  Start  Now\n```",
      "Part two",
    ]);
    expect(post.kind === "post" && post.autoTitle).toBe("Quick T7 update (step ~163)");
    expect(post.kind === "post" && post.figureLabels).toEqual(["figure:/tmp/fig.png"]);
  });

  it("reads a draft's title header and splits differently titled drafts", () => {
    expect(parseDraftBlock("title: T7 thread update\n---\nBody")).toEqual({
      title: "T7 thread update",
      body: "Body",
      attachments: [],
    });
    expect(parseDraftBlock("No header\n---\nBody")).toEqual({
      body: "No header\n---\nBody",
      attachments: [],
    });
    const captures = extractFromTextBlocks([
      "```draft\ntitle: Reply to Dan\n---\nA\n```\n```draft\ntitle: Reply to Frank\n---\nB\n```\n```draft\nC\n```",
    ]);
    expect(captures.map((capture) => capture.kind === "post" && [capture.title, capture.parts])).toEqual([
      ["Reply to Dan", ["A"]],
      ["Reply to Frank", ["B", "C"]],
    ]);
  });

  it("reads a post's part numbers and attached files, keeping attached images as figures", () => {
    const captures = extractFromTextBlocks([
      "```draft\ntitle: T7 status\npart: 2\n---\nTwin is ahead.\nattach: /tmp/plot.png\nattach: /tmp/notes.pdf\n```",
    ]);
    expect(captures.map((capture) => [capture.kind, capture.label])).toEqual([
      ["figure", "figure:/tmp/plot.png"],
      ["post", "post#0"],
    ]);
    // Attached figures sit inside the draft block: there is nothing of theirs to collapse.
    expect(captures[0]!.kind === "figure" && captures[0]!.spans).toEqual([]);
    const post = captures[1]!;
    expect(post.kind === "post" && [post.parts, post.partNumbers, post.attachments]).toEqual([
      ["Twin is ahead."],
      [2],
      [["/tmp/plot.png", "/tmp/notes.pdf"]],
    ]);
  });

  it("captures reports and guided reviews, and skips subagent answers", () => {
    const extracted = extractMessageArtifacts(report("# How it was built\n\nBody", "/r/how.md", NOW));
    expect(extracted?.captures[0]).toMatchObject({
      kind: "report",
      title: "How it was built",
      sourcePath: "/r/how.md",
    });
    const child = {
      ...assistant("```draft\nx\n```", NOW),
      parent_tool_use_id: "tool-1",
    } as BrowserIncomingMessage;
    expect(extractMessageArtifacts(child)).toBeNull();
  });
});

describe("versions and projection", () => {
  it("groups untitled redrafts by their first line, collapses the older one, and marks the newest", async () => {
    // The Oct 23 T7 update: the same post redrafted with new numbers, no title line.
    const v1 = assistant("```draft\nQuick T7 update (T7 at step ~163, twin ~91):\nold\n```", NOW - 3600_000, "q-2713");
    const v2 = assistant("Better:\n\n```draft\nQuick T7 update (T7 at step ~165, twin ~94):\nnew\n```", NOW, "q-2713");
    const session = { id: "s1", messageHistory: [v1, v2] };
    const { store, library, refreshed } = await setup([session]);
    await library.backfill();

    const listed = store.list();
    expect(listed.total).toBe(1);
    expect(listed.artifacts[0]).toMatchObject({
      kind: "post",
      versionCount: 2,
      space: "MSI",
    });
    expect(refreshed).toContain("s1");

    const [older, newer] = library.projectMessages("s1", [v1, v2]);
    expect(textOf(older)).toContain(`\`\`\`${ARTIFACT_PLACEHOLDER_LANGUAGE}`);
    expect(textOf(older)).not.toContain("old");
    expect(textOf(newer)).toContain("new");
    expect((newer as { artifacts?: unknown[] }).artifacts).toEqual([
      expect.objectContaining({ version: 2, versionCount: 2, kind: "post" }),
    ]);
    // Every text version is kept.
    const id = listed.artifacts[0].id;
    expect(await store.versionContent(id, 1)).toMatchObject({
      kind: "post",
      parts: [expect.stringContaining("old")],
    });
  });

  it("revises named parts of a post, rewrites it whole otherwise, and records how parts changed", async () => {
    // Oct 27 (replacing the Oct 23 guess that a shorter redraft only revised its first message):
    // a revision repeats just the parts it changes by number and the rest carry over; a block
    // without numbers is the whole post, which is how parts are dropped, inserted or reordered.
    // Each version records how its parts changed, and an older version collapses whole.
    const post = (...blocks: string[]) => blocks.map((block) => `\`\`\`draft\n${block}\n\`\`\``).join("\n\n");
    const first = assistant(
      post(
        "title: T7 status\n---\nT7 at step 340.\nattach: /tmp/missing-plot.png",
        "Twin is level.",
        "Eval jobs recovered.",
      ),
      NOW,
      "q-1",
    );
    const editTwo = assistant(post("title: T7 status\npart: 2\n---\nTwin is slightly ahead."), NOW + 1, "q-1");
    const dropThree = assistant(
      post("title: T7 status\n---\nT7 at step 340.\nattach: /tmp/missing-plot.png", "Twin is slightly ahead."),
      NOW + 2,
      "q-1",
    );
    const session = { id: "s1", messageHistory: [first, editTwo, dropThree] };
    const { store, library } = await setup([session]);
    await library.backfill();

    const [artifact] = store.list().artifacts.filter((entry) => entry.kind === "post");
    const v1 = await store.versionContent(artifact.id, 1);
    expect(v1).toMatchObject({
      parts: ["T7 at step 340.", "Twin is level.", "Eval jobs recovered."],
      attachments: [[{ path: "/tmp/missing-plot.png" }], [], []],
    });
    expect(await store.versionContent(artifact.id, 2)).toMatchObject({
      parts: ["T7 at step 340.", "Twin is slightly ahead.", "Eval jobs recovered."],
      attachments: [[{ path: "/tmp/missing-plot.png" }], [], []],
    });
    expect(await store.versionContent(artifact.id, 3)).toMatchObject({
      parts: ["T7 at step 340.", "Twin is slightly ahead."],
    });
    const detail = store.get(artifact.id)!;
    expect(detail.versions.map((version) => version.changes)).toEqual([
      undefined,
      { parts: ["same", "edited", "same"], removed: [] },
      { parts: ["same", "same"], removed: [2] },
    ]);

    // The newest message carries how its parts changed; older ones collapse whole.
    expect((library.projectMessage("s1", dropThree) as { artifacts?: unknown }).artifacts).toEqual([
      expect.objectContaining({ version: 3, changes: { parts: ["same", "same"], removed: [2] } }),
    ]);
    const older = textOf(library.projectMessage("s1", first));
    expect(older).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
    expect(older).not.toContain("Twin is level");
    expect(older).not.toContain("Eval jobs recovered");
  });

  it("starts a new post when an untitled first line comes back much later, but titled drafts keep grouping", async () => {
    const early = NOW - UNTITLED_POST_GROUPING_MS - 1000;
    const session = {
      id: "s1",
      messageHistory: [
        assistant("```draft\nDaily status: 3 runs\n```", early),
        assistant("```draft\nDaily status: 4 runs\n```", NOW),
        assistant("```draft\ntitle: Launch note\n---\nv1\n```", early),
        assistant("```draft\ntitle: Launch note\n---\nv2\n```", NOW),
      ],
    };
    const { store, library } = await setup([session]);
    await library.backfill();
    const counts = store
      .list()
      .artifacts.map((artifact) => [artifact.title, artifact.versionCount])
      .sort();
    expect(counts).toEqual([
      ["Daily status: 3 runs", 1],
      ["Daily status: 4 runs", 1],
      ["Launch note", 2],
    ]);
  });

  it("keeps only the newest file of a figure redrawn into the same path, with a record of the older one", async () => {
    const path = join(fixtures, "t7_vs_twin_evals.png");
    await writeFile(path, "first drawing");
    const session: LibrarySessionLike = {
      id: "s1",
      messageHistory: [assistant(`![evals](${path})`, NOW - 1000)],
    };
    const { store, library } = await setup([session]);
    await library.backfill();
    // Shown again unchanged: no new version.
    session.messageHistory.push(assistant(`Same figure ![evals](${path})`, NOW - 500));
    library.sessionSaved("s1");
    await library.idle();
    expect(store.list().artifacts[0].versionCount).toBe(1);

    await writeFile(path, "redrawn");
    const redraw = assistant(`Redrawn ![evals](${path})`, NOW);
    session.messageHistory.push(redraw);
    library.sessionSaved("s1");
    await library.idle();

    const detail = store.get(store.list().artifacts[0].id)!;
    expect(detail.versions.map((version) => [version.n, version.kept])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(await readdir(join(root, "files"))).toHaveLength(1);
    // Both earlier messages showed version 1 and now collapse; the redraw shows the figure.
    const projected = library.projectMessages("s1", session.messageHistory);
    expect(textOf(projected[0])).not.toContain("![evals]");
    expect(textOf(projected[1])).not.toContain("![evals]");
    expect(textOf(projected[2])).toContain("![evals]");
  });

  it("versions a report by its source file across sessions and collapses the older publication", async () => {
    const worker = {
      id: "w1",
      messageHistory: [report("# Plan\n\nv1", "/r/plan.md", NOW - 1000, "w1")],
    };
    const leader = {
      id: "l1",
      messageHistory: [report("# Plan\n\nv2", "/r/plan.md", NOW, "l1")],
    };
    const { store, library, refreshed } = await setup([worker, leader]);
    await library.backfill();
    expect(store.list().artifacts[0]).toMatchObject({
      kind: "report",
      title: "Plan",
      versionCount: 2,
    });
    expect(refreshed).toContain("w1");
    expect(textOf(library.projectMessage("w1", worker.messageHistory[0]))).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
    expect(textOf(library.projectMessage("l1", leader.messageHistory[0]))).toContain("v2");
  });

  it("reads only new history, and skips history older than a month before the library started", async () => {
    const session: LibrarySessionLike = {
      id: "s1",
      messageHistory: [assistant("```draft\ntitle: Old\n---\nx\n```", NOW - 40 * DAY)],
    };
    const { store, library } = await setup([session]);
    await library.backfill();
    expect(store.list().total).toBe(0);
    session.messageHistory.push(assistant("```draft\ntitle: New\n---\ny\n```", NOW));
    library.sessionSaved("s1");
    await library.idle();
    expect(store.list().artifacts.map((artifact) => artifact.title)).toEqual(["New"]);

    // A fresh store reads the same index back from disk.
    const reloaded = new ArtifactLibraryStore(root, () => NOW);
    await reloaded.load();
    expect(reloaded.list().artifacts.map((artifact) => artifact.title)).toEqual(["New"]);
  });

  it("captures a message whose text arrives after its thinking was already read", async () => {
    // Claude sends a message's thinking and its text as separate parts with one message ID. When
    // the session was saved between them, the library read the thinking-only row, moved past it,
    // and never saw the text: on Oct 26 two revisions of a titled draft never became versions
    // (and their older card never collapsed). The text either replaces that row (a leader's routed
    // answer) or joins it in place; both are read now, once.
    const draft = (body: string) => `\`\`\`\`draft\ntitle: Latest evals for Dan\n---\n${body}\n\`\`\`\``;
    const thinkingOnly = (at: number) => {
      const row = assistant("", at, "q-1");
      if (row.type === "assistant") row.message.content = [{ type: "thinking", thinking: "" }];
      return row;
    };
    const withText = (row: BrowserIncomingMessage, text: string) => {
      if (row.type !== "assistant") return row;
      return {
        ...row,
        message: { ...row.message, content: [...row.message.content, { type: "text" as const, text }] },
      };
    };
    const first = assistant(draft("First."), NOW, "q-1");
    const session: LibrarySessionLike = { id: "s1", messageHistory: [first] };
    const { store, library } = await setup([session]);
    library.sessionSaved("s1");
    await library.idle();

    // Replaced: the routed row with the text takes the thinking row's place.
    const second = thinkingOnly(NOW + 60_000);
    session.messageHistory.push(second);
    library.sessionSaved("s1");
    await library.idle();
    session.messageHistory[1] = withText(second, draft("Second."));
    library.sessionSaved("s1");
    await library.idle();

    // In place: the text joins the row already saved, after a tool result was saved behind it.
    const third = thinkingOnly(NOW + 120_000);
    session.messageHistory.push(third);
    library.sessionSaved("s1");
    await library.idle();
    if (third.type === "assistant") third.message.content.push({ type: "text", text: draft("Third.") });
    session.messageHistory.push({ type: "result", data: {} } as unknown as BrowserIncomingMessage);
    library.sessionSaved("s1");
    await library.idle();

    // Saved again with nothing new: no version is added twice.
    library.sessionSaved("s1");
    await library.idle();
    const [artifact] = store.list().artifacts;
    expect(store.get(artifact.id)!.versions.map((version) => version.n)).toEqual([1, 2, 3]);
    expect(textOf(library.projectMessage("s1", session.messageHistory[0]))).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
  });

  it("reads history once more for what was skipped, without putting a version out of order", async () => {
    // Libraries that skipped messages (text arriving after their thinking was read) recover them
    // once at the next start: the index is backed up, skipped drafts become versions, and a
    // skipped draft older than its artifact's newest version stays out, since it would otherwise
    // become the newest and collapse the card that really is. Nobody is told about these.
    const titled = (title: string, body: string, at: number) =>
      assistant(`\`\`\`draft\ntitle: ${title}\n---\n${body}\n\`\`\``, at, "q-1");
    const session: LibrarySessionLike = { id: "s1", messageHistory: [titled("B", "Newest B.", NOW + 3)] };
    const first = await setup([session]);
    first.library.sessionSaved("s1");
    await first.library.idle();

    // Messages read past without their text, as the old cursor left them.
    session.messageHistory.push(titled("B", "Older B.", NOW + 1), titled("A", "A one.", NOW + 2));
    session.messageHistory.push(titled("A", "A two.", NOW + 4));
    const index = JSON.parse(await readFile(join(root, "index.json"), "utf-8"));
    delete index.skippedTextReread;
    index.cursors.s1 = { count: session.messageHistory.length };
    await writeFile(join(root, "index.json"), JSON.stringify(index));

    const told: string[] = [];
    const store = new ArtifactLibraryStore(root, () => NOW);
    await store.load();
    const library = new ArtifactLibrary(store, {
      getSession: () => session,
      listSessions: () => [session],
      spaceFor: () => "MSI",
      refreshConversation: () => {},
      onNewVersion: (version) => told.push(version.title),
    });
    await library.backfill();

    const versions = (title: string) =>
      store
        .get(store.list().artifacts.find((artifact) => artifact.title === title)!.id)!
        .versions.map((version) => version.n);
    expect(versions("A")).toEqual([1, 2]);
    expect(versions("B")).toEqual([1]);
    expect(told).toEqual([]);
    expect((await readdir(root)).filter((name) => name.startsWith("index.backup-skipped-text-"))).toHaveLength(1);
    expect(store.needsSkippedTextReread()).toBe(false);
    // A new library has nothing skipped to read again.
    expect(first.store.needsSkippedTextReread()).toBe(false);
  });

  it("collapses an earlier copy of the newest version when a later message sends it again", async () => {
    // Oct 27: a leader sent the revised draft twice (once more after a false reminder). Both
    // copies were the newest version, so both stayed open and the earlier one read as an older
    // version that failed to collapse. Only the newest message showing a version stays open.
    const titled = (body: string, at: number) =>
      assistant(`\`\`\`draft\ntitle: Latest evals for Dan\n---\n${body}\n\`\`\``, at, "q-1");
    const session: LibrarySessionLike = {
      id: "s1",
      messageHistory: [titled("First.", NOW), titled("Revised.", NOW + 1), titled("Revised.", NOW + 2)],
    };
    const { store, library, refreshed } = await setup([session]);
    library.sessionSaved("s1");
    await library.idle();
    expect(store.get(store.list().artifacts[0].id)!.versions).toHaveLength(2);

    const [first, revised, again] = session.messageHistory.map((message) =>
      textOf(library.projectMessage("s1", message)),
    );
    expect(first).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
    expect(revised).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
    expect(revised).toContain('"repeated":true');
    expect(revised).not.toContain("Revised.");
    expect(again).toContain("Revised.");
    expect((library.projectMessage("s1", session.messageHistory[2]) as { artifacts?: unknown }).artifacts).toEqual([
      expect.objectContaining({ version: 2, versionCount: 2 }),
    ]);

    // A copy sent later refreshes the conversations that showed the earlier one.
    refreshed.length = 0;
    session.messageHistory.push(titled("Revised.", NOW + 3));
    library.sessionSaved("s1");
    await library.idle();
    expect(refreshed).toContain("s1");
    expect(textOf(library.projectMessage("s1", session.messageHistory[2]))).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
  });

  it("keeps a post's destination with its versions until a revision names another", async () => {
    // A `to:` link says where the post is to be sent; revisions that don't repeat it keep it.
    const block = (header: string, body: string) => `\`\`\`draft\ntitle: Note for Dan\n${header}---\n${body}\n\`\`\``;
    const session: LibrarySessionLike = {
      id: "s1",
      messageHistory: [
        assistant(block("to: https://x.slack.com/archives/C1/p17\n", "First."), NOW, "q-1"),
        assistant(block("", "Second."), NOW + 1, "q-1"),
        assistant(block("to: [#other](https://x.slack.com/archives/C2)\n", "Second."), NOW + 2, "q-1"),
      ],
    };
    const { store, library } = await setup([session]);
    library.sessionSaved("s1");
    await library.idle();
    const [artifact] = store.list().artifacts;
    const destinations = await Promise.all(
      [1, 2, 3].map(async (n) => {
        const content = await store.versionContent(artifact.id, n);
        return content?.kind === "post" ? content.destination : null;
      }),
    );
    expect(destinations).toEqual([
      { url: "https://x.slack.com/archives/C1/p17" },
      { url: "https://x.slack.com/archives/C1/p17" },
      { url: "https://x.slack.com/archives/C2", label: "#other" },
    ]);
    // The message showing the newest version carries it, so its card can link it.
    expect((library.projectMessage("s1", session.messageHistory[2]) as { artifacts?: unknown }).artifacts).toEqual([
      expect.objectContaining({ version: 3, destination: { url: "https://x.slack.com/archives/C2", label: "#other" } }),
    ]);
  });

  it("remembers which parts of a post were copied, and a revision keeps that only for unchanged parts", async () => {
    // Copy for Slack records the copied parts on the version, so every device dims those buttons. A
    // new version starts with the parts it kept unchanged from a copied part; edited parts are new.
    const block = (header: string, body: string) => `\`\`\`draft\ntitle: Note for Dan\n${header}---\n${body}\n\`\`\``;
    const session: LibrarySessionLike = {
      id: "s1",
      messageHistory: [assistant(`${block("", "Message.")}\n\n\`\`\`draft\nReply.\n\`\`\``, NOW, "q-1")],
    };
    const { store, library } = await setup([session]);
    library.sessionSaved("s1");
    await library.idle();
    const [artifact] = store.list().artifacts;
    expect(store.markCopied(artifact.id, 1, [1, 0, 0, 7])).toBe(true);
    expect(store.markCopied(artifact.id, 9, [0])).toBe(false);
    expect(store.get(artifact.id)?.versions[0]?.copied).toEqual([0, 1]);
    expect((library.projectMessage("s1", session.messageHistory[0]) as { artifacts?: unknown }).artifacts).toEqual([
      expect.objectContaining({ version: 1, copied: [0, 1] }),
    ]);

    session.messageHistory.push(assistant(block("part: 2\n", "Reply, reworded."), NOW + 1, "q-1"));
    library.sessionSaved("s1");
    await library.idle();
    expect(store.get(artifact.id)?.versions.map((version) => version.copied)).toEqual([[0, 1], [0]]);
  });

  it("renames, stars, filters, and merges separately saved revisions", async () => {
    const session = {
      id: "s1",
      messageHistory: [
        assistant("```draft\ntitle: Note A\n---\none\n```", NOW - 2000),
        assistant("```draft\ntitle: Note B\n---\ntwo\n```", NOW - 1000),
      ],
    };
    const { store, library } = await setup([session]);
    await library.backfill();
    const [b, a] = store.list().artifacts;
    store.setStarred(a.id, true);
    expect(store.list({ starred: true }).artifacts.map((artifact) => artifact.id)).toEqual([a.id]);
    expect(store.list({ query: "two" }).artifacts.map((artifact) => artifact.id)).toEqual([b.id]);
    // Each kind's count ignores the kind asked for but keeps the other filters, for the kind tabs.
    expect(store.list({ kind: "figure" }).kinds).toEqual({ post: 2 });
    expect(store.list({ kind: "figure", query: "two" }).kinds).toEqual({ post: 1 });

    const merged = store.merge(b.id, a.id)!;
    expect(merged.artifact).toMatchObject({ versionCount: 2, starred: true });
    expect(store.get(b.id)).toBeNull();
    expect(textOf(library.projectMessage("s1", session.messageHistory[0]))).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);

    expect(store.rename(a.id, "  Launch note  ")?.title).toBe("Launch note");
    // A user's title stays when an agent later revises the post under its old title.
    session.messageHistory.push(assistant("```draft\ntitle: Note A\n---\nthree\n```", NOW));
    library.sessionSaved("s1");
    await library.idle();
    expect(store.get(a.id)).toMatchObject({
      title: "Launch note",
      versionCount: 3,
    });
  });
  it("prepares the previews of images new answers show, but not of history read at startup", async () => {
    // Images an agent shows or links get their thumbnails and full views made in the background
    // before anyone opens them; history read at startup is old and is left alone.
    const figure = join(fixtures, "chart.png");
    await writeFile(figure, "png bytes");
    const session: LibrarySessionLike = {
      id: "s1",
      messageHistory: [assistant("Earlier: /tmp/old-shot.png", NOW - DAY)],
    };
    const shown: Array<{ sessionId: string; paths: string[] }> = [];
    const figures: string[] = [];
    const { store, library } = await setup([session], NOW, {
      onImagesShown: (sessionId, images) => shown.push({ sessionId, paths: images.map((image) => image.path) }),
      onFigureSaved: (artifactId) => figures.push(artifactId),
    });
    await library.backfill();
    expect(shown).toEqual([]);

    session.messageHistory.push(
      assistant(`![chart](${figure}) and [the shot](file:docs/shot.png), not \`code\` text`, NOW),
    );
    library.sessionSaved("s1");
    await library.idle();
    expect(shown).toEqual([{ sessionId: "s1", paths: [figure, "docs/shot.png"] }]);
    expect(figures).toEqual(store.list({ kind: "figure" }).artifacts.map((artifact) => artifact.id));
    expect(figures).toHaveLength(1);

    // The newest answer is read again on later saves (it may still grow), but its images go once.
    session.messageHistory.push({ type: "result", data: {} } as unknown as BrowserIncomingMessage);
    library.sessionSaved("s1");
    await library.idle();
    expect(shown).toHaveLength(1);
  });
});
