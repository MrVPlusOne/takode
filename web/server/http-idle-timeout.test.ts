import { HTTP_IDLE_TIMEOUT_SECONDS } from "./http-idle-timeout.js";
import { MAX_WAIT_SECONDS } from "./routes/host-exec.js";

/**
 * The regression: the coordinator's HTTP servers kept Bun's 10 s idle timeout,
 * which cut `takode exec`'s long polls, so every foreground run longer than
 * about two minutes failed. Each long poll must end before the connection may
 * be closed for idleness, with room for a slow answer; Bun refuses values
 * above 255.
 */
describe("HTTP idle timeout", () => {
  it("outlasts the longest takode exec long poll and stays within Bun's limit", () => {
    expect(HTTP_IDLE_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(MAX_WAIT_SECONDS * 2);
    expect(HTTP_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255);
  });
});
