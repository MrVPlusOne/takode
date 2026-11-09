import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_HOST_ID } from "../../shared/host-protocol.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HostAgent } from "./host-agent.js";
import { HOST_UPDATE_SETTLE_MS, HostLinkManager } from "./host-link-manager.js";
import { nodeCodeFiles, nodeCodeFingerprint } from "./node-code.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * The fingerprint decides whether this machine's node restarts after Restart
 * Server, which ends every session process on it. It must change exactly when
 * code the node loads at start changes, and not for the rest of Takode.
 */
describe("nodeCodeFingerprint", () => {
  let root: string;

  /** A stand-in checkout's `web` folder: the node entry, a module it imports, one it loads later, and one it never imports. */
  function writeCheckout(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "node-code-"));
    writeCheckout({
      "bin/takode-node.ts": [
        'import { link } from "../server/link.js";',
        "link();",
        'if (process.argv.includes("--remote")) await import("../server/remote-only.js");',
      ].join("\n"),
      "server/link.ts": "export function link() { return 1; }",
      "server/remote-only.ts": "export const remote = 1;",
      "server/coordinator-only.ts": "export const coordinator = 1;",
      "bun.lock": "lock v1",
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("changes with the code the node imports at start", async () => {
    const before = await nodeCodeFingerprint(root);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    writeCheckout({ "server/link.ts": "export function link() { return 2; }" });
    expect(await nodeCodeFingerprint(root)).not.toBe(before);
  });

  // Code the node never imports, or imports only later on another machine,
  // does not restart this machine's node.
  it("ignores other code, modules loaded only with import(), and the lockfile when no package is imported", async () => {
    const before = await nodeCodeFingerprint(root);
    writeCheckout({
      "server/coordinator-only.ts": "export const coordinator = 2;",
      "server/remote-only.ts": "export const remote = 2;",
      "bun.lock": "lock v2",
    });
    expect(await nodeCodeFingerprint(root)).toBe(before);
  });

  it("counts the lockfile when the node imports an installed package", async () => {
    writeCheckout({ "server/link.ts": 'import "some-package";\nexport function link() { return 1; }' });
    const before = await nodeCodeFingerprint(root);
    writeCheckout({ "bun.lock": "lock v2" });
    expect(await nodeCodeFingerprint(root)).not.toBe(before);
  });

  it("is null when the node's entry point is missing", async () => {
    rmSync(join(root, "bin"), { recursive: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await nodeCodeFingerprint(root)).toBeNull();
    vi.restoreAllMocks();
  });

  // The real node entry: host operations and remote-node setup, which only a
  // node on another machine loads, stay out of this machine's node's code.
  it("leaves host operations out of the real node's code", async () => {
    const code = await nodeCodeFiles(fileURLToPath(new URL("../..", import.meta.url)));
    expect(code!.files).toContain("server/remote-host/host-agent.ts");
    expect(code!.files).toContain("server/remote-host/memory-guard.ts");
    expect(code!.files).not.toContain("server/remote-host/host-operations.ts");
    expect(code!.files).not.toContain("server/remote-host/remote-node-setup.ts");
    expect(code!.files).not.toContain("server/cli-launcher.ts");
  });

  // Bun's metafile names some imports only as written; they still count.
  it("follows imports Bun's metafile gives only as written", async () => {
    writeCheckout({
      "bin/takode-node.ts":
        'import { link } from "../server/link.js";\nimport { other } from "../server/other.js";\nlink(); other();',
      "server/link.ts": 'import { shared } from "./shared.js";\nexport function link() { return shared; }',
      "server/other.ts":
        'import { shared } from "./shared.js";\nimport { deep } from "./deep.js";\nexport function other() { return shared + deep; }',
      "server/shared.ts": "export const shared = 1;",
      "server/deep.ts": "export const deep = 1;",
    });
    const code = await nodeCodeFiles(root);
    expect(code!.files).toEqual([
      "bin/takode-node.ts",
      "server/deep.ts",
      "server/link.ts",
      "server/other.ts",
      "server/shared.ts",
    ]);
  });
});

/**
 * This machine's node runs the coordinator's own checkout, so a new commit
 * alone does not restart it; only a change to the code it loaded does. Other
 * hosts still follow the coordinator's commit.
 */
describe("updating this machine's node by its code", () => {
  const COORDINATOR_BUILD = "c".repeat(40);
  const OLDER_BUILD = "a".repeat(40);
  let manager: HostLinkManager;
  let agent: HostAgent | null = null;
  let link: FakeHostLink | null = null;
  let clock = 0;

  function startAgent(hostId: string, codeFingerprint: string | undefined, update: () => Promise<void>): HostAgent {
    const started = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      build: OLDER_BUILD,
      codeFingerprint,
      hostOperations: false,
      update,
      connect: () => {
        link = new FakeHostLink(manager, hostId);
        return link.agentSide;
      },
    });
    started.start();
    return started;
  }

  function tick(hostId: string): void {
    clock += HOST_UPDATE_SETTLE_MS;
    manager.handleMessage(hostId, link!.coordinatorSide, JSON.stringify({ t: "heartbeat" }));
    (manager as unknown as { tick(): void }).tick();
  }

  beforeEach(() => {
    clock = 1_000_000;
    manager = new HostLinkManager({ build: COORDINATOR_BUILD, now: () => clock });
    manager.localNodeCode = "node-code-1";
    manager.updateBlocker = () => null;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    agent?.stop();
    agent = null;
    vi.restoreAllMocks();
  });

  it("leaves this machine's node alone on a new commit that does not change its code", async () => {
    const update = vi.fn(async () => {});
    agent = startAgent(LOCAL_HOST_ID, "node-code-1", update);
    await waitFor(() => manager.status(LOCAL_HOST_ID).online);
    expect(manager.status(LOCAL_HOST_ID).buildMismatch).toBe(false);
    expect(manager.updatesFirst(LOCAL_HOST_ID)).toBe(false);
    tick(LOCAL_HOST_ID);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(update).not.toHaveBeenCalled();
    // Restart Server interrupts nobody on it for a build whose node code is the same...
    expect(manager.hostsUpdatedTo({ commit: "d".repeat(40), localNodeCode: "node-code-1" })).toEqual([]);
    // ...and does for one that changes it.
    expect(manager.hostsUpdatedTo({ commit: "d".repeat(40), localNodeCode: "node-code-2" })).toEqual([LOCAL_HOST_ID]);
  });

  it("updates this machine's node when its code changed", async () => {
    const update = vi.fn(async () => {});
    agent = startAgent(LOCAL_HOST_ID, "node-code-0", update);
    await waitFor(() => update.mock.calls.length > 0);
    expect(manager.status(LOCAL_HOST_ID).buildMismatch).toBe(true);
  });

  // A node from before fingerprints, or one that could not take its own, compares commits as before.
  it("compares commits for a node that reports no fingerprint, and for other hosts", async () => {
    const update = vi.fn(async () => {});
    agent = startAgent(LOCAL_HOST_ID, undefined, update);
    await waitFor(() => update.mock.calls.length > 0);
    agent.stop();

    const remoteUpdate = vi.fn(async () => {});
    agent = startAgent("host-1", "node-code-1", remoteUpdate);
    await waitFor(() => remoteUpdate.mock.calls.length > 0);
    expect(manager.hostsUpdatedTo({ commit: COORDINATOR_BUILD, localNodeCode: "node-code-1" })).toEqual(["host-1"]);
  });
});
