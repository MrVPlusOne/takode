/**
 * `takode bundle send|fetch|list`: carry a worker's commits to the machine of
 * its port target through the Takode server, as a Git bundle. The worker
 * sends; a session on the target machine fetches the commits into its own repo
 * and lands them under the usual port rules.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CommitBundle } from "../server/routes/bundles.js";
import { apiGet, apiPost, getCallerSessionId } from "./takode-core.js";

const execFileAsync = promisify(execFile);

export const BUNDLE_HELP = `Usage: takode bundle <send|fetch|list> ...

Carry commits to the machine of your port target, through this Takode server.

  takode bundle send [--base <ref>]
      Send the commits on your current branch after <ref> (default: your
      port target branch). Prints the bundle ID to report to your leader.
  takode bundle fetch <id>
      Fetch a bundle's commits into this repo as refs/takode/bundles/<id>
      and print how to land them.
  takode bundle list [--json]
      List recent bundles.`;

export async function handleBundle(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "send":
      return sendBundle(base, rest);
    case "fetch":
      return fetchBundle(base, rest);
    case "list":
    case undefined:
      return listBundles(base, rest.includes("--json"));
    default:
      throw new Error(BUNDLE_HELP);
  }
}

async function sendBundle(base: string, args: string[]): Promise<void> {
  const baseIndex = args.indexOf("--base");
  const baseRef = baseIndex !== -1 ? args[baseIndex + 1] : await portTargetRef(base);
  if (!baseRef) throw new Error("--base requires a ref");
  const tip = await git("rev-parse", "HEAD");
  const start = await git("merge-base", "HEAD", baseRef);
  if (start === tip) throw new Error(`There are no commits after ${baseRef} to send.`);
  const commits = (await git("log", "--reverse", "--format=%H%x09%s", `${start}..HEAD`))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split("\t");
      return { sha: sha!, subject: subject.join("\t") };
    });
  const dir = await mkdtemp(join(tmpdir(), "takode-bundle-"));
  try {
    const file = join(dir, "commits.bundle");
    await git("bundle", "create", file, `${start}..HEAD`);
    const { bundle } = (await apiPost(base, "/bundles", {
      branch: await git("rev-parse", "--abbrev-ref", "HEAD"),
      base: start,
      tip,
      commits,
      data: (await readFile(file)).toString("base64"),
    })) as { bundle: CommitBundle };
    console.log(`Sent ${commits.length} commit(s) as bundle ${bundle.id}.`);
    console.log(`A session on the port target's machine lands them after: takode bundle fetch ${bundle.id}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fetchBundle(base: string, args: string[]): Promise<void> {
  const id = args.find((arg) => !arg.startsWith("--"));
  if (!id) throw new Error("Usage: takode bundle fetch <id>");
  const { bundle, data } = (await apiGet(base, `/bundles/${encodeURIComponent(id)}`)) as {
    bundle: CommitBundle;
    data: string;
  };
  const dir = await mkdtemp(join(tmpdir(), "takode-bundle-"));
  try {
    const file = join(dir, "commits.bundle");
    await writeFile(file, Buffer.from(data, "base64"));
    try {
      await git("bundle", "verify", "--quiet", file);
    } catch {
      throw new Error(
        `This repo does not have the bundle's base commit ${bundle.base}. Fetch the latest base branch (for example from origin) and retry.`,
      );
    }
    const ref = `refs/takode/bundles/${bundle.id}`;
    await git("fetch", "--quiet", "--no-tags", file, `HEAD:${ref}`);
    const sender = bundle.sessionNum !== undefined ? `#${bundle.sessionNum}` : bundle.sessionId;
    console.log(`Fetched ${bundle.commits.length} commit(s) from ${sender} on ${bundle.branch} into ${ref}:`);
    for (const commit of bundle.commits) console.log(`  ${commit.sha.slice(0, 10)} ${commit.subject}`);
    console.log("");
    console.log(`Land them on your branch with: git cherry-pick ${bundle.base}..${bundle.tip}`);
    console.log("then port them under the usual port rules (/port-changes).");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function listBundles(base: string, json: boolean): Promise<void> {
  const { bundles } = (await apiGet(base, "/bundles")) as { bundles: CommitBundle[] };
  if (json) {
    console.log(JSON.stringify(bundles, null, 2));
    return;
  }
  if (bundles.length === 0) {
    console.log("No bundles.");
    return;
  }
  for (const bundle of bundles) {
    const sender = bundle.sessionNum !== undefined ? `#${bundle.sessionNum}` : bundle.sessionId.slice(0, 8);
    console.log(
      `${bundle.id}  ${new Date(bundle.createdAt).toISOString()}  ${sender}  ${bundle.branch}  ${bundle.commits.length} commit(s)`,
    );
  }
}

/** The caller's port target branch, as a ref this repo has. */
async function portTargetRef(base: string): Promise<string> {
  const me = getCallerSessionId();
  const session = (await apiGet(base, `/sessions/${encodeURIComponent(me)}`)) as {
    worktreePortTarget?: { branch?: string } | null;
  };
  const branch = session.worktreePortTarget?.branch;
  if (!branch) throw new Error("This session has no port target; pass --base <ref>.");
  for (const candidate of [branch, `origin/${branch}`]) {
    if (await git("rev-parse", "--verify", "--quiet", candidate).catch(() => "")) return candidate;
  }
  throw new Error(`Neither ${branch} nor origin/${branch} exists here; pass --base <ref>.`);
}

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
