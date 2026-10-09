import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Run Git in a directory and return trimmed stdout; failures carry Git's stderr. */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).then(
    () => true,
    () => false,
  );
}

/** Path/mode/blob changes of one commit against its first parent, comparable across cherry-picks. */
export async function commitChanges(cwd: string, sha: string): Promise<string> {
  return git(cwd, ["diff-tree", "--no-commit-id", "--raw", "--no-abbrev", "--no-renames", "-r", `${sha}^`, sha]);
}
