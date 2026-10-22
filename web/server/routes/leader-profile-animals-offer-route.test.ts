import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTest, getSettings, updateSettings } from "../settings-manager.js";
import { registerLeaderProfileAnimalsOfferRoutes } from "./leader-profile-animals-offer-route.js";

interface FakeSession {
  sessionId: string;
  isOrchestrator?: boolean;
  archived?: boolean;
  leaderProfilePortraitId?: string;
}

function createApp(sessions: FakeSession[]) {
  const launcher = {
    listSessions: () => sessions,
    setLeaderProfilePortraitId: vi.fn((sessionId: string, portraitId: string) => {
      const session = sessions.find((candidate) => candidate.sessionId === sessionId);
      if (session) session.leaderProfilePortraitId = portraitId;
      return true;
    }),
  };
  const api = new Hono();
  registerLeaderProfileAnimalsOfferRoutes(api, { launcher } as never);
  return { api, launcher };
}

async function offerShown(api: Hono): Promise<boolean> {
  return ((await (await api.request("/leader-profile/animals-offer")).json()) as { show: boolean }).show;
}

// The offer is for installs upgraded with the cat sets still in use; it shows once and its answer is saved.
describe("Animals portraits offer", () => {
  beforeEach(() => {
    // A disposable settings file, never the user's real one.
    _resetForTest(join(tmpdir(), `takode-animals-offer-${randomUUID()}.json`));
  });

  it("shows only to installs using the cat sets with Animals off", async () => {
    const { api } = createApp([]);
    // A new install defaults to Animals, so it never sees the offer.
    expect(await offerShown(api)).toBe(false);

    updateSettings({ leaderProfilePools: { tako: true, shmi: true, animals: false } });
    expect(await offerShown(api)).toBe(true);

    // Animals already on (like a user who turned it on earlier): nothing to offer.
    updateSettings({ leaderProfilePools: { tako: true, shmi: false, animals: true } });
    expect(await offerShown(api)).toBe(false);
  });

  it("never shows again once dismissed, and keeps the cat sets", async () => {
    updateSettings({ leaderProfilePools: { tako: true, shmi: true, animals: false } });
    const { api } = createApp([]);

    expect((await api.request("/leader-profile/animals-offer/dismiss", { method: "POST" })).status).toBe(200);
    expect(await offerShown(api)).toBe(false);
    expect(getSettings().leaderProfilePools).toEqual({ tako: true, shmi: true, animals: false });
  });

  it("switches new leaders only to Animals when current leaders are left alone", async () => {
    updateSettings({ leaderProfilePools: { tako: true, shmi: true, animals: false } });
    const sessions: FakeSession[] = [
      { sessionId: "leader-1", isOrchestrator: true, leaderProfilePortraitId: "tako1-01" },
    ];
    const { api, launcher } = createApp(sessions);

    const res = await api.request("/leader-profile/animals-offer/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentLeaders: false }),
    });
    expect(await res.json()).toMatchObject({ ok: true, reassignedLeaders: 0 });
    expect(getSettings().leaderProfilePools).toEqual({ tako: false, shmi: false, animals: true });
    expect(launcher.setLeaderProfilePortraitId).not.toHaveBeenCalled();
    expect(await offerShown(api)).toBe(false);
  });

  it("gives every active leader its own animal portrait when switching all leaders", async () => {
    updateSettings({ leaderProfilePools: { tako: true, shmi: true, animals: false } });
    const sessions: FakeSession[] = [
      { sessionId: "leader-1", isOrchestrator: true, leaderProfilePortraitId: "tako1-01" },
      { sessionId: "leader-2", isOrchestrator: true, leaderProfilePortraitId: "shmi1-01" },
      // Archived leaders and workers keep what they have.
      { sessionId: "leader-archived", isOrchestrator: true, archived: true, leaderProfilePortraitId: "tako1-02" },
      { sessionId: "worker-1", isOrchestrator: false },
    ];
    const { api } = createApp(sessions);

    const res = await api.request("/leader-profile/animals-offer/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentLeaders: true }),
    });
    expect(await res.json()).toMatchObject({ ok: true, reassignedLeaders: 2 });
    const [first, second, archived, worker] = sessions;
    expect(first.leaderProfilePortraitId).toMatch(/^animals/);
    expect(second.leaderProfilePortraitId).toMatch(/^animals/);
    expect(first.leaderProfilePortraitId).not.toBe(second.leaderProfilePortraitId);
    expect(archived.leaderProfilePortraitId).toBe("tako1-02");
    expect(worker.leaderProfilePortraitId).toBeUndefined();
  });
});
