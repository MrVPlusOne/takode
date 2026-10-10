import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { listeningPids, parseSsPids } from "./listening-pids.js";

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("parseSsPids", () => {
  it("reads every PID from ss process columns, once per process", () => {
    // A process listening on IPv4 and IPv6 shows up on two lines, and a socket
    // shared by forked workers lists several processes in one users:(...) column.
    const output = [
      "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
      'LISTEN 0      512    127.0.0.1:5180    0.0.0.0:*   users:(("bun",pid=4242,fd=11))',
      'LISTEN 0      512        [::1]:5180       [::]:*   users:(("bun",pid=4242,fd=12))',
      'LISTEN 0      512      0.0.0.0:5180    0.0.0.0:*   users:(("node",pid=7,fd=3),("node",pid=8,fd=3))',
    ].join("\n");

    expect(parseSsPids(output)).toEqual([4242, 7, 8]);
  });

  it("returns no PIDs when only the header is printed", () => {
    // ss exits 0 with just a header when nothing listens on the port.
    expect(parseSsPids("State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n")).toEqual([]);
  });
});

describe("listeningPids", () => {
  it("falls back to ss when lsof is not installed", async () => {
    // Minimal Linux hosts ship iproute2 but not lsof; the fake ss also checks
    // that it was asked for listening TCP sockets with processes on this port.
    const bin = await fakeBin({
      ss: [
        "#!/bin/sh",
        '[ "$1" = "-ltnp" ] && [ "$2" = "( sport = :5180 )" ] || exit 9',
        'echo "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process"',
        `echo 'LISTEN 0 512 127.0.0.1:5180 0.0.0.0:* users:(("bun",pid=4242,fd=11))'`,
      ],
    });

    expect(await listeningPids(5180, { PATH: bin })).toEqual([4242]);
  });

  it("prefers lsof when it is installed", async () => {
    // macOS has lsof but no ss; behavior there must stay the lsof path.
    const bin = await fakeBin({
      lsof: ["#!/bin/sh", "echo 11", "echo 12"],
      ss: ["#!/bin/sh", "exit 9"],
    });

    expect(await listeningPids(5180, { PATH: bin })).toEqual([11, 12]);
  });

  it("treats lsof's exit status 1 as nothing listening", async () => {
    const bin = await fakeBin({ lsof: ["#!/bin/sh", "exit 1"] });

    expect(await listeningPids(5180, { PATH: bin })).toEqual([]);
  });

  it("explains when neither lsof nor ss is installed", async () => {
    const bin = await fakeBin({});

    await expect(listeningPids(5180, { PATH: bin })).rejects.toThrow("neither lsof nor ss is installed");
  });

  const realSs = spawnSync("sh", ["-c", "command -v ss"], { encoding: "utf8" }).stdout.trim();

  it.skipIf(!realSs)("finds this process listening on a real port through ss alone", async () => {
    // End-to-end check against the real ss binary with lsof hidden from PATH,
    // as on hosts without lsof. Skipped where ss is absent (macOS).
    const bin = await fakeBin({});
    await symlink(realSs, join(bin, "ss"));
    const port = await listenOnFreePort();

    expect(await listeningPids(port, { PATH: bin })).toContain(process.pid);
  });
});

async function fakeBin(scripts: Record<string, string[]>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "takode-listening-pids-"));
  tempDirs.push(dir);
  for (const [name, lines] of Object.entries(scripts)) {
    await writeFile(join(dir, name), `${lines.join("\n")}\n`, { mode: 0o755 });
  }
  return dir;
}

async function listenOnFreePort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  return address.port;
}
