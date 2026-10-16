import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Runs the real service worker (`public/sw.js`) against fake browser objects.
 *
 * iOS only lets a service worker close notifications while it handles a tap, so a
 * tapped alert is where the other outdated Takode alerts get closed: the worker sends
 * the subjects of every alert still shown, closes the ones the server reports outdated
 * and sets the badge it returns. Each push also sets the badge, after showing the
 * alert, to the number of questions waiting. Nothing here reaches a real push service.
 */

const SW_SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf-8");

interface FakeNotification {
  data: { url?: string; subjects?: unknown } | null;
  close: ReturnType<typeof vi.fn>;
}

function loadServiceWorker(options: { shown?: FakeNotification[]; fetchResponse?: unknown; fetchFails?: boolean }) {
  const handlers = new Map<string, (event: unknown) => void>();
  const calls: string[] = [];
  const shown = options.shown ?? [];
  const self = {
    location: { origin: "https://takode.example" },
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(async () => void calls.push("show")),
      getNotifications: vi.fn(async () => shown),
    },
    clients: {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
      claim: vi.fn(),
    },
    navigator: {
      setAppBadge: vi.fn(async (count: number) => void calls.push(`badge ${count}`)),
      clearAppBadge: vi.fn(async () => void calls.push("badge cleared")),
    },
  };
  const fetch = vi.fn(async () => {
    if (options.fetchFails) throw new Error("offline");
    return { ok: true, json: async () => options.fetchResponse };
  });
  const console = { warn: vi.fn() };
  runInNewContext(SW_SOURCE, { self, fetch, console, URL, JSON, Promise });

  async function dispatch(type: string, event: object): Promise<void> {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  }

  return {
    self,
    fetch,
    calls,
    push: (payload: unknown) => dispatch("push", { data: { json: () => payload } }),
    tap: (data: FakeNotification["data"]) => dispatch("notificationclick", { notification: { data, close: vi.fn() } }),
  };
}

const shownAlert = (subjects: unknown): FakeNotification => ({ data: { url: "/", subjects }, close: vi.fn() });

describe("Takode service worker", () => {
  it("shows a push with its subjects kept for later, then sets the badge it carries", async () => {
    const sw = loadServiceWorker({});
    const subjects = [{ kind: "question", sessionId: "s1", notificationId: "n-1" }];

    await sw.push({ title: "Takode needs input", body: "b", url: "/#/session/s1", subjects, badge: 4 });
    await sw.push({ title: "Done", body: "b", url: "/", badge: 0 });

    expect(sw.self.registration.showNotification).toHaveBeenCalledWith("Takode needs input", {
      body: "b",
      icon: "/icon-192.png",
      data: { url: "/#/session/s1", subjects },
    });
    expect(sw.calls).toEqual(["show", "badge 4", "show", "badge cleared"]);
  });

  it("leaves the badge alone for a push without a count", async () => {
    const sw = loadServiceWorker({});
    await sw.push({ title: "Takode test", body: "Web Push works.", url: "/" });
    expect(sw.calls).toEqual(["show"]);
  });

  it("closes the shown alerts the server reports outdated when one is tapped, and sets the badge", async () => {
    const answered = shownAlert([{ kind: "question", sessionId: "s1", notificationId: "n-1" }]);
    const waiting = shownAlert([{ kind: "question", sessionId: "s1", notificationId: "n-2" }]);
    const older: FakeNotification = { data: { url: "/" }, close: vi.fn() };
    const sw = loadServiceWorker({
      shown: [answered, waiting, older],
      fetchResponse: { outdated: [true, false, false], badge: 1 },
    });

    await sw.tap({ url: "/#/session/s1?thread=main" });

    expect(sw.fetch).toHaveBeenCalledWith("/api/web-push/shown-alerts", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((sw.fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toEqual({ alerts: [answered.data!.subjects, waiting.data!.subjects, null] });
    expect(answered.close).toHaveBeenCalled();
    expect(waiting.close).not.toHaveBeenCalled();
    expect(older.close).not.toHaveBeenCalled();
    expect(sw.calls).toContain("badge 1");
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith("https://takode.example/#/session/s1?thread=main");
  });

  it("still opens Takode when the outdated check fails", async () => {
    const shown = shownAlert([{ kind: "question", sessionId: "s1", notificationId: "n-1" }]);
    const sw = loadServiceWorker({ shown: [shown], fetchFails: true });

    await sw.tap({ url: "/#/attention" });

    expect(shown.close).not.toHaveBeenCalled();
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith("https://takode.example/#/attention");
  });
});
