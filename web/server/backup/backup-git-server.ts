/**
 * Serves the backup clone (`~/.companion/backup/repo`) to Git over HTTP, for
 * fetching only, so a host can keep its own copy: the host runs `git fetch`
 * against this through its node's API proxy (see `backup-host-sync.ts`).
 * Git's own `http-backend` does the work; only the two requests of a fetch
 * are passed to it, and pushing is never allowed.
 */

import { spawn } from "node:child_process";
import { Readable } from "node:stream";

/** URL path below the API where the backup clone is served; the clone is `repo` in it. */
export const BACKUP_GIT_PATH = "/api/backup/git";

/**
 * Answer one Git HTTP request for the backup clone `<root>/repo`. `pathInfo`
 * is the request path below {@link BACKUP_GIT_PATH}, such as `/repo/info/refs`.
 */
export async function serveBackupGit(request: Request, root: string, pathInfo: string): Promise<Response> {
  const url = new URL(request.url);
  const isAdvertisement =
    request.method === "GET" && pathInfo === "/repo/info/refs" && url.searchParams.get("service") === "git-upload-pack";
  const isUploadPack = request.method === "POST" && pathInfo === "/repo/git-upload-pack";
  if (!isAdvertisement && !isUploadPack) return new Response("Only fetching is served here.", { status: 403 });

  const child = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: pathInfo,
      REQUEST_METHOD: request.method,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers.get("content-type") ?? "",
      HTTP_CONTENT_ENCODING: request.headers.get("content-encoding") ?? "",
      HTTP_GIT_PROTOCOL: request.headers.get("git-protocol") ?? "",
      REMOTE_ADDR: "127.0.0.1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
  // http-backend may end before reading a request it refuses; its own answer says why.
  child.stdin.on("error", (error) => console.warn("[backup] git http-backend did not take the request:", error));
  if (isUploadPack) child.stdin.end(Buffer.from(await request.arrayBuffer()));
  else child.stdin.end();

  // CGI output: header lines, a blank line, then the body.
  const reader = (Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>).getReader();
  let head = Buffer.alloc(0);
  let split = -1;
  while (split === -1) {
    const { done, value } = await reader.read();
    if (done) {
      console.error(`[backup] git http-backend gave no answer: ${stderr.trim()}`);
      return new Response("The backup repository could not be read.", { status: 500 });
    }
    head = Buffer.concat([head, value]);
    split = head.indexOf("\r\n\r\n");
    if (split === -1) split = head.indexOf("\n\n");
  }
  const separator = head[split] === 0x0d ? 4 : 2;
  const headers = new Headers();
  let status = 200;
  for (const line of head.subarray(0, split).toString("utf-8").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === "status") status = Number.parseInt(value, 10) || 200;
    else headers.append(name, value);
  }
  const rest = head.subarray(split + separator);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (rest.length > 0) controller.enqueue(new Uint8Array(rest));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() {
      child.kill();
    },
  });
  return new Response(body, { status, headers });
}
