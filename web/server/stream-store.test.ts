import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("stream store", () => {
  let home: string;

  beforeEach(() => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "stream-store-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("persists current-state-first streams with typed timeline entries and provenance", async () => {
    const { createStream, getStream, searchStreams, updateStream } = await import("./stream-store.js");
    const scope = "test-server:war-room";

    const created = await createStream({
      title: "AI judging",
      scope,
      summary: "Two-lane monitor still active",
      tags: ["ml", "judging"],
      links: [{ type: "quest", ref: "q-645" }],
      owners: [{ ref: "993", steeringMode: "leader-steered" }],
      pinnedFacts: ["expected lanes: ernie_swe,nvidia_nemotron_swe"],
    });

    const updated = await updateStream({
      streamRef: created.slug,
      scope,
      type: "supersession",
      text: "Judging monitor corrected to four lanes",
      source: "session:989:3334",
      statePatch: {
        summary: "Four-lane monitor active",
        health: "degraded: outputs flat in several lanes",
        knownStaleFacts: ["old two-lane timer"],
      },
      links: [
        { type: "session", ref: "989" },
        { type: "message", ref: "989:3334" },
      ],
      staleFacts: ["expected lanes: ernie_swe,nvidia_nemotron_swe"],
      supersedes: ["expected lanes: ernie_swe,nvidia_nemotron_swe,map_terminus2,nemotron_terminal"],
      pins: ["expected lanes: ernie_swe,nvidia_nemotron_swe,map_terminus2,nemotron_terminal"],
    });

    expect(updated).not.toBeNull();
    expect(updated?.current.summary).toBe("Four-lane monitor active");
    expect(updated?.timeline[0]).toMatchObject({
      type: "supersession",
      source: "session:989:3334",
      text: "Judging monitor corrected to four lanes",
    });
    expect(updated?.pinnedFacts?.some((fact) => fact.status === "superseded")).toBe(true);

    const reloaded = await getStream("ai-judging", scope);
    expect(reloaded?.current.health).toBe("degraded: outputs flat in several lanes");
    expect(reloaded?.links).toEqual(
      expect.arrayContaining([
        { type: "quest", ref: "q-645" },
        { type: "session", ref: "989" },
      ]),
    );

    const matches = await searchStreams("four-lane", scope);
    expect(matches.map((stream) => stream.id)).toContain(created.id);
  });

  it("supports dashboard rollups through parent stream links", async () => {
    const { createStream, getStreamDashboard } = await import("./stream-store.js");
    const scope = "test-server:dashboard";

    const parent = await createStream({ title: "23b war room", scope, summary: "Rollup state" });
    const child = await createStream({
      title: "Inference pool v7",
      scope,
      parent: parent.slug,
      summary: "128 healthy nodes",
    });

    const dashboard = await getStreamDashboard(parent.slug, scope);
    expect(dashboard?.stream.id).toBe(parent.id);
    expect(dashboard?.children.map((stream) => stream.id)).toEqual([child.id]);
  });

  it("archives streams without losing searchability", async () => {
    const { archiveStream, createStream, listStreams, searchStreams } = await import("./stream-store.js");
    const scope = "test-server:archive";
    const stream = await createStream({ title: "Nebius salvage", scope, summary: "Canonical artifact repaired" });

    await archiveStream(stream.id, scope, "Salvage complete");

    expect(await listStreams({ scope })).toHaveLength(0);
    const archived = await listStreams({ scope, includeArchived: true });
    expect(archived[0]?.status).toBe("archived");
    expect((await searchStreams("canonical artifact", scope))[0]?.id).toBe(stream.id);
  });

  function initRepo(repo: string): void {
    mkdirSync(repo);
    execFileSync("git", ["--no-optional-locks", "-C", repo, "init"], { stdio: "ignore" });
    writeFileSync(join(repo, "README.md"), "test\n", "utf-8");
    execFileSync("git", ["--no-optional-locks", "-C", repo, "add", "README.md"], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "--no-optional-locks",
        "-C",
        repo,
        "-c",
        "user.name=Stream Test",
        "-c",
        "user.email=stream-test@example.com",
        "commit",
        "-m",
        "init",
      ],
      { stdio: "ignore" },
    );
  }

  it("uses the Takode session group as the default scope when session context is available", async () => {
    const treeGroups = await import("./tree-group-store.js");
    treeGroups._resetForTest(join(home, "tree-groups.json"));
    const group = await treeGroups.createGroup("ML Ops");
    await treeGroups.assignSession("leader-session", group.id);
    await treeGroups.assignSession("worker-session", group.id);

    const { defaultStreamScope } = await import("./stream-store.js");
    const leaderScope = await defaultStreamScope("/tmp/leader-worktree", "server-test", "leader-session");
    const workerScope = await defaultStreamScope("/tmp/worker-worktree", "server-test", "worker-session");

    expect(leaderScope).toBe(`server-test:session-group:${group.id}`);
    expect(workerScope).toBe(leaderScope);
  });

  it("uses the same fallback project scope for a main repo and its worktree when no session group exists", async () => {
    const { defaultStreamScope } = await import("./stream-store.js");
    const repo = join(home, "companion");
    const worktree = join(home, "companion-worktree");

    initRepo(repo);
    execFileSync("git", ["--no-optional-locks", "-C", repo, "worktree", "add", "-b", "wt-test", worktree], {
      stdio: "ignore",
    });

    const mainScope = await defaultStreamScope(repo, "scope-review", "");
    const worktreeScope = await defaultStreamScope(worktree, "scope-review", "");
    const unknownSessionScope = await defaultStreamScope(worktree, "scope-review", "unassigned-session");

    expect(mainScope).toMatch(/^scope-review:project:companion-[a-f0-9]{8}$/);
    expect(worktreeScope).toBe(mainScope);
    expect(unknownSessionScope).toBe(mainScope);
  });

  it("keeps fallback project scopes distinct for unrelated repos with the same basename", async () => {
    const { defaultStreamScope } = await import("./stream-store.js");
    const repoA = join(home, "alpha", "companion");
    const repoB = join(home, "beta", "companion");
    mkdirSync(join(home, "alpha"));
    mkdirSync(join(home, "beta"));
    initRepo(repoA);
    initRepo(repoB);

    const scopeA = await defaultStreamScope(repoA, "server-test", "");
    const scopeB = await defaultStreamScope(repoB, "server-test", "");

    expect(scopeA).toMatch(/^server-test:project:companion-[a-f0-9]{8}$/);
    expect(scopeB).toMatch(/^server-test:project:companion-[a-f0-9]{8}$/);
    expect(scopeA).not.toBe(scopeB);
  });

  it("fails loudly on corrupt scope files without replacing the existing file", async () => {
    const { createStream, getStreamsDir, updateStream } = await import("./stream-store.js");
    const scope = "test-server:corrupt";
    const stream = await createStream({ title: "Corrupt stream", scope, summary: "Preserved" });
    const file = join(getStreamsDir(), readdirSync(getStreamsDir()).find((name) => name.endsWith(".json")) ?? "");
    writeFileSync(file, "{not valid json", "utf-8");

    await expect(
      updateStream({ streamRef: stream.slug, scope, type: "note", text: "Should not overwrite" }),
    ).rejects.toThrow(/Failed to load stream scope/);
    await expect(createStream({ title: "Overwrite attempt", scope, summary: "Nope" })).rejects.toThrow(
      /Failed to load stream scope/,
    );
    expect(readFileSync(file, "utf-8")).toBe("{not valid json");
  });
});
