import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import { setLibrarySessionCreator } from "./library-session-creator.js";
import { startLibraryTopics } from "./topic-service-startup.js";

/**
 * A leader's Scribe starts on the leader's machine: a leader on a remote host gets one created on
 * that host, in the host's home folder (the leader's folder while the host's home is unknown); a
 * leader on the coordinator's machine gets one here, in this machine's home. Runs under the test
 * suite's disposable HOME, so the topic store it loads is empty.
 */
describe("startLibraryTopics Scribe creation", () => {
  async function scribeBodyFor(leader: { hostId?: string; cwd: string }, hostHome: string | null) {
    const bodies: Array<Record<string, unknown>> = [];
    setLibrarySessionCreator(async (body) => {
      bodies.push(body);
      return { sessionId: `scribe-${bodies.length}` };
    });
    const sessions = new Map<string, Record<string, unknown>>([
      ["leader", { sessionId: "leader", isOrchestrator: true, backendType: "claude", ...leader }],
    ]);
    const launcher = {
      getSession: (id: string) => sessions.get(id),
      getSessionNum: () => 7,
      listSessions: () => [...sessions.values()],
      getMemorySessionSpaceSlug: () => "Takode",
      herdSessions: () => {},
      resolveSessionId: () => undefined,
      remoteHosts: { links: { homeDir: () => hostHome } },
    } as unknown as CliLauncher;
    const wsBridge = {
      getSession: (id: string) => (id === "leader" ? { id, messageHistory: [], state: {} } : undefined),
      injectUserMessage: () => "sent",
    } as unknown as WsBridge;
    const service = await startLibraryTopics({
      serverId: `scribe-host-test-${Math.random().toString(36).slice(2)}`,
      wsBridge,
      launcher,
      sessionName: () => "Leader",
    });
    await service.setLeaderEnabled("leader", true);
    return bodies[0];
  }

  it("starts a remote leader's Scribe on its host, in the host's home folder", async () => {
    const body = await scribeBodyFor({ hostId: "laptop", cwd: "/Users/me/code/app" }, "/Users/me");
    expect(body).toMatchObject({ hostId: "laptop", cwd: "/Users/me", fixedName: "Scribe" });
  });

  it("uses the leader's folder when the host's home is not known yet", async () => {
    const body = await scribeBodyFor({ hostId: "laptop", cwd: "/Users/me/code/app" }, null);
    expect(body).toMatchObject({ hostId: "laptop", cwd: "/Users/me/code/app" });
  });

  it("starts a coordinator leader's Scribe here, in this machine's home", async () => {
    const body = await scribeBodyFor({ cwd: "/repo" }, "/unused");
    expect(body).toMatchObject({ cwd: homedir() });
    expect(body).not.toHaveProperty("hostId");
  });
});
