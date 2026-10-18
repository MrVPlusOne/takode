import { mkdtemp, rm, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGit } from "../git-commit-reader.js";
import { verifyReplacementWorkEvidence } from "../work-evidence-replacement.js";
import { resolveWorkEvidenceCaller } from "./work-evidence-context.js";

// A session started directly on an existing checkout records no branch in its
// session record, while the UI shows the branch Git reports. Delivery checks must
// read the same branch from Git instead of refusing the checkout as unidentified.

let repo: string;
let head: string;

beforeEach(async () => {
  // Every Git write below stays inside this new temporary repository.
  repo = await realpath(await mkdtemp(join(tmpdir(), "work-evidence-context-test-")));
  await readGit(repo, ["init", "-b", "feature-line"]);
  await readGit(repo, ["config", "user.name", "Fixture Author"]);
  await readGit(repo, ["config", "user.email", "fixture@example.invalid"]);
  await readGit(repo, ["config", "core.hooksPath", join(repo, ".no-hooks")]);
  await writeFile(join(repo, "file.txt"), "content\n");
  await readGit(repo, ["add", "file.txt"]);
  await readGit(repo, ["commit", "-m", "Add file"]);
  head = await readGit(repo, ["rev-parse", "HEAD"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("resolveWorkEvidenceCaller", () => {
  it("reads a direct checkout's branch from Git so the existing verifier accepts its commits", async () => {
    const session = { cwd: repo, isWorktree: false };
    // Without the branch the verifier cannot identify the target at all.
    expect(await verifyReplacementWorkEvidence(session, [head])).toMatchObject({
      error: expect.stringContaining("Cannot identify"),
    });

    const caller = await resolveWorkEvidenceCaller(session);
    expect(caller.actualBranch).toBe("feature-line");
    expect(await verifyReplacementWorkEvidence(caller, [head])).toMatchObject({
      branch: "feature-line",
      mode: "direct",
      headSha: head,
      commitShas: [head],
    });
  });

  it("still lets the verifier refuse commits the branch does not contain", async () => {
    // A commit on another branch: the resolved branch must not widen what counts as delivered.
    await readGit(repo, ["checkout", "-q", "-b", "side"]);
    await writeFile(join(repo, "side.txt"), "side\n");
    await readGit(repo, ["add", "side.txt"]);
    await readGit(repo, ["commit", "-m", "Side work"]);
    const sideSha = await readGit(repo, ["rev-parse", "HEAD"]);
    await readGit(repo, ["checkout", "-q", "feature-line"]);

    const caller = await resolveWorkEvidenceCaller({ cwd: repo });
    expect(await verifyReplacementWorkEvidence(caller, [sideSha])).toMatchObject({
      error: expect.stringContaining("is not reachable"),
    });
  });

  it("leaves a detached checkout's branch unknown", async () => {
    await readGit(repo, ["checkout", "-q", "--detach"]);
    const caller = await resolveWorkEvidenceCaller({ cwd: repo });
    expect(caller.actualBranch).toBeUndefined();
  });

  it("keeps recorded branches and worktree port targets as they are", async () => {
    // Recorded metadata stays authoritative; Git is only asked when nothing is recorded.
    expect(await resolveWorkEvidenceCaller({ cwd: repo, branch: "recorded" })).toEqual({
      cwd: repo,
      branch: "recorded",
    });
    const worktree = { cwd: repo, isWorktree: true, worktreePortTarget: { repoRoot: repo, branch: "target" } };
    expect(await resolveWorkEvidenceCaller(worktree)).toEqual(worktree);
  });
});
