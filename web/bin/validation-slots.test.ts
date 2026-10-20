import { describe, expect, it } from "vitest";
import { agentBrowserSession, devServerSlot, validationServerEnv } from "./validation-slots.js";

describe("validation slot mapping", () => {
  // Parallel lease holders rely on this mapping to never share a port, a HOME
  // or a browser, and no slot may land on the live server or `make dev` ports.
  it("gives every slot its own ports, state and browser session", () => {
    const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(devServerSlot);
    const ports = slots.flatMap((slot) => [slot.backendPort, slot.vitePort]);

    expect(new Set(ports).size).toBe(ports.length);
    expect(ports).not.toContain(3456);
    expect(ports).not.toContain(3457);
    expect(ports).not.toContain(5174);
    expect(new Set(slots.map((slot) => slot.home)).size).toBe(slots.length);
    expect(new Set([1, 2, 3].map(agentBrowserSession)).size).toBe(3);
  });

  it("keeps a slot's HOME inside its own state directory", () => {
    expect(devServerSlot(2)).toEqual({
      slot: 2,
      backendPort: 3472,
      vitePort: 5182,
      stateDir: "/tmp/takode-validation/dev-server-2",
      home: "/tmp/takode-validation/dev-server-2/home",
    });
  });
});

describe("validation server environment", () => {
  const inherited = {
    PATH: "/usr/bin",
    COMPANION_SESSION_ID: "live-session",
    TAKODE_REMOTE_HOST: "1",
    OPENAI_API_KEY: "live-key",
  };

  // Slots must never spend the user's live OpenAI key: an inherited key is
  // replaced by the test key, and the live server's identity is dropped.
  it("uses the test key in place of any inherited OpenAI key", () => {
    const env = validationServerEnv(inherited, devServerSlot(2), "test-key");
    expect(env).toEqual({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "test-key",
      HOME: "/tmp/takode-validation/dev-server-2/home",
      PORT: "3472",
      NODE_ENV: "development",
    });
  });

  // Without a test key the slot gets no key at all, so its voice and Read
  // aloud fail visibly instead of quietly using the live key.
  it("leaves the slot without an OpenAI key when no test key is set", () => {
    const env = validationServerEnv(inherited, devServerSlot(2), null);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
