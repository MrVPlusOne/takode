import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, resolve } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Stream scope for work outside a Takode session: the Git project holding
 * `cwd`, shared by all of its worktrees. It describes a checkout, so it is
 * computed on the machine that has the checkout (the `stream` CLI's).
 */
export async function projectStreamScope(cwd: string, serverId: string | undefined): Promise<string> {
  const server = serverId?.trim() || "local";
  const project = (await resolveGitProjectScopeComponent(cwd)) ?? basename(resolve(cwd)) ?? "project";
  return [server, "project", project].join(":");
}

function projectScopeComponentFromGitCommonDir(gitCommonDir: string): string {
  const commonDir = resolve(gitCommonDir);
  const name = basename(commonDir);
  const projectName =
    name === ".git" ? basename(dirname(commonDir)) || "project" : name.endsWith(".git") ? name.slice(0, -4) : name;
  const digest = createHash("sha1").update(commonDir).digest("hex").slice(0, 8);
  return `${projectName || "project"}-${digest}`;
}

async function resolveGitProjectScopeComponent(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd },
    );
    const gitCommonDir = stdout.trim();
    return gitCommonDir ? projectScopeComponentFromGitCommonDir(gitCommonDir) : null;
  } catch {
    return null;
  }
}
