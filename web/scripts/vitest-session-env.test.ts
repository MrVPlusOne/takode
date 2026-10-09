import { describe, expect, it } from "vitest";
import { TAKODE_SESSION_ENV } from "./vitest-session-env.js";

describe("vitest session environment", () => {
  it("runs tests without the variables of the Takode session that started the run", () => {
    // The global setup must take effect in worker processes: when the suite runs
    // from a session, CLIs spawned by tests would otherwise inherit its
    // credentials, server port and remote-host marker.
    for (const name of TAKODE_SESSION_ENV) expect(process.env[name], name).toBeUndefined();
  });
});
